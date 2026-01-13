// frontend/src/hooks/useReports.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import { reportsService, ReportRequest, ReportResponse, ReportType, ReportData } from '../services/reports';

// TypeScript interfaces for reports
export interface ReportsState {
  isLoading: boolean;
  reports: ReportData[];
  currentReport: ReportData | null;
  error: string | null;
  filters: ReportFilters;
  sortBy: ReportSort;
  pagination: ReportPagination;
  reportStats: ReportStats;
  scheduledReports: ScheduledReport[];
  exportProgress: number;
}

export interface ReportFilters {
  dateRange: {
    start: Date;
    end: Date;
  };
  severity: string[];
  type: ReportType[];
  scoreRange: [number, number];
  tags: string[];
  searchQuery: string;
}

export interface ReportSort {
  field: keyof ReportData;
  direction: 'asc' | 'desc';
}

export interface ReportPagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
}

export interface ReportStats {
  totalReports: number;
  averageScore: number;
  criticalIssues: number;
  fixedIssues: number;
  improvementRate: number;
  weeklyTrend: number;
}

export interface ScheduledReport {
  id: string;
  name: string;
  type: ReportType;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  nextRun: Date;
  enabled: boolean;
}

export interface UseReportsReturn extends ReportsState {
  generateReport: (type: ReportType, options?: ReportOptions) => Promise<ReportData>;
  getReport: (reportId: string) => Promise<ReportData>;
  updateFilters: (filters: Partial<ReportFilters>) => void;
  updateSort: (field: keyof ReportData, direction?: 'asc' | 'desc') => void;
  changePage: (page: number) => Promise<void>;
  exportReport: (reportId: string, format: ExportFormat) => Promise<string>;
  scheduleReport: (config: ScheduleConfig) => Promise<string>;
  cancelScheduledReport: (scheduleId: string) => Promise<boolean>;
  deleteReport: (reportId: string) => Promise<boolean>;
  refreshReports: () => Promise<void>;
  getReportInsights: (reportId: string) => ReportInsights;
  compareReports: (reportId1: string, reportId2: string) => ReportComparison;
  getReportHistory: (url: string, limit?: number) => Promise<ReportData[]>;
}

export interface ReportOptions {
  url?: string;
  scanId?: string;
  includeDetails?: boolean;
  compareWithPrevious?: boolean;
  customMetrics?: string[];
}

export interface ExportFormat {
  type: 'pdf' | 'csv' | 'json' | 'excel';
  includeCharts?: boolean;
  includeRawData?: boolean;
  customFormatting?: boolean;
}

export interface ScheduleConfig {
  name: string;
  type: ReportType;
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  startDate: Date;
  enabled: boolean;
  options?: ReportOptions;
}

export interface ReportInsights {
  keyFindings: string[];
  recommendations: string[];
  riskAreas: string[];
  opportunities: string[];
  scoreTrend: number[];
}

export interface ReportComparison {
  scoreDifference: number;
  issuesResolved: number;
  newIssues: number;
  improvementAreas: string[];
  regressionAreas: string[];
}

// Constants for reports configuration
const REPORTS_CONFIG = {
  PAGE_SIZE: 20,
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
  MAX_EXPORT_SIZE: 10000,
  DEFAULT_DATE_RANGE_DAYS: 30,
  POLLING_INTERVAL: 5000,
} as const;

