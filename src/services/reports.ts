import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import {
  ApiResponse,
  ReportRequest,
  ReportResponse,
  WeeklyReport,
  MonthlyReport,
  ComparisonReport,
  TrendReport,
  CustomReport,
  ReportHistoryItem,
  SEOHealthScore,
  IssueTrend,
  PerformanceMetric,
  KeywordRanking
} from '../types/reports.types';

/**
 * Reports service for SEO reporting and analytics
 */
class ReportsService {
  private api: AxiosInstance;
  private readonly BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.seo-automation.com/v1';
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
  private cache: Map<string, { data: any; timestamp: number }> = new Map();

  constructor() {
    this.api = axios.create({
      baseURL: this.BASE_URL,
      timeout: 30000, // 30 second timeout for reports
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
   * Get weekly SEO report
   */
  async getWeeklyReport(
    startDate: string,
    endDate: string,
    websiteId?: string
  ): Promise<WeeklyReport> {
    const cacheKey = `weekly_${startDate}_${endDate}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<WeeklyReport>>('/reports/weekly', {
        params: { startDate, endDate, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get weekly report:', error);
      throw error;
    }
  }

  /**
   * Get monthly SEO report
   */
  async getMonthlyReport(
    year: number,
    month: number,
    websiteId?: string
  ): Promise<MonthlyReport> {
    const cacheKey = `monthly_${year}_${month}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<MonthlyReport>>('/reports/monthly', {
        params: { year, month, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get monthly report:', error);
      throw error;
    }
  }

  /**
   * Generate custom report
   */
  async generateCustomReport(request: ReportRequest): Promise<CustomReport> {
    try {
      const response = await this.api.post<ApiResponse<CustomReport>>('/reports/custom', request);
      return response.data.data;
    } catch (error) {
      console.error('Failed to generate custom report:', error);
      throw error;
    }
  }

  /**
   * Get comparison report between two periods
   */
  async getComparisonReport(
    period1: { start: string; end: string },
    period2: { start: string; end: string },
    websiteId?: string
  ): Promise<ComparisonReport> {
    const cacheKey = `compare_${period1.start}_${period1.end}_${period2.start}_${period2.end}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<ComparisonReport>>('/reports/compare', {
        params: { period1, period2, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get comparison report:', error);
      throw error;
    }
  }

  /**
   * Get trend report for specific metrics
   */
  async getTrendReport(
    metric: string,
    days: number = 30,
    websiteId?: string
  ): Promise<TrendReport> {
    const cacheKey = `trend_${metric}_${days}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<TrendReport>>('/reports/trend', {
        params: { metric, days, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get trend report:', error);
      throw error;
    }
  }

  /**
   * Get SEO health score history
   */
  async getHealthScoreHistory(
    days: number = 90,
    websiteId?: string
  ): Promise<SEOHealthScore[]> {
    const cacheKey = `health_score_${days}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<SEOHealthScore[]>>('/reports/health-scores', {
        params: { days, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get health score history:', error);
      return [];
    }
  }

  /**
   * Get issue trends over time
   */
  async getIssueTrends(
    issueType?: string,
    days: number = 30,
    websiteId?: string
  ): Promise<IssueTrend[]> {
    const cacheKey = `issue_trends_${issueType}_${days}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<IssueTrend[]>>('/reports/issue-trends', {
        params: { issueType, days, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get issue trends:', error);
      return [];
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(
    metricType: 'page-speed' | 'accessibility' | 'best-practices' | 'seo',
    days: number = 30,
    websiteId?: string
  ): Promise<PerformanceMetric[]> {
    const cacheKey = `performance_${metricType}_${days}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<PerformanceMetric[]>>('/reports/performance', {
        params: { metricType, days, websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get performance metrics:', error);
      return [];
    }
  }

  /**
   * Get keyword rankings
   */
  async getKeywordRankings(
    keywords?: string[],
    websiteId?: string
  ): Promise<KeywordRanking[]> {
    const cacheKey = `keywords_${keywords?.join('_')}_${websiteId}`;
    
    try {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        return cached;
      }

      const response = await this.api.get<ApiResponse<KeywordRanking[]>>('/reports/keywords', {
        params: { keywords: keywords?.join(','), websiteId },
      });

      const data = response.data.data;
      this.setCachedData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get keyword rankings:', error);
      return [];
    }
  }

  /**
   * Get report history
   */
  async getReportHistory(limit: number = 50, offset: number = 0): Promise<ReportHistoryItem[]> {
    try {
      const response = await this.api.get<ApiResponse<ReportHistoryItem[]>>('/reports/history', {
        params: { limit, offset },
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to get report history:', error);
      return [];
    }
  }

  /**
   * Download report as PDF
   */
  async downloadReportPdf(reportId: string): Promise<Blob> {
    try {
      const response = await this.api.get(`/reports/${reportId}/download`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to download report ${reportId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule automated reports
   */
  async scheduleReport(
    frequency: 'daily' | 'weekly' | 'monthly',
    recipients: string[],
    reportType: 'weekly' | 'monthly' | 'custom',
    customParams?: any
  ): Promise<{ scheduleId: string }> {
    try {
      const response = await this.api.post<ApiResponse<{ scheduleId: string }>>('/reports/schedule', {
        frequency,
        recipients,
        reportType,
        customParams,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to schedule report:', error);
      throw error;
    }
  }

  /**
   * Get reporting statistics
   */
  async getReportStats(): Promise<{
    totalReports: number;
    reportsThisMonth: number;
    avgGenerationTime: number;
    mostPopularReport: string;
  }> {
    try {
      const response = await this.api.get<ApiResponse<any>>('/reports/stats');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get report stats:', error);
      return {
        totalReports: 0,
        reportsThisMonth: 0,
        avgGenerationTime: 0,
        mostPopularReport: 'weekly',
      };
    }
  }

  /**
   * Clear report cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cached data if valid
   */
  private getCachedData(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  /**
   * Set data in cache
   */
  private setCachedData(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Format report date for display
   */
  formatReportDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * Calculate trend direction and percentage
   */
  calculateTrend(current: number, previous: number): { direction: 'up' | 'down' | 'stable'; percentage: number } {
    if (previous === 0) {
      return { direction: 'stable', percentage: 0 };
    }

    const percentage = ((current - previous) / previous) * 100;
    const rounded = Math.round(percentage * 10) / 10;

    if (rounded > 0.5) {
      return { direction: 'up', percentage: Math.abs(rounded) };
    } else if (rounded < -0.5) {
      return { direction: 'down', percentage: Math.abs(rounded) };
    } else {
      return { direction: 'stable', percentage: 0 };
    }
  }

  /**
   * Generate report filename
   */
  generateFilename(reportType: string, date: Date): string {
    const dateStr = date.toISOString().split('T')[0];
    return `seo-report-${reportType}-${dateStr}.pdf`;
  }
}

// Export singleton instance
export const reportsService = new ReportsService();
export default reportsService;