import axios from 'axios';
import { AuthManager } from './authManager.js';
import { 
  OneMapSearchResponse, 
  OneMapRouteResponse, 
  TransportMode, 
  RouteOptions,
  MRTStation 
} from '../types/index.js';
import NodeCache from 'node-cache';

export class OneMapClient {
  private authManager: AuthManager;
  private cache: NodeCache;
  private baseUrl = 'https://www.onemap.gov.sg/api';

  constructor() {
    this.authManager = new AuthManager();
    this.cache = new NodeCache({ stdTTL: 86400 }); // 24 hours cache
  }

  async searchLocation(query: string): Promise<OneMapSearchResponse> {
    const cacheKey = `search_${query}`;
    const cached = this.cache.get<OneMapSearchResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await axios.get<OneMapSearchResponse>(
        `${this.baseUrl}/common/elastic/search`,
        {
          params: {
            searchVal: query,
            returnGeom: 'Y',
            getAddrDetails: 'Y'
          }
        }
      );

      this.cache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to search location: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to search location: ${error}`);
    }
  }

  async getAllMrtStations(): Promise<MRTStation[]> {
    const cacheKey = 'all_mrt_stations';
    const cached = this.cache.get<MRTStation[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Get first page to see total pages
      const firstResponse = await this.searchLocation('MRT STATION');
      const totalPages = firstResponse.totalNumPages;
      
      console.error(`Loading MRT stations: ${firstResponse.found} total across ${totalPages} pages`);
      
      let allStations: MRTStation[] = [];
      
      // Process first page
      allStations.push(...this.convertToMRTStations(firstResponse.results));
      
      // Fetch remaining pages
      for (let page = 2; page <= totalPages; page++) {
        try {
          const response = await axios.get<OneMapSearchResponse>(
            `${this.baseUrl}/common/elastic/search`,
            {
              params: {
                searchVal: 'MRT STATION',
                returnGeom: 'Y',
                getAddrDetails: 'Y',
                pageNum: page
              }
            }
          );
          
          allStations.push(...this.convertToMRTStations(response.data.results));
          
          if (page % 10 === 0) {
            console.error(`Loaded ${page}/${totalPages} pages...`);
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`Failed to load page ${page}: ${error}`);
        }
      }

      console.error(`Total MRT stations loaded: ${allStations.length}`);
      
      // Cache for 24 hours (MRT stations don't change often)
      this.cache.set(cacheKey, allStations, 86400);
      return allStations;
    } catch (error) {
      throw new Error(`Failed to get MRT stations: ${error}`);
    }
  }

  private convertToMRTStations(results: any[]): MRTStation[] {
    return results.map(result => {
      // Extract line code from building name
      const lineMatch = result.BUILDING.match(/\(([A-Z]{2}\d+)\)$/);
      const stationCode = lineMatch ? lineMatch[1] : undefined;
      const line = stationCode ? stationCode.replace(/\d+$/, '') : undefined;

      return {
        name: result.BUILDING,
        building: result.BUILDING,
        address: result.ADDRESS,
        postal: result.POSTAL,
        x: parseFloat(result.X),
        y: parseFloat(result.Y),
        latitude: parseFloat(result.LATITUDE),
        longitude: parseFloat(result.LONGITUDE),
        line,
        stationCode
      };
    });
  }

  async calculateRoute(
    start: string,
    end: string,
    routeType: TransportMode,
    options: RouteOptions = {}
  ): Promise<OneMapRouteResponse> {
    const cacheKey = `route_${start}_${end}_${routeType}_${JSON.stringify(options)}`;
    const cached = this.cache.get<OneMapRouteResponse>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const token = await this.authManager.getToken();
      
      const params: any = {
        start,
        end,
        routeType
      };

      // Add public transport specific parameters
      if (routeType === 'pt') {
        params.mode = options.mode || 'TRANSIT';
        params.date = options.date || this.getCurrentDate();
        params.time = options.time || '09:00:00';
        params.maxWalkDistance = options.maxWalkDistance || 1500;
      }

      const response = await axios.get<OneMapRouteResponse>(
        `${this.baseUrl}/public/routingsvc/route`,
        {
          params,
          headers: {
            'Authorization': `Bearer ${token}`
          },
          timeout: 30000 // 30 second timeout
        }
      );

      // Cache successful responses for 24 hours (routes don't change often)
      if (!response.data.error && !response.data.message) {
        this.cache.set(cacheKey, response.data, 86400); // 24 hours
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          // Token might be expired, clear it and try once more
          this.authManager.clearToken();
          throw new Error('Authentication failed. Please check your OneMap credentials.');
        }
        // Include status code in error for better handling
        const status = error.response?.status || 0;
        const message = error.response?.data?.message || error.message;
        throw new Error(`Failed to calculate route: ${message} (${status})`);
      }
      throw new Error(`Failed to calculate route: ${error}`);
    }
  }

  /**
   * Calculate route with retry logic for handling rate limits
   */
  async calculateRouteWithRetry(
    start: string,
    end: string,
    routeType: TransportMode,
    options: RouteOptions = {},
    maxRetries: number = 3
  ): Promise<OneMapRouteResponse> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.calculateRoute(start, end, routeType, options);
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || '';
        
        // Check if it's a rate limit error (429) or server error (5xx)
        const isRetryable = errorMessage.includes('(429)') || 
                          errorMessage.includes('(500)') ||
                          errorMessage.includes('(502)') ||
                          errorMessage.includes('(503)') ||
                          errorMessage.includes('Too Many Requests');
        
        if (!isRetryable || attempt === maxRetries) {
          throw lastError;
        }
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.error(`Route calculation failed, retry ${attempt}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError || new Error('Route calculation failed after retries');
  }

