import { DatabaseManager } from '../services/databaseManager.js';

// Database schema documentation for LLM reference
const DATABASE_SCHEMA = `
-- Singapore Property Database Schema

TABLE properties:
- id (INTEGER PRIMARY KEY)
- project (TEXT) - Project name (e.g., "PARC CLEMATIS", "THE PINNACLE@DUXTON") 
- street (TEXT) - Street address
- x, y (REAL) - SVY21 coordinates for spatial queries
- market_segment (TEXT) - 'CCR'/'RCR'/'OCR' (Core Central/Rest of Core/Outside Core)
- district (TEXT) - Singapore districts '01' to '28'

TABLE transactions:
- id, property_id (INTEGER)
- price (INTEGER) - Transaction price in SGD
- area (REAL) - Floor area in square meters
- contract_date (TEXT) - MMYY format (e.g., '1224' = Dec 2024, '0125' = Jan 2025)
- property_type (TEXT) - 'Apartment'/'Condominium'/'Terrace'/'Semi-detached'/'Detached'
- floor_range (TEXT) - Floor range like '01-05', '21-25', '-' for landed
- tenure (TEXT) - Contains lease info like '99 yrs lease commencing from 2024' or 'Freehold'
- type_of_sale (TEXT) - '1'=New Sale, '2'=Sub-sale, '3'=Resale
- type_of_area (TEXT) - 'Strata'/'Land' etc.

TABLE rentals:
- id, property_id (INTEGER)  
- rent (INTEGER) - Monthly rent in SGD
- bedrooms (INTEGER) - Number of bedrooms (NULL if not specified)
- lease_date (TEXT) - MMYY format
- area_sqm, area_sqft (TEXT) - Area ranges (e.g., "160-170")
- property_type (TEXT) - Property type for rentals
- district (TEXT) - District code

USEFUL FORMULAS:
- Price per sqf: ROUND(price/(area*10.764), 0) -- Convert sqm to sqf
- Quarter extraction: 
  CASE 
    WHEN CAST(SUBSTR(contract_date,1,2) AS INTEGER) <= 3 THEN SUBSTR(contract_date,3,2)||'Q1'
    WHEN CAST(SUBSTR(contract_date,1,2) AS INTEGER) <= 6 THEN SUBSTR(contract_date,3,2)||'Q2'
    WHEN CAST(SUBSTR(contract_date,1,2) AS INTEGER) <= 9 THEN SUBSTR(contract_date,3,2)||'Q3'
    ELSE SUBSTR(contract_date,3,2)||'Q4'
  END
- Property completion year (from tenure):
  CASE 
    WHEN tenure LIKE '%commencing from%' THEN SUBSTR(tenure, -4)
    ELSE NULL
  END
- Property age: 2025 - CAST(SUBSTR(tenure, -4) AS INTEGER)
- Sale type: CASE type_of_sale WHEN '1' THEN 'New Sale' WHEN '2' THEN 'Sub-sale' WHEN '3' THEN 'Resale' END

COMMON JOINS:
- Properties with transactions: properties p JOIN transactions t ON p.id = t.property_id
- Properties with rentals: properties p JOIN rentals r ON p.id = r.property_id

TIME FILTERS:
- Last 1 year: contract_date >= '0124' (or current year-1)
- Last 2 years: contract_date >= '0123' (or current year-2) 
- Specific year: contract_date LIKE '%24' for 2024
`;

export const queryPropertyDataTool = {
  name: 'execute_property_sql',
  description: `Execute custom SQL queries against the Singapore property database. ${DATABASE_SCHEMA}`,
  inputSchema: {
    type: 'object',
    properties: {
      sql_query: {
        type: 'string',
        description: 'SQL SELECT query to execute against the property database (only SELECT statements allowed)'
      },
      description: {
        type: 'string',
        description: 'Human-readable description of what this query analyzes (optional)',
        default: 'Custom property analysis'
      },
      format: {
        type: 'string',
        enum: ['table', 'summary', 'chart'],
        description: 'Output format preference: table (structured data), summary (key insights), chart (CSV data)',
        default: 'table'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 100, max: 1000)',
        default: 100,
        minimum: 1,
        maximum: 1000
      }
    },
    required: ['sql_query']
  }
};

