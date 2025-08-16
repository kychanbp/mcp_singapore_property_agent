import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { URAClient } from './uraClient.js';
import { 
  PropertyRecord, 
  TransactionRecord, 
  RentalRecord,
  URAProperty,
  URARentalProperty 
} from '../types/index.js';
import { createSearchBounds } from '../utils/distance.js';
import { getDatabasePath } from '../utils/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PropertySearchOptions {
  maxDistanceMeters?: number;
  minPrice?: number;
  maxPrice?: number;
  propertyTypes?: string[];
  marketSegments?: string[];
  districts?: string[];
  fromDate?: string; // MMYY format
  toDate?: string;   // MMYY format
  minCompletionYear?: number;
  maxPropertyAge?: number;
  saleTypes?: string[]; // '1'=New, '2'=Sub-sale, '3'=Resale
  limit?: number;
}

export interface QuarterlyPriceTrend {
  quarter: string;      // "Q1'24"
  avgPricePerSqf: number;
  transactionCount: number;
}

export interface RecentRentalInfo {
  avgRent: number;
  quarter: string;      // "Q4'24"  
  rentalCount: number;
}

export interface PropertySearchResult {
  property: PropertyRecord;
  recentTransactions: TransactionRecord[];
  recentRentals: RentalRecord[];
  distance: number; // in meters
  pricePerSqfTrend?: QuarterlyPriceTrend[];
  latestPrice?: number;
  recentRentalInfo?: RecentRentalInfo;
}

export interface PropertySearchResponse {
  results: PropertySearchResult[];
  truncated: boolean;
  totalAvailable?: number;
}

export class DatabaseManager {
  private db: Database.Database;
  private uraClient: URAClient;
  
  constructor(dbPath?: string) {
    // Use app data directory by default, allow override
    const finalDbPath = dbPath || getDatabasePath();
    
    console.error(`Initializing database at: ${finalDbPath}`);
    this.db = new Database(finalDbPath);
    this.uraClient = new URAClient();
    
    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 1000000'); // 1GB cache
    this.db.pragma('temp_store = memory');
    
    this.initializeDatabase();
  }

  /**
   * Initialize database schema
   */
  private initializeDatabase(): void {
    const schemaPath = join(dirname(__dirname), 'database', 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    
    // Execute schema - split by semicolon and filter empty statements
    const statements = schema.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        this.db.exec(statement);
      }
    }
    
