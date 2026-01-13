import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { ApiResponse, ScanRequest, ScanResponse, ScanResult, ScanProgress, ScanStatus, ScanIssue, ScanSummary, ScanHistoryItem } from '../types/scanner.types';

/**
 * Scanner service for SEO scanning operations
 */
class ScannerService {
  private api: AxiosInstance;
  private readonly BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.seo-automation.com/v1';

  constructor() {
    this.api = axios.create({
      baseURL: this.BASE_URL,
      timeout: 30000, // 30 second timeout for scans
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor for adding auth token
    this.api.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response: AxiosResponse<ApiResponse<any>>) => {
        if (response.data && response.data.success === false) {
          throw new Error(response.data.error || 'API request failed');
        }
        return response;
      },
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
        return Promise.reject(this.handleError(error));
      }
    );
  }

  /**
   * Handle API errors consistently
   */
  private handleError(error: AxiosError): Error {
    if (error.response) {
      const apiError = error.response.data as { error?: string; message?: string };
      return new Error(
        apiError?.error || 
        apiError?.message || 
        `API Error: ${error.response.status} ${error.response.statusText}`
      );
    } else if (error.request) {
      return new Error('No response received from server. Please check your network connection.');
    } else {
      return new Error(`Request setup error: ${error.message}`);
    }
  }

  /**
   * Initiate a new SEO scan for a URL
   */
  async startScan(url: string, options?: {
    deepScan?: boolean;
    includeMobile?: boolean;
    followRedirects?: boolean;
    scanDepth?: number;
    userAgent?: string;
  }): Promise<ScanResponse> {
    try {
      const scanRequest: ScanRequest = {
        url: this.normalizeUrl(url),
        deepScan: options?.deepScan || false,
        includeMobile: options?.includeMobile || true,
        followRedirects: options?.followRedirects || true,
        scanDepth: options?.scanDepth || 3,
        userAgent: options?.userAgent || 'SEO-Automation-Scanner/1.0',
        timestamp: new Date().toISOString(),
      };

      const response = await this.api.post<ApiResponse<ScanResponse>>('/scans/start', scanRequest);
      return response.data.data;
    } catch (error) {
      console.error('Failed to start scan:', error);
      throw error;
    }
  }

  /**
   * Get scan progress by ID
   */
  async getScanProgress(scanId: string): Promise<ScanProgress> {
    try {
      const response = await this.api.get<ApiResponse<ScanProgress>>(`/scans/${scanId}/progress`);
      return response.data.data;
    } catch (error) {
      console.error(`Failed to get scan progress for ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed scan results
   */
  async getScanResults(scanId: string): Promise<ScanResult> {
    try {
      const response = await this.api.get<ApiResponse<ScanResult>>(`/scans/${scanId}/results`);
      return response.data.data;
    } catch (error) {
      console.error(`Failed to get scan results for ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Get scan summary
   */
  async getScanSummary(scanId: string): Promise<ScanSummary> {
    try {
      const response = await this.api.get<ApiResponse<ScanSummary>>(`/scans/${scanId}/summary`);
      return response.data.data;
    } catch (error) {
      console.error(`Failed to get scan summary for ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Get all scans for current user
   */
  async getUserScans(limit: number = 20, offset: number = 0): Promise<ScanHistoryItem[]> {
    try {
      const response = await this.api.get<ApiResponse<ScanHistoryItem[]>>(
        '/scans/user',
        { params: { limit, offset } }
      );
      return response.data.data;
    } catch (error) {
      console.error('Failed to get user scans:', error);
      throw error;
    }
  }

  /**
   * Cancel an ongoing scan
   */
  async cancelScan(scanId: string): Promise<void> {
    try {
      await this.api.post<ApiResponse<void>>(`/scans/${scanId}/cancel`);
    } catch (error) {
      console.error(`Failed to cancel scan ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Delete a scan and its results
   */
  async deleteScan(scanId: string): Promise<void> {
    try {
      await this.api.delete<ApiResponse<void>>(`/scans/${scanId}`);
    } catch (error) {
      console.error(`Failed to delete scan ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Retry a failed scan
   */
  async retryScan(scanId: string): Promise<ScanResponse> {
    try {
      const response = await this.api.post<ApiResponse<ScanResponse>>(`/scans/${scanId}/retry`);
      return response.data.data;
    } catch (error) {
      console.error(`Failed to retry scan ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Get scan statistics for dashboard
   */
  async getScanStats(): Promise<{
    totalScans: number;
    scansToday: number;
    avgScanTime: number;
    successRate: number;
  }> {
    try {
      const response = await this.api.get<ApiResponse<any>>('/scans/stats');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get scan stats:', error);
      return {
        totalScans: 0,
        scansToday: 0,
        avgScanTime: 0,
        successRate: 0,
      };
    }
  }

  /**
   * Validate URL before scanning
   */
  validateUrl(url: string): { isValid: boolean; error?: string } {
    if (!url) {
      return { isValid: false, error: 'URL is required' };
    }

    try {
      const normalized = this.normalizeUrl(url);
      const urlObj = new URL(normalized);
      
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { isValid: false, error: 'URL must use HTTP or HTTPS protocol' };
      }

      if (!urlObj.hostname) {
        return { isValid: false, error: 'URL must have a valid hostname' };
      }

      // Additional validation rules
      if (urlObj.hostname.includes('localhost') || urlObj.hostname.includes('127.0.0.1')) {
        return { isValid: false, error: 'Localhost URLs are not supported' };
      }

      return { isValid: true };
    } catch (error) {
      return { isValid: false, error: 'Invalid URL format' };
    }
  }

  /**
   * Normalize URL for consistency
   */
  private normalizeUrl(url: string): string {
    let normalized = url.trim();
    
    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    
    // Remove trailing slash for consistency
    normalized = normalized.replace(/\/$/, '');
    
    return normalized;
  }

  /**
   * Estimate scan time based on URL and options
   */
  estimateScanTime(url: string, deepScan: boolean = false): number {
    const baseTime = 30; // seconds for base scan
    const deepScanMultiplier = 3;
    
    // Very basic estimation
    const domainParts = new URL(url).hostname.split('.');
    const isComplex = domainParts.length > 2 || url.includes('?') || url.includes('#');
    
    let estimatedTime = baseTime;
    
    if (deepScan) {
      estimatedTime *= deepScanMultiplier;
    }
    
    if (isComplex) {
      estimatedTime *= 1.5;
    }
    
    return Math.ceil(estimatedTime);
  }
}

// Export singleton instance
export const scannerService = new ScannerService();
export default scannerService;