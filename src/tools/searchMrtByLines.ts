import { MRTFinder } from '../services/mrtFinder.js';
import { formatRouteResults } from '../utils/formatters.js';
import { TransportMode } from '../types/index.js';

export const searchMrtByLinesTool = {
  definition: {
    name: 'search_mrt_by_lines',
    description: 'Find MRT stations on specific lines within time limit from a location',
    inputSchema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Starting location - can be an address, postal code, or coordinates (lat,lon)',
          examples: ['117285', 'Normanton Park', '1.287,103.792']
        },
        lines: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['NS', 'EW', 'NE', 'CC', 'DT', 'TE', 'CE', 'JE', 'JS', 'CG', 'BP', 'SW', 'PE', 'PW', 'SE']
          },
          description: 'MRT line codes to search (e.g., NS for North-South, EW for East-West)',
          examples: [['CC'], ['NS', 'EW'], ['DT', 'TE']]
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
          description: 'Mode of transport'
        }
      },
      required: ['origin', 'lines']
    }
  },

  async handler(args: any) {
    try {
      const finder = new MRTFinder();
      
      const {
        origin,
        lines,
        maxTimeMinutes = 30,
        transportMode = 'pt' as TransportMode
      } = args;

      // Validate inputs
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new Error('Lines must be a non-empty array of MRT line codes');
      }

      const validLines = ['NS', 'EW', 'NE', 'CC', 'DT', 'TE', 'CE', 'JE', 'JS', 'CG', 'BP', 'SW', 'PE', 'PW', 'SE'];
      const invalidLines = lines.filter((line: string) => !validLines.includes(line));
      if (invalidLines.length > 0) {
        throw new Error(`Invalid line codes: ${invalidLines.join(', ')}. Valid codes are: ${validLines.join(', ')}`);
      }

      const resultsByLine = await finder.filterByLines(
        origin,
        lines,
        maxTimeMinutes,
        transportMode
      );

      let output = `**MRT Stations by Line**\n\n`;
      output += `📍 **Origin**: ${origin}\n`;
      output += `⏱️ **Max time**: ${maxTimeMinutes} minutes\n`;
      output += `🚇 **Transport mode**: ${transportMode.toUpperCase()}\n`;
      output += `🔍 **Lines searched**: ${lines.join(', ')}\n`;
      output += `\n---\n\n`;

      const lineNames: { [key: string]: string } = {
        'NS': 'North-South Line',
        'EW': 'East-West Line',
        'NE': 'North-East Line',
        'CC': 'Circle Line',
        'DT': 'Downtown Line',
        'TE': 'Thomson-East Coast Line',
        'CE': 'Circle Line Extension',
        'JE': 'Jurong Region Line (East)',
        'JS': 'Jurong Region Line (South)',
        'CG': 'Cross Island Line (Central)',
        'BP': 'Bukit Panjang LRT',
        'SW': 'Sengkang West LRT',
        'PE': 'Punggol East LRT',
        'PW': 'Punggol West LRT',
        'SE': 'Sengkang East LRT'
      };

      let totalStations = 0;
      
      for (const line of lines) {
        const stations = resultsByLine[line] || [];
        totalStations += stations.length;
        
        output += `## ${lineNames[line] || line} (${line})\n\n`;
        
        if (stations.length === 0) {
          output += `No stations found within ${maxTimeMinutes} minutes.\n\n`;
        } else {
          output += formatRouteResults(stations);
        }
      }

      if (totalStations === 0) {
        output += `\n💡 **No stations found**: Try increasing the time limit or using a different transport mode.\n`;
      } else {
        output += `\n📊 **Summary**: Found ${totalStations} station(s) across ${lines.length} line(s)\n`;
      }

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
            text: `❌ **Error searching MRT lines**: ${errorMessage}\n\n` +
                  `Please check that:\n` +
                  `- The origin location is valid\n` +
                  `- Line codes are correct (NS, EW, NE, CC, DT, TE, etc.)\n` +
                  `- The transport mode is valid`
          }
        ],
        isError: true
      };
    }
  }
};