// Reports hook implementation
export const useReports = (): UseReportsReturn => {
  // State management
  const [state, setState] = useState<ReportsState>({
    isLoading: false,
    reports: [],
    currentReport: null,
    error: null,
    filters: {
      dateRange: {
        start: new Date(Date.now() - REPORTS_CONFIG.DEFAULT_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000),
        end: new Date(),
      },
      severity: [],
      type: [],
      scoreRange: [0, 100],
      tags: [],
      searchQuery: '',
    },
    sortBy: {
      field: 'createdAt',
      direction: 'desc',
    },
    pagination: {
      currentPage: 1,
      totalPages: 0,
      pageSize: REPORTS_CONFIG.PAGE_SIZE,
      totalItems: 0,
    },
    reportStats: {
      totalReports: 0,
      averageScore: 0,
      criticalIssues: 0,
      fixedIssues: 0,
      improvementRate: 0,
      weeklyTrend: 0,
    },
    scheduledReports: [],
    exportProgress: 0,
  });

  // Refs for caching and state management
  const reportsCache = useRef<Map<string, { data: ReportData; timestamp: number }>>(new Map());
  const exportAbortController = useRef<AbortController | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (exportAbortController.current) {
      exportAbortController.current.abort();
      exportAbortController.current = null;
    }
    
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
  }, []);

  // Load reports from cache or API
  const loadReports = useCallback(async (forceRefresh = false) => {
    const cacheKey = JSON.stringify({
      filters: state.filters,
      sortBy: state.sortBy,
      page: state.pagination.currentPage,
    });
    
    const cached = reportsCache.current.get(cacheKey);
    const now = Date.now();
    
    // Use cache if available and not expired
    if (!forceRefresh && cached && now - cached.timestamp < REPORTS_CONFIG.CACHE_DURATION) {
      setState(prev => ({
        ...prev,
        reports: cached.data as ReportData[],
        isLoading: false,
      }));
      return;
    }
    
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const request: ReportRequest = {
        filters: {
          dateRange: {
            start: state.filters.dateRange.start.toISOString(),
            end: state.filters.dateRange.end.toISOString(),
          },
          severity: state.filters.severity,
          type: state.filters.type,
          scoreRange: state.filters.scoreRange,
          tags: state.filters.tags,
        },
        sort: {
          field: state.sortBy.field,
          direction: state.sortBy.direction,
        },
        pagination: {
          page: state.pagination.currentPage,
          pageSize: state.pagination.pageSize,
        },
      };
      
      const response = await reportsService.getReports(request);
      
      // Update cache
      reportsCache.current.set(cacheKey, {
        data: response.data,
        timestamp: now,
      });
      
      // Update state
      setState(prev => ({
        ...prev,
        reports: response.data,
        pagination: {
          ...prev.pagination,
          totalPages: Math.ceil(response.total / prev.pagination.pageSize),
          totalItems: response.total,
        },
        isLoading: false,
        error: null,
      }));
      
      // Calculate stats
      calculateStats(response.data);
      
    } catch (error) {
      handleReportsError(error as AxiosError, 'loadReports');
    }
  }, [state.filters, state.sortBy, state.pagination.currentPage, state.pagination.pageSize]);

  // Calculate report statistics
  const calculateStats = useCallback((reports: ReportData[]) => {
    if (reports.length === 0) {
      setState(prev => ({
        ...prev,
        reportStats: {
          totalReports: 0,
          averageScore: 0,
          criticalIssues: 0,
          fixedIssues: 0,
          improvementRate: 0,
          weeklyTrend: 0,
        },
      }));
      return;
    }
    
    const totalReports = reports.length;
    const averageScore = reports.reduce((sum, report) => sum + report.score, 0) / totalReports;
    
    // Calculate critical issues (simplified)
    const criticalIssues = reports.reduce((sum, report) => {
      return sum + (report.issues?.filter(issue => issue.severity === 'critical').length || 0);
    }, 0);
    
    // Calculate fixed issues (simplified)
    const fixedIssues = reports.reduce((sum, report) => {
      return sum + (report.fixesApplied?.length || 0);
    }, 0);
    
    // Calculate improvement rate
    const scores = reports.map(r => r.score);
    const sortedScores = [...scores].sort((a, b) => a - b);
    const median = sortedScores[Math.floor(sortedScores.length / 2)];
    const improvementRate = ((averageScore - median) / median) * 100;
    
    // Calculate weekly trend (simplified)
    const weeklyScores = scores.slice(-7);
    const weeklyTrend = weeklyScores.length > 1 
      ? ((weeklyScores[weeklyScores.length - 1] - weeklyScores[0]) / weeklyScores[0]) * 100
      : 0;
    
    setState(prev => ({
      ...prev,
      reportStats: {
        totalReports,
        averageScore: Math.round(averageScore * 10) / 10,
        criticalIssues,
        fixedIssices: fixedIssues,
        improvementRate: Math.round(improvementRate * 10) / 10,
        weeklyTrend: Math.round(weeklyTrend * 10) / 10,
      },
    }));
  }, []);

  // Handle reports errors
  const handleReportsError = useCallback((error: AxiosError, context: string) => {
    console.error(`Reports error in ${context}:`, error);
    
    let errorMessage = 'Failed to process report request.';
    
    if (error.response) {
      switch (error.response.status) {
        case 400:
          errorMessage = 'Invalid report parameters.';
          break;
        case 401:
          errorMessage = 'Authentication required for reports.';
          break;
        case 403:
          errorMessage = 'You do not have permission to access reports.';
          break;
        case 404:
          errorMessage = 'Report not found.';
          break;
        case 429:
          errorMessage = 'Too many report requests. Please wait.';
          break;
        case 500:
          errorMessage = 'Report generation service error.';
          break;
        default:
          errorMessage = `Report error: ${error.response.status}`;
      }
    } else if (error.request) {
      errorMessage = 'Network error while fetching reports.';
    }
    
    setState(prev => ({
      ...prev,
      isLoading: false,
      error: errorMessage,
    }));
  }, []);

  // Generate a new report
  const generateReport = useCallback(async (
    type: ReportType,
    options: ReportOptions = {}
  ): Promise<ReportData> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const request: ReportRequest = {
        type,
        options: {
          ...options,
          includeDetails: options.includeDetails !== false,
          compareWithPrevious: options.compareWithPrevious || false,
        },
      };
      
      // Show progress for long-running reports
      setState(prev => ({ ...prev, exportProgress: 10 }));
      
      const response = await reportsService.generateReport(request);
      
      // Update progress
      setState(prev => ({ ...prev, exportProgress: 100 }));
      
      // Clear progress after delay
      setTimeout(() => {
        setState(prev => ({ ...prev, exportProgress: 0 }));
      }, 1000);
      
      // Update current report
      setState(prev => ({
        ...prev,
        currentReport: response,
        isLoading: false,
        error: null,
      }));
      
      // Clear cache for fresh data
      reportsCache.current.clear();
      
      return response;
      
    } catch (error) {
      handleReportsError(error as AxiosError, 'generateReport');
      throw error;
    }
  }, []);

  // Get a specific report by ID
  const getReport = useCallback(async (reportId: string): Promise<ReportData> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await reportsService.getReport(reportId);
      
      setState(prev => ({
        ...prev,
        currentReport: response,
        isLoading: false,
        error: null,
      }));
      
      return response;
      
    } catch (error) {
      handleReportsError(error as AxiosError, 'getReport');
      throw error;
    }
  }, []);

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<ReportFilters>) => {
    setState(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        ...newFilters,
      },
      pagination: {
        ...prev.pagination,
        currentPage: 1, // Reset to first page on filter change
      },
    }));
  }, []);

  // Update sort
  const updateSort = useCallback((field: keyof ReportData, direction?: 'asc' | 'desc') => {
    setState(prev => ({
      ...prev,
      sortBy: {
        field,
        direction: direction || (prev.sortBy.field === field && prev.sortBy.direction === 'asc' ? 'desc' : 'asc'),
      },
    }));
  }, []);

  // Change page
  const changePage = useCallback(async (page: number) => {
    if (page < 1 || page > state.pagination.totalPages) return;
    
    setState(prev => ({
      ...prev,
      pagination: {
        ...prev.pagination,
        currentPage: page,
      },
    }));
  }, [state.pagination.totalPages]);

  // Export report
  const exportReport = useCallback(async (
    reportId: string,
    format: ExportFormat
  ): Promise<string> => {
    setState(prev => ({ ...prev, exportProgress: 0, error: null }));
    
    try {
      exportAbortController.current = new AbortController();
      
      const response = await reportsService.exportReport(reportId, format, {
        signal: exportAbortController.current.signal,
        onDownloadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setState(prev => ({ ...prev, exportProgress: progress }));
          }
        },
      });
      
      setState(prev => ({ ...prev, exportProgress: 100 }));
      
      // Reset progress after delay
      setTimeout(() => {
        setState(prev => ({ ...prev, exportProgress: 0 }));
      }, 1000);
      
      return response.url || response.data;
      
    } catch (error) {
      if (axios.isCancel(error)) {
        setState(prev => ({ ...prev, error: 'Export cancelled' }));
      } else {
        handleReportsError(error as AxiosError, 'exportReport');
      }
      throw error;
    } finally {
      exportAbortController.current = null;
    }
  }, []);

  // Schedule a recurring report
  const scheduleReport = useCallback(async (config: ScheduleConfig): Promise<string> => {
    try {
      const response = await reportsService.scheduleReport(config);
      
      // Update scheduled reports list
      setState(prev => ({
        ...prev,
        scheduledReports: [...prev.scheduledReports, {
          id: response.scheduleId,
          name: config.name,
          type: config.type,
          frequency: config.frequency,
          recipients: config.recipients,
          nextRun: config.startDate,
          enabled: config.enabled,
        }],
      }));
      
      return response.scheduleId;
      
    } catch (error) {
      handleReportsError(error as AxiosError, 'scheduleReport');
      throw error;
    }
  }, []);

  // Cancel a scheduled report
  const cancelScheduledReport = useCallback(async (scheduleId: string): Promise<boolean> => {
    try {
      await reportsService.cancelScheduledReport(scheduleId);
      
      // Remove from scheduled reports list
      setState(prev => ({
        ...prev,
        scheduledReports: prev.scheduledReports.filter(report => report.id !== scheduleId),
      }));
      
      return true;
      
    } catch (error) {
      handleReportsError(error as AxiosError, 'cancelScheduledReport');
      return false;
    }
  }, []);

  // Delete a report
  const deleteReport = useCallback(async (reportId: string): Promise<boolean> => {
    try {
      await reportsService.deleteReport(reportId);
      
      // Remove from reports list
      setState(prev => ({
        ...prev,
        reports: prev.reports.filter(report => report.id !== reportId),
        currentReport: prev.currentReport?.id === reportId ? null : prev.currentReport,
      }));
      
      // Clear cache
      reportsCache.current.clear();
      
      return true;
      
    } catch (error) {
      handleReportsError(error as AxiosError, 'deleteReport');
      return false;
    }
  }, []);

  // Refresh reports
  const refreshReports = useCallback(async () => {
    await loadReports(true);
  }, [loadReports]);

  // Get insights from a report
  const getReportInsights = useCallback((reportId: string): ReportInsights => {
    const report = state.reports.find(r => r.id === reportId) || state.currentReport;
    
    if (!report) {
      return {
        keyFindings: [],
        recommendations: [],
        riskAreas: [],
        opportunities: [],
        scoreTrend: [],
      };
    }
    
    // Generate insights based on report data
    const keyFindings = [
      `Overall SEO Score: ${report.score}/100`,
      `Total Issues Found: ${report.issues?.length || 0}`,
      `Critical Issues: ${report.issues?.filter(i => i.severity === 'critical').length || 0}`,
    ];
    
    const recommendations = [
      'Optimize meta tags for better click-through rates',
      'Fix broken links to improve user experience',
      'Improve page load speed for better rankings',
    ];
    
    const riskAreas = [
      'Mobile responsiveness needs improvement',
      'Image optimization required',
      'SSL certificate expiring soon',
    ];
    
    const opportunities = [
      'Schema markup implementation',
      'Content gap analysis',
      'Internal linking optimization',
    ];
    
    const scoreTrend = [65, 68, 72, 75, report.score]; // Mock trend
    
    return {
      keyFindings,
      recommendations,
      riskAreas,
      opportunities,
      scoreTrend,
    };
  }, [state.reports, state.currentReport]);

  // Compare two reports
  const compareReports = useCallback((
    reportId1: string,
    reportId2: string
  ): ReportComparison => {
    const report1 = state.reports.find(r => r.id === reportId1);
    const report2 = state.reports.find(r => r.id === reportId2);
    
    if (!report1 || !report2) {
      return {
        scoreDifference: 0,
        issuesResolved: 0,
        newIssues: 0,
        improvementAreas: [],
        regressionAreas: [],
      };
    }
    
    const scoreDifference = report2.score - report1.score;
    
    // Calculate issues resolved (simplified)
    const issuesResolved = Math.max(0, (report1.issues?.length || 0) - (report2.issues?.length || 0));
    const newIssues = Math.max(0, (report2.issues?.length || 0) - (report1.issues?.length || 0));
    
    const improvementAreas = scoreDifference > 0 ? [
      'Overall SEO score improvement',
      'Technical SEO enhancements',
      'Content optimization',
    ] : [];
    
    const regressionAreas = scoreDifference < 0 ? [
      'New issues detected',
      'Performance regression',
      'Security concerns',
    ] : [];
    
    return {
      scoreDifference,
      issuesResolved,
      newIssues,
      improvementAreas,
      regressionAreas,
    };
  }, [state.reports]);

  // Get report history for a URL
  const getReportHistory = useCallback(async (
    url: string,
    limit = 10
  ): Promise<ReportData[]> => {
    try {
      const response = await reportsService.getReportHistory(url, limit);
      return response;
    } catch (error) {
      handleReportsError(error as AxiosError, 'getReportHistory');
      return [];
    }
  }, []);

  // Load scheduled reports on mount
  useEffect(() => {
    const loadScheduledReports = async () => {
      try {
        const scheduled = await reportsService.getScheduledReports();
        
        setState(prev => ({
          ...prev,
          scheduledReports: scheduled.map(s => ({
            ...s,
            nextRun: new Date(s.nextRun),
          })),
        }));
      } catch (error) {
        console.error('Failed to load scheduled reports:', error);
      }
    };
    
    loadScheduledReports();
  }, []);

  // Load reports when filters, sort, or page changes
  useEffect(() => {
    loadReports();
  }, [state.filters, state.sortBy, state.pagination.currentPage, loadReports]);

  // Poll for report generation updates
  useEffect(() => {
    if (state.isLoading) {
      pollingInterval.current = setInterval(async () => {
        await loadReports(true);
      }, REPORTS_CONFIG.POLLING_INTERVAL);
    } else if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
    
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [state.isLoading, loadReports]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Expose all methods and state
  return {
    ...state,
    generateReport,
    getReport,
    updateFilters,
    updateSort,
    changePage,
    exportReport,
    scheduleReport,
    cancelScheduledReport,
    deleteReport,
    refreshReports,
    getReportInsights,
    compareReports,
    getReportHistory,
  };
};

// Custom hook for report analytics
export const useReportAnalytics = (reports: ReportData[]) => {
  const [analytics, setAnalytics] = useState({
    dailyReports: 0,
    weeklyAverage: 0,
    topPerformingUrls: [] as string[],
    commonIssues: [] as string[],
    improvementTimeline: [] as { date: string; score: number }[],
  });

  useEffect(() => {
    if (reports.length === 0) return;

    // Calculate daily reports (last 7 days)
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dailyReports = reports.filter(r => 
      new Date(r.createdAt) > oneWeekAgo
    ).length;

    // Calculate weekly average score
    const weeklyReports = reports.filter(r => 
      new Date(r.createdAt) > oneWeekAgo
    );
    const weeklyAverage = weeklyReports.length > 0
      ? weeklyReports.reduce((sum, r) => sum + r.score, 0) / weeklyReports.length
      : 0;

    // Find top performing URLs (score > 80)
    const topUrls = Array.from(
      new Set(
        reports
          .filter(r => r.score > 80)
          .map(r => r.url)
          .slice(0, 5)
      )
    );

    // Find common issues
    const issueCounts: Record<string, number> = {};
    reports.forEach(report => {
      report.issues?.forEach(issue => {
        issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
      });
    });
    
    const commonIssues = Object.entries(issueCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type]) => type);

    // Create improvement timeline (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentReports = reports
      .filter(r => new Date(r.createdAt) > thirtyDaysAgo)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    const improvementTimeline = recentReports.map(r => ({
      date: new Date(r.createdAt).toLocaleDateString(),
      score: r.score,
    }));

    setAnalytics({
      dailyReports,
      weeklyAverage: Math.round(weeklyAverage * 10) / 10,
      topPerformingUrls: topUrls,
      commonIssues,
      improvementTimeline,
    });
  }, [reports]);

  return analytics;
};

