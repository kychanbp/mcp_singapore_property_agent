import { DatabaseManager } from '../services/databaseManager.js';
import { OneMapClient } from '../services/oneMapClient.js';
import { OneMapSchoolClient } from '../services/oneMapSchoolClient.js';
import { PlanningZoneClient } from '../services/planningZoneClient.js';

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
      min_completion_year: {
        type: 'number',
        description: 'Minimum property completion year (e.g., 2020 for properties completed from 2020 onwards) (optional)',
        minimum: 1900,
        maximum: 2030
      },
      max_property_age: {
        type: 'number',
        description: 'Maximum property age in years (e.g., 5 for properties 5 years old or newer) (optional)',
        minimum: 0,
        maximum: 100
      },
      sale_types: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['1', '2', '3']
        },
        description: 'Filter by sale type: 1=New Sale, 2=Sub-sale, 3=Resale (optional)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of properties to return (default: 200)',
        default: 200,
        minimum: 1,
        maximum: 200
      },
      include_schools: {
        type: 'boolean',
        description: 'Include nearby primary schools information for each property (default: false)',
        default: false
      },
      include_planning_zones: {
        type: 'boolean',
        description: 'Include planning zone and land use information for each property (default: false)',
        default: false
      }
    },
    required: ['location']
  }
};

