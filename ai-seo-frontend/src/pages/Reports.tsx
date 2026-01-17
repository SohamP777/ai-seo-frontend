// frontend/src/pages/Reports.tsx
import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { format, subDays, isAfter, isBefore, parseISO } from 'date-fns';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Context & Hooks
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { usePerformanceMetrics } from '../hooks/usePerformanceMetrics';
import { useReports } from '../hooks/useReports';
import { useSecurity } from '../hooks/useSecurity';

// Components
import MainLayout from '../components/layout/MainLayout';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';
import SEOHealthScore from '../components/seo-dashboard/HealthScore';
import Button from '../components/ui/Button';
import ProgressRing from '../components/ui/ProgressRing';

// Lazy loaded components for performance
const ReportTable = lazy(() => import('../components/reports/ReportTable'));
const DateRangePicker = lazy(() => import('../components/reports/DateRangePicker'));
const ExportModal = lazy(() => import('../components/reports/ExportModal'));
const ReportFilters = lazy(() => import('../components/reports/ReportFilters'));

// Services
import { reportsService } from '../services/reports';
import { monitoringService } from '../services/monitoring';
import { analyticsService } from '../services/analytics';

// Utils
import { formatSeoScore, calculateImpact } from '../utils/seoCalculations';
import { SEO_ISSUE_TYPES, REPORT_CATEGORIES } from '../utils/constants';
import { sanitizeInput, escapeHtml, validateInput } from '../utils/security';
import { debounce, throttle } from '../utils/performance';
import { generateTraceId, logError, logEvent } from '../utils/analytics';

// Types - Production-ready with proper validation
interface SEOReport {
  id: string;
  websiteId: string;
  websiteUrl: string;
  scanDate: string;
  seoScore: number;
  previousScore?: number;
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScoreBreakdown: {
    onPage: number;
    technical: number;
    content: number;
    mobile: number;
    security: number;
  };
  criticalIssues: number;
  warnings: number;
  recommendations: number;
  pageLoadTime: number;
  pageSize: number;
  requestCount: number;
  domSize: number;
  lighthouseReport: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
    firstContentfulPaint: number;
    largestContentfulPaint: number;
    cumulativeLayoutShift: number;
    totalBlockingTime: number;
    speedIndex: number;
  };
  topIssues: Array<{
    id: string;
    type: string;
    severity: 'critical' | 'warning' | 'recommendation';
    description: string;
    impact: number;
    fix: string;
    element?: string;
    occurrences: number;
  }>;
  fixesApplied: Array<{
    id: string;
    type: string;
    description: string;
    appliedAt: string;
    result: 'success' | 'failed' | 'partial';
  }>;
  metadata: {
    scanDuration: number;
    pagesScanned: number;
    scanType: 'quick' | 'full' | 'custom';
    userAgent: string;
    timestamp: string;
    traceId: string;
  };
  reportUrl?: string;
  downloadableFormats: Array<'pdf' | 'csv' | 'json'>;
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canExport: boolean;
  };
}

interface ReportFilters {
  dateRange: {
    start: Date;
    end: Date;
  };
  websites: string[];
  scoreThreshold: number;
  issueTypes: string[];
  categories: string[];
  sortBy: 'date' | 'score' | 'issues' | 'performance' | 'accessibility';
  sortOrder: 'asc' | 'desc';
  searchQuery: string;
  status?: 'completed' | 'failed' | 'processing';
  severity?: ('critical' | 'warning' | 'recommendation')[];
}

interface ReportStatistics {
  totalReports: number;
  totalWebsites: number;
  avgScore: number;
  avgPreviousScore?: number;
  totalCriticalIssues: number;
  totalWarnings: number;
  totalRecommendations: number;
  avgLoadTime: number;
  improvements: number;
  declines: number;
  noChange: number;
  scoreDistribution: {
    excellent: number;
    good: number;
    needsImprovement: number;
    poor: number;
  };
  topIssues: Array<{
    type: string;
    count: number;
    totalImpact: number;
    websitesAffected: number;
  }>;
  trend: {
    score: number[];
    criticalIssues: number[];
    loadTime: number[];
    dates: string[];
  };
}