    console.error('Database schema initialized');
  }

  /**
   * Load all URA transaction data into database
   */
  async ingestTransactionData(): Promise<void> {
    console.error('Starting transaction data ingestion...');
    
    // Clear existing data
    this.db.exec('DELETE FROM transactions');
    this.db.exec('DELETE FROM properties WHERE id NOT IN (SELECT DISTINCT property_id FROM rentals)');
    
    const transactions = await this.uraClient.getAllPropertyTransactions();
    let totalTransactionCount = 0;
    
    const insertProperty = this.db.prepare(`
      INSERT OR IGNORE INTO properties (project, street, x, y, market_segment, district)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const getPropertyId = this.db.prepare(`
      SELECT id FROM properties WHERE project = ? AND street = ?
    `);
    
    const insertTransaction = this.db.prepare(`
      INSERT INTO transactions (
        property_id, price, area, contract_date, property_type,
        floor_range, no_of_units, tenure, type_of_sale, type_of_area
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const logRefresh = this.db.prepare(`
      INSERT INTO data_refresh_log (data_type, batch_or_period, record_count, status)
      VALUES (?, ?, ?, ?)
    `);

    // Process in transaction for performance
    const processTransactions = this.db.transaction((properties: URAProperty[]) => {
      for (const property of properties) {
        // Skip properties without coordinates
        if (!property.x || !property.y) {
          continue;
        }
        
        // Insert property
        insertProperty.run(
          property.project,
          property.street,
          parseFloat(property.x),
          parseFloat(property.y),
          property.marketSegment,
          property.transaction[0]?.district || null
        );
        
        // Get property ID
        const propertyRow = getPropertyId.get(property.project, property.street) as { id: number };
        if (!propertyRow) {
          console.error(`Failed to get property ID for ${property.project}`);
          continue;
        }
        
        // Insert transactions
        for (const transaction of property.transaction) {
          try {
            insertTransaction.run(
              propertyRow.id,
              parseInt(transaction.price),
              parseFloat(transaction.area),
              transaction.contractDate,
              transaction.propertyType,
              transaction.floorRange || null,
              transaction.noOfUnits || null,
              transaction.tenure || null,
              transaction.typeOfSale || null,
              transaction.typeOfArea || null
            );
            totalTransactionCount++;
          } catch (error) {
            console.error(`Failed to insert transaction for ${property.project}: ${error}`);
          }
        }
      }
    });
    
    try {
      processTransactions(transactions);
      
      // Log successful ingestion
      logRefresh.run('transactions', 'all_batches', totalTransactionCount, 'success');
      
      console.error(`Transaction data ingestion completed: ${totalTransactionCount} transactions`);
    } catch (error) {
      logRefresh.run('transactions', 'all_batches', 0, 'error');
      throw error;
    }
  }

  /**
   * Load URA rental data into database
   */
  async ingestRentalData(): Promise<void> {
    console.error('Starting rental data ingestion...');
    
    // Clear existing rental data
    this.db.exec('DELETE FROM rentals');
    
    const rentals = await this.uraClient.getRecentPropertyRentals(8); // Last 2 years
    let totalRentalCount = 0;
    
    const insertProperty = this.db.prepare(`
      INSERT OR IGNORE INTO properties (project, street, x, y, market_segment, district)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const getPropertyId = this.db.prepare(`
      SELECT id FROM properties WHERE project = ? AND street = ?
    `);
    
    const insertRental = this.db.prepare(`
      INSERT INTO rentals (
        property_id, rent, bedrooms, lease_date, area_sqm, area_sqft, property_type, district
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const logRefresh = this.db.prepare(`
      INSERT INTO data_refresh_log (data_type, batch_or_period, record_count, status)
      VALUES (?, ?, ?, ?)
    `);

    // Process in transaction for performance
    const processRentals = this.db.transaction((rentalProperties: URARentalProperty[]) => {
      for (const property of rentalProperties) {
        // Insert property (will be ignored if already exists)
        insertProperty.run(
          property.project,
          property.street,
          parseFloat(property.x),
          parseFloat(property.y),
          null, // Market segment not available in rental data
          property.rental[0]?.district || null
        );
        
        // Get property ID
        const propertyRow = getPropertyId.get(property.project, property.street) as { id: number };
        if (!propertyRow) {
          console.error(`Failed to get property ID for ${property.project}`);
          continue;
        }
        
        // Insert rental records
        for (const rental of property.rental) {
          try {
            const bedrooms = rental.noOfBedRoom ? parseInt(rental.noOfBedRoom) : null;
            
            insertRental.run(
              propertyRow.id,
              rental.rent,
              bedrooms,
              rental.leaseDate,
              rental.areaSqm || null,
              rental.areaSqft || null,
              rental.propertyType || null,
              rental.district || null
            );
            totalRentalCount++;
          } catch (error) {
            console.error(`Failed to insert rental for ${property.project}: ${error}`);
          }
        }
      }
    });
    
    try {
      processRentals(rentals);
      
      // Log successful ingestion
      logRefresh.run('rentals', 'recent_quarters', totalRentalCount, 'success');
      
      console.error(`Rental data ingestion completed: ${totalRentalCount} rentals`);
    } catch (error) {
      logRefresh.run('rentals', 'recent_quarters', 0, 'error');
      throw error;
    }
  }

  /**
   * Search for properties within distance of a location
   */
  searchPropertiesNear(
    center: { x: number; y: number }, 
    options: PropertySearchOptions = {}
  ): PropertySearchResponse {
    const {
      maxDistanceMeters = 2000,
      minPrice,
      maxPrice,
      propertyTypes,
      marketSegments,
      districts,
      fromDate,
      toDate,
      minCompletionYear,
      maxPropertyAge,
      saleTypes,
      limit = 50
    } = options;

    // Create rectangular search bounds for initial filtering
    const bounds = createSearchBounds(center, maxDistanceMeters);
    
    // Build dynamic query
    let query = `
      SELECT DISTINCT
        p.id, p.project, p.street, p.x, p.y, p.market_segment, p.district,
        -- Calculate distance
        SQRT(POWER(p.x - ?, 2) + POWER(p.y - ?, 2)) as distance
      FROM properties p
      WHERE p.x BETWEEN ? AND ?
        AND p.y BETWEEN ? AND ?
        AND SQRT(POWER(p.x - ?, 2) + POWER(p.y - ?, 2)) <= ?
    `;
    
    const params: any[] = [
      center.x, center.y, // For distance calculation
      bounds.minX, bounds.maxX,
      bounds.minY, bounds.maxY,
      center.x, center.y, maxDistanceMeters // Final distance filter
    ];
    
    // Add filters
    if (marketSegments && marketSegments.length > 0) {
      query += ` AND p.market_segment IN (${marketSegments.map(() => '?').join(',')})`;
      params.push(...marketSegments);
    }
    
    if (districts && districts.length > 0) {
      query += ` AND p.district IN (${districts.map(() => '?').join(',')})`;
      params.push(...districts);
    }
    
    // Add transaction filters if specified
    if (minPrice || maxPrice || propertyTypes || fromDate || toDate || minCompletionYear || maxPropertyAge || saleTypes) {
      query += `
        AND EXISTS (
          SELECT 1 FROM transactions t 
          WHERE t.property_id = p.id
      `;
      
      if (minPrice) {
        query += ` AND t.price >= ?`;
        params.push(minPrice);
      }
      
      if (maxPrice) {
        query += ` AND t.price <= ?`;
        params.push(maxPrice);
      }
      
      if (propertyTypes && propertyTypes.length > 0) {
        query += ` AND t.property_type IN (${propertyTypes.map(() => '?').join(',')})`;
        params.push(...propertyTypes);
      }
      
      if (fromDate) {
        query += ` AND t.contract_date >= ?`;
        params.push(fromDate);
      }
      
      if (toDate) {
        query += ` AND t.contract_date <= ?`;
        params.push(toDate);
      }
      
      // Filter by completion year
      if (minCompletionYear) {
        query += ` AND CAST(SUBSTR(t.tenure, -4) AS INTEGER) >= ?`;
        params.push(minCompletionYear);
      }
      
      // Filter by property age
      if (maxPropertyAge) {
        const minYear = 2025 - maxPropertyAge;
        query += ` AND CAST(SUBSTR(t.tenure, -4) AS INTEGER) >= ?`;
        params.push(minYear);
      }
      
      // Filter by sale type
      if (saleTypes && saleTypes.length > 0) {
        query += ` AND t.type_of_sale IN (${saleTypes.map(() => '?').join(',')})`;
        params.push(...saleTypes);
      }
      
      query += ')';
    }
    
    query += `
      ORDER BY distance ASC
      LIMIT ?
    `;
    params.push(limit);
    
    const properties = this.db.prepare(query).all(params) as (PropertyRecord & { distance: number })[];
    
    // Check if there are more results by querying with limit + 1
    const checkQuery = query.replace(/LIMIT \?$/, 'LIMIT ?');
    const checkParams = [...params.slice(0, -1), limit + 1];
    const checkProperties = this.db.prepare(checkQuery).all(checkParams) as (PropertyRecord & { distance: number })[];
    
    const truncated = checkProperties.length > limit;
    const actualResults = properties.slice(0, limit);
    
    // Enrich with transaction and rental data
    const enrichedResults = actualResults.map(property => this.enrichPropertyData(property));
    
    return {
      results: enrichedResults,
      truncated,
      totalAvailable: truncated ? undefined : actualResults.length
    };
  }

  /**
   * Parse MMYY date format to quarter string
   */
  private parseToQuarter(mmyyDate: string): string {
    const month = parseInt(mmyyDate.substring(0, 2));
    const year = parseInt(mmyyDate.substring(2, 4));
    const fullYear = year < 50 ? 2000 + year : 1900 + year; // Handle Y2K
    const quarter = Math.ceil(month / 3);
    return `Q${quarter}'${fullYear.toString().substring(2)}`;
  }

  /**
   * Calculate quarterly price per sqf trends over 5 years
   */
  private calculatePriceTrends(transactions: TransactionRecord[]): QuarterlyPriceTrend[] {
    if (transactions.length === 0) return [];
    
    // Filter valid transactions with price and area
    const validTransactions = transactions.filter(t => t.price > 0 && t.area > 0);
    if (validTransactions.length === 0) return [];
    
    // Group by quarter
    const quarterlyData = new Map<string, { total: number; count: number; pricePerSqfSum: number }>();
    
    validTransactions.forEach(t => {
      const quarter = this.parseToQuarter(t.contract_date);
      // Convert sqm to sqf (1 sqm = 10.764 sqf) and calculate price per sqf
      const areaInSqf = t.area * 10.764;
      const pricePerSqf = t.price / areaInSqf;
      
      // Validate reasonable psf range for Singapore properties ($200-$10,000 psf)
      if (pricePerSqf < 200 || pricePerSqf > 10000) {
        console.warn(`Suspicious price/sqf: $${pricePerSqf.toFixed(0)} for ${t.property_id} (Price: $${t.price}, Area: ${t.area}sqm)`);
        return; // Skip outliers
      }
      
      if (!quarterlyData.has(quarter)) {
        quarterlyData.set(quarter, { total: 0, count: 0, pricePerSqfSum: 0 });
      }
      
      const data = quarterlyData.get(quarter)!;
      data.count++;
      data.pricePerSqfSum += pricePerSqf;
    });
    
    // Convert to sorted array
    const trends: QuarterlyPriceTrend[] = [];
    quarterlyData.forEach((data, quarter) => {
      trends.push({
        quarter,
        avgPricePerSqf: Math.round(data.pricePerSqfSum / data.count),
        transactionCount: data.count
      });
    });
    
    // Sort by year and quarter (convert back to compare)
    trends.sort((a, b) => {
      const aYear = parseInt(a.quarter.substring(2));
      const bYear = parseInt(b.quarter.substring(2));
      const aQ = parseInt(a.quarter.substring(1, 2));
      const bQ = parseInt(b.quarter.substring(1, 2));
      
      if (aYear !== bYear) return aYear - bYear;
      return aQ - bQ;
    });
    
    // Limit to last 20 quarters (5 years)
    return trends.slice(-20);
  }

  /**
   * Get recent rental information from most recent quarter
   */
  private getRecentRentalInfo(rentals: RentalRecord[]): RecentRentalInfo | undefined {
    if (rentals.length === 0) return undefined;
    
    const validRentals = rentals.filter(r => r.rent > 0);
    if (validRentals.length === 0) return undefined;
    
    // Group by quarter
    const quarterlyRentals = new Map<string, { rents: number[]; count: number }>();
    
    validRentals.forEach(r => {
      const quarter = this.parseToQuarter(r.lease_date);
      
      if (!quarterlyRentals.has(quarter)) {
        quarterlyRentals.set(quarter, { rents: [], count: 0 });
      }
      
      const data = quarterlyRentals.get(quarter)!;
      data.rents.push(r.rent);
      data.count++;
    });
    
    // Get most recent quarter
    const quarters = Array.from(quarterlyRentals.keys()).sort((a, b) => {
      const aYear = parseInt(a.substring(2));
      const bYear = parseInt(b.substring(2));
      const aQ = parseInt(a.substring(1, 2));
      const bQ = parseInt(b.substring(1, 2));
      
      if (aYear !== bYear) return bYear - aYear; // Descending
      return bQ - aQ; // Descending
    });
    
    if (quarters.length === 0) return undefined;
    
    const mostRecentQuarter = quarters[0];
    const recentData = quarterlyRentals.get(mostRecentQuarter)!;
    const avgRent = Math.round(recentData.rents.reduce((sum, rent) => sum + rent, 0) / recentData.count);
    
    return {
      avgRent,
      quarter: mostRecentQuarter,
      rentalCount: recentData.count
    };
  }

  /**
   * Enrich property data with recent transactions and rentals
   */
  private enrichPropertyData(property: PropertyRecord & { distance: number }): PropertySearchResult {
    // Get recent transactions (last 2 years)
    const recentTransactions = this.db.prepare(`
      SELECT * FROM transactions 
      WHERE property_id = ? 
      ORDER BY contract_date DESC 
      LIMIT 10
    `).all(property.id) as TransactionRecord[];
    
    // Get recent rentals (last 1 year)
    const recentRentals = this.db.prepare(`
      SELECT * FROM rentals 
      WHERE property_id = ? 
      ORDER BY lease_date DESC 
      LIMIT 10
    `).all(property.id) as RentalRecord[];
    
    // Calculate quarterly trends and recent rental info
    const pricePerSqfTrend = this.calculatePriceTrends(recentTransactions);
    const recentRentalInfo = this.getRecentRentalInfo(recentRentals);
    
    // Calculate latest price
    let latestPrice: number | undefined;
    if (recentTransactions.length > 0) {
      latestPrice = recentTransactions[0].price;
    }
    
    return {
      property,
      recentTransactions,
      recentRentals,
      distance: property.distance,
      pricePerSqfTrend,
      latestPrice,
      recentRentalInfo
    };
  }

  /**
   * Search for properties near multiple locations in a single optimized query
   */
  searchPropertiesNearMultiple(
    centers: Array<{ x: number; y: number; name: string; radius?: number }>,
    options: PropertySearchOptions = {}
  ): {
    results: Array<PropertySearchResult & { searchCenter: string; distanceToCenter: number }>;
    truncated: boolean;
    totalAvailable?: number;
  } {
    const {
      minPrice,
      maxPrice,
      propertyTypes,
      marketSegments,
      districts,
      fromDate,
      toDate,
      limit = 100
    } = options;

    // Build multi-center union query
    const centerQueries: string[] = [];
    const params: any[] = [];
    
    centers.forEach((center) => {
      const radius = center.radius || 1200; // Default 1200m radius
      const bounds = createSearchBounds(center, radius);
      
      centerQueries.push(`
        SELECT DISTINCT
          p.id, p.project, p.street, p.x, p.y, p.market_segment, p.district,
          ? as search_center,
          SQRT(POWER(p.x - ?, 2) + POWER(p.y - ?, 2)) as distance_to_center
        FROM properties p
        WHERE p.x BETWEEN ? AND ?
          AND p.y BETWEEN ? AND ?
          AND SQRT(POWER(p.x - ?, 2) + POWER(p.y - ?, 2)) <= ?
      `);
      
      // Add parameters for this center
      params.push(
        center.name,           // search_center
        center.x, center.y,    // distance calculation
        bounds.minX, bounds.maxX,
        bounds.minY, bounds.maxY,
        center.x, center.y, radius  // final distance filter
      );
    });

    // Combine with UNION ALL and find closest assignment
    let query = `
      WITH multi_center_results AS (
        ${centerQueries.join(' UNION ALL ')}
      ),
      closest_assignment AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY id ORDER BY distance_to_center ASC) as closest_rank
        FROM multi_center_results
      )
      SELECT * FROM closest_assignment 
      WHERE closest_rank = 1
    `;

    // Add filters
    if (marketSegments && marketSegments.length > 0) {
      query += ` AND market_segment IN (${marketSegments.map(() => '?').join(',')})`;
      params.push(...marketSegments);
    }
    
    if (districts && districts.length > 0) {
      query += ` AND district IN (${districts.map(() => '?').join(',')})`;
      params.push(...districts);
    }
    
    // Add transaction filters if specified
    if (minPrice || maxPrice || propertyTypes || fromDate || toDate) {
      query += `
        AND EXISTS (
          SELECT 1 FROM transactions t 
          WHERE t.property_id = id
      `;
      
      if (minPrice) {
        query += ` AND t.price >= ?`;
        params.push(minPrice);
      }
      
      if (maxPrice) {
        query += ` AND t.price <= ?`;
        params.push(maxPrice);
      }
      
      if (propertyTypes && propertyTypes.length > 0) {
        query += ` AND t.property_type IN (${propertyTypes.map(() => '?').join(',')})`;
        params.push(...propertyTypes);
      }
      
      if (fromDate) {
        query += ` AND t.contract_date >= ?`;
        params.push(fromDate);
      }
      
      if (toDate) {
        query += ` AND t.contract_date <= ?`;
        params.push(toDate);
      }
      
      query += ')';
    }
    
    query += `
      ORDER BY search_center, distance_to_center ASC
      LIMIT ?
    `;
    params.push(limit);
    
    const properties = this.db.prepare(query).all(params) as Array<PropertyRecord & { 
      distance_to_center: number; 
      search_center: string 
    }>;
    
    // Check if there are more results by querying with limit + 1
    const checkQuery = query.replace(/LIMIT \?$/, 'LIMIT ?');
    const checkParams = [...params.slice(0, -1), limit + 1];
    const checkProperties = this.db.prepare(checkQuery).all(checkParams) as Array<PropertyRecord & { 
      distance_to_center: number; 
      search_center: string 
    }>;
    
    const truncated = checkProperties.length > limit;
    const actualResults = properties.slice(0, limit);
    
    // Enrich with transaction and rental data
    const enrichedResults = actualResults.map(property => {
      const enriched = this.enrichPropertyData({
        ...property,
        distance: property.distance_to_center
      });
      
      return {
        ...enriched,
        searchCenter: property.search_center,
        distanceToCenter: property.distance_to_center
      };
    });
    
    return {
      results: enrichedResults,
      truncated,
      totalAvailable: truncated ? undefined : actualResults.length
    };
  }

  /**
   * Get database statistics
   */
  getStats(): {
    properties: number;
    transactions: number;
    rentals: number;
    lastRefresh: { transactions?: string; rentals?: string };
  } {
    const propertyCount = this.db.prepare('SELECT COUNT(*) as count FROM properties').get() as { count: number };
    const transactionCount = this.db.prepare('SELECT COUNT(*) as count FROM transactions').get() as { count: number };
    const rentalCount = this.db.prepare('SELECT COUNT(*) as count FROM rentals').get() as { count: number };
    
    const lastTransactionRefresh = this.db.prepare(`
      SELECT refresh_date FROM data_refresh_log 
      WHERE data_type = 'transactions' AND status = 'success' 
      ORDER BY refresh_date DESC LIMIT 1
    `).get() as { refresh_date: string } | undefined;
    
    const lastRentalRefresh = this.db.prepare(`
      SELECT refresh_date FROM data_refresh_log 
      WHERE data_type = 'rentals' AND status = 'success' 
      ORDER BY refresh_date DESC LIMIT 1
    `).get() as { refresh_date: string } | undefined;
    
    return {
      properties: propertyCount.count,
      transactions: transactionCount.count,
      rentals: rentalCount.count,
      lastRefresh: {
        transactions: lastTransactionRefresh?.refresh_date,
        rentals: lastRentalRefresh?.refresh_date
      }
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get raw database instance for advanced queries
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}