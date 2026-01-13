import React, { useState, useEffect, useContext, useMemo, useCallback, useRef, Suspense, lazy } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';
import { Helmet } from 'react-helmet-async';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import DOMPurify from 'dompurify';
import MainLayout from '../components/layout/MainLayout';
import { SEOContext } from '../contexts/SEOContext';
import { useAuth } from '../hooks/useAuth';
import { useApiService } from '../services/api';
import { useAnalytics } from '../hooks/useAnalytics';
import { usePerformance } from '../hooks/usePerformance';
import { useFeatureFlags, FeatureFlag } from '../hooks/useFeatureFlags';
import { useWebSocket } from '../hooks/useWebSocket';
import { useCache } from '../hooks/useCache';
import { useRateLimiter } from '../hooks/useRateLimiter';
import { calculateImpact } from '../utils/calculateImpact';
import { formatSeoScore, getScoreColor } from '../utils/formatSeoScore';
import { validateDashboardData, validateSEOScore, dashboardSchema, seoScoreSchema } from '../utils/validators';
import { debounce, throttle } from '../utils/performance';
import { trackEvent, trackPageView, trackError } from '../utils/analytics';
import { logError, logInfo, logWarning, captureException } from '../utils/logger';
import { sanitizeInput } from '../utils/security';
import { 
  DashboardStats, 
  SEOScore, 
  WeeklyReport as WeeklyReportType,
  ApiResponse,
  PaginationParams,
  Website,
  Issue,
  ActiveFix
} from '../types/seo.types';

// Lazy load heavy components for code splitting
const HealthScore = lazy(() => import('../components/seo-dashboard/HealthScore').then(m => ({ default: m.HealthScore })));
const QuickStats = lazy(() => import('../components/seo-dashboard/QuickStats').then(m => ({ default: m.QuickStats })));
const OneClickFix = lazy(() => import('../components/seo-dashboard/OneClickFix').then(m => ({ default: m.OneClickFix })));
const WeeklyReport = lazy(() => import('../components/seo-dashboard/WeeklyReport').then(m => ({ default: m.WeeklyReport })));
const ActiveFixes = lazy(() => import('../components/seo-dashboard/ActiveFixes').then(m => ({ default: m.ActiveFixes })));
const Button = lazy(() => import('../components/ui/Button').then(m => ({ default: m.Button })));

// Environment validation schema
const envSchema = z.object({
  VITE_API_BASE_URL: z.string().url().min(1),
  VITE_WEBSOCKET_URL: z.string().url().min(1),
  VITE_ENABLE_REALTIME: z.string().transform(val => val === 'true'),
  VITE_ANALYTICS_ID: z.string().optional(),
  VITE_SENTRY_DSN: z.string().optional(),
  VITE_APP_VERSION: z.string().default('1.0.0'),
  VITE_ENVIRONMENT: z.enum(['development', 'staging', 'production']).default('development'),
});

// Validate environment variables
const env = envSchema.parse({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_WEBSOCKET_URL: import.meta.env.VITE_WEBSOCKET_URL,
  VITE_ENABLE_REALTIME: import.meta.env.VITE_ENABLE_REALTIME,
  VITE_ANALYTICS_ID: import.meta.env.VITE_ANALYTICS_ID,
  VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
  VITE_APP_VERSION: import.meta.env.VITE_APP_VERSION,
  VITE_ENVIRONMENT: import.meta.env.VITE_ENVIRONMENT,
});

// API Configuration with rate limiting
const API_CONFIG = {
  baseURL: env.VITE_API_BASE_URL,
  timeout: 30000,
  retries: 3,
  rateLimit: {
    maxRequests: 100,
    timeWindow: 60000, // 1 minute
  },
};

// Dashboard form schema for A/B testing
const dashboardFormSchema = z.object({
  timeRange: z.enum(['7d', '30d', '90d']),
  websiteId: z.string(),
  viewMode: z.enum(['grid', 'list', 'compact']).default('grid'),
  autoRefresh: z.boolean().default(false),
  notificationsEnabled: z.boolean().default(true),
});

type DashboardFormData = z.infer<typeof dashboardFormSchema>;

