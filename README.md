# MCP Singapore Property Agent

A comprehensive MCP (Model Context Protocol) server that provides Singapore property search, MRT transport analysis, school proximity data, and urban planning insights using official Singapore government APIs.

## Features

🏠 **Property Search**: Search properties with URA transaction data, pricing trends, and market analysis  
🚇 **MRT Transport**: Find nearby MRT stations with commute time analysis  
🏫 **School Proximity**: Primary school search with distance categorization  
🗺️ **Planning Zones**: Singapore Master Plan 2019 zoning and land use analysis  
📊 **Market Intelligence**: Property age, completion dates, sale types, and rental data  
⚖️ **Transport Comparison**: Compare walking, cycling, driving, and public transport options  

## Tools Available

### Property Search Tools

#### `search_properties`
Search for properties within a specified radius with comprehensive filtering options.

**Parameters:**
- `location` (required): Address, postal code, or coordinates
- `radius_meters` (optional): Search radius (default: 2000m)
- `min_price`, `max_price` (optional): Price range filters
- `property_types` (optional): Filter by Apartment, Condominium, Terrace, etc.
- `market_segments` (optional): CCR (Core Central), RCR (Rest of Core), OCR (Outside Core)
- `min_completion_year` (optional): Filter by property completion year
- `max_property_age` (optional): Filter by property age in years
- `sale_types` (optional): New Sale, Sub-sale, Resale
- `include_schools` (optional): Include nearby primary schools data
- `include_planning_zones` (optional): Include zoning and land use data

**Example:** "Search for condominiums under $2M within 1km of Clementi with nearby schools"

#### `execute_property_sql`
Execute custom SQL queries on the property database for advanced analysis.

**Parameters:**
- `query` (required): SQL query to execute
- `description` (optional): Description of what the query does

**Example:** "Show average property prices by district for the last 6 months"

#### `init_property_database`
Initialize and populate the property database with URA transaction data.

### School Search Tools

#### `search_nearby_schools`
Find primary schools within specified distance with detailed information.

**Parameters:**
- `location` (required): Search location
- `distance_meters` (optional): Search radius (default: 2000m)

**Example:** "Find primary schools within 1km of Bukit Timah"

### Planning Zone Tools

#### `search_planning_zones`
Analyze Singapore planning zones and land use patterns around a location.

**Parameters:**
- `location` (required): Search location
- `radius_meters` (optional): Analysis radius (default: 1000m)
- `include_statistics` (optional): Include detailed zone statistics

**Example:** "Analyze planning zones around Marina Bay with statistics"

### MRT Transport Tools

#### `find_nearby_mrt`
Find MRT stations within specified commute time from a location.

**Parameters:**
- `location` (required): Address, postal code, or coordinates
- `maxTimeMinutes` (optional): Maximum commute time (default: 30)
- `transportMode` (optional): walk, cycle, drive, or pt (default: pt)

#### `compare_transport_modes`
Compare all transport modes to reach an MRT station.

#### `search_mrt_by_lines`
Find stations on specific MRT lines within time limit.

#### `get_detailed_route`
Get detailed directions to an MRT station.

## Setup

### Prerequisites

