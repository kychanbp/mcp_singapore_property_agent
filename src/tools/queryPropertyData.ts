import { DatabaseManager } from '../services/databaseManager.js';

export const queryPropertyDataTool = {
  name: 'query_property_data',
  description: 'Execute natural language queries against the Singapore property database for custom analysis and insights',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Natural language question about Singapore properties (e.g., "Compare rental yields in District 9 vs 10", "Show 2-bedroom prices in Orchard area")'
      },
      format: {
        type: 'string',
        enum: ['table', 'summary', 'chart'],
        description: 'Output format preference: table (structured data), summary (key insights), chart (data for visualization)',
        default: 'table'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 50, max: 200)',
        default: 50,
        minimum: 1,
        maximum: 200
      }
    },
    required: ['question']
  }
};

// Query templates for common property analysis patterns
const queryTemplates = {
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
  `
};

// Natural language processing for query generation
class PropertyQueryProcessor {
  private dbManager: DatabaseManager;

  constructor() {
    this.dbManager = new DatabaseManager();
  }

  // Parse natural language question and generate appropriate SQL
  async processQuery(question: string, format: string = 'table', limit: number = 50): Promise<any> {
    const normalizedQuery = question.toLowerCase();
    
    try {
      // Determine query type based on keywords
      const queryType = this.identifyQueryType(normalizedQuery);
      const filters = this.extractFilters(normalizedQuery);
      
      // Generate SQL query
      const { sql, description } = this.generateSQL(queryType, filters, limit);
      
      // Execute query
      const results = this.dbManager.getDatabase().prepare(sql).all();
      
      // Format output based on requested format
      return this.formatOutput(results, format, description, question);
      
    } catch (error) {
      console.error('Error processing property query:', error);
      return this.formatError(error instanceof Error ? error.message : 'Unknown error', question);
    } finally {
      this.dbManager.close();
    }
  }

  private identifyQueryType(query: string): string {
    // Keywords to identify query patterns
    if (query.includes('district') && (query.includes('compare') || query.includes('vs'))) {
      return 'priceByDistrict';
    }
    if (query.includes('bedroom') || query.includes('room')) {
      return 'rentalByBedrooms';
    }
    if (query.includes('yield') || query.includes('rental yield')) {
      return 'rentalYield';
    }
    if (query.includes('property type') || query.includes('condo') || query.includes('apartment')) {
      return 'priceByPropertyType';
    }
    if (query.includes('trend') || query.includes('over time') || query.includes('quarterly')) {
      return 'trendAnalysis';
    }
    if (query.includes('market segment') || query.includes('ccr') || query.includes('rcr') || query.includes('ocr')) {
      return 'marketSegmentTrends';
    }
    if (query.includes('near') || query.includes('around') || query.includes('orchard') || query.includes('mrt')) {
      return 'nearLocation';
    }
    
    // Default to general location-based query
    return 'nearLocation';
  }

  private extractFilters(query: string): any {
    const filters: any = {};
    
    // Extract districts
    const districtMatch = query.match(/district\s*(\d+|[0-9]+)/gi);
    if (districtMatch) {
      filters.districts = districtMatch.map(d => d.replace(/district\s*/i, '').padStart(2, '0'));
    }

    // Extract market segments
    if (query.includes('ccr')) filters.marketSegments = ['CCR'];
    if (query.includes('rcr')) filters.marketSegments = ['RCR'];
    if (query.includes('ocr')) filters.marketSegments = ['OCR'];

    // Extract property types
    if (query.includes('condo')) filters.propertyTypes = ['Condominium'];
    if (query.includes('apartment')) filters.propertyTypes = ['Apartment'];
    if (query.includes('terrace')) filters.propertyTypes = ['Terrace'];

    // Extract bedroom counts
    const bedroomMatch = query.match(/(\d+)[\s-]*bedroom/gi);
    if (bedroomMatch) {
      filters.bedrooms = bedroomMatch.map(b => parseInt(b.replace(/[\s-]*bedroom/gi, '')));
    }

    // Extract locations
    if (query.includes('orchard')) filters.location = 'orchard';
    if (query.includes('marina')) filters.location = 'marina';
    if (query.includes('sentosa')) filters.location = 'sentosa';

    // Extract time periods
    if (query.includes('last year') || query.includes('recent')) {
      filters.timeframe = 'recent';
    }
    if (query.includes('2024')) filters.year = '24';
    if (query.includes('2023')) filters.year = '23';

    return filters;
  }

  private generateSQL(queryType: string, filters: any, limit: number): { sql: string; description: string } {
    let template = queryTemplates[queryType as keyof typeof queryTemplates];
    let whereConditions: string[] = ['1=1']; // Base condition
    let description = '';

    // Apply filters based on extracted criteria
    if (filters.districts) {
      whereConditions.push(`p.district IN ('${filters.districts.join("','")}')`);
      description += `Districts: ${filters.districts.join(', ')} `;
    }

    if (filters.marketSegments) {
      whereConditions.push(`p.market_segment IN ('${filters.marketSegments.join("','")}')`);
      description += `Market: ${filters.marketSegments.join(', ')} `;
    }

    if (filters.propertyTypes) {
      whereConditions.push(`t.property_type IN ('${filters.propertyTypes.join("','")}')`);
      description += `Types: ${filters.propertyTypes.join(', ')} `;
    }

    if (filters.bedrooms) {
      whereConditions.push(`r.bedrooms IN (${filters.bedrooms.join(',')})`);
      description += `Bedrooms: ${filters.bedrooms.join(', ')} `;
    }

    if (filters.location) {
      if (filters.location === 'orchard') {
        whereConditions.push(`(p.street LIKE '%ORCHARD%' OR p.district = '09')`);
        description += 'Location: Orchard area ';
      }
    }

    if (filters.timeframe === 'recent') {
      whereConditions.push(`(t.contract_date >= '0123' OR r.lease_date >= '0123')`);
      description += 'Period: Last 2 years ';
    }

    // Replace placeholder and add limit
    const sql = template
      .replace('{where_conditions}', whereConditions.join(' AND '))
      .replace(/ORDER BY[^;]*/, `$& LIMIT ${limit}`);

    return { sql, description: description.trim() || 'General property analysis' };
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
  const { question, format = 'table', limit = 50 } = args;
  
  const processor = new PropertyQueryProcessor();
  return await processor.processQuery(question, format, limit);
}