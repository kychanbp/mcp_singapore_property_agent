import { config } from 'dotenv';
import { handleSearchProperties } from './dist/tools/searchProperties.js';

// Load environment variables
config();

async function testPropertySearchWithZones() {
  try {
    console.log('Testing property search with planning zones for Clementi area...\n');
    
    const result = await handleSearchProperties({
      location: 'Clementi',
      radius_meters: 1000,
      limit: 2,
      include_planning_zones: true
    });
    
    console.log('Property search with planning zones completed successfully!');
    console.log('\n' + '='.repeat(120));
    console.log(result.content[0].text);
    console.log('='.repeat(120));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testPropertySearchWithZones();