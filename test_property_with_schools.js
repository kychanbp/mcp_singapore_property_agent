import { config } from 'dotenv';
import { handleSearchProperties } from './dist/tools/searchProperties.js';

// Load environment variables
config();

async function testPropertySearchWithSchools() {
  try {
    console.log('Testing property search with schools for Clementi area...\n');
    
    const result = await handleSearchProperties({
      location: 'Clementi',
      radius_meters: 1000,
      limit: 3,
      include_schools: true
    });
    
    console.log('Property search with schools completed successfully!');
    console.log('\n' + '='.repeat(100));
    console.log(result.content[0].text);
    console.log('='.repeat(100));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error('Full error:', error);
  }
}

testPropertySearchWithSchools();