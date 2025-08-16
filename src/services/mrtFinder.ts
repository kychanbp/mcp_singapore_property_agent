import { OneMapClient } from './oneMapClient.js';
import { 
  MRTStation, 
  RouteResult, 
  ComparisonResult, 
  TransportMode, 
  Location,
  RouteOptions 
} from '../types/index.js';
import { calculateDistance, filterByDistance, sortByDistance } from '../utils/distance.js';
import { parseLocation } from '../utils/formatters.js';
import { deduplicateStations, debugDeduplication } from '../utils/deduplication.js';

export class MRTFinder {
  private client: OneMapClient;

  constructor() {
    this.client = new OneMapClient();
  }

  async findStationsWithinTime(
    locationQuery: string,
    maxTimeMinutes: number = 30,
    transportMode: TransportMode = 'pt',
    options: RouteOptions = {}
  ): Promise<RouteResult[]> {
    // First resolve the location
    const location = await this.resolveLocation(locationQuery);
    console.error(`Resolved location ${locationQuery} to: SVY21(${location.x}, ${location.y}), WGS84(${location.latitude}, ${location.longitude})`); 
    
    // Get all MRT stations
    const stations = await this.client.getAllMrtStations();
    console.error(`Total MRT stations loaded: ${stations.length}`);
    
    // Pre-filter by distance to improve performance (only check stations within 15km)
    const nearbyStations = filterByDistance(location, stations, 15);
    
    // Sort by distance to prioritize closest stations
    const sortedStations = sortByDistance(location, nearbyStations);
    
    // Deduplicate stations to prioritize main stations over exits
    const deduplicatedStations = deduplicateStations(sortedStations);
    
    // Debug deduplication results
    debugDeduplication(sortedStations.slice(0, 100)); // Show duplicates in closest 100 stations
    
    // Only check the closest 40 unique stations to avoid API rate limits but get more diverse stations
    const stationsToCheck = deduplicatedStations.slice(0, 40);
    
    console.error(`Found ${nearbyStations.length} stations within 15km, deduplicated to ${deduplicatedStations.length} unique stations, checking closest ${stationsToCheck.length}`);
    console.error(`Closest 10 unique stations:`);
    stationsToCheck.slice(0, 10).forEach((station, index) => {
      const stationDistance = calculateDistance(location, station);
      console.error(`  ${index + 1}. ${station.name}: ${stationDistance.toFixed(1)}km`);
    });
    
    // Look for Clementi specifically in deduplicated list
    const clementiIndex = deduplicatedStations.findIndex(s => s.name.includes('CLEMENTI'));
    if (clementiIndex !== -1) {
      const clementi = deduplicatedStations[clementiIndex];
      const clementiDistance = calculateDistance(location, clementi);
      console.error(`Clementi found at rank ${clementiIndex + 1} in deduplicated list: ${clementi.name} (${clementiDistance.toFixed(1)}km)`);
    } else {
      console.error(`Clementi not found in deduplicated nearby stations`);
    }
    
    // Calculate routes to nearby stations in batches
    const destinations = stationsToCheck.map(station => ({
      lat: station.latitude,
      lon: station.longitude,
      name: station.name
    }));
    
    const routeResults = await this.client.batchCalculateRoutes(
      `${location.latitude},${location.longitude}`,
      destinations,
      transportMode,
      options
    );
    
    // Process results with enhanced error tracking
    const results: RouteResult[] = [];
    const failedStations: Array<{ station: MRTStation; error: string }> = [];
    let successCount = 0;
    let errorCount = 0;
    let withinTimeCount = 0;
    
    console.error(`Processing ${routeResults.length} route results...`);
    
    for (const routeResult of routeResults) {
      const station = stationsToCheck.find(s => s.name === routeResult.destination);
      if (!station) {
        console.error(`Station not found for destination: ${routeResult.destination}`);
        continue;
      }

      if (routeResult.result && !routeResult.error) {
        successCount++;
        
        const timeData = this.extractTimeData(routeResult.result, transportMode);
        if (timeData) {
          console.error(`${station.name}: ${timeData.totalTime} minutes`);
          if (timeData.totalTime <= maxTimeMinutes) {
            withinTimeCount++;
            const distance = calculateDistance(location, station);
            
            results.push({
              station,
              totalTime: timeData.totalTime,
              distance,
              walkTime: timeData.walkTime,
              transitTime: timeData.transitTime,
              transfers: timeData.transfers,
              mode: transportMode,
              withinTimeLimit: true
            });
          }
        } else {
          console.error(`Could not extract time data for ${station.name}`);
          failedStations.push({ station, error: 'Could not extract time data' });
        }
      } else {
        errorCount++;
        const errorMsg = routeResult.error || 'No result returned';
        console.error(`Error calculating route to ${routeResult.destination}: ${errorMsg}`);
        failedStations.push({ station, error: errorMsg });
      }
    }
    
    // Enhanced summary logging
    console.error(`Summary: ${successCount} successful, ${errorCount} errors, ${withinTimeCount} within time limit`);
    
    if (failedStations.length > 0) {
      console.error(`Failed stations (${failedStations.length}):`);
      failedStations.forEach(({ station, error }) => {
        const isRateLimit = error.includes('Too Many Requests') || error.includes('(429)');
        const errorType = isRateLimit ? 'Rate Limited' : 'Error';
        const stationDistance = calculateDistance(location, station);
        console.error(`  - ${station.name} (${stationDistance.toFixed(1)}km): ${errorType}`);
      });
      
      // Check if Clementi was in failed stations
      const clementiFailure = failedStations.find(({ station }) => station.name.includes('CLEMENTI'));
      if (clementiFailure) {
        console.error(`⚠️  Note: Clementi MRT was attempted but failed due to: ${clementiFailure.error}`);
      }
    }

    // Sort by total time
    return results.sort((a, b) => a.totalTime - b.totalTime);
  }

