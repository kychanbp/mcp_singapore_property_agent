import axios from 'axios';
import { URAAuthManager } from './uraAuthManager.js';
import { 
  URATransactionResponse, 
  URARentalResponse,
  URAProperty,
  URARentalProperty
} from '../types/index.js';
import NodeCache from 'node-cache';

export class URAClient {
  private authManager: URAAuthManager;
  private cache: NodeCache;
  private baseUrl = 'https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1';

  constructor() {
    this.authManager = new URAAuthManager();
    // Cache API responses for reasonable time periods
    this.cache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache
  }

  /**
   * Fetch private residential property transactions
   * Batch 1-4 covers different postal districts across Singapore
   */
  async getPropertyTransactions(batch: 1 | 2 | 3 | 4): Promise<URAProperty[]> {
    const cacheKey = `transactions_batch_${batch}`;
    const cached = this.cache.get<URAProperty[]>(cacheKey);
    if (cached) {
      console.error(`Using cached transaction data for batch ${batch}`);
      return cached;
    }

    try {
      const token = await this.authManager.getToken();
      
      console.error(`Fetching URA property transactions batch ${batch}`);
      const response = await axios.get<URATransactionResponse>(this.baseUrl, {
        params: {
          service: 'PMI_Resi_Transaction',
          batch: batch.toString()
        },
        headers: {
          'AccessKey': this.authManager.getAccessKey(),
          'Token': token
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data.Status !== 'Success') {
        throw new Error(`URA API error: ${response.data.Status}`);
      }

      const transactions = response.data.Result;
      console.error(`Retrieved ${transactions.length} property projects from batch ${batch}`);
      
      // Cache for 2 hours (transactions update twice weekly)
      this.cache.set(cacheKey, transactions, 7200);
      
      return transactions;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          // Token might be expired, clear it and try once more
          this.authManager.clearToken();
          throw new Error('Authentication failed. Token may be expired.');
        }
        throw new Error(`Failed to fetch URA transactions: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to fetch URA transactions: ${error}`);
    }
  }

  /**
   * Fetch all property transaction batches
   * Returns combined data from all 4 batches
   */
  async getAllPropertyTransactions(): Promise<URAProperty[]> {
    const cacheKey = 'all_transactions';
    const cached = this.cache.get<URAProperty[]>(cacheKey);
    if (cached) {
      console.error('Using cached data for all transactions');
      return cached;
    }

    console.error('Fetching all URA property transaction batches');
    const batches: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
    const allTransactions: URAProperty[] = [];

    for (const batch of batches) {
      try {
        const batchData = await this.getPropertyTransactions(batch);
        allTransactions.push(...batchData);
        
        // Small delay between batches to avoid overwhelming the API
        if (batch < 4) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to fetch batch ${batch}: ${error}`);
        // Continue with other batches even if one fails
      }
    }

    console.error(`Total property projects retrieved: ${allTransactions.length}`);
    
    // Cache for 2 hours
    this.cache.set(cacheKey, allTransactions, 7200);
    
    return allTransactions;
  }

  /**
   * Fetch private residential rental contracts
   * refPeriod format: "24q3" for Q3 2024, "24q4" for Q4 2024, etc.
   */
  async getPropertyRentals(refPeriod: string): Promise<URARentalProperty[]> {
    const cacheKey = `rentals_${refPeriod}`;
    const cached = this.cache.get<URARentalProperty[]>(cacheKey);
    if (cached) {
      console.error(`Using cached rental data for period ${refPeriod}`);
      return cached;
    }

    try {
      const token = await this.authManager.getToken();
      
      console.error(`Fetching URA property rentals for period ${refPeriod}`);
      const response = await axios.get<URARentalResponse>(this.baseUrl, {
        params: {
          service: 'PMI_Resi_Rental',
          refPeriod
        },
        headers: {
          'AccessKey': this.authManager.getAccessKey(),
          'Token': token
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data.Status !== 'Success') {
        throw new Error(`URA API error: ${response.data.Status}`);
      }

      const rentals = response.data.Result;
      console.error(`Retrieved ${rentals.length} rental properties for period ${refPeriod}`);
      
      // Cache for 24 hours (rentals update monthly)
      this.cache.set(cacheKey, rentals, 86400);
      
      return rentals;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          // Token might be expired, clear it and try once more
          this.authManager.clearToken();
          throw new Error('Authentication failed. Token may be expired.');
        }
        throw new Error(`Failed to fetch URA rentals: ${error.response?.data?.message || error.message}`);
      }
      throw new Error(`Failed to fetch URA rentals: ${error}`);
    }
  }

  /**
   * Get recent rental periods (last 4 quarters)
   * Returns periods like ["24q4", "24q3", "24q2", "24q1"] for current year
   */
  getRecentRentalPeriods(quarters: number = 4): string[] {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear() % 100; // Get 2-digit year
    const currentMonth = currentDate.getMonth() + 1;
    const currentQuarter = Math.ceil(currentMonth / 3);
    
    const periods: string[] = [];
    let year = currentYear;
    let quarter = currentQuarter;
    
    for (let i = 0; i < quarters; i++) {
      periods.push(`${year.toString().padStart(2, '0')}q${quarter}`);
      
      quarter--;
      if (quarter < 1) {
        quarter = 4;
        year--;
        if (year < 0) year = 99; // Handle year wrap-around
      }
    }
    
    return periods;
  }

  /**
   * Fetch rental data for recent periods
   */
  async getRecentPropertyRentals(quarters: number = 4): Promise<URARentalProperty[]> {
    const periods = this.getRecentRentalPeriods(quarters);
    const allRentals: URARentalProperty[] = [];
    
    console.error(`Fetching rental data for periods: ${periods.join(', ')}`);
    
    for (const period of periods) {
      try {
        const periodData = await this.getPropertyRentals(period);
        allRentals.push(...periodData);
        
        // Small delay between requests
        if (period !== periods[periods.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to fetch rentals for period ${period}: ${error}`);
        // Continue with other periods even if one fails
      }
    }
    
    console.error(`Total rental properties retrieved: ${allRentals.length}`);
    return allRentals;
  }

  /**
   * Clear all cached data (useful for forcing fresh data)
   */
  clearCache(): void {
    this.cache.flushAll();
    console.error('URA client cache cleared');
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
}