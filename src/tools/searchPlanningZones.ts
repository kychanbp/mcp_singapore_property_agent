import { PlanningZoneClient } from '../services/planningZoneClient.js';
import { OneMapClient } from '../services/oneMapClient.js';

export const searchPlanningZonesTool = {
  name: 'search_planning_zones',
  description: 'Search for Singapore planning zones and land use information within a specified radius from a location',
  inputSchema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'Location to search from (postal code, address, or coordinates)'
      },
      radius_meters: {
        type: 'number',
        description: 'Search radius in meters (default: 1000m)',
        default: 1000,
        minimum: 100,
        maximum: 5000
      },
      include_statistics: {
        type: 'boolean',
        description: 'Include detailed land use statistics (default: true)',
        default: true
      }
    },
    required: ['location']
  }
};

export async function searchPlanningZones(args: {
  location: string;
  radius_meters?: number;
  include_statistics?: boolean;
}) {
  try {
    const { location, radius_meters = 1000, include_statistics = true } = args;
    
    console.error(`Searching for planning zones near: ${location}`);
    
    // Initialize clients
    const oneMapClient = new OneMapClient();
    const planningZoneClient = new PlanningZoneClient();
    
    // First, search for the location to get coordinates
    const searchResults = await oneMapClient.searchLocation(location);
    
    if (!searchResults.results || searchResults.results.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `❌ **Error**: Location "${location}" not found in OneMap search`
        }]
      };
    }
    
    // Use the first search result
    const locationData = searchResults.results[0];
    const latitude = parseFloat(locationData.LATITUDE);
    const longitude = parseFloat(locationData.LONGITUDE);
    
    console.error(`Found location: ${locationData.ADDRESS}, Coordinates: ${latitude}, ${longitude}`);
    
    // Get comprehensive planning zone analysis
    const analysis = await planningZoneClient.getPlanningZoneAnalysis(
      latitude,
      longitude,
      radius_meters
    );
    
    // Format the response
    let output = `# Planning Zones Near ${locationData.ADDRESS}\n\n`;
    output += `📍 **Search Location**: ${locationData.ADDRESS}\n`;
    output += `📏 **Search Radius**: ${radius_meters}m\n`;
    output += `🗺️ **Total Zones Found**: ${analysis.totalZones}\n\n`;
    
    // Property's immediate planning zone
    if (analysis.propertyZone) {
      output += `## 🏠 Property Planning Zone\n\n`;
      output += `**Land Use**: ${analysis.propertyZone.landUse}\n`;
      if (analysis.propertyZone.landUseText) {
        output += `**Description**: ${analysis.propertyZone.landUseText}\n`;
      }
      if (analysis.propertyZone.grossPlotRatio && analysis.propertyZone.grossPlotRatio !== 'EVA') {
        output += `**Gross Plot Ratio**: ${analysis.propertyZone.grossPlotRatio}\n`;
      }
      if (analysis.propertyZone.maxHeight) {
        output += `**Max Height**: ${analysis.propertyZone.maxHeight}\n`;
      }
      output += `**Last Updated**: ${analysis.propertyZone.lastUpdated.replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}\n\n`;
    } else {
      output += `## 🏠 Property Planning Zone\n\n`;
      output += `❌ **No planning zone found** for the exact property location\n\n`;
    }
    
    // Land use mix analysis
    if (analysis.totalZones > 0) {
      output += `## 📊 Land Use Mix (within ${radius_meters}m)\n\n`;
      
      const sortedLandUse = Object.entries(analysis.landUseMix)
        .sort(([,a], [,b]) => b.percentage - a.percentage);
      
      for (const [landUse, stats] of sortedLandUse) {
        const emoji = getLandUseEmoji(landUse);
        output += `${emoji} **${landUse}**: ${stats.count} zones (${stats.percentage}%)\n`;
      }
      output += `\n`;
      
      // Area characterization
      output += `## 🏘️ Area Characterization\n\n`;
      const topLandUse = sortedLandUse[0];
      if (topLandUse) {
        const [primaryUse, primaryStats] = topLandUse;
        output += `**Primary Character**: ${primaryUse} (${primaryStats.percentage}%)\n`;
        
        if (sortedLandUse.length > 1) {
          const diversityScore = calculateDiversityScore(analysis.landUseMix);
          if (diversityScore > 0.7) {
            output += `**Area Type**: Highly Mixed-Use (Diversity Score: ${diversityScore.toFixed(2)})\n`;
          } else if (diversityScore > 0.4) {
            output += `**Area Type**: Moderately Mixed-Use (Diversity Score: ${diversityScore.toFixed(2)})\n`;
          } else {
            output += `**Area Type**: Predominantly ${primaryUse} (Diversity Score: ${diversityScore.toFixed(2)})\n`;
          }
        }
        
        output += `\n${getAreaDescription(analysis.landUseMix)}\n\n`;
      }
      
      // Detailed statistics if requested
      if (include_statistics && analysis.totalZones > 0) {
        output += `## 📈 Detailed Statistics\n\n`;
        output += `- **Total Planning Zones**: ${analysis.totalZones}\n`;
        output += `- **Unique Land Use Types**: ${Object.keys(analysis.landUseMix).length}\n`;
        output += `- **Search Radius**: ${radius_meters}m (${(radius_meters/1000).toFixed(1)}km)\n`;
        
        // Most common combinations
        const topThree = sortedLandUse.slice(0, 3);
        if (topThree.length > 1) {
          const combinedPercentage = topThree.reduce((sum, [, stats]) => sum + stats.percentage, 0);
          const combination = topThree.map(([use]) => use).join(' + ');
          output += `- **Top 3 Land Uses**: ${combination} (${combinedPercentage}% combined)\n`;
        }
        
        const cacheStats = planningZoneClient.getCacheStats();
        output += `\n*Cache performance: ${cacheStats.keys} entries, ${cacheStats.hits} hits, ${cacheStats.misses} misses*\n`;
      }
    } else {
      output += `No planning zones found within ${radius_meters}m of the specified location.\n`;
    }
    
    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(`Planning zone search error: ${errorMessage}`);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **Error**: Failed to search for planning zones - ${errorMessage}`
      }]
    };
  }
}

/**
 * Get emoji representation for land use types
 */
function getLandUseEmoji(landUse: string): string {
  const emojiMap: Record<string, string> = {
    'RESIDENTIAL': '🏠',
    'COMMERCIAL': '🏢',
    'INDUSTRIAL': '🏭',
    'ROAD': '🛣️',
    'OPEN SPACE': '🌳',
    'EDUCATIONAL': '🎓',
    'MEDICAL': '🏥',
    'PLACE OF WORSHIP': '⛪',
    'TRANSPORT': '🚇',
    'UTILITY': '⚡',
    'RECREATION': '⚽',
    'AGRICULTURE': '🌾',
    'UNKNOWN': '❓'
  };
  
  return emojiMap[landUse] || '📍';
}

/**
 * Calculate land use diversity score (0 = uniform, 1 = completely diverse)
 */
function calculateDiversityScore(landUseMix: Record<string, { count: number; percentage: number }>): number {
  const percentages = Object.values(landUseMix).map(stats => stats.percentage / 100);
  
  // Shannon diversity index normalized to 0-1 scale
  const shannonIndex = -percentages.reduce((sum, p) => {
    return p > 0 ? sum + p * Math.log(p) : sum;
  }, 0);
  
  const maxPossibleDiversity = Math.log(percentages.length);
  return maxPossibleDiversity > 0 ? shannonIndex / maxPossibleDiversity : 0;
}

/**
 * Generate area description based on land use mix
 */
function getAreaDescription(landUseMix: Record<string, { count: number; percentage: number }>): string {
  const sortedUses = Object.entries(landUseMix)
    .sort(([,a], [,b]) => b.percentage - a.percentage);
  
  const hasResidential = landUseMix['RESIDENTIAL']?.percentage > 20;
  const hasCommercial = landUseMix['COMMERCIAL']?.percentage > 15;
  const hasIndustrial = landUseMix['INDUSTRIAL']?.percentage > 10;
  const hasOpenSpace = landUseMix['OPEN SPACE']?.percentage > 10;
  const hasEducational = landUseMix['EDUCATIONAL']?.percentage > 5;
  
  if (hasResidential && hasCommercial && hasOpenSpace) {
    return "**Area Character**: Well-balanced mixed-use neighborhood with good amenities and green spaces.";
  } else if (hasResidential && hasCommercial) {
    return "**Area Character**: Mixed residential-commercial area with convenient access to services.";
  } else if (hasResidential && hasEducational) {
    return "**Area Character**: Residential area with good educational facilities nearby.";
  } else if (hasCommercial && !hasResidential) {
    return "**Area Character**: Commercial district with business and retail focus.";
  } else if (hasIndustrial) {
    return "**Area Character**: Industrial area with manufacturing and business facilities.";
  } else if (landUseMix['RESIDENTIAL']?.percentage > 60) {
    return "**Area Character**: Predominantly residential neighborhood with quiet, family-oriented environment.";
  } else {
    return "**Area Character**: Mixed-use area with diverse zoning and development types.";
  }
}