// SQL Security validation
function isSelectQuery(sql: string): boolean {
  const normalizedSql = sql.trim().toUpperCase();
  
  // Must start with SELECT
  if (!normalizedSql.startsWith('SELECT')) {
    return false;
  }
  
  // Block dangerous operations
  const forbiddenKeywords = [
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 
    'TRUNCATE', 'REPLACE', 'PRAGMA', 'ATTACH', 'DETACH'
  ];
  
  for (const keyword of forbiddenKeywords) {
    if (normalizedSql.includes(keyword)) {
      return false;
    }
  }
  
  return true;
}

function sanitizeSQL(sql: string, limit: number): string {
  let cleanSql = sql.trim();
  
  // Add LIMIT if not present
  if (!cleanSql.toUpperCase().includes('LIMIT')) {
    cleanSql += ` LIMIT ${limit}`;
  }
  
  return cleanSql;
}

// Example query templates for reference (documentation purposes)
const exampleQueries = {
  // Price comparison queries
  priceByDistrict: `
    SELECT 
      p.district,
      p.market_segment,
      COUNT(t.id) as transaction_count,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      ROUND(MIN(t.price/(t.area*10.764)), 0) as min_price_psf,
      ROUND(MAX(t.price/(t.area*10.764)), 0) as max_price_psf,
      ROUND(AVG(t.price), 0) as avg_total_price
    FROM properties p 
    JOIN transactions t ON p.id = t.property_id
    WHERE {where_conditions}
    GROUP BY p.district, p.market_segment
    ORDER BY avg_price_psf DESC
  `,

  // Rental analysis queries  
  rentalByBedrooms: `
    SELECT 
      r.bedrooms,
      COUNT(r.id) as rental_count,
      ROUND(AVG(r.rent), 0) as avg_rent,
      ROUND(MIN(r.rent), 0) as min_rent,
      ROUND(MAX(r.rent), 0) as max_rent,
      r.lease_date as quarter
    FROM rentals r 
    JOIN properties p ON r.property_id = p.id
    WHERE {where_conditions}
    GROUP BY r.bedrooms, r.lease_date
    ORDER BY r.bedrooms, r.lease_date DESC
  `,

  // Property type comparison
  priceByPropertyType: `
    SELECT 
      t.property_type,
      COUNT(t.id) as transaction_count,
      ROUND(AVG(t.price), 0) as avg_price,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      ROUND(AVG(t.area), 1) as avg_area_sqm
    FROM transactions t
    JOIN properties p ON t.property_id = p.id
    WHERE {where_conditions}
    GROUP BY t.property_type
    ORDER BY avg_price_psf DESC
  `,

  // Market segment analysis
  marketSegmentTrends: `
    SELECT 
      p.market_segment,
      SUBSTR(t.contract_date, 3, 2) || 'Q' || 
      CASE 
        WHEN CAST(SUBSTR(t.contract_date, 1, 2) AS INTEGER) <= 3 THEN '1'
        WHEN CAST(SUBSTR(t.contract_date, 1, 2) AS INTEGER) <= 6 THEN '2'  
        WHEN CAST(SUBSTR(t.contract_date, 1, 2) AS INTEGER) <= 9 THEN '3'
        ELSE '4'
      END as quarter,
      COUNT(t.id) as transactions,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf
    FROM properties p
    JOIN transactions t ON p.id = t.property_id  
    WHERE {where_conditions}
    GROUP BY p.market_segment, quarter
    ORDER BY quarter, p.market_segment
  `,

  // Rental yield analysis
  rentalYield: `
    SELECT 
      p.project,
      p.district,
      p.market_segment,
      r.bedrooms,
      ROUND(AVG(r.rent * 12), 0) as annual_rent,
      ROUND(AVG(t.price), 0) as avg_purchase_price,
      ROUND(AVG(r.rent * 12) / AVG(t.price) * 100, 2) as rental_yield_percent
    FROM properties p
    JOIN rentals r ON p.id = r.property_id
    JOIN transactions t ON p.id = t.property_id
    WHERE {where_conditions}
      AND r.lease_date >= '0123'  -- Last 2 years
      AND t.contract_date >= '0123'
    GROUP BY p.project, p.district, p.market_segment, r.bedrooms
    HAVING COUNT(r.id) >= 2 AND COUNT(t.id) >= 1
    ORDER BY rental_yield_percent DESC
  `,

  // Location-based queries
  nearLocation: `
    SELECT 
      p.project,
      p.street,
      p.district,
      p.market_segment,
      ROUND(AVG(t.price), 0) as avg_price,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      ROUND(AVG(r.rent), 0) as avg_rent,
      COUNT(t.id) as transactions,
      COUNT(r.id) as rentals
    FROM properties p
    LEFT JOIN transactions t ON p.id = t.property_id
    LEFT JOIN rentals r ON p.id = r.property_id
    WHERE {where_conditions}
    GROUP BY p.project, p.street, p.district, p.market_segment
    HAVING COUNT(t.id) > 0 OR COUNT(r.id) > 0
    ORDER BY avg_price_psf DESC
  `,

  // Time-based analysis
  trendAnalysis: `
    SELECT 
      SUBSTR(t.contract_date, 3, 2) || 'Q' || 
      CASE 
        WHEN CAST(SUBSTR(t.contract_date, 1, 2) AS INTEGER) <= 3 THEN '1'
        WHEN CAST(SUBSTR(t.contract_date, 1, 2) AS INTEGER) <= 6 THEN '2'
        WHEN CAST(SUBSTR(t.contract_date, 1, 2) AS INTEGER) <= 9 THEN '3'
        ELSE '4'
      END as quarter,
      COUNT(t.id) as transactions,
      ROUND(AVG(t.price), 0) as avg_price,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      ROUND(AVG(t.area), 1) as avg_area_sqm
    FROM transactions t
    JOIN properties p ON t.property_id = p.id
    WHERE {where_conditions}
    GROUP BY quarter
    ORDER BY 
      CAST(SUBSTR(quarter, 1, 2) AS INTEGER),
      CAST(SUBSTR(quarter, 4, 1) AS INTEGER)
  `,

  // Property age analysis (NEW)
  propertyAgeAnalysis: `
    SELECT 
      CASE 
        WHEN t.tenure LIKE '%commencing from%' THEN SUBSTR(t.tenure, -4)
        ELSE 'Unknown'
      END as completion_year,
      CASE 
        WHEN t.tenure LIKE '%commencing from%' THEN 2025 - CAST(SUBSTR(t.tenure, -4) AS INTEGER)
        ELSE NULL
      END as property_age,
      COUNT(t.id) as transaction_count,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      ROUND(AVG(t.price), 0) as avg_price
    FROM transactions t
    JOIN properties p ON t.property_id = p.id
    WHERE t.contract_date >= '0124' -- Recent transactions only
    GROUP BY completion_year, property_age
    ORDER BY completion_year DESC
  `,

  // New vs Resale comparison (NEW)
  newVsResale: `
    SELECT 
      CASE t.type_of_sale 
        WHEN '1' THEN 'New Sale'
        WHEN '2' THEN 'Sub-sale'
        WHEN '3' THEN 'Resale'
        ELSE 'Other'
      END as sale_type,
      COUNT(t.id) as transaction_count,
      ROUND(AVG(t.price), 0) as avg_price,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      ROUND(MIN(t.price/(t.area*10.764)), 0) as min_price_psf,
      ROUND(MAX(t.price/(t.area*10.764)), 0) as max_price_psf
    FROM transactions t
    JOIN properties p ON t.property_id = p.id
    WHERE t.contract_date >= '0124'
    GROUP BY sale_type
    ORDER BY transaction_count DESC
  `,

  // Recent new launches (NEW)
  recentNewLaunches: `
    SELECT 
      p.project,
      p.district,
      p.market_segment,
      SUBSTR(t.tenure, -4) as completion_year,
      COUNT(t.id) as units_sold,
      ROUND(AVG(t.price), 0) as avg_price,
      ROUND(AVG(t.price/(t.area*10.764)), 0) as avg_price_psf,
      MIN(t.contract_date) as first_sale_date,
      MAX(t.contract_date) as latest_sale_date
    FROM properties p
    JOIN transactions t ON p.id = t.property_id
    WHERE t.tenure LIKE '%commencing from 202%' -- Properties completed in 2020s
      AND t.type_of_sale = '1' -- New sales only
    GROUP BY p.project, p.district, p.market_segment, completion_year
    ORDER BY completion_year DESC, units_sold DESC
  `
};

