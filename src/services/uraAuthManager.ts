import axios from 'axios';
import NodeCache from 'node-cache';
import { URATokenResponse } from '../types/index.js';

export class URAAuthManager {
  private cache: NodeCache;
  private accessKey: string;
  private baseUrl = 'https://eservice.ura.gov.sg/uraDataService';

  constructor() {
    this.accessKey = process.env.URA_ACCESS_KEY || '';
    if (!this.accessKey) {
      throw new Error('URA_ACCESS_KEY environment variable is required');
    }
    
    // Cache tokens for 24 hours (they expire daily)
    this.cache = new NodeCache({ stdTTL: 86400 }); // 24 hours
  }

  /**
   * Get a valid token for URA API requests
   * Generates a new token if none exists or if cached token is expired
   */
  async getToken(): Promise<string> {
    const cacheKey = 'ura_token';
    const cachedToken = this.cache.get<string>(cacheKey);
    
    if (cachedToken) {
      console.error('Using cached URA token');
      return cachedToken;
    }

    console.error('Generating new URA token');
    return this.generateNewToken();
  }

  /**
   * Generate a new daily token
   */
  private async generateNewToken(): Promise<string> {
    try {
      const response = await axios.get<URATokenResponse>(
        `${this.baseUrl}/insertNewToken/v1`,
        {
          headers: {
            'AccessKey': this.accessKey
          },
          timeout: 10000 // 10 second timeout
        }
      );

      if (response.data.Status !== 'Success') {
        throw new Error(`Token generation failed: ${response.data.Message}`);
      }

      const token = response.data.Result;
      if (!token) {
        throw new Error('No token received from URA API');
      }

      // Cache with 23-hour TTL to ensure we refresh before expiry
      this.cache.set('ura_token', token, 82800); // 23 hours
      console.error('New URA token generated and cached');
      
      return token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          throw new Error('Invalid URA access key. Please check your URA_ACCESS_KEY environment variable.');
        }
        throw new Error(`Failed to generate URA token: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to generate URA token: ${error}`);
    }
  }

  /**
   * Clear cached token (useful for testing or error recovery)
   */
  clearToken(): void {
    this.cache.del('ura_token');
    console.error('URA token cache cleared');
  }

  /**
   * Get the access key (for debugging)
   */
  getAccessKey(): string {
    return this.accessKey;
  }

  /**
   * Check if we have a cached token
   */
  hasCachedToken(): boolean {
    return this.cache.has('ura_token');
  }
}