1. **Node.js 18+**
2. **OneMap API Account**: Register at [OneMap Developer Portal](https://www.onemap.gov.sg/apidocs/register)
3. **URA API Account**: Register at [URA SPACE](https://www.ura.gov.sg/maps/api/) for property data

### Installation

1. **Clone and install dependencies:**
```bash
git clone https://github.com/kychanbp/mcp_singapore_property_agent.git
cd mcp_singapore_property_agent
npm install
```

2. **Set up environment variables:**
Create a `.env` file with your API credentials:
```env
ONEMAP_EMAIL=your-email@example.com
ONEMAP_PASSWORD=your-password
URA_ACCESS_KEY=your-ura-access-key
```

3. **Download planning zones data:**
```bash
# Create data directory and download Singapore Master Plan 2019 GeoJSON
mkdir -p data/planning-zones
# Download from URA and place in data/planning-zones/MasterPlan2019LandUselayer.geojson
```

4. **Build the project:**
```bash
npm run build
```

5. **Initialize property database:**
```bash
# Run the MCP server and use the init_property_database tool
npm start
```

### Claude Desktop Configuration

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "singapore-property-agent": {
      "command": "node",
      "args": ["/full/path/to/mcp_singapore_property_agent/dist/index.js"],
      "env": {
        "ONEMAP_EMAIL": "your-email@example.com",
        "ONEMAP_PASSWORD": "your-password",
        "URA_ACCESS_KEY": "your-ura-access-key"
      }
    }
  }
}
```

**Important:** 
- Use the full absolute path to the `dist/index.js` file
- Replace the credentials with your actual API account details
- Restart Claude Desktop after making changes

## Usage Examples

Once configured in Claude Desktop, you can use natural language:

### Property Search
- "Find condominiums under $2M within 1km of Orchard with nearby schools and planning zones"
- "Search for properties in Clementi completed after 2020 with MRT access"
- "Show me resale properties in District 10 with price trends"

### Market Analysis
- "Analyze property price trends in Marina Bay for the last 2 years"
- "Compare property ages and completion dates in different districts"
- "Find new sale properties with high rental yields"

### School and Planning
- "Find primary schools within walking distance of Bukit Timah"
- "Analyze planning zones around Jurong East and show land use mix"
- "Search for residential properties near good schools with proper zoning"

### Transport Integration
- "Find properties with good MRT access and school proximity in the west"
- "Compare transport options to CBD from different residential areas"

## Data Sources

- **Property Data**: Urban Redevelopment Authority (URA) Real Estate Information System
- **Transport Data**: OneMap Singapore routing and MRT station database
- **School Data**: OneMap Singapore education facility database
- **Planning Zones**: Singapore Master Plan 2019 Land Use GeoJSON
- **Market Segments**: CCR/RCR/OCR classification system

## Technical Architecture

- **TypeScript**: Full type safety and comprehensive interfaces
- **SQLite Database**: Efficient property data storage with spatial indexing
- **Spatial Analysis**: Turf.js for geospatial operations and zone analysis
- **Caching**: Multi-layer caching for API responses and computed results
- **Authentication**: Automatic token management for all Singapore government APIs
- **Error Handling**: Robust error handling with detailed user feedback

### Performance Features

- **Spatial Indexing**: Optimized property searches with bounding box queries
- **Batch Processing**: Parallel API calls for efficient data retrieval
- **Smart Caching**: 1-hour TTL for planning zones, session-based for schools
- **Rate Limiting**: Respects all API rate limits with automatic retries

## Database Schema

### Properties Table
- Transaction data with prices, dates, property types
- Calculated fields: completion year, property age, sale type
- Spatial coordinates in SVY21 and WGS84 systems
- Market segment classification (CCR/RCR/OCR)

### Views and Indexes
- `recent_transactions`: Latest transaction per property with trends
- Spatial indexes for efficient radius-based searches
- Price trend calculations by quarter and year

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with proper TypeScript types
4. Add tests for new functionality
5. Ensure all existing tests pass
6. Submit a pull request

### Development Workflow

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Type check
npm run type-check
```

## API Rate Limits

- **OneMap API**: 250 requests per minute
- **URA API**: 10,000 requests per day
- **School API**: Session-based with auto-refresh

All APIs include automatic retry logic and respect rate limits.

## License

MIT License - see LICENSE file for details.

## Support

For issues related to:
- **OneMap API**: Check [OneMap Documentation](https://www.onemap.gov.sg/apidocs/)
- **URA API**: See [URA SPACE Documentation](https://www.ura.gov.sg/maps/api/)
- **MCP Protocol**: Visit [MCP Documentation](https://modelcontextprotocol.io/)
- **This Agent**: Open an issue in this repository

## Acknowledgments

- Urban Redevelopment Authority (URA) for property transaction data
- Singapore Land Authority (SLA) for OneMap services
- Ministry of Education (MOE) for school location data
- Singapore government for open data initiatives