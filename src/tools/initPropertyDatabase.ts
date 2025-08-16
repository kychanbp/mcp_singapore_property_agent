import { DatabaseManager } from '../services/databaseManager.js';

export const initPropertyDatabaseTool = {
  name: 'init_property_database',
  description: 'Initialize and load property transaction and rental data from URA API into local database. This needs to be run once before using property search features.',
  inputSchema: {
    type: 'object',
    properties: {
      load_transactions: {
        type: 'boolean',
        description: 'Load property transaction data (default: true)',
        default: true
      },
      load_rentals: {
        type: 'boolean', 
        description: 'Load property rental data (default: true)',
        default: true
      },
      force_refresh: {
        type: 'boolean',
        description: 'Force refresh even if data already exists (default: false)',
        default: false
      }
    }
  }
};

export async function handleInitPropertyDatabase(args: any) {
  const {
    load_transactions = true,
    load_rentals = true,
    force_refresh = false
  } = args;

  const dbManager = new DatabaseManager();
  
  try {
    let output = `**Property Database Initialization**\n\n`;
    
    // Check existing data
    const stats = dbManager.getStats();
    
    output += `📊 **Current database status**:\n`;
    output += `- Properties: ${stats.properties.toLocaleString()}\n`;
    output += `- Transactions: ${stats.transactions.toLocaleString()}\n`;
    output += `- Rentals: ${stats.rentals.toLocaleString()}\n`;
    
    if (stats.lastRefresh.transactions) {
      output += `- Last transaction update: ${new Date(stats.lastRefresh.transactions).toLocaleString()}\n`;
    }
    if (stats.lastRefresh.rentals) {
      output += `- Last rental update: ${new Date(stats.lastRefresh.rentals).toLocaleString()}\n`;
    }
    
    output += `\n`;

    // Check if we need to load data
    const hasTransactions = stats.transactions > 0;
    const hasRentals = stats.rentals > 0;

    if (!force_refresh && hasTransactions && hasRentals) {
      output += `✅ **Database already initialized** with ${stats.properties.toLocaleString()} properties.\n\n`;
      output += `Use \`force_refresh: true\` to reload data from URA API.\n`;
      output += `Property search is ready to use!`;
      
      return {
        content: [{
          type: 'text',
          text: output
        }]
      };
    }

    // Load transaction data
    if (load_transactions && (force_refresh || !hasTransactions)) {
      output += `🔄 **Loading property transaction data from URA API...**\n`;
      output += `This will fetch data from all 4 batches (complete Singapore coverage)\n`;
      output += `Please wait, this may take 1-2 minutes...\n\n`;
      
      const startTime = Date.now();
      await dbManager.ingestTransactionData();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      const newStats = dbManager.getStats();
      output += `✅ **Transaction data loaded successfully!**\n`;
      output += `- Duration: ${duration} seconds\n`;
      output += `- Properties: ${newStats.properties.toLocaleString()}\n`;
      output += `- Transactions: ${newStats.transactions.toLocaleString()}\n\n`;
    } else if (hasTransactions) {
      output += `ℹ️ **Skipping transactions** (already loaded, use force_refresh=true to reload)\n\n`;
    }

    // Load rental data
    if (load_rentals && (force_refresh || !hasRentals)) {
      output += `🔄 **Loading property rental data from URA API...**\n`;
      output += `This will fetch recent quarters of rental data\n`;
      output += `Please wait, this may take 30-60 seconds...\n\n`;
      
      const startTime = Date.now();
      await dbManager.ingestRentalData();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      const newStats = dbManager.getStats();
      output += `✅ **Rental data loaded successfully!**\n`;
      output += `- Duration: ${duration} seconds\n`;
      output += `- Properties: ${newStats.properties.toLocaleString()}\n`;
      output += `- Rentals: ${newStats.rentals.toLocaleString()}\n\n`;
    } else if (hasRentals) {
      output += `ℹ️ **Skipping rentals** (already loaded, use force_refresh=true to reload)\n\n`;
    }

    const finalStats = dbManager.getStats();
    
    output += `---\n\n🎉 **Database initialization complete!**\n\n`;
    output += `📊 **Final statistics**:\n`;
    output += `- Total properties: ${finalStats.properties.toLocaleString()}\n`;
    output += `- Total transactions: ${finalStats.transactions.toLocaleString()}\n`;
    output += `- Total rentals: ${finalStats.rentals.toLocaleString()}\n\n`;
    
    output += `🚀 **You can now use property search features:**\n`;
    output += `- \`search_properties\` - Find properties near a location\n`;
    output += `- Search by distance, price range, property type, and more\n`;
    output += `- Data covers 5+ years of Singapore property transactions\n\n`;
    
    output += `💡 **Tip**: Property data updates twice weekly. Run this tool with \`force_refresh: true\` to get the latest data.`;

    return {
      content: [{
        type: 'text',
        text: output
      }]
    };

  } catch (error) {
    console.error('Error initializing property database:', error);
    
    return {
      content: [{
        type: 'text',
        text: `❌ **Error initializing property database**: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease check:\n- Your internet connection\n- URA API access key in environment\n- Available disk space\n\nTry running the initialization again.`
      }]
    };
  } finally {
    dbManager.close();
  }
}