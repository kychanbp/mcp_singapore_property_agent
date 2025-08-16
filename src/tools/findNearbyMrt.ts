import { MRTFinder } from '../services/mrtFinder.js';
import { formatRouteResults } from '../utils/formatters.js';
import { TransportMode } from '../types/index.js';

export const findNearbyMrtTool = {
  definition: {
    name: 'find_nearby_mrt',
    description: 'Find MRT stations within specified commute time from a location in Singapore',
    inputSchema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Starting location - can be an address, postal code, or coordinates (lat,lon)',
          examples: ['117285', 'Normanton Park', '1.287,103.792']
        },
        maxTimeMinutes: {
          type: 'number',
          description: 'Maximum commute time in minutes',
          default: 30,
          minimum: 1,
          maximum: 120
        },
        transportMode: {
          type: 'string',
          enum: ['walk', 'cycle', 'drive', 'pt'],
          default: 'pt',
          description: 'Mode of transport: walk, cycle, drive, or pt (public transport)'
        },
        date: {
          type: 'string',
          description: 'Date for public transport routing (MM-DD-YYYY format). Only used for pt mode.',
          pattern: '^\\d{2}-\\d{2}-\\d{4}$'
        },
        time: {
          type: 'string',
          description: 'Time for public transport routing (HH:MM:SS format). Only used for pt mode.',
          pattern: '^\\d{2}:\\d{2}:\\d{2}$',
          default: '09:00:00'
        }
      },
      required: ['location']
    }
  },

  async handler(args: any) {
    try {
      const finder = new MRTFinder();
      
      const {
        location,
        maxTimeMinutes = 30,
        transportMode = 'pt' as TransportMode,
        date,
        time = '09:00:00'
      } = args;

      // Validate transport mode
      const validModes: TransportMode[] = ['walk', 'cycle', 'drive', 'pt'];
      if (!validModes.includes(transportMode)) {
        throw new Error(`Invalid transport mode. Must be one of: ${validModes.join(', ')}`);
      }

      // Validate time range
      if (maxTimeMinutes < 1 || maxTimeMinutes > 120) {
        throw new Error('Maximum time must be between 1 and 120 minutes');
      }

      const options = transportMode === 'pt' ? { date, time } : {};
      
      const results = await finder.findStationsWithinTime(
        location,
        maxTimeMinutes,
        transportMode,
        options
      );

      const formattedResults = formatRouteResults(results);
      
      let summary = `**MRT Station Search Results**\n\n`;
      summary += `📍 **Origin**: ${location}\n`;
      summary += `⏱️ **Max time**: ${maxTimeMinutes} minutes\n`;
      summary += `🚇 **Transport mode**: ${transportMode.toUpperCase()}\n`;
      if (transportMode === 'pt' && (date || time !== '09:00:00')) {
        summary += `📅 **Date/Time**: ${date || 'today'} at ${time}\n`;
      }
      summary += `\n---\n\n`;
      summary += formattedResults;

      if (results.length > 0) {
        summary += `\n💡 **Tip**: Use the compare_transport_modes tool to see all transport options to a specific station.`;
      }

      return {
        content: [
          {
            type: 'text',
            text: summary
          }
        ]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Error finding MRT stations**: ${errorMessage}\n\n` +
                  `Please check that:\n` +
                  `- The location is valid (try a postal code like "117285" or address)\n` +
                  `- The transport mode is one of: walk, cycle, drive, pt\n` +
                  `- The time limit is reasonable (1-120 minutes)`
          }
        ],
        isError: true
      };
    }
  }
};