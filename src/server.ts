import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { 
  ListToolsRequestSchema, 
  CallToolRequestSchema,
  CallToolRequest,
  ListToolsRequest
} from '@modelcontextprotocol/sdk/types.js';
import { findNearbyMrtTool } from './tools/findNearbyMrt.js';
import { compareTransportModesTool } from './tools/compareTransportModes.js';
import { searchMrtByLinesTool } from './tools/searchMrtByLines.js';
import { getDetailedRouteTool } from './tools/getDetailedRoute.js';
import { searchPropertiesTool, handleSearchProperties } from './tools/searchProperties.js';
import { searchPropertiesMultipleTool, handleSearchPropertiesMultiple } from './tools/searchPropertiesMultiple.js';
import { initPropertyDatabaseTool, handleInitPropertyDatabase } from './tools/initPropertyDatabase.js';
import { queryPropertyDataTool, handleQueryPropertyData } from './tools/queryPropertyData.js';

export function setupTools(server: Server) {
  // Register tools list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        findNearbyMrtTool.definition,
        compareTransportModesTool.definition,
        searchMrtByLinesTool.definition,
        getDetailedRouteTool.definition,
        initPropertyDatabaseTool,
        searchPropertiesTool,
        searchPropertiesMultipleTool,
        queryPropertyDataTool
      ]
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    
    try {
      switch (name) {
        case 'find_nearby_mrt':
          return await findNearbyMrtTool.handler(args);
          
        case 'compare_transport_modes':
          return await compareTransportModesTool.handler(args);
          
        case 'search_mrt_by_lines':
          return await searchMrtByLinesTool.handler(args);
          
        case 'get_detailed_route':
          return await getDetailedRouteTool.handler(args);
          
        case 'init_property_database':
          return await handleInitPropertyDatabase(args);
          
        case 'search_properties':
          return await handleSearchProperties(args);
          
        case 'search_properties_multiple':
          return await handleSearchPropertiesMultiple(args);
          
        case 'query_property_data':
          return await handleQueryPropertyData(args);
          
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      // Log error to stderr (won't interfere with MCP protocol)
      console.error(`Error in tool ${name}:`, error);
      
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Internal Error**: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
          }
        ],
        isError: true
      };
    }
  });
}