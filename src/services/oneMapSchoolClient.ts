import axios from 'axios';
import NodeCache from 'node-cache';

interface SchoolCookie {
  name: string;
  value: string;
  expires: number; // Unix timestamp
  domain: string;
  path: string;
}

interface SchoolSearchResult {
  SCHOOLNAME: string;
  SCH_HSE_BLK_NUM: string;
  SCH_ROAD_NAME: string;
  SCH_POSTAL_CODE: string;
  DIST_CODE: string; // "1" = within 1km, "2" = 1-2km
  HYPERLINK: string;
  LATITUDE: string;
  LONGITUDE: string;
  SCH_X_ADDR: string; // SVY21 X coordinate
  SCH_Y_ADDR: string; // SVY21 Y coordinate
  SCH_TEXT: string;
  GEOMETRY: number[][]; // Polygon coordinates [lng, lat]
}

interface SchoolApiResponse {
  SearchResults: SchoolSearchResult[];
}

interface ProcessedSchool {
  name: string;
  address: string;
  postalCode: string;
  coordinates: {
    latitude: number;
    longitude: number;
    x: number; // SVY21
    y: number; // SVY21
  };
  distanceCategory: '1km' | '1-2km';
  geometry: number[][];
  moeLink: string;
}

export class OneMapSchoolClient {
  private baseUrl = 'https://www.onemap.gov.sg';
  private cookies: Map<string, SchoolCookie> = new Map();
  private cache: NodeCache;
  private isAuthenticating = false;

  constructor() {
    // Cache school results for 1 hour (schools don't change frequently)
    this.cache = new NodeCache({ stdTTL: 3600 });
  }