// Security: Zod schema for input validation
const reportFilterSchema = z.object({
  searchQuery: z.string()
    .max(256, 'Search query too long')
    .optional(),
  dateRange: z.object({
    start: z.date(),
    end: z.date(),
  }).refine(data => data.end >= data.start, {
    message: 'End date must be after start date',
  }),
  scoreThreshold: z.number()
    .min(0, 'Minimum score must be at least 0')
    .max(100, 'Maximum score is 100')
    .default(0),
  websites: z.array(z.string())
    .max(20, 'Cannot select more than 20 websites')
    .default([]),
  issueTypes: z.array(z.string())
    .max(10, 'Cannot select more than 10 issue types')
    .default([]),
  categories: z.array(z.string())
    .max(5, 'Cannot select more than 5 categories')
    .default([]),
  sortBy: z.enum(['date', 'score', 'issues', 'performance', 'accessibility'])
    .default('date'),
  sortOrder: z.enum(['asc', 'desc'])
    .default('desc'),
  status: z.enum(['completed', 'failed', 'processing']).optional(),
  severity: z.array(z.enum(['critical', 'warning', 'recommendation'])).optional(),
});

type ReportFilterFormData = z.infer<typeof reportFilterSchema>;

// Main Component with proper error handling and performance
const Reports: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { showNotification, showError, showSuccess, showWarning } = useNotification();
  const { trackMetric, startTimer, endTimer } = usePerformanceMetrics();
  const { checkRateLimit, validateRequest } = useSecurity();
  
  // Refs for performance and cleanup
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastRequestTimeRef = useRef<number>(0);
  const requestCountRef = useRef<number>(0);
  const traceIdRef = useRef<string>('');
  
  // State management with proper typing
  const [reports, setReports] = useState<SEOReport[]>([]);
  const [filteredReports, setFilteredReports] = useState<SEOReport[]>([]);
  const [statistics, setStatistics] = useState<ReportStatistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<SEOReport | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [showExportModal, setShowExportModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [bulkActions, setBulkActions] = useState<{
    selected: Set<string>;
    isSelecting: boolean;
  }>({
    selected: new Set(),
    isSelecting: false,
  });
  
  // Filter state with form hook
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty, isValid },
    watch,
    setValue,
    reset,
    trigger,
    getValues,
  } = useForm<ReportFilterFormData>({
    resolver: zodResolver(reportFilterSchema),
    defaultValues: {
      searchQuery: '',
      dateRange: {
        start: subDays(new Date(), 30),
        end: new Date(),
      },
      scoreThreshold: 0,
      websites: [],
      issueTypes: [],
      categories: [],
      sortBy: 'date',
      sortOrder: 'desc',
    },
    mode: 'onChange',
  });
  
  const filters = watch();
  
  // Pagination state
  const [pagination, setPagination] = useState({
    currentPage: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
    hasMore: true,
  });
  
  // Cache state
  const [cache, setCache] = useState<{
    reports: Map<string, SEOReport>;
    lastFetched: Map<string, number>;
    statistics?: ReportStatistics;
  }>({
    reports: new Map(),
    lastFetched: new Map(),
  });

  // Performance: Debounced search
  const useDebouncedValue = <T,>(value: T, delay: number): T => {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
      const timer = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);

      return () => {
        clearTimeout(timer);
      };
    }, [value, delay]);

    return debouncedValue;
  };

  const debouncedSearch = useDebouncedValue(filters.searchQuery, 500);
  const debouncedScoreThreshold = useDebouncedValue(filters.scoreThreshold, 300);

  // Initialize component with proper error handling
  useEffect(() => {
    const initialize = async () => {
      traceIdRef.current = generateTraceId();
      startTimer('reports_page_load', traceIdRef.current);
      
      try {
        // Check authentication
        if (!isAuthenticated) {
          navigate('/auth/login', { state: { from: location.pathname } });
          return;
        }

        // Check rate limits
        const rateLimitCheck = await checkRateLimit('reports_page', user?.id);
        if (!rateLimitCheck.allowed) {
          showError(`Rate limit exceeded. ${rateLimitCheck.retryAfter ? `Try again in ${rateLimitCheck.retryAfter} seconds` : ''}`);
          return;
        }

        // Load initial data
        await Promise.all([
          loadReports(true),
          loadStatistics(),
        ]);

        // Track page view
        analyticsService.trackPageView('reports', {
          userId: user?.id,
          traceId: traceIdRef.current,
        });

      } catch (error) {
        handleError(error, 'initialize');
      } finally {
        endTimer('reports_page_load', traceIdRef.current);
        setIsLoading(false);
      }
    };

    initialize();

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Load reports with caching and error handling
  const loadReports = useCallback(async (initialLoad = false) => {
    if (!user?.id) return;

    // Cancel previous request if exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();
    
    const loadingStartTime = Date.now();
    const traceId = generateTraceId();

    try {
      if (initialLoad) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      // Check cache first
      const cacheKey = JSON.stringify({
        ...filters,
        page: pagination.currentPage,
        pageSize: pagination.pageSize,
      });

      const cachedData = cache.reports.get(cacheKey);
      const cacheTime = cache.lastFetched.get(cacheKey);

      if (cachedData && cacheTime && Date.now() - cacheTime < 5 * 60 * 1000) { // 5 minute cache
        setReports(Array.from(cache.reports.values()));
        return;
      }

      // Validate request
      const validationResult = await validateRequest({
        type: 'reports_fetch',
        data: filters,
        userId: user.id,
      });

      if (!validationResult.allowed) {
        throw new Error(validationResult.reason || 'Request not allowed');
      }

      // Fetch reports
      const response = await reportsService.getReports({
        filters: {
          ...filters,
          userId: user.id,
        },
        pagination: {
          page: pagination.currentPage,
          pageSize: pagination.pageSize,
        },
        signal: abortControllerRef.current.signal,
        traceId,
      });

      // Update cache
      setCache(prev => ({
        ...prev,
        reports: new Map(prev.reports).set(cacheKey, response.data),
        lastFetched: new Map(prev.lastFetched).set(cacheKey, Date.now()),
      }));

      // Update state
      setReports(response.data);
      setPagination(prev => ({
        ...prev,
        totalItems: response.total,
        totalPages: Math.ceil(response.total / pagination.pageSize),
        hasMore: response.data.length === pagination.pageSize,
      }));

      // Track success
      trackMetric('reports_fetch_success', {
        duration: Date.now() - loadingStartTime,
        count: response.data.length,
        traceId,
      });

      logEvent('reports_loaded', {
        count: response.data.length,
        userId: user.id,
        traceId,
      });

    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Request was cancelled, ignore
        return;
      }

      handleError(error, 'loadReports');
      trackMetric('reports_fetch_failed', {
        duration: Date.now() - loadingStartTime,
        error: error.message,
        traceId,
      });

    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [user?.id, filters, pagination.currentPage, pagination.pageSize, cache, validateRequest, trackMetric]);

  // Load statistics
  const loadStatistics = useCallback(async () => {
    if (!user?.id) return;

    try {
      const stats = await reportsService.getStatistics(user.id);
      setStatistics(stats);

      // Update cache
      setCache(prev => ({
        ...prev,
        statistics: stats,
      }));

    } catch (error) {
      handleError(error, 'loadStatistics');
    }
  }, [user?.id]);

  // Apply filters with debouncing
  useEffect(() => {
    const applyFilters = async () => {
      // Cancel previous request if exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const traceId = generateTraceId();
      startTimer('apply_filters', traceId);

      try {
        // Validate filters
        await trigger();
        if (!isValid) return;

        // Apply filters locally first
        const filtered = reports.filter(report => {
          // Date range filter
          const reportDate = parseISO(report.scanDate);
          if (!isAfter(reportDate, filters.dateRange.start) || 
              !isBefore(reportDate, filters.dateRange.end)) {
            return false;
          }

          // Score threshold filter
          if (report.seoScore < filters.scoreThreshold) {
            return false;
          }

          // Website filter
          if (filters.websites.length > 0 && !filters.websites.includes(report.websiteId)) {
            return false;
          }

          // Search filter
          if (debouncedSearch) {
            const query = debouncedSearch.toLowerCase();
            const url = report.websiteUrl.toLowerCase();
            const hostname = url.replace(/^https?:\/\//, '').split('/')[0];
            
            if (!url.includes(query) && !hostname.includes(query)) {
              return false;
            }
          }

          // Issue type filter
          if (filters.issueTypes.length > 0) {
            const reportIssueTypes = new Set(report.topIssues.map(issue => issue.type));
            const hasMatchingIssue = filters.issueTypes.some(type => reportIssueTypes.has(type));
            if (!hasMatchingIssue) return false;
          }

          // Category filter
          if (filters.categories.length > 0) {
            const reportCategories = Object.keys(report.seoScoreBreakdown);
            const hasMatchingCategory = filters.categories.some(category => 
              reportCategories.includes(category)
            );
            if (!hasMatchingCategory) return false;
          }

          // Status filter
          if (filters.status && report.metadata?.scanType !== filters.status) {
            return false;
          }

          // Severity filter
          if (filters.severity && filters.severity.length > 0) {
            const reportSeverities = new Set(report.topIssues.map(issue => issue.severity));
            const hasMatchingSeverity = filters.severity.some(severity => 
              reportSeverities.has(severity)
            );
            if (!hasMatchingSeverity) return false;
          }

          return true;
        });

        // Sort filtered reports
        const sorted = [...filtered].sort((a, b) => {
          let aValue: any;
          let bValue: any;

          switch (filters.sortBy) {
            case 'date':
              aValue = parseISO(a.scanDate).getTime();
              bValue = parseISO(b.scanDate).getTime();
              break;
            case 'score':
              aValue = a.seoScore;
              bValue = b.seoScore;
              break;
            case 'issues':
              aValue = a.criticalIssues + a.warnings;
              bValue = b.criticalIssues + b.warnings;
              break;
            case 'performance':
              aValue = a.performanceScore;
              bValue = b.performanceScore;
              break;
            case 'accessibility':
              aValue = a.accessibilityScore;
              bValue = b.accessibilityScore;
              break;
            default:
              aValue = parseISO(a.scanDate).getTime();
              bValue = parseISO(b.scanDate).getTime();
          }

          if (filters.sortOrder === 'asc') {
            return aValue - bValue;
          } else {
            return bValue - aValue;
          }
        });

        setFilteredReports(sorted);

        // Track filter application
        trackMetric('filters_applied', {
          duration: endTimer('apply_filters', traceId),
          filterCount: Object.keys(filters).length,
          resultCount: sorted.length,
          traceId,
        });

        logEvent('reports_filtered', {
          filterCount: Object.keys(filters).length,
          resultCount: sorted.length,
          userId: user?.id,
          traceId,
        });

      } catch (error) {
        handleError(error, 'applyFilters');
      }
    };

    applyFilters();
  }, [
    reports,
    filters,
    debouncedSearch,
    debouncedScoreThreshold,
    trigger,
    isValid,
    user?.id,
    trackMetric,
    startTimer,
    endTimer,
  ]);

  // Handle export with progress tracking
  const handleExport = useCallback(async (
    reportId: string, 
    format: 'pdf' | 'csv' | 'json' | 'xlsx',
    options?: {
      includeCharts?: boolean;
      includeRawData?: boolean;
      passwordProtect?: boolean;
    }
  ) => {
    const traceId = generateTraceId();
    startTimer('report_export', traceId);
    
    setIsExporting(true);
    setExportProgress(0);

    try {
      // Check rate limit for exports
      const rateLimitCheck = await checkRateLimit('report_export', user?.id);
      if (!rateLimitCheck.allowed) {
        throw new Error(`Export limit exceeded. ${rateLimitCheck.retryAfter ? `Try again in ${rateLimitCheck.retryAfter} seconds` : ''}`);
      }

      // Validate request
      const validationResult = await validateRequest({
        type: 'report_export',
        data: { reportId, format, ...options },
        userId: user?.id,
      });

      if (!validationResult.allowed) {
        throw new Error(validationResult.reason || 'Export not allowed');
      }

      // Start export with progress tracking
      const exportResult = await reportsService.exportReport(
        reportId,
        format,
        {
          ...options,
          onProgress: (progress) => {
            setExportProgress(progress);
          },
          signal: abortControllerRef.current?.signal,
          traceId,
        }
      );

      // Create secure download
      const url = window.URL.createObjectURL(exportResult.blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Security: Sanitize filename
      const sanitizedReportId = reportId.replace(/[^a-zA-Z0-9-_]/g, '');
      const sanitizedDate = format(new Date(), 'yyyy-MM-dd');
      a.download = `seo-report-${sanitizedReportId}-${sanitizedDate}.${format}`;
      
      // Security: Add rel attributes
      a.setAttribute('rel', 'noopener noreferrer');
      
      // Security: Add download attribute with proper MIME type
      a.setAttribute('type', exportResult.mimeType);
      
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Security: Revoke object URL
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 10000);

      // Show success notification
      showSuccess(`Report exported successfully as ${format.toUpperCase()}`);

      // Track export success
      trackMetric('report_export_success', {
        duration: endTimer('report_export', traceId),
        format,
        reportId,
        traceId,
      });

      logEvent('report_exported', {
        reportId,
        format,
        userId: user?.id,
        traceId,
      });

    } catch (error) {
      handleError(error, 'exportReport');
      
      trackMetric('report_export_failed', {
        duration: endTimer('report_export', traceId),
        error: error instanceof Error ? error.message : 'Export failed',
        format,
        reportId,
        traceId,
      });

    } finally {
      setIsExporting(false);
      setExportProgress(0);
      setShowExportModal(false);
    }
  }, [user?.id, checkRateLimit, validateRequest, showSuccess, trackMetric, startTimer, endTimer]);

  // Handle bulk export
  const handleBulkExport = useCallback(async (
    reportIds: string[], 
    format: 'pdf' | 'csv' | 'json' | 'xlsx'
  ) => {
    if (reportIds.length === 0) {
      showWarning('Please select reports to export');
      return;
    }

    if (reportIds.length > 10) {
      showError('Cannot export more than 10 reports at once');
      return;
    }

    const traceId = generateTraceId();
    startTimer('bulk_export', traceId);

    setIsExporting(true);
    setExportProgress(0);

    try {
      // Check rate limit
      const rateLimitCheck = await checkRateLimit('bulk_export', user?.id);
      if (!rateLimitCheck.allowed) {
        throw new Error(`Bulk export limit exceeded. ${rateLimitCheck.retryAfter ? `Try again in ${rateLimitCheck.retryAfter} seconds` : ''}`);
      }

      const exportResult = await reportsService.bulkExportReports(
        reportIds,
        format,
        {
          onProgress: (progress) => {
            setExportProgress(progress);
          },
          signal: abortControllerRef.current?.signal,
          traceId,
        }
      );

      // Create download
      const url = window.URL.createObjectURL(exportResult.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seo-reports-bulk-${format(new Date(), 'yyyy-MM-dd')}.zip`;
      a.setAttribute('rel', 'noopener noreferrer');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 10000);

      showSuccess(`Successfully exported ${reportIds.length} reports`);

      // Clear selection
      setBulkActions({
        selected: new Set(),
        isSelecting: false,
      });

      trackMetric('bulk_export_success', {
        duration: endTimer('bulk_export', traceId),
        format,
        count: reportIds.length,
        traceId,
      });

    } catch (error) {
      handleError(error, 'bulkExport');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [user?.id, checkRateLimit, showWarning, showSuccess, trackMetric, startTimer, endTimer]);

  // Handle delete with confirmation and undo
  const handleDeleteReport = useCallback(async (reportId: string) => {
    if (!confirm('Are you sure you want to delete this report? This action cannot be undone.')) {
      return;
    }

    setIsDeleting(reportId);
    const traceId = generateTraceId();

    try {
      // Store for potential undo
      const reportToDelete = reports.find(r => r.id === reportId);
      
      // Validate permissions
      if (reportToDelete && !reportToDelete.permissions.canDelete) {
        throw new Error('You do not have permission to delete this report');
      }

      await reportsService.deleteReport(reportId, { traceId });

      // Update state
      setReports(prev => prev.filter(r => r.id !== reportId));
      
      // Clear cache for this report
      setCache(prev => ({
        ...prev,
        reports: new Map([...prev.reports].filter(([key]) => !key.includes(reportId))),
      }));

      // Show undo notification
      showNotification({
        type: 'warning',
        title: 'Report Deleted',
        message: 'Report has been deleted',
        action: reportToDelete ? {
          label: 'Undo',
          onClick: async () => {
            try {
              await reportsService.restoreReport(reportId);
              setReports(prev => [...prev, reportToDelete]);
              showSuccess('Report restored successfully');
            } catch (error) {
              handleError(error, 'restoreReport');
            }
          },
        } : undefined,
        duration: 10000,
      });

      logEvent('report_deleted', {
        reportId,
        userId: user?.id,
        traceId,
      });

    } catch (error) {
      handleError(error, 'deleteReport');
    } finally {
      setIsDeleting(null);
    }
  }, [reports, user?.id, showNotification, showSuccess]);

  // Handle bulk delete
  const handleBulkDelete = useCallback(async () => {
    const selectedCount = bulkActions.selected.size;
    if (selectedCount === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedCount} report${selectedCount > 1 ? 's' : ''}? This action cannot be undone.`)) {
      return;
    }

    const traceId = generateTraceId();
    const reportIds = Array.from(bulkActions.selected);

    try {
      await reportsService.bulkDeleteReports(reportIds, { traceId });

      // Update state
      setReports(prev => prev.filter(r => !bulkActions.selected.has(r.id)));
      
      // Clear selection
      setBulkActions({
        selected: new Set(),
        isSelecting: false,
      });

      showSuccess(`Successfully deleted ${selectedCount} report${selectedCount > 1 ? 's' : ''}`);

      logEvent('bulk_delete_reports', {
        count: selectedCount,
        userId: user?.id,
        traceId,
      });

    } catch (error) {
      handleError(error, 'bulkDelete');
    }
  }, [bulkActions.selected, user?.id, showSuccess]);

  // Handle error with proper logging and user feedback
  const handleError = useCallback((error: any, context: string) => {
    console.error(`Error in ${context}:`, error);
    
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    
    // Log to monitoring service
    monitoringService.captureException(error, {
      context,
      userId: user?.id,
      traceId: traceIdRef.current,
    });

    // Show user-friendly error
    showError(errorMessage);

    // Track error metric
    trackMetric('error_occurred', {
      context,
      error: errorMessage,
      userId: user?.id,
    });
  }, [user?.id, showError, trackMetric]);

  // Handle refresh with proper loading states
  const handleRefresh = useCallback(async () => {
    const traceId = generateTraceId();
    startTimer('manual_refresh', traceId);

    try {
      // Clear cache for fresh data
      setCache({
        reports: new Map(),
        lastFetched: new Map(),
      });

      await Promise.all([
        loadReports(true),
        loadStatistics(),
      ]);

      showSuccess('Reports refreshed successfully');

      trackMetric('manual_refresh_success', {
        duration: endTimer('manual_refresh', traceId),
        traceId,
      });

    } catch (error) {
      handleError(error, 'refresh');
    }
  }, [loadReports, loadStatistics, showSuccess, trackMetric, startTimer, endTimer, handleError]);

  // Handle infinite scroll
  const handleLoadMore = useCallback(() => {
    if (!pagination.hasMore || isLoadingMore) return;

    setPagination(prev => ({
      ...prev,
      currentPage: prev.currentPage + 1,
    }));
  }, [pagination.hasMore, isLoadingMore]);

  // Calculate derived statistics
  const derivedStats = useMemo(() => {
    if (!statistics) return null;

    const avgScoreChange = statistics.avgPreviousScore 
      ? statistics.avgScore - statistics.avgPreviousScore
      : 0;

    const totalIssues = statistics.totalCriticalIssues + statistics.totalWarnings;
    const avgIssuesPerReport = filteredReports.length > 0 
      ? totalIssues / filteredReports.length
      : 0;

    const topPerforming = [...filteredReports]
      .sort((a, b) => b.seoScore - a.seoScore)
      .slice(0, 3);

    const needsAttention = [...filteredReports]
      .filter(r => r.criticalIssues > 0 || r.seoScore < 60)
      .sort((a, b) => a.seoScore - b.seoScore)
      .slice(0, 5);

    return {
      ...statistics,
      avgScoreChange,
      avgIssuesPerReport,
      topPerforming,
      needsAttention,
    };
  }, [statistics, filteredReports]);

  // Render loading state with accessibility
  if (isLoading && reports.length === 0) {
    return (
      <MainLayout>
        <div 
          className="min-h-screen bg-gray-50 flex items-center justify-center"
          role="status"
          aria-label="Loading reports"
        >
          <div className="text-center">
            <div 
              className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"
              aria-hidden="true"
            ></div>
            <p className="text-lg font-semibold text-gray-700">Loading reports...</p>
            <p className="text-gray-500 mt-2">Fetching your SEO analysis data</p>
            <span className="sr-only">Loading SEO reports, please wait</span>
          </div>
        </div>
      </MainLayout>
    );
  }

  // Render error state
  if (error && reports.length === 0) {
    return (
      <MainLayout>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Failed to Load Reports</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <div className="space-y-3">
              <Button
                variant="primary"
                onClick={handleRefresh}
                fullWidth
                aria-label="Try loading reports again"
              >
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/dashboard')}
                fullWidth
                aria-label="Go to dashboard"
              >
                Go to Dashboard
              </Button>
            </div>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div 
        className="min-h-screen bg-gray-50"
        role="main"
        aria-label="SEO Reports Dashboard"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header Section */}
          <header className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900" id="reports-title">
                  SEO Reports
                </h1>
                <p className="text-gray-600 mt-1" id="reports-description">
                  Analyze and track your website's SEO performance over time
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                {bulkActions.isSelecting && bulkActions.selected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">
                      {bulkActions.selected.size} selected
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBulkActions({ selected: new Set(), isSelecting: false })}
                      aria-label="Cancel selection"
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={handleBulkDelete}
                      disabled={isDeleting !== null}
                      aria-label={`Delete ${bulkActions.selected.size} selected reports`}
                    >
                      Delete Selected
                    </Button>
                  </div>
                )}
                
                <Button
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={isLoading}
                  aria-label="Refresh reports"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="ml-2">Refresh</span>
                </Button>
                
                <Button
                  onClick={() => navigate('/scan')}
                  aria-label="Start new SEO scan"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="ml-2">New Scan</span>
                </Button>
              </div>
            </div>

            {/* Stats Cards */}
            {derivedStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6" role="region" aria-label="Report Statistics">
                <div className="bg-white rounded-lg shadow-sm p-4" role="group" aria-label="Total Reports">
                  <div className="flex items-center">
                    <div className="p-2 bg-blue-100 rounded-lg" aria-hidden="true">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm text-gray-600">Total Reports</p>
                      <p className="text-2xl font-bold text-gray-900" aria-live="polite">
                        {derivedStats.totalReports}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg shadow-sm p-4" role="group" aria-label="Average SEO Score">
                  <div className="flex items-center">
                    <div className="p-2 bg-green-100 rounded-lg" aria-hidden="true">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm text-gray-600">Avg SEO Score</p>
                      <p className="text-2xl font-bold text-gray-900" aria-live="polite">
                        {derivedStats.avgScore}/100
                      </p>
                      {derivedStats.avgScoreChange !== 0 && (
                        <p className={`text-xs ${
                          derivedStats.avgScoreChange > 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {derivedStats.avgScoreChange > 0 ? '↑' : '↓'} 
                          {Math.abs(derivedStats.avgScoreChange)} from previous
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg shadow-sm p-4" role="group" aria-label="Critical Issues">
                  <div className="flex items-center">
                    <div className="p-2 bg-red-100 rounded-lg" aria-hidden="true">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.198 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm text-gray-600">Critical Issues</p>
                      <p className="text-2xl font-bold text-gray-900" aria-live="polite">
                        {derivedStats.totalCriticalIssues}
                      </p>
                      <p className="text-xs text-gray-500">
                        {derivedStats.avgIssuesPerReport.toFixed(1)} per report
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-white rounded-lg shadow-sm p-4" role="group" aria-label="Average Load Time">
                  <div className="flex items-center">
                    <div className="p-2 bg-purple-100 rounded-lg" aria-hidden="true">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm text-gray-600">Avg Load Time</p>
                      <p className="text-2xl font-bold text-gray-900" aria-live="polite">
                        {derivedStats.avgLoadTime}s
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </header>

          {/* Main Content Area */}
          <div className="space-y-6">
            {/* Filters Section */}
            <Suspense fallback={
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
                <div className="h-10 bg-gray-100 rounded"></div>
              </div>
            }>
              <ReportFilters
                filters={filters}
                onFiltersChange={(newFilters) => {
                  Object.entries(newFilters).forEach(([key, value]) => {
                    setValue(key as keyof ReportFilterFormData, value as any);
                  });
                }}
                websites={Array.from(new Set(reports.map(r => r.websiteId)))}
                isLoading={isLoading}
              />
            </Suspense>

            {/* Reports Table */}
            <Suspense fallback={<LoadingSkeleton count={5} />}>
              <ReportTable
                reports={filteredReports.slice(0, pagination.pageSize * pagination.currentPage)}
                selectedReports={bulkActions.selected}
                onSelectReport={setSelectedReport}
                onSelectReports={(selected) => {
                  setBulkActions(prev => ({
                    ...prev,
                    selected: new Set(selected),
                  }));
                }}
                onExport={handleExport}
                onDelete={handleDeleteReport}
                onView={(report) => navigate(`/reports/${report.id}`)}
                isLoading={isLoading}
                isDeleting={isDeleting}
                onBulkExport={() => handleBulkExport(Array.from(bulkActions.selected), 'pdf')}
                onToggleSelectAll={(selectAll) => {
                  setBulkActions(prev => ({
                    ...prev,
                    selected: selectAll ? new Set(filteredReports.map(r => r.id)) : new Set(),
                  }));
                }}
              />
            </Suspense>

            {/* Load More / Pagination */}
            {pagination.hasMore && (
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full max-w-xs"
                  aria-label="Load more reports"
                >
                  {isLoadingMore ? (
                    <>
                      <svg className="w-4 h-4 animate-spin mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Loading...
                    </>
                  ) : (
                    'Load More Reports'
                  )}
                </Button>
              </div>
            )}

            {/* Export Progress Indicator */}
            {isExporting && (
              <div className="fixed bottom-4 right-4 z-50 bg-white rounded-lg shadow-lg border border-gray-200 p-4 max-w-sm">
                <div className="flex items-center">
                  <div className="w-5 h-5 text-blue-600 animate-spin mr-3" aria-hidden="true">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">Preparing export...</p>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${exportProgress}%` }}
                        role="progressbar"
                        aria-valuenow={exportProgress}
                        aria-valuemin="0"
                        aria-valuemax="100"
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{exportProgress}% complete</p>
                  </div>
                </div>
              </div>
            )}

            {/* Export Modal */}
            <Suspense fallback={null}>
              {showExportModal && selectedReport && (
                <ExportModal
                  report={selectedReport}
                  onExport={handleExport}
                  onClose={() => setShowExportModal(false)}
                  isExporting={isExporting}
                  progress={exportProgress}
                />
              )}
            </Suspense>

            {/* Empty State */}
            {!isLoading && filteredReports.length === 0 && (
              <div 
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center"
                role="status"
                aria-label="No reports available"
              >
                <div className="w-16 h-16 text-gray-400 mx-auto mb-4 flex items-center justify-center" aria-hidden="true">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">No Reports Found</h3>
                <p className="text-gray-600 mb-6 max-w-md mx-auto">
                  {filters.searchQuery || filters.scoreThreshold > 0 
                    ? 'No reports match your current filters. Try adjusting your search criteria.'
                    : 'Start by running your first SEO scan to generate detailed performance reports'}
                </p>
                <div className="space-y-3">
                  <Button
                    onClick={() => navigate('/scan')}
                    size="lg"
                    aria-label="Run first SEO scan"
                  >
                    Run First Scan
                  </Button>
                  {(filters.searchQuery || filters.scoreThreshold > 0) && (
                    <Button
                      variant="outline"
                      onClick={() => reset()}
                      aria-label="Clear all filters"
                    >
                      Clear All Filters
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

// Export with proper error boundary and suspense
export default function ReportsWithErrorBoundary() {
  return (
    <ErrorBoundary componentName="Reports">
      <Suspense fallback={
        <MainLayout>
          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <LoadingSkeleton height="100vh" width="100%" />
          </div>
        </MainLayout>
      }>
        <Reports />
      </Suspense>
    </ErrorBoundary>
  );
}

// Infrastructure configuration for production
export const REPORTS_CONFIG = {
  // Security configuration
  SECURITY: {
    MAX_REPORTS_PER_PAGE: 100,
    MAX_BULK_EXPORT: 10,
    EXPORT_TIMEOUT: 300000, // 5 minutes
    CACHE_TTL: 300000, // 5 minutes
    RATE_LIMITS: {
      REPORTS_FETCH: { max: 60, window: 60000 }, // 60 requests per minute
      REPORT_EXPORT: { max: 10, window: 60000 }, // 10 exports per minute
      BULK_EXPORT: { max: 2, window: 60000 }, // 2 bulk exports per minute
    },
  },
  
  // Performance configuration
  PERFORMANCE: {
    VIRTUALIZATION_THRESHOLD: 100,
    DEBOUNCE_DELAY: 300,
    THROTTLE_DELAY: 1000,
    LAZY_LOAD_THRESHOLD: 10,
    CACHE_STRATEGY: 'stale-while-revalidate',
  },
  
  // Monitoring configuration
  MONITORING: {
    SENTRY_DSN: process.env.REACT_APP_SENTRY_DSN,
    LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    ERROR_SAMPLE_RATE: 1.0,
    PERFORMANCE_SAMPLE_RATE: 0.1,
  },
  
  // API endpoints
  API_ENDPOINTS: {
    REPORTS: process.env.REACT_APP_REPORTS_API || 'https://api.example.com/reports',
    EXPORT: process.env.REACT_APP_EXPORT_API || 'https://api.example.com/export',
    STATISTICS: process.env.REACT_APP_STATISTICS_API || 'https://api.example.com/statistics',
  },
};