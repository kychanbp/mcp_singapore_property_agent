import { config } from 'dotenv';
import { searchPlanningZones } from './dist/tools/searchPlanningZones.js';

// Load environment variables
config();

async function testPlanningZoneSearch() {
  try {
    console.log('Testing planning zone search for Clementi...\n');
    
    const result = await searchPlanningZones({
      location: 'Clementi',
      radius_meters: 1000,
      include_statistics: true
    });
    
    console.log('Planning zone search completed successfully!');
    console.log('\n' + '='.repeat(100));
    console.log(result.content[0].text);
    console.log('='.repeat(100));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testPlanningZoneSearch();