  /**
   * Get nearby primary schools within specified distance
   */
  async getNearbyPrimarySchools(
    postalCode: string, 
    blockNo: string, 
    distanceMeters: number = 1000
  ): Promise<ProcessedSchool[]> {
    const cacheKey = `schools_${postalCode}_${blockNo}_${distanceMeters}`;
    const cached = this.cache.get<ProcessedSchool[]>(cacheKey);
    if (cached) {
      console.error(`Using cached school data for ${postalCode}`);
      return cached;
    }

    try {
      // Ensure we have valid authentication
      await this.ensureAuthenticated();

      const response = await this.makeAuthenticatedRequest<SchoolApiResponse>(
        '/omapp/getnearbyPriSchools',
        {
          distance: distanceMeters.toString(),
          postalcode: postalCode,
          blkno: blockNo
        }
      );

      const processedSchools = this.processSchoolResults(response.SearchResults);
      
      // Cache the results
      this.cache.set(cacheKey, processedSchools);
      
      console.error(`Found ${processedSchools.length} primary schools near ${postalCode}`);
      return processedSchools;

    } catch (error) {
      // Handle authentication errors by retrying once
      if (this.isAuthenticationError(error)) {
        console.error('Authentication failed, clearing cookies and retrying...');
        this.clearCookies();
        
        // Retry once with fresh authentication
        await this.ensureAuthenticated();
        const response = await this.makeAuthenticatedRequest<SchoolApiResponse>(
          '/omapp/getnearbyPriSchools',
          {
            distance: distanceMeters.toString(),
            postalcode: postalCode,
            blkno: blockNo
          }
        );
        
        const processedSchools = this.processSchoolResults(response.SearchResults);
        this.cache.set(cacheKey, processedSchools);
        return processedSchools;
      }
      
      throw new Error(`Failed to get nearby schools: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Ensure we have valid authentication cookies
   */
  private async ensureAuthenticated(): Promise<void> {
    // Check if we have valid cookies that haven't expired
    if (this.hasValidCookies()) {
      return;
    }

    // Prevent concurrent authentication attempts
    if (this.isAuthenticating) {
      // Wait for ongoing authentication to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (this.hasValidCookies()) {
        return;
      }
    }

    this.isAuthenticating = true;
    
    try {
      console.error('Authenticating with OneMap school API...');
      await this.authenticate();
    } finally {
      this.isAuthenticating = false;
    }
  }

  /**
   * Authenticate with OneMap by visiting homepage and extracting cookies
   */
  private async authenticate(): Promise<void> {
    try {
      const response = await axios.get(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
        },
        timeout: 30000
      });

      // Extract cookies from response headers
      const setCookieHeaders = response.headers['set-cookie'];
      if (setCookieHeaders) {
        this.parseCookies(setCookieHeaders);
      }

      // Verify we got the required cookies
      if (!this.hasRequiredCookies()) {
        throw new Error('Failed to obtain required authentication cookies');
      }

      console.error('Successfully authenticated with OneMap school API');
    } catch (error) {
      throw new Error(`Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse Set-Cookie headers and store cookies with expiration
   */
  private parseCookies(setCookieHeaders: string[]): void {
    for (const cookieHeader of setCookieHeaders) {
      const cookie = this.parseCookieHeader(cookieHeader);
      if (cookie) {
        this.cookies.set(cookie.name, cookie);
        console.error(`Stored cookie: ${cookie.name}, expires: ${new Date(cookie.expires * 1000).toISOString()}`);
      }
    }
  }

  /**
   * Parse individual Set-Cookie header
   */
  private parseCookieHeader(cookieHeader: string): SchoolCookie | null {
    const parts = cookieHeader.split(';').map(part => part.trim());
    const [nameValue] = parts;
    const [name, value] = nameValue.split('=', 2);

    if (!name || !value) {
      return null;
    }

    // Default expiration to 1 hour if not specified
    let expires = Math.floor(Date.now() / 1000) + 3600;
    let domain = 'www.onemap.gov.sg';
    let path = '/';

    // Parse cookie attributes
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.toLowerCase().startsWith('expires=')) {
        const expireDate = new Date(part.substring(8));
        if (!isNaN(expireDate.getTime())) {
          expires = Math.floor(expireDate.getTime() / 1000);
        }
      } else if (part.toLowerCase().startsWith('max-age=')) {
        const maxAge = parseInt(part.substring(8));
        if (!isNaN(maxAge)) {
          expires = Math.floor(Date.now() / 1000) + maxAge;
        }
      } else if (part.toLowerCase().startsWith('domain=')) {
        domain = part.substring(7);
      } else if (part.toLowerCase().startsWith('path=')) {
        path = part.substring(5);
      }
    }

    return {
      name: decodeURIComponent(name),
      value: decodeURIComponent(value),
      expires,
      domain,
      path
    };
  }

  /**
   * Check if we have valid, non-expired cookies
   */
  private hasValidCookies(): boolean {
    const requiredCookies = ['OMITN', 'omiApp'];
    const currentTime = Math.floor(Date.now() / 1000);
    const bufferTime = 3600; // 1 hour buffer before expiration

    for (const cookieName of requiredCookies) {
      const cookie = this.cookies.get(cookieName);
      if (!cookie || cookie.expires - bufferTime <= currentTime) {
        console.error(`Cookie ${cookieName} is missing or will expire soon`);
        return false;
      }
    }

    return true;
  }

  /**
   * Check if we have the minimum required cookies
   */
  private hasRequiredCookies(): boolean {
    return this.cookies.has('OMITN') && this.cookies.has('omiApp');
  }

  /**
   * Clear all stored cookies
   */
  private clearCookies(): void {
    this.cookies.clear();
    console.error('Cleared all authentication cookies');
  }

  /**
   * Make authenticated request with cookies
   */
  private async makeAuthenticatedRequest<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const cookieHeader = this.buildCookieHeader();
    
    try {
      const response = await axios.get<T>(`${this.baseUrl}${endpoint}`, {
        params,
        headers: {
          'accept': 'application/json',
          'application': 'OMI3D',
          'x-requested-with': 'XMLHttpRequest',
          'cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
        },
        timeout: 30000
      });

      // Check for reauth response
      if (typeof response.data === 'string' && response.data === 'reauth') {
        throw new Error('Authentication required');
      }

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Request failed: ${error.response?.status} ${error.response?.statusText || error.message}`);
      }
      throw error;
    }
  }

  /**
   * Build cookie header string from stored cookies
   */
  private buildCookieHeader(): string {
    const cookieStrings: string[] = [];
    
    for (const cookie of this.cookies.values()) {
      cookieStrings.push(`${cookie.name}=${cookie.value}`);
    }
    
    return cookieStrings.join('; ');
  }

  /**
   * Check if error is authentication-related
   */
  private isAuthenticationError(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('reauth') || 
             message.includes('authentication') || 
             message.includes('401') || 
             message.includes('403');
    }
    return false;
  }

  /**
   * Process raw school results into structured format
   */
  private processSchoolResults(results: SchoolSearchResult[]): ProcessedSchool[] {
    return results.map(school => ({
      name: school.SCHOOLNAME,
      address: `${school.SCH_HSE_BLK_NUM} ${school.SCH_ROAD_NAME} ${school.SCH_POSTAL_CODE}`,
      postalCode: school.SCH_POSTAL_CODE,
      coordinates: {
        latitude: parseFloat(school.LATITUDE),
        longitude: parseFloat(school.LONGITUDE),
        x: parseFloat(school.SCH_X_ADDR),
        y: parseFloat(school.SCH_Y_ADDR)
      },
      distanceCategory: school.DIST_CODE === '1' ? '1km' : '1-2km',
      geometry: school.GEOMETRY,
      moeLink: school.HYPERLINK
    }));
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { keys: number; hits: number; misses: number } {
    const stats = this.cache.getStats();
    return {
      keys: this.cache.keys().length,
      hits: stats.hits,
      misses: stats.misses
    };
  }

  /**
   * Clear cached school data
   */
  clearCache(): void {
    this.cache.flushAll();
    console.error('Cleared school search cache');
  }
}