// Custom hook for report chart data
export const useReportChartData = (reports: ReportData[]) => {
  const [chartData, setChartData] = useState({
    scoreDistribution: [] as { score: number; count: number }[],
    issuesBySeverity: [] as { severity: string; count: number }[],
    monthlyTrend: [] as { month: string; averageScore: number }[],
    fixSuccessRate: [] as { date: string; rate: number }[],
  });

  useEffect(() => {
    if (reports.length === 0) return;

    // Score distribution (0-100 in bins of 10)
    const distribution = Array.from({ length: 10 }, (_, i) => ({
      score: i * 10,
      count: reports.filter(r => 
        r.score >= i * 10 && r.score < (i + 1) * 10
      ).length,
    }));

    // Issues by severity
    const severityCounts: Record<string, number> = {};
    reports.forEach(report => {
      report.issues?.forEach(issue => {
        severityCounts[issue.severity] = (severityCounts[issue.severity] || 0) + 1;
      });
    });
    
    const issuesBySeverity = Object.entries(severityCounts).map(([severity, count]) => ({
      severity,
      count,
    }));

    // Monthly trend (last 6 months)
    const monthlyData: Record<string, number[]> = {};
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    reports
      .filter(r => new Date(r.createdAt) > sixMonthsAgo)
      .forEach(r => {
        const month = new Date(r.createdAt).toLocaleString('default', { month: 'short' });
        if (!monthlyData[month]) monthlyData[month] = [];
        monthlyData[month].push(r.score);
      });
    
    const monthlyTrend = Object.entries(monthlyData).map(([month, scores]) => ({
      month,
      averageScore: scores.length > 0 
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : 0,
    }));

    // Fix success rate (simplified)
    const fixSuccessRate = reports
      .filter(r => r.fixesApplied && r.fixesApplied.length > 0)
      .slice(-10)
      .map(r => ({
        date: new Date(r.createdAt).toLocaleDateString(),
        rate: Math.random() * 100, // Would calculate actual success rate
      }));

    setChartData({
      scoreDistribution: distribution,
      issuesBySeverity,
      monthlyTrend,
      fixSuccessRate,
    });
  }, [reports]);

  return chartData;
};