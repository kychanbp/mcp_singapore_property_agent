import { DatabaseManager } from '../services/databaseManager.js';
import { OneMapClient } from '../services/oneMapClient.js';

export const searchPropertiesTool = {
  name: 'search_properties',
  description: 'Search for properties within a specified distance from a location, with optional filters for price, property type, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'Location to search from (postal code, address, or coordinates)'
      },
      radius_meters: {
        type: 'number',
        description: 'Search radius in meters (default: 2000m)',
        default: 2000
      },
      min_price: {
        type: 'number',
        description: 'Minimum property price in SGD (optional)'
      },
      max_price: {
        type: 'number',
        description: 'Maximum property price in SGD (optional)'
      },
      property_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['Apartment', 'Condominium', 'Terrace', 'Semi-detached', 'Detached', 'Strata Terrace']
        },
        description: 'Filter by property types (optional)'
      },
      market_segments: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['CCR', 'RCR', 'OCR']
        },
        description: 'Filter by market segments: CCR (Core Central), RCR (Rest of Core), OCR (Outside Core) (optional)'
      },
      districts: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Filter by Singapore districts (01-28) (optional)'
      },
      from_date: {
        type: 'string',
        pattern: '^\\d{4}$',
        description: 'Filter transactions from date (MMYY format, e.g., "0124" for Jan 2024) (optional)'
      },
      to_date: {
        type: 'string',
        pattern: '^\\d{4}$',
        description: 'Filter transactions to date (MMYY format, e.g., "1224" for Dec 2024) (optional)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of properties to return (default: 200)',
        default: 200,
        minimum: 1,
        maximum: 200
      }
    },
    required: ['location']
  }
};