// Simple SQL execution processor
class SQLExecutor {
  private dbManager: DatabaseManager;

  constructor() {
    this.dbManager = new DatabaseManager();
  }

  // Execute SQL query with security validation
  async executeQuery(sqlQuery: string, description: string = 'Custom query', format: string = 'table', limit: number = 100): Promise<any> {
    try {
      // Security validation
      if (!isSelectQuery(sqlQuery)) {
        throw new Error('Only SELECT queries are allowed. Forbidden operations detected.');
      }
      
      // Sanitize and add limits
      const safeSql = sanitizeSQL(sqlQuery, limit);
      
      console.error(`Executing SQL: ${safeSql}`);
      
      // Execute query with timeout
      const results = this.dbManager.getDatabase().prepare(safeSql).all();
      
      // Format output based on requested format
      return this.formatOutput(results, format, description, sqlQuery);
      
    } catch (error) {
      console.error('Error executing SQL query:', error);
      return this.formatError(error instanceof Error ? error.message : 'Unknown error', sqlQuery);
    } finally {
      this.dbManager.close();
    }
  }




  private formatOutput(results: any[], format: string, description: string, originalQuestion: string): any {
    if (results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `**Property Query Results**\n\n❓ **Question**: ${originalQuestion}\n🔍 **Analysis**: ${description}\n\n❌ **No data found** matching your criteria.\n\nTry:\n- Broadening your search criteria\n- Checking different districts or time periods\n- Using different property types or market segments`
        }]
      };
    }

    switch (format) {
      case 'summary':
        return this.formatSummary(results, description, originalQuestion);
      case 'chart':
        return this.formatChart(results, description, originalQuestion);
      default:
        return this.formatTable(results, description, originalQuestion);
    }
  }

  private formatTable(results: any[], description: string, originalQuestion: string): any {
    let output = `**Property Database Query Results**\n\n`;
    output += `❓ **Question**: ${originalQuestion}\n`;
    output += `🔍 **Analysis**: ${description}\n`;
    output += `📊 **Results**: ${results.length} records found\n\n`;
    output += `---\n\n`;

    // Create table header
    const columns = Object.keys(results[0]);
    const header = columns.map(col => this.formatColumnName(col)).join(' | ');
    const separator = columns.map(() => '---').join(' | ');
    
    output += `${header}\n${separator}\n`;

    // Add data rows
    results.slice(0, 20).forEach(row => {
      const values = columns.map(col => this.formatCellValue(row[col], col)).join(' | ');
      output += `${values}\n`;
    });

    if (results.length > 20) {
      output += `\n*... and ${results.length - 20} more results*\n`;
    }

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
  }

  private formatSummary(results: any[], description: string, originalQuestion: string): any {
    let output = `**Property Market Insights**\n\n`;
    output += `❓ **Question**: ${originalQuestion}\n`;
    output += `🔍 **Analysis**: ${description}\n\n`;

    // Generate summary insights based on data
    const insights = this.generateInsights(results);
    
    output += `💡 **Key Insights**:\n`;
    insights.forEach(insight => {
      output += `• ${insight}\n`;
    });

    if (results.length > 0) {
      output += `\n📈 **Top 5 Results**:\n`;
      results.slice(0, 5).forEach((row, index) => {
        output += `${index + 1}. ${this.formatRowSummary(row)}\n`;
      });
    }

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
  }

  private formatChart(results: any[], description: string, originalQuestion: string): any {
    let output = `**Property Data for Visualization**\n\n`;
    output += `❓ **Question**: ${originalQuestion}\n`;
    output += `🔍 **Analysis**: ${description}\n\n`;
    output += `📊 **Chart Data** (CSV format):\n\n`;

    // Convert to CSV format
    const columns = Object.keys(results[0]);
    output += `\`\`\`csv\n`;
    output += `${columns.join(',')}\n`;
    
    results.forEach(row => {
      const values = columns.map(col => row[col] || '');
      output += `${values.join(',')}\n`;
    });
    
    output += `\`\`\`\n\n`;
    output += `💡 Copy the CSV data above to create charts in Excel, Google Sheets, or visualization tools.`;

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
  }

  private formatColumnName(col: string): string {
    return col.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  private formatCellValue(value: any, column: string): string {
    if (value === null || value === undefined) return '-';
    
    if (column.includes('price') || column.includes('rent')) {
      return typeof value === 'number' ? `$${value.toLocaleString()}` : value;
    }
    
    if (column.includes('percent') || column.includes('yield')) {
      return typeof value === 'number' ? `${value}%` : value;
    }
    
    return value.toString();
  }

  private generateInsights(results: any[]): string[] {
    const insights: string[] = [];
    
    if (results.length === 0) return ['No data available for analysis'];

    // Basic statistics
    insights.push(`Dataset contains ${results.length} records`);

    // Look for price-related insights
    const priceColumns = Object.keys(results[0]).filter(col => 
      col.includes('price') && typeof results[0][col] === 'number'
    );
    
    if (priceColumns.length > 0) {
      const priceCol = priceColumns[0];
      const prices = results.map(r => r[priceCol]).filter(p => p > 0);
      
      if (prices.length > 0) {
        const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
        const maxPrice = Math.max(...prices);
        const minPrice = Math.min(...prices);
        
        insights.push(`Average price: $${Math.round(avgPrice).toLocaleString()}`);
        insights.push(`Price range: $${minPrice.toLocaleString()} - $${maxPrice.toLocaleString()}`);
      }
    }

    // Look for district patterns
    if (results[0].district) {
      const districts = [...new Set(results.map(r => r.district))];
      if (districts.length > 1) {
        insights.push(`Analysis covers ${districts.length} districts: ${districts.slice(0, 3).join(', ')}${districts.length > 3 ? '...' : ''}`);
      }
    }

    return insights;
  }

  private formatRowSummary(row: any): string {
    // Create a meaningful summary line for each row
    const parts: string[] = [];
    
    if (row.project) parts.push(row.project);
    if (row.district) parts.push(`D${row.district}`);
    if (row.market_segment) parts.push(row.market_segment);
    if (row.avg_price_psf) parts.push(`$${row.avg_price_psf}/sqf`);
    if (row.avg_rent) parts.push(`$${row.avg_rent}/month`);
    if (row.rental_yield_percent) parts.push(`${row.rental_yield_percent}% yield`);
    
    return parts.join(' • ');
  }

  private formatError(error: string, question: string): any {
    return {
      content: [{
        type: 'text',
        text: `**Property Query Error**\n\n❓ **Question**: ${question}\n\n❌ **Error**: ${error}\n\n💡 **Try asking**:\n- "Compare prices in District 9 vs District 10"\n- "Show 2-bedroom rental prices in Orchard"\n- "What are rental yields by property type?"\n- "Show price trends over time"\n- "Compare CCR vs RCR market segments"`
      }]
    };
  }
}

export async function handleQueryPropertyData(args: any) {
  const { sql_query, description = 'Custom property analysis', format = 'table', limit = 100 } = args;
  
  const executor = new SQLExecutor();
  return await executor.executeQuery(sql_query, description, format, limit);
}