export async function handleSearchProperties(args: any) {
  const oneMapClient = new OneMapClient();
  const dbManager = new DatabaseManager();
  const schoolClient = new OneMapSchoolClient();
  const planningZoneClient = new PlanningZoneClient();
  
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
      min_completion_year,
      max_property_age,
      sale_types,
      limit = 200,
      include_schools = false,
      include_planning_zones = false
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
      minCompletionYear: min_completion_year,
      maxPropertyAge: max_property_age,
      saleTypes: sale_types,
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

    // Helper function to get school information for a property
    const getSchoolInfo = async (propertyStreet: string) => {
      if (!include_schools) return '';
      
      try {
        // Search for the property address to get postal code
        const propertySearch = await oneMapClient.searchLocation(propertyStreet);
        if (!propertySearch.results || propertySearch.results.length === 0) {
          return `   🏫 **Schools**: Unable to locate property for school search\n`;
        }
        
        const propertyData = propertySearch.results[0];
        const propertyPostal = propertyData.POSTAL || '';
        const propertyBlock = propertyData.BLK_NO || '';
        
        if (!propertyPostal) {
          return `   🏫 **Schools**: No postal code found for property\n`;
        }
        
        // Use the property's postal code to search for schools
        const schools = await schoolClient.getNearbyPrimarySchools(propertyPostal, propertyBlock, 2000);
        
        if (schools.length === 0) {
          return `   🏫 **Schools**: No primary schools within 2km\n`;
        }
        
        const schoolsWithin1km = schools.filter(school => school.distanceCategory === '1km');
        const schoolsWithin1to2km = schools.filter(school => school.distanceCategory === '1-2km');
        
        let schoolOutput = '';
        if (schoolsWithin1km.length > 0) {
          schoolOutput += `   🟢 **Schools (≤1km)**: ${schoolsWithin1km.length} schools - ${schoolsWithin1km.slice(0, 3).map(s => s.name).join(', ')}${schoolsWithin1km.length > 3 ? ` +${schoolsWithin1km.length - 3} more` : ''}\n`;
        }
        if (schoolsWithin1to2km.length > 0) {
          schoolOutput += `   🟡 **Schools (1-2km)**: ${schoolsWithin1to2km.length} schools - ${schoolsWithin1to2km.slice(0, 2).map(s => s.name).join(', ')}${schoolsWithin1to2km.length > 2 ? ` +${schoolsWithin1to2km.length - 2} more` : ''}\n`;
        }
        
        return schoolOutput;
      } catch (error) {
        console.error(`Failed to get school info for ${propertyStreet}: ${error}`);
        return `   🏫 **Schools**: Error loading school data\n`;
      }
    };

    // Helper function to get planning zone information for a property
    const getPlanningZoneInfo = async (propertyStreet: string) => {
      if (!include_planning_zones) return '';
      
      try {
        // Search for the property address to get coordinates
        const propertySearch = await oneMapClient.searchLocation(propertyStreet);
        if (!propertySearch.results || propertySearch.results.length === 0) {
          return `   🗺️ **Planning Zone**: Unable to locate property\n`;
        }
        
        const propertyData = propertySearch.results[0];
        const latitude = parseFloat(propertyData.LATITUDE);
        const longitude = parseFloat(propertyData.LONGITUDE);
        
        // Get planning zone analysis
        const analysis = await planningZoneClient.getPlanningZoneAnalysis(latitude, longitude, 500);
        
        let zoneOutput = '';
        if (analysis.propertyZone) {
          zoneOutput += `   🏘️ **Zone**: ${analysis.propertyZone.landUse}`;
          if (analysis.propertyZone.grossPlotRatio && analysis.propertyZone.grossPlotRatio !== 'EVA') {
            zoneOutput += ` (GPR: ${analysis.propertyZone.grossPlotRatio})`;
          }
          zoneOutput += `\n`;
          
          // Show nearby zone mix if interesting
          if (analysis.totalZones > 1) {
            const landUseTypes = Object.keys(analysis.landUseMix);
            if (landUseTypes.length > 1) {
              const topTypes = Object.entries(analysis.landUseMix)
                .sort(([,a], [,b]) => b.percentage - a.percentage)
                .slice(0, 3)
                .map(([use, stats]) => `${use} ${stats.percentage}%`);
              zoneOutput += `   🗺️ **Area Mix**: ${topTypes.join(', ')}\n`;
            }
          }
        } else {
          zoneOutput += `   🗺️ **Planning Zone**: Not found in database\n`;
        }
        
        return zoneOutput;
      } catch (error) {
        console.error(`Failed to get planning zone info for ${propertyStreet}: ${error}`);
        return `   🗺️ **Planning Zone**: Error loading zone data\n`;
      }
    };

    // Process properties and include school data if requested
    for (const [index, result] of searchResponse.results.entries()) {
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
        
        // Property age/completion year info
        if (latestTxn.tenure) {
          if (latestTxn.tenure.includes('commencing from')) {
            const completionYear = latestTxn.tenure.substring(latestTxn.tenure.lastIndexOf(' ') + 1);
            const propertyAge = 2025 - parseInt(completionYear);
            output += `   🏗️ **Completion**: ${completionYear} (${propertyAge} year${propertyAge !== 1 ? 's' : ''} old)\n`;
          } else if (latestTxn.tenure === 'Freehold') {
            output += `   🏗️ **Tenure**: Freehold\n`;
          }
        }
        
        // Sale type info
        if (latestTxn.type_of_sale) {
          const saleType = latestTxn.type_of_sale === '1' ? 'New Sale' : 
                           latestTxn.type_of_sale === '2' ? 'Sub-sale' : 
                           latestTxn.type_of_sale === '3' ? 'Resale' : 'Unknown';
          if (saleType !== 'Unknown') {
            output += `   🏷️ **Sale type**: ${saleType}\n`;
          }
        }
      }

      // Recent rental info
      if (result.recentRentalInfo) {
        const rental = result.recentRentalInfo;
        const unitText = rental.rentalCount === 1 ? 'unit' : 'units';
        output += `   🏠 **Recent rent**: $${rental.avgRent.toLocaleString()}/month (${rental.quarter}, ${rental.rentalCount} ${unitText})\n`;
      }

      // Add school information if requested
      const schoolInfo = await getSchoolInfo(prop.street);
      output += schoolInfo;

      output += `\n`;
    }

    // Add truncation notice if needed
    if (searchResponse.truncated) {
      output += `⚠️ **Note**: Results limited to 200 properties. Refine your search criteria to see different properties.\n\n`;
    }
    
    // Add helpful tips
    output += `---\n\n💡 **Tips**:\n`;
    output += `- Use \`find_nearby_mrt\` to check MRT accessibility\n`;
    output += `- Use \`search_nearby_schools\` for detailed school information\n`;
    output += `- Set \`include_schools: true\` to see primary schools for each property\n`;
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