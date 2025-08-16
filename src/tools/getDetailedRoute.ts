import { MRTFinder } from '../services/mrtFinder.js';
import { OneMapClient } from '../services/oneMapClient.js';
import { TransportMode } from '../types/index.js';
import { parseLocation, getTransportModeDisplay } from '../utils/formatters.js';

export const getDetailedRouteTool = {
  definition: {
    name: 'get_detailed_route',
    description: 'Get detailed turn-by-turn directions to an MRT station',
    inputSchema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Starting location - can be an address, postal code, or coordinates (lat,lon)',
          examples: ['117285', 'Normanton Park', '1.287,103.792']
        },
        stationName: {
          type: 'string',
          description: 'Target MRT station name',
          examples: ['Kent Ridge MRT', 'Buona Vista', 'CC24']
        },
        transportMode: {
          type: 'string',
          enum: ['walk', 'cycle', 'drive', 'pt'],
          default: 'pt',
          description: 'Mode of transport'
        },
        includeAlternatives: {
          type: 'boolean',
          default: false,
          description: 'Include alternative routes (for public transport)'
        },
        date: {
          type: 'string',
          description: 'Date for public transport routing (MM-DD-YYYY format)',
          pattern: '^\\d{2}-\\d{2}-\\d{4}$'
        },
        time: {
          type: 'string',
          description: 'Time for public transport routing (HH:MM:SS format)',
          pattern: '^\\d{2}:\\d{2}:\\d{2}$',
          default: '09:00:00'
        }
      },
      required: ['origin', 'stationName']
    }
  },

  async handler(args: any) {
    try {
      const client = new OneMapClient();
      const finder = new MRTFinder();
      
      const {
        origin,
        stationName,
        transportMode = 'pt' as TransportMode,
        includeAlternatives = false,
        date,
        time = '09:00:00'
      } = args;

      // Resolve origin location
      const originCoords = parseLocation(origin);
      let resolvedOrigin: { x: number; y: number; latitude: number; longitude: number };
      
      if (originCoords) {
        resolvedOrigin = originCoords;
      } else {
        const searchResult = await client.searchLocation(origin);
        if (searchResult.found === 0) {
          throw new Error(`Origin location "${origin}" not found`);
        }
        const result = searchResult.results[0];
        resolvedOrigin = {
          x: parseFloat(result.X),
          y: parseFloat(result.Y),
          latitude: parseFloat(result.LATITUDE),
          longitude: parseFloat(result.LONGITUDE)
        };
      }

      // Find the target station
      const stations = await client.getAllMrtStations();
      const station = stations.find(s => 
        s.name.toLowerCase().includes(stationName.toLowerCase()) ||
        s.building.toLowerCase().includes(stationName.toLowerCase()) ||
        (s.stationCode && s.stationCode.toLowerCase() === stationName.toLowerCase())
      );

      if (!station) {
        throw new Error(`MRT station "${stationName}" not found`);
      }

      // Get route details
      const options = transportMode === 'pt' ? { date, time } : {};
      const routeResponse = await client.calculateRoute(
        `${resolvedOrigin.latitude},${resolvedOrigin.longitude}`,
        `${station.latitude},${station.longitude}`,
        transportMode,
        options
      );

      let output = `**Detailed Route to ${station.name}**\n\n`;
      output += `📍 **From**: ${origin}\n`;
      output += `🎯 **To**: ${station.name}\n`;
      output += `📍 **Station Address**: ${station.address}\n`;
      if (station.stationCode) {
        output += `🚇 **Station Code**: ${station.stationCode}\n`;
      }
      output += `🚶 **Transport Mode**: ${getTransportModeDisplay(transportMode)}\n`;
      
      if (transportMode === 'pt' && (date || time !== '09:00:00')) {
        output += `📅 **Date/Time**: ${date || 'today'} at ${time}\n`;
      }
      
      output += `\n---\n\n`;

      if (transportMode === 'pt' && routeResponse.plan?.itineraries) {
        // Public transport detailed instructions
        const itineraries = routeResponse.plan.itineraries;
        
        if (itineraries.length === 0) {
          output += `❌ No public transport routes found.\n`;
        } else {
          // Primary route (fastest)
          const primary = itineraries.reduce((min, current) => 
            current.duration < min.duration ? current : min
          );
          
          output += `## Primary Route\n\n`;
          output += `⏱️ **Total Time**: ${Math.ceil(primary.duration / 60)} minutes\n`;
          output += `🚶 **Walking Time**: ${Math.ceil(primary.walkTime / 60)} minutes\n`;
          output += `🚇 **Transit Time**: ${Math.ceil(primary.transitTime / 60)} minutes\n`;
          output += `🔄 **Transfers**: ${primary.transfers || 0}\n`;
          output += `📏 **Walking Distance**: ${Math.round(primary.walkDistance)}m\n\n`;
          
          // For PT, we would need to parse the legs from the response
          // This is a simplified version
          output += `**Route Summary**: Take public transport from your location to ${station.name}\n`;
          output += `Note: Detailed step-by-step instructions would require parsing the route legs from the OneMap response.\n\n`;
          
          // Alternative routes
          if (includeAlternatives && itineraries.length > 1) {
            output += `## Alternative Routes\n\n`;
            const alternatives = itineraries
              .filter(it => it !== primary)
              .sort((a, b) => a.duration - b.duration)
              .slice(0, 2); // Show top 2 alternatives
            
            alternatives.forEach((alt, index) => {
              output += `### Alternative ${index + 1}\n`;
              output += `⏱️ **Time**: ${Math.ceil(alt.duration / 60)} minutes\n`;
              output += `🔄 **Transfers**: ${alt.transfers || 0}\n`;
              output += `🚶 **Walking**: ${Math.ceil(alt.walkTime / 60)} minutes\n\n`;
            });
          }
        }
      } else if (routeResponse.route_summary) {
        // Walk, cycle, drive route
        const summary = routeResponse.route_summary;
        output += `⏱️ **Total Time**: ${Math.ceil(summary.total_time / 60)} minutes\n`;
        output += `📏 **Distance**: ${(summary.total_distance / 1000).toFixed(1)} km\n\n`;
        
        if (routeResponse.route_instructions) {
          output += `## Turn-by-Turn Directions\n\n`;
          // Note: OneMap route_instructions format would need to be parsed
          output += `Detailed turn-by-turn instructions would be parsed from the OneMap route_instructions array.\n`;
        }
      } else {
        output += `❌ No route found or route data unavailable.\n`;
        if (routeResponse.error) {
          output += `Error: ${routeResponse.error}\n`;
        }
      }

      output += `\n💡 **Tip**: Use the compare_transport_modes tool to see other transport options to this station.`;

      return {
        content: [
          {
            type: 'text',
            text: output
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Error getting route details**: ${errorMessage}\n\n` +
                  `Please check that:\n` +
                  `- The origin location is valid\n` +
                  `- The station name is correct\n` +
                  `- The transport mode is valid`
          }
        ],
        isError: true
      };
    }
  }
};