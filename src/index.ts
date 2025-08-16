#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupTools } from './server.js';
import { config } from 'dotenv';

// Load environment variables
config();

const server = new Server({
  name: 'mcp-property-search',
  version: '1.0.0',
  description: 'Find MRT stations within commute distance in Singapore using OneMap API'
}, {
  capabilities: {
    tools: {}
  }
});

// Setup all tools
setupTools(server);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Log that server is ready (to stderr so it doesn't interfere with MCP protocol)
  console.error('MCP Property Search server is running');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});