import { config } from 'dotenv';
import { searchNearbySchools } from './dist/tools/searchNearbySchools.js';

// Load environment variables
config();

async function testSchoolSearch() {
  try {
    console.log('Testing school search for Parc Clementi within 1km...\n');
    
    const result = await searchNearbySchools({
      location: 'PARC CLEMATIS',
      distance_meters: 1000
    });
    
    console.log('Search completed successfully!');
    console.log('\n' + '='.repeat(80));
    console.log(result.content[0].text);
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testSchoolSearch();