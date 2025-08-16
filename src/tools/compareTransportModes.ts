import { MRTFinder } from '../services/mrtFinder.js';
import { formatComparisonResult } from '../utils/formatters.js';

export const compareTransportModesTool = {
  definition: {
    name: 'compare_transport_modes',
    description: 'Compare all transport modes (walk, cycle, drive, public transport) to reach an MRT station',
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
          description: 'Target MRT station name (optional - if not provided, uses nearest station)',
          examples: ['Kent Ridge MRT', 'Buona Vista', 'CC24']
        }
      },
      required: ['origin']
    }
  },

  async handler(args: any) {
    try {
      const finder = new MRTFinder();
      
      const { origin, stationName } = args;

      const comparison = await finder.compareTransportModes(origin, stationName);
      const formattedResult = formatComparisonResult(comparison);
      
      let output = `**Transport Mode Comparison**\n\n`;
      output += `📍 **Origin**: ${origin}\n`;
      output += `🎯 **Destination**: ${comparison.station.name}\n`;
      output += `📍 **Address**: ${comparison.station.address}\n`;
      if (comparison.station.stationCode) {
        output += `🚇 **Station Code**: ${comparison.station.stationCode}\n`;
      }
      output += `\n---\n\n`;
      output += formattedResult;
      
      // Add practical advice
      output += `\n**Practical Tips:**\n`;
      
      const ptResult = comparison.modes.pt;
      const walkResult = comparison.modes.walk;
      const cycleResult = comparison.modes.cycle;
      
      if (walkResult && walkResult.totalTime <= 20) {
        output += `🚶 Walking is very convenient - under 20 minutes!\n`;
      }
      
      if (cycleResult && cycleResult.totalTime <= 15) {
        output += `🚴 Cycling is very fast - under 15 minutes!\n`;
      }
      
      if (ptResult && ptResult.transfers === 0) {
        output += `🚇 Direct public transport connection - no transfers needed!\n`;
      } else if (ptResult && ptResult.transfers && ptResult.transfers > 1) {
        output += `🚇 Public transport requires ${ptResult.transfers} transfers\n`;
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
            text: `❌ **Error comparing transport modes**: ${errorMessage}\n\n` +
                  `Please check that:\n` +
                  `- The origin location is valid\n` +
                  `- The station name is correct (if provided)\n` +
                  `- Your OneMap API credentials are working`
          }
        ],
        isError: true
      };
    }
  }
};