  async findNearestStations(
    locationQuery: string,
    count: number = 5
  ): Promise<Array<MRTStation & { distance: number }>> {
    const location = await this.resolveLocation(locationQuery);
    const stations = await this.client.getAllMrtStations();
    
    return sortByDistance(location, stations).slice(0, count);
  }

  async compareTransportModes(
    locationQuery: string,
    stationName?: string
  ): Promise<ComparisonResult> {
    const location = await this.resolveLocation(locationQuery);
    
    let station: MRTStation;
    if (stationName) {
      const stations = await this.client.getAllMrtStations();
      const found = stations.find(s => 
        s.name.toLowerCase().includes(stationName.toLowerCase()) ||
        s.building.toLowerCase().includes(stationName.toLowerCase())
      );
      if (!found) {
        throw new Error(`Station "${stationName}" not found`);
      }
      station = found;
    } else {
      // Use nearest station
      const nearest = await this.findNearestStations(locationQuery, 1);
      station = nearest[0];
    }
    
    const modes: TransportMode[] = ['walk', 'cycle', 'drive', 'pt'];
    const comparison: ComparisonResult = {
      station,
      modes: {},
      recommendation: 'walk'
    };
    
    // Calculate routes for each mode
    for (const mode of modes) {
      try {
        const routeResponse = await this.client.calculateRoute(
          `${location.latitude},${location.longitude}`,
          `${station.latitude},${station.longitude}`,
          mode,
          mode === 'pt' ? { date: undefined, time: '09:00:00' } : {}
        );
        
        const timeData = this.extractTimeData(routeResponse, mode);
        if (timeData) {
          const distance = calculateDistance(location, station);
          
          comparison.modes[mode] = {
            station,
            totalTime: timeData.totalTime,
            distance,
            walkTime: timeData.walkTime,
            transitTime: timeData.transitTime,
            transfers: timeData.transfers,
            mode,
            withinTimeLimit: timeData.totalTime <= 30
          };
        }
      } catch (error) {
        console.error(`Error calculating ${mode} route:`, error);
      }
    }
    
    // Determine recommendation (fastest mode that's within 30 minutes)
    const validModes = Object.entries(comparison.modes)
      .filter(([_, result]) => result?.withinTimeLimit)
      .sort(([_, a], [__, b]) => (a?.totalTime || Infinity) - (b?.totalTime || Infinity));
    
    if (validModes.length > 0) {
      comparison.recommendation = validModes[0][0] as TransportMode;
    }
    
    return comparison;
  }

  async filterByLines(
    locationQuery: string,
    lines: string[],
    maxTimeMinutes: number = 30,
    transportMode: TransportMode = 'pt'
  ): Promise<{ [line: string]: RouteResult[] }> {
    const allResults = await this.findStationsWithinTime(
      locationQuery,
      maxTimeMinutes,
      transportMode
    );
    
    const resultsByLine: { [line: string]: RouteResult[] } = {};
    
    for (const line of lines) {
      resultsByLine[line] = allResults.filter(result => 
        result.station.line?.toLowerCase() === line.toLowerCase()
      );
    }
    
    return resultsByLine;
  }

  private async resolveLocation(locationQuery: string): Promise<Location> {
    // First try to parse as coordinates
    const coords = parseLocation(locationQuery);
    if (coords) {
      return coords;
    }
    
    // Otherwise search using OneMap
    const searchResult = await this.client.searchLocation(locationQuery);
    if (searchResult.found === 0) {
      throw new Error(`Location "${locationQuery}" not found`);
    }
    
    const result = searchResult.results[0];
    return {
      x: parseFloat(result.X),
      y: parseFloat(result.Y),
      latitude: parseFloat(result.LATITUDE),
      longitude: parseFloat(result.LONGITUDE),
      address: result.ADDRESS
    };
  }

  private extractTimeData(
    routeResponse: any,
    mode: TransportMode
  ): { totalTime: number; walkTime?: number; transitTime?: number; transfers?: number } | null {
    if (mode === 'pt') {
      // Public transport response
      if (routeResponse.plan?.itineraries?.length > 0) {
        const fastest = routeResponse.plan.itineraries.reduce((min: any, current: any) => 
          current.duration < min.duration ? current : min
        );
        
        return {
          totalTime: Math.ceil(fastest.duration / 60), // Convert to minutes
          walkTime: Math.ceil(fastest.walkTime / 60),
          transitTime: Math.ceil(fastest.transitTime / 60),
          transfers: fastest.transfers || 0
        };
      }
    } else {
      // Walk, cycle, drive response
      if (routeResponse.route_summary) {
        return {
          totalTime: Math.ceil(routeResponse.route_summary.total_time / 60) // Convert to minutes
        };
      }
    }
    
    return null;
  }
}