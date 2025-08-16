import { DatabaseManager } from '../services/databaseManager.js';
import { OneMapClient } from '../services/oneMapClient.js';

export const searchPropertiesMultipleTool = {
  name: 'search_properties_multiple',
  description: 'Search for properties within specified distances from multiple locations (e.g., multiple MRT stations) in a single optimized query',
  inputSchema: {
    type: 'object',
    properties: {
      locations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'Location to search from (postal code, address, or coordinates)'
            },
            name: {
              type: 'string',
              description: 'Display name for this location (e.g., "Buona Vista MRT")'
            },
            radius_meters: {
              type: 'number',
              description: 'Search radius in meters (default: 1200m)',
              default: 1200
            }
          },
          required: ['location', 'name']
        },
        description: 'Array of locations to search around',
        minItems: 1,
        maxItems: 20
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
    required: ['locations']
  }
};

export async function handleSearchPropertiesMultiple(args: any) {
  const oneMapClient = new OneMapClient();
  const dbManager = new DatabaseManager();
  
  try {
    const {
      locations,
      min_price,
      max_price,
      property_types,
      market_segments,
      districts,
      from_date,
      to_date,
      limit = 200
    } = args;

    console.error(`Starting multi-location property search for ${locations.length} locations`);

    // Resolve all locations to SVY21 coordinates
    const centers: Array<{ x: number; y: number; name: string; radius: number }> = [];
    
    for (const locationSpec of locations) {
      const { location, name, radius_meters = 1200 } = locationSpec;
      
      console.error(`Resolving location: ${location} (${name})`);
      
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
          center = await oneMapClient.convertWGS84ToSVY21(first, second);
          console.error(`Converted ${name} from WGS84 to SVY21: (${center.x}, ${center.y})`);
        } else if (coordSystem === 'SVY21') {
          // Already SVY21, use directly
          center = { x: first, y: second };
          console.error(`Using SVY21 coordinates for ${name}: (${center.x}, ${center.y})`);
        } else {
          // Unknown coordinate system, fall back to OneMap search
          const searchResult = await oneMapClient.searchLocation(location);
          if (searchResult.found === 0) {
            throw new Error(`Location "${location}" (${name}) not found`);
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
          throw new Error(`Location "${location}" (${name}) not found`);
        }
        
        const result = searchResult.results[0];
        center = {
          x: parseFloat(result.X),
          y: parseFloat(result.Y)
        };
      }

      centers.push({
        ...center,
        name,
        radius: radius_meters
      });
    }

    console.error(`All locations resolved, starting multi-center search...`);

    // Perform multi-center search
    const searchOptions = {
      minPrice: min_price,
      maxPrice: max_price,
      propertyTypes: property_types,
      marketSegments: market_segments,
      districts: districts,
      fromDate: from_date,
      toDate: to_date,
      limit
    };

    const searchResponse = dbManager.searchPropertiesNearMultiple(centers, searchOptions);
    
    if (searchResponse.results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `**Multi-Location Property Search Results**\n\n📍 **Locations**: ${locations.map((l: any) => l.name).join(', ')}\n\n❌ **No properties found** matching your criteria.\n\nTry:\n- Increasing the search radius\n- Removing some filters\n- Checking if data is available in these areas`
        }]
      };
    }

    // Group results by search center
    const resultsByCenter = searchResponse.results.reduce((acc, property) => {
      if (!acc[property.searchCenter]) {
        acc[property.searchCenter] = [];
      }
      acc[property.searchCenter].push(property);
      return acc;
    }, {} as Record<string, typeof searchResponse.results>);

    // Format results
    let output = `**Multi-Location Property Search Results**\n\n`;
    output += `📍 **Search Locations**: ${locations.length} locations\n`;
    output += `🔍 **Total Properties Found**: ${searchResponse.results.length}${searchResponse.truncated ? ' (showing first 200)' : ''}\n`;
    
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

    // Display results grouped by location
    Object.entries(resultsByCenter).forEach(([centerName, centerProperties]) => {
      output += `## 🚇 ${centerName}\n`;
      output += `Found ${centerProperties.length} properties within walking distance:\n\n`;
      
      centerProperties.slice(0, 8).forEach((result: any, index: number) => {
        const prop = result.property;
        const distanceKm = (result.distanceToCenter / 1000).toFixed(1);
        
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
          
          // Price per sqm trend or single value
          if (result.pricePerSqmTrend && result.pricePerSqmTrend.length > 0) {
            const trends = result.pricePerSqmTrend;
            if (trends.length > 12) {
              // Condensed format for >12 quarters (show yearly)
              const firstTrend = trends[0];
              const lastTrend = trends[trends.length - 1];
              const yearlyTrends = trends.filter((_: any, index: number) => index % 4 === 3 || index === trends.length - 1);
              const percentChange = ((lastTrend.avgPricePerSqm - firstTrend.avgPricePerSqm) / firstTrend.avgPricePerSqm * 100).toFixed(1);
              
              const trendText = yearlyTrends.map((t: any) => `$${t.avgPricePerSqm.toLocaleString()} (${t.quarter})`).join(' → ');
              output += `   📐 **Price/sqm trend (5yr)**: ${trendText} [${percentChange > '0' ? '+' : ''}${percentChange}%]\n`;
            } else if (trends.length > 1) {
              // Full format for ≤12 quarters
              const firstTrend = trends[0];
              const lastTrend = trends[trends.length - 1];
              const percentChange = ((lastTrend.avgPricePerSqm - firstTrend.avgPricePerSqm) / firstTrend.avgPricePerSqm * 100).toFixed(1);
              
              const trendText = trends.map((t: any) => `${t.quarter}: $${t.avgPricePerSqm.toLocaleString()}`).join(' → ');
              output += `   📐 **Price/sqm trend**: ${trendText} (${percentChange > '0' ? '+' : ''}${percentChange}%)\n`;
            } else {
              // Single quarter only
              const trend = trends[0];
              output += `   📐 **Price/sqm**: $${trend.avgPricePerSqm.toLocaleString()} (${trend.quarter} only)\n`;
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
      
      if (centerProperties.length > 8) {
        output += `*... and ${centerProperties.length - 8} more properties*\n`;
      }
      
      output += `\n`;
    });

    // Add summary
    output += `---\n\n📊 **Summary by Location**:\n`;
    Object.entries(resultsByCenter).forEach(([centerName, centerProperties]) => {
      output += `- **${centerName}**: ${centerProperties.length} properties\n`;
    });

    // Add truncation notice if needed
    if (searchResponse.truncated) {
      output += `\n⚠️ **Note**: Results limited to 200 properties across all locations. Refine your search criteria to see different properties.\n`;
    }
    
    // Add helpful tips
    output += `\n💡 **Tips**:\n`;
    output += `- Each property is assigned to its closest search location\n`;
    output += `- Use single-location search for more detailed results\n`;
    output += `- Market segments: CCR (Prime), RCR (City Fringe), OCR (Suburbs)\n`;
    output += `- This multi-location search is optimized for performance`;

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };

  } catch (error) {
    console.error('Error in search_properties_multiple:', error);
    return {
      content: [{
        type: 'text',
        text: `❌ **Error in multi-location property search**: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check your search parameters and try again.`
      }]
    };
  } finally {
    dbManager.close();
  }
}