import axios from 'axios';
import NodeCache from 'node-cache';

interface TokenResponse {
  access_token: string;
  expiry_timestamp: string;
}

export class AuthManager {
  private cache: NodeCache;
  private email: string;
  private password: string;
  private baseUrl = 'https://www.onemap.gov.sg/api';

  constructor() {
    this.cache = new NodeCache({ stdTTL: 259200 }); // 3 days default TTL
    this.email = process.env.ONEMAP_EMAIL!;
    this.password = process.env.ONEMAP_PASSWORD!;

    if (!this.email || !this.password) {
      throw new Error('ONEMAP_EMAIL and ONEMAP_PASSWORD environment variables are required');
    }
  }

  async getToken(): Promise<string> {
    // Check cache first
    const cached = this.cache.get<string>('token');
    if (cached) {
      return cached;
    }

    // Get new token
    try {
      const response = await axios.post<TokenResponse>(
        `${this.baseUrl}/auth/post/getToken`,
        {
          email: this.email,
          password: this.password
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      const { access_token, expiry_timestamp } = response.data;
      
      // Calculate TTL (expire 1 hour before actual expiry for safety)
      const expiryTime = Number(expiry_timestamp);
      const currentTime = Math.floor(Date.now() / 1000);
      const ttl = expiryTime - currentTime - 3600; // 1 hour buffer

      if (ttl > 0) {
        this.cache.set('token', access_token, ttl);
      }
      
      return access_token;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to get OneMap token: ${error.response?.data?.error || error.message}`);
      }
      throw new Error(`Failed to get OneMap token: ${error}`);
    }
  }

  async isTokenValid(): Promise<boolean> {
    return this.cache.has('token');
  }

  clearToken(): void {
    this.cache.del('token');
  }
}