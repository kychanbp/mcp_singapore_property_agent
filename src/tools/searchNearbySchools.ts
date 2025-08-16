import { OneMapSchoolClient } from '../services/oneMapSchoolClient.js';
import { OneMapClient } from '../services/oneMapClient.js';

export const searchNearbySchoolsTool = {
  name: 'search_nearby_schools',
  description: 'Search for primary schools within 1km and 1-2km from a specified location using OneMap School Query API',
  inputSchema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'Location to search from (postal code, address, or property name)'
      },
      distance_meters: {
        type: 'number',
        description: 'Maximum search distance in meters (default: 2000m for 1-2km range)',
        default: 2000,
        minimum: 500,
        maximum: 5000
      }
    },
    required: ['location']
  }
};

export async function searchNearbySchools(args: {
  location: string;
  distance_meters?: number;
}) {
  try {
    const { location, distance_meters = 2000 } = args;
    
    console.error(`Searching for primary schools near: ${location}`);
    
    // Initialize clients
    const oneMapClient = new OneMapClient();
    const schoolClient = new OneMapSchoolClient();
    
    // First, search for the location to get coordinates and postal code
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
    const postalCode = locationData.POSTAL || '';
    const blockNo = locationData.BLK_NO || '';
    
    if (!postalCode) {
      return {
        content: [{
          type: 'text',
          text: `❌ **Error**: No postal code found for location "${location}"`
        }]
      };
    }
    
    console.error(`Found location: ${locationData.ADDRESS}, Postal: ${postalCode}, Block: ${blockNo}`);
    
    // Search for nearby primary schools
    const schools = await schoolClient.getNearbyPrimarySchools(
      postalCode,
      blockNo,
      distance_meters
    );
    
    // Group schools by distance category
    const schoolsWithin1km = schools.filter(school => school.distanceCategory === '1km');
    const schoolsWithin1to2km = schools.filter(school => school.distanceCategory === '1-2km');
    
    // Format the response
    let output = `# Primary Schools Near ${locationData.ADDRESS}\n\n`;
    output += `📍 **Search Location**: ${locationData.ADDRESS} (${postalCode})\n`;
    output += `📏 **Search Radius**: ${distance_meters}m\n\n`;
    
    if (schoolsWithin1km.length > 0) {
      output += `## 🟢 Schools Within 1km (${schoolsWithin1km.length})\n\n`;
      for (const school of schoolsWithin1km) {
        output += `### ${school.name}\n`;
        output += `- **Address**: ${school.address}\n`;
        output += `- **Postal Code**: ${school.postalCode}\n`;
        output += `- **Coordinates**: ${school.coordinates.latitude.toFixed(6)}, ${school.coordinates.longitude.toFixed(6)}\n`;
        output += `- **MOE Website**: ${school.moeLink}\n\n`;
      }
    }
    
    if (schoolsWithin1to2km.length > 0) {
      output += `## 🟡 Schools Within 1-2km (${schoolsWithin1to2km.length})\n\n`;
      for (const school of schoolsWithin1to2km) {
        output += `### ${school.name}\n`;
        output += `- **Address**: ${school.address}\n`;
        output += `- **Postal Code**: ${school.postalCode}\n`;
        output += `- **Coordinates**: ${school.coordinates.latitude.toFixed(6)}, ${school.coordinates.longitude.toFixed(6)}\n`;
        output += `- **MOE Website**: ${school.moeLink}\n\n`;
      }
    }
    
    if (schools.length === 0) {
      output += `No primary schools found within ${distance_meters}m of the specified location.\n`;
    }
    
    // Add summary statistics
    output += `## Summary\n`;
    output += `- **Total Schools Found**: ${schools.length}\n`;
    output += `- **Within 1km**: ${schoolsWithin1km.length}\n`;
    output += `- **Within 1-2km**: ${schoolsWithin1to2km.length}\n`;
    
    // Add cache information
    const cacheStats = schoolClient.getCacheStats();
    output += `\n*Data cached for performance. Cache stats: ${cacheStats.keys} entries, ${cacheStats.hits} hits, ${cacheStats.misses} misses*\n`;
    
    return {
      content: [{
        type: 'text',
        text: output
      }]
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error(`School search error: ${errorMessage}`);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **Error**: Failed to search for schools - ${errorMessage}`
      }]
    };
  }
}