  async batchCalculateRoutes(
    origin: string,
    destinations: Array<{ lat: number; lon: number; name: string }>,
    routeType: TransportMode,
    options: RouteOptions = {}
  ): Promise<Array<{ destination: string; result: OneMapRouteResponse | null; error?: string }>> {
    console.error(`Starting batch calculation for ${destinations.length} destinations`);
    
    const BATCH_SIZE = 3; // Smaller batch size to reduce rate limits
    const BASE_DELAY = 2000; // Base delay between batches (2 seconds)
    let consecutiveErrors = 0;
    
    const results: Array<{ destination: string; result: OneMapRouteResponse | null; error?: string }> = [];
    
    // Process destinations in smaller batches with adaptive delays
    for (let i = 0; i < destinations.length; i += BATCH_SIZE) {
      const batch = destinations.slice(i, i + BATCH_SIZE);
      
      // Create promises for this batch using retry logic
      const batchPromises = batch.map(async (dest) => {
        try {
          console.error(`Calculating route to ${dest.name} (${dest.lat}, ${dest.lon})`);
          const result = await this.calculateRouteWithRetry(
            origin,
            `${dest.lat},${dest.lon}`,
            routeType,
            options,
            2 // Max 2 retries for batch processing
          );
          console.error(`✓ Success for ${dest.name}`);
          return { destination: dest.name, result, error: undefined };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`✗ Error for ${dest.name}: ${errorMsg}`);
          return { 
            destination: dest.name, 
            result: null, 
            error: errorMsg
          };
        }
      });
      
      // Execute batch and collect results
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Calculate error rate for this batch
      const errors = batchResults.filter(r => r.error).length;
      const errorRate = errors / batch.length;
      
      // Adjust consecutive error counter
      if (errorRate > 0.5) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = Math.max(0, consecutiveErrors - 1);
      }
      
      // Adaptive delay based on error rate
      if (i + BATCH_SIZE < destinations.length) {
        // Increase delay if we're getting many errors
        const adaptiveDelay = BASE_DELAY * (1 + errorRate * 2) * (1 + consecutiveErrors * 0.5);
        const finalDelay = Math.min(adaptiveDelay, 10000); // Cap at 10 seconds
        
        console.error(`Batch ${Math.floor(i/BATCH_SIZE) + 1} complete. Error rate: ${(errorRate * 100).toFixed(0)}%. Waiting ${finalDelay}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, finalDelay));
      }
    }
    
    // Log summary
    const successCount = results.filter(r => r.result).length;
    const errorCount = results.filter(r => r.error).length;
    console.error(`Batch processing complete: ${successCount} successful, ${errorCount} failed out of ${destinations.length} total`);

    return results;
  }

  private getCurrentDate(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const year = now.getFullYear();
    return `${month}-${day}-${year}`;
  }

  private getCurrentTime(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}:00`;
  }

  /**
   * Convert WGS84 coordinates to SVY21 using OneMap's conversion service
   */
  async convertWGS84ToSVY21(latitude: number, longitude: number): Promise<{ x: number; y: number }> {
    const cacheKey = `convert_${latitude}_${longitude}`;
    const cached = this.cache.get<{ x: number; y: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const token = await this.authManager.getToken();
      
      const response = await axios.get(
        `${this.baseUrl}/common/convert/4326to3414`,
        {
          params: {
            latitude,
            longitude
          },
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.data && response.data.X && response.data.Y) {
        const result = {
          x: parseFloat(response.data.X),
          y: parseFloat(response.data.Y)
        };
        
        // Cache for 24 hours (coordinates don't change)
        this.cache.set(cacheKey, result, 86400);
        return result;
      } else {
        throw new Error('Invalid response from coordinate conversion service');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to convert coordinates: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to convert coordinates: ${error}`);
    }
  }

  /**
   * Detect coordinate system based on value ranges for Singapore
   */
  static detectCoordinateSystem(first: number, second: number): 'WGS84' | 'SVY21' | 'unknown' {
    // Singapore WGS84 ranges: lat (1.2-1.4), lng (103-104)
    if (first >= 1.2 && first <= 1.5 && second >= 103 && second <= 104.5) {
      return 'WGS84';
    }
    
    // Singapore SVY21 ranges: X (2,000-50,000), Y (15,000-50,000)
    if (first >= 2000 && first <= 50000 && second >= 15000 && second <= 50000) {
      return 'SVY21';
    }
    
    return 'unknown';
  }
}