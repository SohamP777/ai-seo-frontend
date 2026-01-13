import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { 
  ApiResponse, 
  FixRequest, 
  FixResponse, 
  FixStatus, 
  FixProgress, 
  FixResult, 
  FixHistoryItem,
  AutoFixRule,
  FixableIssue,
  AppliedFix
} from '../types/fixer.types';

/**
 * Fixer service for automated SEO issue fixing
 */
class FixerService {
  private api: AxiosInstance;
  private readonly BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.seo-automation.com/v1';

  constructor() {
    this.api = axios.create({
      baseURL: this.BASE_URL,
      timeout: 60000, // 60 second timeout for fixes
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
   * Apply fixes for identified SEO issues
   */
  async applyFixes(
    scanId: string, 
    issueIds: string[], 
    options?: {
      autoConfirm?: boolean;
      backupBeforeFix?: boolean;
      dryRun?: boolean;
      priority?: 'low' | 'medium' | 'high';
    }
  ): Promise<FixResponse> {
    try {
      const fixRequest: FixRequest = {
        scanId,
        issueIds,
        autoConfirm: options?.autoConfirm || false,
        backupBeforeFix: options?.backupBeforeFix || true,
        dryRun: options?.dryRun || false,
        priority: options?.priority || 'medium',
        timestamp: new Date().toISOString(),
      };

      const response = await this.api.post<ApiResponse<FixResponse>>('/fixes/apply', fixRequest);
      return response.data.data;
    } catch (error) {
      console.error('Failed to apply fixes:', error);
      throw error;
    }
  }

  /**
   * Get fix progress by ID
   */
  async getFixProgress(fixId: string): Promise<FixProgress> {
    try {
      const response = await this.api.get<ApiResponse<FixProgress>>(`/fixes/${fixId}/progress`);
      return response.data.data;
    } catch (error) {
      console.error(`Failed to get fix progress for ${fixId}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed fix results
   */
  async getFixResults(fixId: string): Promise<FixResult> {
    try {
      const response = await this.api.get<ApiResponse<FixResult>>(`/fixes/${fixId}/results`);
      return response.data.data;
    } catch (error) {
      console.error(`Failed to get fix results for ${fixId}:`, error);
      throw error;
    }
  }

  /**
   * Get all fixes for current user
   */
  async getUserFixes(limit: number = 20, offset: number = 0): Promise<FixHistoryItem[]> {
    try {
      const response = await this.api.get<ApiResponse<FixHistoryItem[]>>(
        '/fixes/user',
        { params: { limit, offset } }
      );
      return response.data.data;
    } catch (error) {
      console.error('Failed to get user fixes:', error);
      throw error;
    }
  }

  /**
   * Get fixable issues from a scan
   */
  async getFixableIssues(scanId: string): Promise<FixableIssue[]> {
    try {
      const response = await this.api.get<ApiResponse<FixableIssue[]>>(
        `/scans/${scanId}/fixable-issues`
      );
      return response.data.data;
    } catch (error) {
      console.error(`Failed to get fixable issues for scan ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel an ongoing fix operation
   */
  async cancelFix(fixId: string): Promise<void> {
    try {
      await this.api.post<ApiResponse<void>>(`/fixes/${fixId}/cancel`);
    } catch (error) {
      console.error(`Failed to cancel fix ${fixId}:`, error);
      throw error;
    }
  }

  /**
   * Rollback applied fixes
   */
  async rollbackFix(fixId: string, backupId?: string): Promise<void> {
    try {
      const payload = backupId ? { backupId } : {};
      await this.api.post<ApiResponse<void>>(`/fixes/${fixId}/rollback`, payload);
    } catch (error) {
      console.error(`Failed to rollback fix ${fixId}:`, error);
      throw error;
    }
  }

  /**
   * Get available auto-fix rules
   */
  async getAutoFixRules(): Promise<AutoFixRule[]> {
    try {
      const response = await this.api.get<ApiResponse<AutoFixRule[]>>('/fixes/rules');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get auto-fix rules:', error);
      return this.getDefaultRules();
    }
  }

  /**
   * Update auto-fix rule configuration
   */
  async updateAutoFixRule(ruleId: string, enabled: boolean): Promise<AutoFixRule> {
    try {
      const response = await this.api.put<ApiResponse<AutoFixRule>>(
        `/fixes/rules/${ruleId}`,
        { enabled }
      );
      return response.data.data;
    } catch (error) {
      console.error(`Failed to update rule ${ruleId}:`, error);
      throw error;
    }
  }

  /**
   * Get fix statistics
   */
  async getFixStats(): Promise<{
    totalFixes: number;
    fixesToday: number;
    successRate: number;
    avgFixTime: number;
    issuesFixed: number;
  }> {
    try {
      const response = await this.api.get<ApiResponse<any>>('/fixes/stats');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get fix stats:', error);
      return {
        totalFixes: 0,
        fixesToday: 0,
        successRate: 0,
        avgFixTime: 0,
        issuesFixed: 0,
      };
    }
  }

  /**
   * Apply one-click fix for all high-priority issues
   */
  async applyOneClickFix(scanId: string): Promise<FixResponse> {
    try {
      const response = await this.api.post<ApiResponse<FixResponse>>(
        `/fixes/one-click/${scanId}`
      );
      return response.data.data;
    } catch (error) {
      console.error(`Failed to apply one-click fix for scan ${scanId}:`, error);
      throw error;
    }
  }

  /**
   * Schedule automated fixes
   */
  async scheduleAutoFix(
    scanId: string, 
    schedule: { 
      frequency: 'daily' | 'weekly' | 'monthly';
      time: string;
      dayOfWeek?: number;
      dayOfMonth?: number;
    }
  ): Promise<{ scheduleId: string; nextRun: string }> {
    try {
      const response = await this.api.post<ApiResponse<any>>(
        `/fixes/schedule/${scanId}`,
        schedule
      );
      return response.data.data;
    } catch (error) {
      console.error('Failed to schedule auto-fix:', error);
      throw error;
    }
  }

  /**
   * Get default auto-fix rules (fallback)
   */
  private getDefaultRules(): AutoFixRule[] {
    return [
      {
        id: 'missing-alt-tags',
        name: 'Missing Alt Tags',
        description: 'Automatically add alt tags to images without them',
        category: 'accessibility',
        severity: 'medium',
        enabled: true,
        confidence: 0.95,
      },
      {
        id: 'missing-meta-description',
        name: 'Missing Meta Descriptions',
        description: 'Generate meta descriptions for pages without them',
        category: 'on-page',
        severity: 'high',
        enabled: true,
        confidence: 0.85,
      },
      {
        id: 'slow-page-speed',
        name: 'Page Speed Optimization',
        description: 'Optimize images and scripts for faster loading',
        category: 'performance',
        severity: 'high',
        enabled: true,
        confidence: 0.9,
      },
      {
        id: 'broken-links',
        name: 'Broken Links',
        description: 'Fix or remove broken internal links',
        category: 'technical',
        severity: 'medium',
        enabled: true,
        confidence: 1.0,
      },
    ];
  }

  /**
   * Calculate fix priority based on issue severity and impact
   */
  calculateFixPriority(issue: FixableIssue): 'low' | 'medium' | 'high' {
    const { severity, impactScore } = issue;
    
    if (severity === 'critical' || impactScore >= 80) {
      return 'high';
    } else if (severity === 'high' || impactScore >= 50) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Estimate fix time based on issues
   */
  estimateFixTime(issues: FixableIssue[]): number {
    const baseTimePerIssue = 5; // seconds
    const complexityMultiplier = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 5,
    };

    return issues.reduce((total, issue) => {
      const multiplier = complexityMultiplier[issue.severity] || 1;
      return total + (baseTimePerIssue * multiplier);
    }, 0);
  }
}

// Export singleton instance
export const fixerService = new FixerService();
export default fixerService;