export async function handleSearchProperties(args: any) {
  const oneMapClient = new OneMapClient();
  const dbManager = new DatabaseManager();
  
  try {
    const {
      location,
      radius_meters = 2000,
      min_price,
      max_price,
      property_types,
      market_segments,
      districts,
      from_date,
      to_date,
      limit = 200
    } = args;

    console.error(`Searching for properties within ${radius_meters}m of ${location}`);

    // Resolve location to SVY21 coordinates
    let center: { x: number; y: number };
    
    // Try parsing as coordinates first
    const coordMatch = location.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const first = parseFloat(coordMatch[1]);
      const second = parseFloat(coordMatch[2]);
      
      // Detect coordinate system and convert if needed
      const coordSystem = OneMapClient.detectCoordinateSystem(first, second);
      
      if (coordSystem === 'WGS84') {
        // Convert WGS84 lat/lng to SVY21
        console.error(`Converting WGS84 coordinates (${first}, ${second}) to SVY21...`);
        center = await oneMapClient.convertWGS84ToSVY21(first, second);
        console.error(`Converted to SVY21: (${center.x}, ${center.y})`);
      } else if (coordSystem === 'SVY21') {
        // Already SVY21, use directly
        console.error(`Using SVY21 coordinates directly: (${first}, ${second})`);
        center = { x: first, y: second };
      } else {
        // Unknown coordinate system, fall back to OneMap search
        console.error(`Unknown coordinate system for (${first}, ${second}), using OneMap search...`);
        const searchResult = await oneMapClient.searchLocation(location);
        if (searchResult.found === 0) {
          throw new Error(`Location "${location}" not found`);
        }
        
        const result = searchResult.results[0];
        center = {
          x: parseFloat(result.X),
          y: parseFloat(result.Y)
        };
      }
    } else {
      // Search using OneMap
      const searchResult = await oneMapClient.searchLocation(location);
      if (searchResult.found === 0) {
        throw new Error(`Location "${location}" not found`);
      }
      
      const result = searchResult.results[0];
      center = {
        x: parseFloat(result.X),
        y: parseFloat(result.Y)
      };
    }

    console.error(`Resolved location to SVY21: ${center.x}, ${center.y}`);

    // Search for properties
    const searchOptions = {
      maxDistanceMeters: radius_meters,
      minPrice: min_price,
      maxPrice: max_price,
      propertyTypes: property_types,
      marketSegments: market_segments,
      districts: districts,
      fromDate: from_date,
      toDate: to_date,
      limit
    };

    const searchResponse = dbManager.searchPropertiesNear(center, searchOptions);
    
    if (searchResponse.results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `**Property Search Results**\n\n📍 **Location**: ${location}\n🔍 **Radius**: ${radius_meters}m\n\n❌ **No properties found** matching your criteria.\n\nTry:\n- Increasing the search radius\n- Removing some filters\n- Checking if data is available for this area`
        }]
      };
    }

    // Format results
    let output = `**Property Search Results**\n\n`;
    output += `📍 **Location**: ${location}\n`;
    output += `🔍 **Radius**: ${radius_meters}m\n`;
    if (min_price || max_price) {
      output += `💰 **Price range**: ${min_price ? `$${min_price.toLocaleString()}` : 'Any'} - ${max_price ? `$${max_price.toLocaleString()}` : 'Any'}\n`;
    }
    if (property_types && property_types.length > 0) {
      output += `🏠 **Property types**: ${property_types.join(', ')}\n`;
    }
    if (market_segments && market_segments.length > 0) {
      output += `📊 **Market segments**: ${market_segments.join(', ')}\n`;
    }
    output += `\n---\n\n`;
    output += `Found ${searchResponse.results.length} propert${searchResponse.results.length === 1 ? 'y' : 'ies'}${searchResponse.truncated ? ' (showing first 200)' : ''}:\n\n`;

    searchResponse.results.forEach((result, index) => {
      const prop = result.property;
      const distanceKm = (result.distance / 1000).toFixed(1);
      
      output += `**${index + 1}. ${prop.project}**\n`;
      output += `   📍 **Address**: ${prop.street}\n`;
      output += `   📏 **Distance**: ${distanceKm}km\n`;
      
      if (prop.market_segment) {
        output += `   📊 **Market**: ${prop.market_segment}\n`;
      }
      
      if (prop.district) {
        output += `   🗺️ **District**: ${prop.district}\n`;
      }

      // Recent transaction info
      if (result.recentTransactions.length > 0) {
        const latestTxn = result.recentTransactions[0];
        output += `   💰 **Latest sale**: $${latestTxn.price.toLocaleString()} (${latestTxn.contract_date.substring(0,2)}/${latestTxn.contract_date.substring(2)})\n`;
        
        // Price per sqf trend or single value
        if (result.pricePerSqfTrend && result.pricePerSqfTrend.length > 0) {
          const trends = result.pricePerSqfTrend;
          if (trends.length > 12) {
            // Condensed format for >12 quarters (show yearly)
            const firstTrend = trends[0];
            const lastTrend = trends[trends.length - 1];
            const yearlyTrends = trends.filter((_: any, index: number) => index % 4 === 3 || index === trends.length - 1);
            const percentChange = ((lastTrend.avgPricePerSqf - firstTrend.avgPricePerSqf) / firstTrend.avgPricePerSqf * 100).toFixed(1);
            
            const trendText = yearlyTrends.map((t: any) => `$${t.avgPricePerSqf.toLocaleString()} (${t.quarter})`).join(' → ');
            output += `   📐 **Price/sqf trend (5yr)**: ${trendText} [${percentChange > '0' ? '+' : ''}${percentChange}%]\n`;
          } else if (trends.length > 1) {
            // Full format for ≤12 quarters
            const firstTrend = trends[0];
            const lastTrend = trends[trends.length - 1];
            const percentChange = ((lastTrend.avgPricePerSqf - firstTrend.avgPricePerSqf) / firstTrend.avgPricePerSqf * 100).toFixed(1);
            
            const trendText = trends.map((t: any) => `${t.quarter}: $${t.avgPricePerSqf.toLocaleString()}`).join(' → ');
            output += `   📐 **Price/sqf trend**: ${trendText} (${percentChange > '0' ? '+' : ''}${percentChange}%)\n`;
          } else {
            // Single quarter only
            const trend = trends[0];
            output += `   📐 **Price/sqf**: $${trend.avgPricePerSqf.toLocaleString()} (${trend.quarter} only)\n`;
          }
        }
        
        output += `   🏢 **Property type**: ${latestTxn.property_type}\n`;
      }

      // Recent rental info
      if (result.recentRentalInfo) {
        const rental = result.recentRentalInfo;
        const unitText = rental.rentalCount === 1 ? 'unit' : 'units';
        output += `   🏠 **Recent rent**: $${rental.avgRent.toLocaleString()}/month (${rental.quarter}, ${rental.rentalCount} ${unitText})\n`;
      }

      output += `\n`;
    });

    // Add truncation notice if needed
    if (searchResponse.truncated) {
      output += `⚠️ **Note**: Results limited to 200 properties. Refine your search criteria to see different properties.\n\n`;
    }
    
    // Add helpful tips
    output += `---\n\n💡 **Tips**:\n`;
    output += `- Use \`find_nearby_mrt\` to check MRT accessibility\n`;
    output += `- Adjust radius or filters to see more/fewer results\n`;
    output += `- Market segments: CCR (Prime), RCR (City Fringe), OCR (Suburbs)`;

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };

  } catch (error) {
    console.error('Error in search_properties:', error);
    return {
      content: [{
        type: 'text',
        text: `❌ **Error searching properties**: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your search parameters and try again.`
      }]
    };
  } finally {
    dbManager.close();
  }
}