// Error boundary with Sentry integration
const DashboardErrorFallback: React.FC<{ 
  error: Error; 
  resetErrorBoundary: () => void;
  componentStack?: string;
}> = ({ error, resetErrorBoundary, componentStack }) => {
  // Capture error in error reporting service
  useEffect(() => {
    captureException(error, {
      componentStack,
      page: 'Dashboard',
      timestamp: new Date().toISOString(),
    });
  }, [error, componentStack]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" role="alert">
      <div className="text-center max-w-md">
        <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-red-100" aria-hidden="true">
          <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-gray-900">Dashboard Error</h2>
        <p className="mt-2 text-gray-600">
          We encountered an error loading the dashboard. Our team has been notified.
        </p>
        <div className="mt-6 space-y-3">
          <button
            onClick={resetErrorBoundary}
            className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
            aria-label="Try loading dashboard again"
          >
            Try Again
          </button>
          <Link to="/" className="block">
            <button className="w-full bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors">
              Go to Home
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
};

// Performance monitoring wrapper
const withPerformanceMonitoring = <P extends object>(
  WrappedComponent: React.ComponentType<P>
) => {
  return function WithPerformanceMonitoring(props: P) {
    const { measure, reportMetric } = usePerformance();
    
    useEffect(() => {
      const startTime = performance.now();
      
      return () => {
        const endTime = performance.now();
        reportMetric('component_render_time', endTime - startTime, {
          component: WrappedComponent.name,
        });
      };
    }, [reportMetric]);
    
    return <WrappedComponent {...props} />;
  };
};

// Main Dashboard Component
const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state, dispatch, persistState, hydrateState } = useContext(SEOContext);
  const { user, token, refreshToken, logout, isAuthenticated } = useAuth();
  const { track, identify } = useAnalytics();
  const { measure, reportMetric, startTrace, endTrace } = usePerformance();
  const { isEnabled, validateFlag, getVariant } = useFeatureFlags();
  const { connect, disconnect, send, subscribe, isConnected } = useWebSocket();
  const { get, set, del, clear, size } = useCache();
  const { checkRateLimit, resetRateLimit } = useRateLimiter();
  
  const apiService = useApiService({
    baseURL: API_CONFIG.baseURL,
    timeout: API_CONFIG.timeout,
    retries: API_CONFIG.retries,
    token,
    onTokenExpired: refreshToken,
    onUnauthorized: () => {
      logout();
      navigate('/login');
    },
    onRateLimitExceeded: (retryAfter) => {
      logWarning('Rate limit exceeded', { retryAfter });
      trackEvent('rate_limit_exceeded', { retryAfter });
    },
  });

  // Form handling for A/B testing
  const { register, watch, setValue, handleSubmit } = useForm<DashboardFormData>({
    resolver: zodResolver(dashboardFormSchema),
    defaultValues: {
      timeRange: '7d',
      websiteId: 'all',
      viewMode: 'grid',
      autoRefresh: false,
      notificationsEnabled: true,
    },
  });

  const formValues = watch();

  // State management with persistence
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardStats | null>(null);
  const [seoScore, setSeoScore] = useState<SEOScore | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReportType | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [realtimeUpdates, setRealtimeUpdates] = useState<Array<{
    type: string;
    data: any;
    timestamp: Date;
    id: string;
  }>>([]);
  const [performanceMetrics, setPerformanceMetrics] = useState<{
    loadTime: number;
    apiCalls: number;
    cacheHits: number;
    errors: number;
  }>({
    loadTime: 0,
    apiCalls: 0,
    cacheHits: 0,
    errors: 0,
  });

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const visibilityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountTimeRef = useRef<number>(performance.now());
  const renderCountRef = useRef<number>(0);

  // Feature flag variants
  const dashboardVariant = getVariant('dashboard_layout');
  const enableAdvancedAnalytics = isEnabled('advanced_analytics');
  const enableAIRecommendations = isEnabled('ai_recommendations');
  const enablePerformanceOptimizations = isEnabled('performance_optimizations');

  // Identify user for analytics
  useEffect(() => {
    if (user) {
      identify(user.id, {
        email: user.email,
        plan: user.plan,
        signupDate: user.signupDate,
      });
    }
  }, [user, identify]);

  // Hydrate state from persistence
  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        await hydrateState();
        logInfo('State hydrated successfully');
      } catch (err) {
        logError('State hydration failed', err);
      }
    };
    
    loadPersistedState();
  }, [hydrateState]);

  // Query definitions with React Query
  const {
    data: dashboardQueryData,
    isLoading: isDashboardLoading,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery({
    queryKey: ['dashboard', formValues.timeRange, formValues.websiteId],
    queryFn: async () => {
      const traceId = startTrace('dashboard_fetch');
      
      try {
        // Check rate limit
        const canProceed = await checkRateLimit('dashboard_fetch');
        if (!canProceed) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }

        const response = await apiService.get<ApiResponse<DashboardStats>>('/dashboard/stats', {
          params: {
            timeRange: formValues.timeRange,
            websiteId: formValues.websiteId !== 'all' ? formValues.websiteId : undefined,
            includeAdvanced: enableAdvancedAnalytics,
          },
          signal: abortControllerRef.current?.signal,
        });

        // Validate response with Zod
        const validatedData = dashboardSchema.parse(response.data);
        
        // Sanitize data
        const sanitizedData = {
          ...validatedData,
          issues: validatedData.issues.map(issue => ({
            ...issue,
            title: DOMPurify.sanitize(issue.title),
            description: DOMPurify.sanitize(issue.description),
          })),
        };

        setPerformanceMetrics(prev => ({
          ...prev,
          apiCalls: prev.apiCalls + 1,
        }));

        return sanitizedData;
      } finally {
        endTrace(traceId);
      }
    },
    enabled: isAuthenticated && !isInitialLoad,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    onError: (err) => {
      captureException(err as Error, { context: 'dashboard_query' });
      setPerformanceMetrics(prev => ({ ...prev, errors: prev.errors + 1 }));
    },
  });

  const {
    data: seoScoreData,
    isLoading: isSeoScoreLoading,
  } = useQuery({
    queryKey: ['seoScore', formValues.websiteId],
    queryFn: async () => {
      const response = await apiService.get<ApiResponse<SEOScore>>('/seo/score', {
        params: {
          websiteId: formValues.websiteId !== 'all' ? formValues.websiteId : undefined,
        },
      });

      return seoScoreSchema.parse(response.data);
    },
    enabled: isAuthenticated && !!dashboardQueryData,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const {
    data: weeklyReportData,
    isLoading: isWeeklyReportLoading,
  } = useQuery({
    queryKey: ['weeklyReport', formValues.timeRange, formValues.websiteId],
    queryFn: async () => {
      const response = await apiService.get<ApiResponse<WeeklyReportType>>('/reports/weekly', {
        params: {
          timeRange: formValues.timeRange,
          websiteId: formValues.websiteId !== 'all' ? formValues.websiteId : undefined,
        },
      });

      return response.data;
    },
    enabled: isAuthenticated && !!dashboardQueryData,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Mutations for data updates
  const applyFixMutation = useMutation({
    mutationFn: async (issueId: string) => {
      const sanitizedId = sanitizeInput(issueId);
      
      const response = await apiService.post<ApiResponse<{ fixId: string }>>('/fixes/apply', {
        issueId: sanitizedId,
        userId: user?.id,
        timestamp: new Date().toISOString(),
      });

      return response.data;
    },
    onSuccess: (data, issueId) => {
      // Update cache
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      
      // Update local state
      if (dashboardData) {
        setDashboardData(prev => prev ? {
          ...prev,
          issues: prev.issues.filter(issue => issue.id !== issueId),
          appliedFixes: prev.appliedFixes + 1,
        } : null);
      }

      trackEvent('fix_applied', {
        issueId,
        fixId: data.data.fixId,
        success: true,
      });
    },
    onError: (error, issueId) => {
      captureException(error as Error, { context: 'apply_fix', issueId });
      trackEvent('fix_failed', { issueId, error: error.message });
    },
  });

  const bulkFixMutation = useMutation({
    mutationFn: async (issueIds: string[]) => {
      const sanitizedIds = issueIds.map(sanitizeInput);
      
      const response = await apiService.post<ApiResponse<{ results: Array<{ issueId: string; success: boolean }> }>>('/fixes/bulk-apply', {
        issueIds: sanitizedIds,
        userId: user?.id,
        batchSize: sanitizedIds.length,
      });

      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      
      const successfulFixes = data.data.results.filter(r => r.success);
      trackEvent('bulk_fix_applied', {
        total: data.data.results.length,
        successful: successfulFixes.length,
      });
    },
  });

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (env.VITE_ENABLE_REALTIME && isAuthenticated && isEnabled('realtime_updates')) {
      connect({
        url: env.VITE_WEBSOCKET_URL,
        token,
        onMessage: (message) => {
          const sanitizedMessage = DOMPurify.sanitize(JSON.stringify(message));
          const parsedMessage = JSON.parse(sanitizedMessage);
          
          setRealtimeUpdates(prev => [...prev, {
            ...parsedMessage,
            id: `${Date.now()}-${Math.random()}`,
            timestamp: new Date(),
          }]);

          // Invalidate queries based on message type
          if (parsedMessage.type === 'dashboard_update') {
            queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          }
        },
        onError: (error) => {
          captureException(error, { context: 'websocket' });
        },
      });
    }

    return () => {
      disconnect();
    };
  }, [connect, disconnect, token, isAuthenticated, isEnabled, queryClient]);

  // Auto-refresh based on form setting
  useEffect(() => {
    if (formValues.autoRefresh && !isLoading) {
      fetchTimerRef.current = setInterval(() => {
        refetchDashboard();
      }, 30000); // 30 seconds
    }

    return () => {
      if (fetchTimerRef.current) {
        clearInterval(fetchTimerRef.current);
      }
    };
  }, [formValues.autoRefresh, isLoading, refetchDashboard]);

  // Handle browser visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && formValues.autoRefresh) {
        // Delay refresh to avoid immediate network spike
        visibilityTimerRef.current = setTimeout(() => {
          refetchDashboard();
        }, 2000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current);
      }
    };
  }, [formValues.autoRefresh, refetchDashboard]);

  // Update state when query data changes
  useEffect(() => {
    if (dashboardQueryData) {
      setDashboardData(dashboardQueryData);
      setLastUpdated(new Date());
      setIsLoading(false);
      
      // Update context
      dispatch({
        type: 'SET_WEBSITES',
        payload: dashboardQueryData.websites || [],
      });

      // Persist state
      persistState();
    }
  }, [dashboardQueryData, dispatch, persistState]);

  useEffect(() => {
    if (seoScoreData) {
      setSeoScore(seoScoreData);
    }
  }, [seoScoreData]);

  useEffect(() => {
    if (weeklyReportData) {
      setWeeklyReport(weeklyReportData);
    }
  }, [weeklyReportData]);

  // Performance tracking
  useEffect(() => {
    if (!isLoading && dashboardData) {
      const totalLoadTime = performance.now() - mountTimeRef.current;
      setPerformanceMetrics(prev => ({ ...prev, loadTime: totalLoadTime }));
      
      reportMetric('dashboard_complete_load', totalLoadTime, {
        dataPoints: dashboardData.issues.length,
        cacheSize: size(),
        variant: dashboardVariant,
      });

      trackEvent('dashboard_loaded', {
        loadTime: totalLoadTime,
        apiCalls: performanceMetrics.apiCalls,
        cacheHits: performanceMetrics.cacheHits,
        errors: performanceMetrics.errors,
        environment: env.VITE_ENVIRONMENT,
      });
    }
  }, [isLoading, dashboardData, performanceMetrics, size, reportMetric, trackEvent, dashboardVariant]);

  // Render count for performance optimization
  useEffect(() => {
    renderCountRef.current += 1;
    
    if (renderCountRef.current > 10 && enablePerformanceOptimizations) {
      logWarning('High render count detected', { count: renderCountRef.current });
    }
  });

  // Calculate derived metrics with memoization
  const metrics = useMemo(() => {
    if (!dashboardData || !seoScoreData) return null;

    const calculationTrace = startTrace('metrics_calculation');
    
    try {
      const criticalIssues = dashboardData.issues.filter(issue => issue.severity === 'critical');
      const highIssues = dashboardData.issues.filter(issue => issue.severity === 'high');
      const mediumIssues = dashboardData.issues.filter(issue => issue.severity === 'medium');
      const lowIssues = dashboardData.issues.filter(issue => issue.severity === 'low');

      const totalFixes = dashboardData.appliedFixes + dashboardData.pendingFixes;
      const fixSuccessRate = totalFixes > 0 
        ? Math.round((dashboardData.appliedFixes / totalFixes) * 100)
        : 0;

      const metrics = {
        criticalIssues: criticalIssues.length,
        highIssues: highIssues.length,
        mediumIssues: mediumIssues.length,
        lowIssues: lowIssues.length,
        totalIssues: dashboardData.issues.length,
        fixSuccessRate,
        avgFixTime: dashboardData.averageFixTime?.toFixed(1) || '0.0',
        performanceScore: seoScoreData.performance || 0,
        accessibilityScore: seoScoreData.accessibility || 0,
        bestPracticesScore: seoScoreData.bestPractices || 0,
        seoScore: seoScoreData.seo || 0,
        websitesScanned: dashboardData.websitesScanned || 1,
        lastScanDate: dashboardData.lastScanDate || new Date().toISOString(),
        impactScore: calculateImpact(dashboardData.issues),
        seoScoreLabel: formatSeoScore(seoScoreData.seo || 0),
        seoScoreColor: getScoreColor(seoScoreData.seo || 0),
        aiRecommendations: enableAIRecommendations ? generateAIRecommendations(dashboardData) : [],
      };

      return metrics;
    } finally {
      endTrace(calculationTrace);
    }
  }, [dashboardData, seoScoreData, enableAIRecommendations, startTrace, endTrace]);

  // Generate AI recommendations
  const generateAIRecommendations = useCallback((data: DashboardStats): Array<{
    id: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    action: string;
  }> => {
    const recommendations = [];
    
    if (data.issues.some(issue => issue.severity === 'critical')) {
      recommendations.push({
        id: 'rec-1',
        title: 'Fix Critical Issues',
        description: 'Address critical SEO issues immediately to prevent ranking drops',
        priority: 'high' as const,
        action: 'View critical issues',
      });
    }
    
    if (data.seoScore && data.seoScore < 70) {
      recommendations.push({
        id: 'rec-2',
        title: 'Improve SEO Score',
        description: 'Your SEO score needs improvement. Consider implementing our optimization suggestions',
        priority: 'medium' as const,
        action: 'View optimization plan',
      });
    }
    
    return recommendations;
  }, []);

  // Event handlers with rate limiting
  const handleTimeRangeChange = useCallback(
    debounce((range: '7d' | '30d' | '90d') => {
      if (!checkRateLimit('time_range_change')) {
        logWarning('Rate limit exceeded for time range changes');
        return;
      }
      
      setValue('timeRange', range);
      trackEvent('dashboard_time_range_change', { range });
    }, 300),
    [setValue, trackEvent, checkRateLimit]
  );

  const handleWebsiteChange = useCallback(
    throttle((websiteId: string) => {
      if (!checkRateLimit('website_change')) {
        logWarning('Rate limit exceeded for website changes');
        return;
      }
      
      const sanitizedId = sanitizeInput(websiteId);
      setValue('websiteId', sanitizedId);
      trackEvent('dashboard_website_change', { websiteId: sanitizedId });
    }, 500),
    [setValue, trackEvent, checkRateLimit]
  );

  const handleOneClickFix = useCallback(async (issueId: string) => {
    const sanitizedId = sanitizeInput(issueId);
    
    if (!checkRateLimit('one_click_fix')) {
      setError('Too many fix attempts. Please wait before trying again.');
      return;
    }
    
    try {
      await applyFixMutation.mutateAsync(sanitizedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply fix');
    }
  }, [applyFixMutation, checkRateLimit]);

  const handleBulkFix = useCallback(async (issueIds: string[]) => {
    const sanitizedIds = issueIds.map(sanitizeInput);
    
    if (!checkRateLimit('bulk_fix')) {
      setError('Too many bulk fix attempts. Please wait before trying again.');
      return;
    }
    
    try {
      await bulkFixMutation.mutateAsync(sanitizedIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply bulk fixes');
    }
  }, [bulkFixMutation, checkRateLimit]);

  const handleManualRefresh = useCallback(() => {
    if (!checkRateLimit('manual_refresh')) {
      logWarning('Rate limit exceeded for manual refresh');
      return;
    }
    
    trackEvent('dashboard_manual_refresh');
    refetchDashboard();
    resetRateLimit('manual_refresh');
  }, [refetchDashboard, trackEvent, checkRateLimit, resetRateLimit]);

  // Clear errors
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (fetchTimerRef.current) {
        clearInterval(fetchTimerRef.current);
      }
      if (visibilityTimerRef.current) {
        clearTimeout(visibilityTimerRef.current);
      }
    };
  }, []);

  // Loading state
  const isLoadingState = isDashboardLoading || isSeoScoreLoading || isWeeklyReportLoading || isLoading;

  // Error state
  if (dashboardError && !dashboardData) {
    const errorMessage = dashboardError instanceof Error ? dashboardError.message : 'Failed to load dashboard';
    captureException(dashboardError as Error, { context: 'dashboard_initial_load' });
    
    return (
      <MainLayout>
        <Helmet>
          <title>Error - SEO Dashboard</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
          <div className="text-center max-w-md">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-bold text-gray-900">Unable to Load Dashboard</h2>
            <p className="mt-2 text-gray-600">{errorMessage}</p>
            <div className="mt-6 space-y-3">
              <button
                onClick={() => refetchDashboard()}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                aria-label="Retry loading dashboard"
              >
                Retry
              </button>
              <Link to="/scan">
                <button className="w-full bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors">
                  Run New Scan
                </button>
              </Link>
            </div>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <ErrorBoundary
      FallbackComponent={DashboardErrorFallback}
      onReset={() => {
        clearError();
        setIsLoading(true);
        refetchDashboard();
      }}
      onError={(error, info) => {
        captureException(error, { componentStack: info.componentStack });
        trackError(error, { component: 'Dashboard' });
      }}
    >
      <Helmet>
        <title>SEO Dashboard - AI SEO Diagnostics</title>
        <meta name="description" content="Monitor and improve your website's SEO performance with real-time analytics and AI-powered recommendations" />
        <meta property="og:title" content="SEO Dashboard - AI SEO Diagnostics" />
        <meta property="og:description" content="Comprehensive SEO monitoring and optimization dashboard" />
        <link rel="preload" href="/api/dashboard/stats" as="fetch" crossOrigin="anonymous" />
      </Helmet>
      
      <MainLayout>
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        }>
          <div className="space-y-6">
            {/* Header with real-time indicators */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">SEO Dashboard</h1>
                  {isConnected && env.VITE_ENABLE_REALTIME && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1"></span>
                      Live
                    </span>
                  )}
                  {dashboardVariant && dashboardVariant !== 'control' && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                      {dashboardVariant}
                    </span>
                  )}
                </div>
                <p className="text-gray-600 mt-1 sm:mt-2">
                  Monitor and improve your website's SEO performance
                  {enableAIRecommendations && ' with AI-powered insights'}
                </p>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Performance metrics */}
                {enableAdvancedAnalytics && lastUpdated && (
                  <div className="text-sm text-gray-500 hidden md:block">
                    Load: {performanceMetrics.loadTime.toFixed(0)}ms • 
                    Cache: {performanceMetrics.cacheHits} hits • 
                    API: {performanceMetrics.apiCalls} calls
                  </div>
                )}
                
                {/* Last updated */}
                {lastUpdated && (
                  <div className="text-sm text-gray-500">
                    Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
                
                {/* Refresh button */}
                <button
                  onClick={handleManualRefresh}
                  disabled={isLoadingState || !checkRateLimit('refresh_button')}
                  className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Refresh dashboard data"
                  title="Refresh data"
                >
                  <svg 
                    className={`w-4 h-4 ${isLoadingState ? 'animate-spin' : ''}`} 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
                
                {/* Website selector */}
                <div className="flex items-center space-x-2">
                  <label htmlFor="website-select" className="sr-only">
                    Select website
                  </label>
                  <select
                    id="website-select"
                    value={formValues.websiteId}
                    onChange={(e) => handleWebsiteChange(e.target.value)}
                    className="rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    disabled={isLoadingState}
                    aria-label="Select website to view"
                  >
                    <option value="all">All Websites</option>
                    {state.websites?.map(website => (
                      <option key={website.id} value={website.id}>
                        {DOMPurify.sanitize(website.name)}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* Time range selector */}
                <div className="flex items-center space-x-2">
                  <span className="sr-only">Select time range</span>
                  <div className="flex space-x-1" role="group" aria-label="Time range selection">
                    {(['7d', '30d', '90d'] as const).map(range => (
                      <button
                        key={range}
                        onClick={() => handleTimeRangeChange(range)}
                        disabled={isLoadingState}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          formValues.timeRange === range
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        } ${isLoadingState ? 'opacity-50 cursor-not-allowed' : ''}`}
                        aria-pressed={formValues.timeRange === range}
                      >
                        {range}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Real-time updates notification */}
            {realtimeUpdates.length > 0 && formValues.notificationsEnabled && (
              <div 
                className="bg-blue-50 border border-blue-200 rounded-lg p-3 animate-fade-in"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center">
                  <svg className="h-5 w-5 text-blue-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                  </svg>
                  <span className="text-sm text-blue-700">
                    {realtimeUpdates.length} update{realtimeUpdates.length !== 1 ? 's' : ''} received
                  </span>
                  <button
                    onClick={() => setRealtimeUpdates([])}
                    className="ml-auto text-blue-500 hover:text-blue-700"
                    aria-label="Clear notifications"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* Loading State */}
            {isLoadingState && !dashboardData ? (
              <div className="space-y-6">
                {/* Skeleton for Health Score */}
                <div className="bg-white rounded-xl shadow p-6">
                  <div className="h-6 w-48 bg-gray-200 rounded mb-6 animate-pulse"></div>
                  <div className="h-32 bg-gray-100 rounded animate-pulse"></div>
                </div>
                
                {/* Skeleton for Quick Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-white rounded-xl shadow p-6">
                      <div className="h-4 bg-gray-200 rounded w-1/2 mb-4 animate-pulse"></div>
                      <div className="h-8 bg-gray-200 rounded w-3/4 animate-pulse"></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : metrics && dashboardData ? (
              <>
                {/* Health Score Section */}
                <div className="bg-white rounded-xl shadow p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-900">SEO Health Score</h2>
                    <div className="flex items-center space-x-4">
                      <span className={`text-sm font-medium ${metrics.seoScoreColor}`}>
                        {metrics.seoScoreLabel}
                      </span>
                      <span className="text-sm text-gray-500">
                        Last scan: {new Date(metrics.lastScanDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  
                  {seoScoreData && (
                    <HealthScore 
                      score={metrics.seoScore}
                      performanceScore={metrics.performanceScore}
                      accessibilityScore={metrics.accessibilityScore}
                      bestPracticesScore={metrics.bestPracticesScore}
                      impactScore={metrics.impactScore}
                      isLoading={isLoadingState}
                      aiRecommendations={metrics.aiRecommendations}
                    />
                  )}
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <div className="bg-white rounded-xl shadow p-4 sm:p-6">
                      <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-6">Quick Statistics</h2>
                      <QuickStats 
                        criticalIssues={metrics.criticalIssues}
                        highIssues={metrics.highIssues}
                        mediumIssues={metrics.mediumIssues}
                        lowIssues={metrics.lowIssues}
                        totalIssues={metrics.totalIssues}
                        fixSuccessRate={metrics.fixSuccessRate}
                        avgFixTime={metrics.avgFixTime}
                        websitesScanned={metrics.websitesScanned}
                        isLoading={isLoadingState}
                        advancedMetrics={enableAdvancedAnalytics}
                      />
                    </div>
                  </div>

                  {/* One-Click Fix Section */}
                  <div className="bg-white rounded-xl shadow p-4 sm:p-6">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Quick Fixes</h2>
                      <span className="text-sm text-gray-500">
                        {dashboardData.issues.filter(i => i.fixable).length} fixable
                      </span>
                    </div>
                    <OneClickFix 
                      issues={dashboardData.issues}
                      onFix={handleOneClickFix}
                      onBulkFix={handleBulkFix}
                      isLoading={isLoadingState || applyFixMutation.isLoading || bulkFixMutation.isLoading}
                      aiEnabled={enableAIRecommendations}
                    />
                  </div>
                </div>

                {/* Weekly Report & Active Fixes */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2">
                    <div className="bg-white rounded-xl shadow p-4 sm:p-6">
                      <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-6">Weekly Report</h2>
                      {weeklyReportData ? (
                        <WeeklyReport 
                          report={weeklyReportData}
                          timeRange={formValues.timeRange}
                          isLoading={isLoadingState}
                        />
                      ) : (
                        <div className="text-center py-8">
                          <div className="mx-auto h-12 w-12 text-gray-300 mb-4">
                            <svg className="w-full h-full" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                          </div>
                          <p className="text-gray-500">No weekly report available</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Active Fixes */}
                  <div className="bg-white rounded-xl shadow p-4 sm:p-6">
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-6">Active Fixes</h2>
                    <ActiveFixes 
                      activeFixes={dashboardData.activeFixes}
                      onFixComplete={handleManualRefresh}
                      isLoading={isLoadingState}
                    />
                  </div>
                </div>

                {/* AI Recommendations Section */}
                {enableAIRecommendations && metrics.aiRecommendations && metrics.aiRecommendations.length > 0 && (
                  <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-100 rounded-xl shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">AI Recommendations</h3>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        AI-Powered
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {metrics.aiRecommendations.map(rec => (
                        <div key={rec.id} className="bg-white rounded-lg p-4 shadow-sm">
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-medium text-gray-900">{rec.title}</h4>
                              <p className="text-sm text-gray-600 mt-1">{rec.description}</p>
                            </div>
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              rec.priority === 'high' 
                                ? 'bg-red-100 text-red-800' 
                                : rec.priority === 'medium'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-green-100 text-green-800'
                            }`}>
                              {rec.priority}
                            </span>
                          </div>
                          <button className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
                            {rec.action} →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Call to Action */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl shadow-sm p-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        Ready to improve your SEO score?
                      </h3>
                      <p className="text-gray-600">
                        Run a comprehensive scan to identify all SEO issues and get personalized recommendations.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                      <Link to="/scan" className="w-full sm:w-auto">
                        <button
                          onClick={() => trackEvent('dashboard_cta_scan_click')}
                          disabled={isLoadingState}
                          className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Run New Scan
                        </button>
                      </Link>
                      <Link to="/reports" className="w-full sm:w-auto">
                        <button
                          onClick={() => trackEvent('dashboard_cta_reports_click')}
                          disabled={isLoadingState}
                          className="w-full bg-white text-blue-600 border border-blue-600 px-6 py-3 rounded-lg font-medium hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          View Detailed Reports
                        </button>
                      </Link>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              // Empty State
              <div className="bg-white rounded-xl shadow p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
                  <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">No SEO data available</h3>
                <p className="mt-2 text-sm text-gray-500">
                  Get started by running your first SEO scan.
                </p>
                <div className="mt-6">
                  <Link to="/scan">
                    <button
                      onClick={() => trackEvent('dashboard_empty_state_cta_click')}
                      className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    >
                      Run First Scan
                    </button>
                  </Link>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && dashboardData && (
              <div 
                className="bg-red-50 border border-red-200 rounded-lg p-4 animate-fade-in"
                role="alert"
                aria-live="polite"
              >
                <div className="flex items-start">
                  <div className="flex-shrink-0 mt-0.5">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1">
                    <p className="text-sm text-red-700">{error}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearError}
                    className="ml-3 inline-flex text-red-500 hover:text-red-700 focus:outline-none"
                    aria-label="Dismiss error"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {/* Performance watermark (dev only) */}
            {env.VITE_ENVIRONMENT === 'development' && (
              <div className="fixed bottom-4 right-4 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                Perf: {performanceMetrics.loadTime.toFixed(0)}ms | 
                Renders: {renderCountRef.current} | 
                Cache: {size()} items
              </div>
            )}
          </div>
        </Suspense>
      </MainLayout>
    </ErrorBoundary>
  );
};

// Performance monitoring HOC
const DashboardWithPerformance = withPerformanceMonitoring(Dashboard);

// Export with React.memo and display name
const MemoizedDashboard = React.memo(DashboardWithPerformance);
MemoizedDashboard.displayName = 'Dashboard';

export default MemoizedDashboard;