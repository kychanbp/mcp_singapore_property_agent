# MCP Property Search - Singapore MRT Station Finder

An MCP (Model Context Protocol) server that helps find MRT stations within commute distance in Singapore using the OneMap API.

## Features

🚇 **Find Nearby MRT Stations**: Search for MRT stations within specified commute time  
🚶 **Multiple Transport Modes**: Walk, cycle, drive, or public transport  
⚖️ **Transport Comparison**: Compare all transport modes to a specific station  
🎯 **Line-Specific Search**: Find stations on specific MRT lines (NS, EW, CC, etc.)  
🗺️ **Detailed Routes**: Get turn-by-turn directions  

## Tools Available

### `find_nearby_mrt`
Find MRT stations within specified commute time from a location.

**Parameters:**
- `location` (required): Address, postal code, or coordinates (lat,lon)
- `maxTimeMinutes` (optional): Maximum commute time (default: 30 minutes)
- `transportMode` (optional): walk, cycle, drive, or pt (default: pt)
- `date` (optional): Date for PT routing (MM-DD-YYYY)
- `time` (optional): Time for PT routing (HH:MM:SS, default: 09:00:00)

**Example:** "Find MRT stations within 30 minutes from postal code 117285"

### `compare_transport_modes`
Compare all transport modes to reach an MRT station.

**Parameters:**
- `origin` (required): Starting location
- `stationName` (optional): Target station (if not provided, uses nearest)

**Example:** "Compare transport options to Kent Ridge MRT from Normanton Park"

### `search_mrt_by_lines`
Find stations on specific MRT lines within time limit.

**Parameters:**
- `origin` (required): Starting location
- `lines` (required): Array of line codes (NS, EW, CC, DT, TE, etc.)
- `maxTimeMinutes` (optional): Maximum time (default: 30)
- `transportMode` (optional): Transport mode (default: pt)

**Example:** "Show me Circle Line stations within cycling distance"

### `get_detailed_route`
Get detailed directions to an MRT station.

**Parameters:**
- `origin` (required): Starting location
- `stationName` (required): Target station name
- `transportMode` (optional): Transport mode (default: pt)
- `includeAlternatives` (optional): Show alternative routes
- `date`/`time` (optional): For PT routing

## Setup

### Prerequisites

1. **Node.js 18+**
2. **OneMap API Account**: Register at [OneMap Developer Portal](https://www.onemap.gov.sg/apidocs/register)

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository>
cd mcp_property_search
npm install
```

2. **Set up environment variables:**
Copy your OneMap credentials to `.env`:
```env
ONEMAP_EMAIL=your-email@example.com
ONEMAP_PASSWORD=your-password
```

3. **Build the project:**
```bash
npm run build
```

### Claude Desktop Configuration

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mcp-property-search": {
      "command": "node",
      "args": ["/full/path/to/mcp_property_search/dist/index.js"],
      "env": {
        "ONEMAP_EMAIL": "your-email@example.com",
        "ONEMAP_PASSWORD": "your-password"
      }
    }
  }
}
```

**Important:** 
- Use the full absolute path to the `dist/index.js` file
- Replace the credentials with your actual OneMap account details
- Restart Claude Desktop after making changes

### Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run built version
npm start

# Run tests
npm test
```

## Usage Examples

Once configured in Claude Desktop, you can use natural language:

- "Find MRT stations within 30 minutes from postal code 117285"
- "Compare transport options to Buona Vista MRT from Normanton Park"
- "Show me Circle Line stations within walking distance of Kent Ridge"
- "Get directions to Holland Village MRT by cycling"

## API Features Tested

✅ **Authentication**: Automatic token management with caching  
✅ **Search**: Location and MRT station search  
✅ **Routing**: Walk, cycle, drive, and public transport routing  
✅ **Real-world Validation**: Tested with postal code 117285 (found 19 stations within 30 mins)  

### Test Results from Postal 117285 (Normanton Park)
- **Buona Vista MRT**: 11 minutes by public transport
- **Kent Ridge MRT**: 14 minutes by PT, 16 minutes walking
- **Holland Village MRT**: 15 minutes by public transport
- 19 total stations within 30 minutes by public transport

## Technical Details

- **TypeScript**: Full type safety and IntelliSense support
- **Caching**: Intelligent caching for stations and routes
- **Batch Processing**: Efficient parallel route calculations
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **Rate Limiting**: Respects OneMap API limits

## Troubleshooting

### Common Issues

1. **"Authentication failed"**
   - Check your OneMap email and password in the config
   - Ensure your OneMap account is active

2. **"Location not found"**
   - Try using a postal code (e.g., "117285")
   - Check spelling of location names

3. **"No stations found"**
   - Try increasing the time limit
   - Use a different transport mode
   - Check if the location is in Singapore

4. **Claude Desktop not showing tools**
   - Ensure the full path to `dist/index.js` is correct
   - Restart Claude Desktop after config changes
   - Check that Node.js is in your PATH

### Debug Mode

Add `"DEBUG": "true"` to the environment variables in your Claude Desktop config to see detailed logging.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues related to:
- **OneMap API**: Check [OneMap Documentation](https://www.onemap.gov.sg/apidocs/)
- **MCP Protocol**: See [MCP Documentation](https://modelcontextprotocol.io/)
- **This Server**: Open an issue in this repository