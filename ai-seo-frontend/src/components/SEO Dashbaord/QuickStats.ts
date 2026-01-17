import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios, { AxiosError, CancelTokenSource } from 'axios';
import { DashboardStats, API_ENDPOINTS, SEO_CATEGORIES } from '../../utils/constants';
import { useAnalytics } from '../../hooks/useAnalytics';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';
import ErrorBoundary from '../ui/ErrorBoundary';
import LoadingSkeleton from '../ui/LoadingSkeleton';

// Type definitions with strict validation
interface QuickStatsData extends DashboardStats {
  period: '7d' | '30d' | '90d';
  timestamp: string;
  dataVersion: string;
  metadata: {
    generatedAt: string;
    ttl: number;
    source: 'live' | 'cache' | 'fallback';
    cacheKey?: string;
  };
  breakdown: {
    daily: Array<{
      date: string;
      scans: number;
      fixes: number;
      score: number;
    }>;
    hourly?: Array<{
      hour: string;
      scans: number;
      successRate: number;
    }>;
  };
  predictions?: {
    nextWeekScore: number;
    confidence: number;
    expectedIssues: number;
  };
}

interface QuickStatsProps {
  timeframe?: '7d' | '30d' | '90d';
  websiteId?: string;
  teamId?: string;
  autoRefresh?: boolean;
  onStatsUpdate?: (stats: DashboardStats) => void;
  onError?: (error: { code: string; message: string; retryable: boolean }) => void;
  onLoadingStateChange?: (loading: boolean) => void;
  compareMode?: boolean;
  showPredictions?: boolean;
  enableCache?: boolean;
}

interface ApiResponse<T> {
  data: T;
  status: 'success' | 'partial' | 'error';
  metadata: {
    requestId: string;
    timestamp: string;
    cache: {
      hit: boolean;
      age?: number;
      stale?: boolean;
    };
    rateLimit: {
      remaining: number;
      reset: number;
      limit: number;
    };
  };
  warnings?: string[];
}

interface ComponentMetrics {
  loadTime: number;
  renderCount: number;
  errorCount: number;
  cacheHitRate: number;
  lastDataFetch: number;
}

// Web Worker for heavy calculations (separate thread)
class StatsCalculator extends Worker {
  constructor() {
    super(new URL('./stats.worker.ts', import.meta.url));
  }
  
  calculateTrends(data: QuickStatsData): Promise<{
    trends: any[];
    predictions: any;
    insights: string[];
  }> {
    return new Promise((resolve, reject) => {
      this.onmessage = (e) => resolve(e.data);
      this.onerror = reject;
      this.postMessage({ type: 'calculate', data });
    });
  }
}

// Main component with all production features
const QuickStats: React.FC<QuickStatsProps> = ({
  timeframe = '7d',
  websiteId,
  teamId,
  autoRefresh = true,
  onStatsUpdate,
  onError,
  onLoadingStateChange,
  compareMode = false,
  showPredictions = true,
  enableCache = true,
}) => {
  // Refs
  const cancelTokenSourceRef = useRef<CancelTokenSource | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const statsWorkerRef = useRef<Worker | null>(null);
  const mountedRef = useRef(true);
  
  // Cache with Redis-like structure (local storage + memory)
  const cacheStore = useRef({
    memory: new Map<string, { data: QuickStatsData; expires: number; etag?: string }>(),
    storage: {
      get: (key: string): QuickStatsData | null => {
        try {
          const item = localStorage.getItem(`qs_cache_${key}`);
          if (!item) return null;
          const parsed = JSON.parse(item);
          if (Date.now() > parsed.expires) {
            localStorage.removeItem(`qs_cache_${key}`);
            return null;
          }
          return parsed.data;
        } catch {
          return null;
        }
      },
      set: (key: string, data: QuickStatsData, ttl: number) => {
        try {
          const item = {
            data,
            expires: Date.now() + ttl,
            storedAt: Date.now(),
          };
          localStorage.setItem(`qs_cache_${key}`, JSON.stringify(item));
        } catch (error) {
          console.warn('Failed to cache data:', error);
        }
      },
      clearOld: () => {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('qs_cache_')) {
              const item = localStorage.getItem(key);
              if (item) {
                const parsed = JSON.parse(item);
                if (Date.now() > parsed.expires) {
                  localStorage.removeItem(key);
                }
              }
            }
          }
        } catch (error) {
          // Silent fail
        }
      },
    },
  });

  // State
  const [state, setState] = useState<{
    data: QuickStatsData | null;
    loading: boolean;
    error: { code: string; message: string; retryable: boolean } | null;
    lastSuccessfulFetch: number | null;
    cacheStatus: 'fresh' | 'stale' | 'expired' | 'miss';
    offline: boolean;
    retryCount: number;
    backgroundRefreshing: boolean;
    predictions: any;
    insights: string[];
  }>({
    data: null,
    loading: true,
    error: null,
    lastSuccessfulFetch: null,
    cacheStatus: 'miss',
    offline: !navigator.onLine,
    retryCount: 0,
    backgroundRefreshing: false,
    predictions: null,
    insights: [],
  });

  // Hooks
  const { trackEvent, trackError, trackPerformance } = useAnalytics();
  const { measure, reportMetric } = usePerformanceMonitor('QuickStats');
  
  // Configuration with environment overrides
  const CONFIG = useMemo(() => ({
    // API
    baseURL: process.env.REACT_APP_API_URL || 'https://api.seo-tool.com/v1',
    timeout: parseInt(process.env.REACT_APP_API_TIMEOUT || '15000'),
    
    // Retry
    maxRetries: parseInt(process.env.REACT_APP_MAX_RETRIES || '3'),
    retryDelay: 2000,
    retryBackoffFactor: 2,
    
    // Cache
    cacheTTL: parseInt(process.env.REACT_APP_CACHE_TTL || '300000'), // 5 minutes
    staleWhileRevalidate: parseInt(process.env.REACT_APP_STALE_TTL || '60000'), // 1 minute
    maxCacheSize: 50,
    
    // Polling
    pollingInterval: autoRefresh ? parseInt(process.env.REACT_APP_POLLING_INTERVAL || '30000') : 0,
    backgroundRefreshThreshold: 1000 * 60 * 5, // 5 minutes
    
    // Performance
    debounceDelay: 300,
    lazyLoadThreshold: 1000, // Start calculations after 1s
    webWorkerEnabled: typeof Worker !== 'undefined' && !process.env.NODE_ENV === 'test',
    
    // Feature flags
    enablePredictions: showPredictions && process.env.REACT_APP_ENABLE_PREDICTIONS === 'true',
    enableOffline: process.env.REACT_APP_ENABLE_OFFLINE === 'true',
    enableBackgroundSync: process.env.REACT_APP_ENABLE_BACKGROUND_SYNC === 'true',
    
    // Monitoring
    sampleRate: parseFloat(process.env.REACT_APP_METRICS_SAMPLE_RATE || '0.1'),
  }), [autoRefresh, showPredictions]);

  // Initialize Web Worker
  useEffect(() => {
    if (CONFIG.webWorkerEnabled && !statsWorkerRef.current) {
      statsWorkerRef.current = new StatsCalculator();
    }
    
    return () => {
      if (statsWorkerRef.current) {
        statsWorkerRef.current.terminate();
      }
    };
  }, [CONFIG.webWorkerEnabled]);

  // Cleanup
  const cleanup = useCallback(() => {
    mountedRef.current = false;
    
    // Cancel requests
    if (cancelTokenSourceRef.current) {
      cancelTokenSourceRef.current.cancel('Component unmounted');
      cancelTokenSourceRef.current = null;
    }
    
    // Clear intervals
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    // Clear cache if too large
    if (cacheStore.current.memory.size > CONFIG.maxCacheSize) {
      cacheStore.current.memory.clear();
    }
  }, [CONFIG.maxCacheSize]);

  // Cache management
  const getCachedData = useCallback((key: string): { data: QuickStatsData; source: 'memory' | 'storage' | null } => {
    if (!enableCache) return { data: null, source: null };
    
    // Check memory cache first
    const memoryCache = cacheStore.current.memory.get(key);
    if (memoryCache && Date.now() < memoryCache.expires) {
      return { data: memoryCache.data, source: 'memory' };
    }
    
    // Check localStorage
    const storageData = cacheStore.current.storage.get(key);
    if (storageData) {
      // Populate memory cache
      cacheStore.current.memory.set(key, {
        data: storageData,
        expires: Date.now() + CONFIG.cacheTTL,
      });
      return { data: storageData, source: 'storage' };
    }
    
    return { data: null, source: null };
  }, [enableCache, CONFIG.cacheTTL]);

  const setCachedData = useCallback((key: string, data: QuickStatsData, ttl = CONFIG.cacheTTL) => {
    if (!enableCache) return;
    
    const cacheItem = {
      data,
      expires: Date.now() + ttl,
      etag: `"${Date.now()}-${Math.random().toString(36).substr(2, 9)}"`,
    };
    
    // Update memory cache
    cacheStore.current.memory.set(key, cacheItem);
    
    // Update localStorage (async)
    requestIdleCallback(() => {
      cacheStore.current.storage.set(key, data, ttl);
    });
  }, [enableCache, CONFIG.cacheTTL]);

  // Error handling with Sentry integration
  const handleError = useCallback((error: unknown, context: string) => {
    const errorId = `qs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    let errorDetails = {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected error occurred',
      retryable: false,
      context,
      errorId,
    };
    
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{
        code: string;
        message: string;
        retryAfter?: number;
      }>;
      
      if (axiosError.response) {
        const { status, data, headers } = axiosError.response;
        
        switch (status) {
          case 400:
            errorDetails = {
              code: 'VALIDATION_ERROR',
              message: data?.message || 'Invalid request parameters',
              retryable: false,
              context,
              errorId,
            };
            break;
            
          case 401:
            errorDetails = {
              code: 'UNAUTHORIZED',
              message: 'Your session has expired. Please log in again.',
              retryable: false,
              context,
              errorId,
            };
            // Trigger auth refresh
            window.dispatchEvent(new CustomEvent('auth:refresh', { detail: { silent: true } }));
            break;
            
          case 403:
            errorDetails = {
              code: 'FORBIDDEN',
              message: 'You do not have permission to view these statistics.',
              retryable: false,
              context,
              errorId,
            };
            break;
            
          case 404:
            errorDetails = {
              code: 'NOT_FOUND',
              message: 'Statistics not found for the specified criteria.',
              retryable: false,
              context,
              errorId,
            };
            break;
            
          case 429:
            const retryAfter = parseInt(headers['retry-after'] || data?.retryAfter?.toString() || '30');
            errorDetails = {
              code: 'RATE_LIMITED',
              message: `Too many requests. Please wait ${retryAfter} seconds.`,
              retryable: true,
              context,
              errorId,
            };
            
            // Schedule automatic retry
            if (state.retryCount < CONFIG.maxRetries) {
              retryTimeoutRef.current = setTimeout(() => {
                if (mountedRef.current) {
                  fetchData();
                }
              }, retryAfter * 1000);
            }
            break;
            
          case 500:
          case 502:
          case 503:
          case 504:
            errorDetails = {
              code: 'SERVER_ERROR',
              message: 'Our servers are experiencing issues. Please try again later.',
              retryable: true,
              context,
              errorId,
            };
            break;
            
          default:
            errorDetails = {
              code: `HTTP_${status}`,
              message: data?.message || `Server error: ${status}`,
              retryable: status >= 500,
              context,
              errorId,
            };
        }
      } else if (axiosError.request) {
        errorDetails = {
          code: 'NETWORK_ERROR',
          message: 'Unable to connect to the server. Please check your internet connection.',
          retryable: true,
          context,
          errorId,
        };
      } else {
        errorDetails = {
          code: 'REQUEST_ERROR',
          message: axiosError.message,
          retryable: false,
          context,
          errorId,
        };
      }
    } else if (error instanceof Error) {
      errorDetails = {
        code: 'CLIENT_ERROR',
        message: error.message,
        retryable: false,
        context,
        errorId,
      };
    }
    
    // Track error
    trackError('quick_stats_error', {
      ...errorDetails,
      timeframe,
      retryCount: state.retryCount,
    });
    
    // Update state
    if (mountedRef.current) {
      setState(prev => ({
        ...prev,
        error: errorDetails,
        loading: false,
        backgroundRefreshing: false,
      }));
      
      onError?.(errorDetails);
    }
    
    // Report to monitoring service
    if (process.env.NODE_ENV === 'production') {
      fetch('/api/monitoring/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: 'QuickStats',
          ...errorDetails,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
        }),
        keepalive: true, // Ensure delivery even if page unloads
      }).catch(() => {}); // Silently fail
    }
  }, [timeframe, state.retryCount, CONFIG.maxRetries, trackError, onError]);

  // Main data fetching with all production features
  const fetchData = useCallback(async (forceRefresh = false, background = false) => {
    if (!mountedRef.current) return;
    
    const cacheKey = `stats_${websiteId}_${teamId}_${timeframe}`;
    const measurement = measure('data_fetch');
    
    try {
      // Don't show loading spinner for background refreshes
      if (!background) {
        setState(prev => ({ ...prev, loading: true }));
        onLoadingStateChange?.(true);
      } else {
        setState(prev => ({ ...prev, backgroundRefreshing: true }));
      }
      
      // Check cache first
      if (!forceRefresh && enableCache) {
        const cached = getCachedData(cacheKey);
        if (cached.data) {
          const cacheAge = Date.now() - (cached.data.metadata.generatedAt ? 
            new Date(cached.data.metadata.generatedAt).getTime() : Date.now());
          
          const isStale = cacheAge > CONFIG.staleWhileRevalidate;
          
          if (!isStale) {
            // Use cached data
            measurement.end({ cache: 'hit', source: cached.source });
            
            setState(prev => ({
              ...prev,
              data: cached.data,
              loading: false,
              error: null,
              cacheStatus: 'fresh',
              lastSuccessfulFetch: Date.now(),
            }));
            
            onStatsUpdate?.(cached.data);
            
            // Refresh in background if stale
            if (cacheAge > CONFIG.cacheTTL * 0.5) {
              setTimeout(() => fetchData(true, true), 0);
            }
            
            return;
          }
          
          // Data is stale but usable
          setState(prev => ({
            ...prev,
            data: cached.data,
            cacheStatus: 'stale',
          }));
        }
      }
      
      // Cancel previous request
      if (cancelTokenSourceRef.current) {
        cancelTokenSourceRef.current.cancel('New request initiated');
      }
      
      cancelTokenSourceRef.current = axios.CancelToken.source();
      
      // Build request
      const token = localStorage.getItem('access_token');
      const refreshToken = localStorage.getItem('refresh_token');
      
      if (!token && !refreshToken) {
        throw new Error('Authentication required');
      }
      
      const requestConfig = {
        url: `${CONFIG.baseURL}${API_ENDPOINTS.DASHBOARD}`,
        method: 'GET' as const,
        params: {
          timeframe,
          websiteId,
          teamId,
          compare: compareMode,
          include: ['breakdown', 'predictions', 'metadata'].join(','),
          dataVersion: '2.0',
        },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Accept-Version': '2.0',
          'X-Request-ID': `qs_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          'X-Client-Version': process.env.REACT_APP_VERSION || '1.0.0',
          'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        timeout: CONFIG.timeout,
        cancelToken: cancelTokenSourceRef.current.token,
        validateStatus: (status: number) => status >= 200 && status < 300,
        // Enable HTTP/2
        httpAgent: new (require('http').Agent)({ keepAlive: true }),
        httpsAgent: new (require('https').Agent)({ keepAlive: true }),
      };
      
      // Make request
      const response = await axios.request<ApiResponse<QuickStatsData>>(requestConfig);
      
      measurement.end({ 
        cache: response.data.metadata.cache.hit ? 'hit' : 'miss',
        status: response.data.status,
      });
      
      // Track successful request
      trackEvent('quick_stats_loaded', {
        timeframe,
        cacheHit: response.data.metadata.cache.hit,
        dataSize: JSON.stringify(response.data.data).length,
        responseTime: measurement.duration,
      });
      
      // Process response
      const data = response.data.data;
      data.metadata = {
        ...data.metadata,
        source: response.data.metadata.cache.hit ? 'cache' : 'live',
        cacheKey,
      };
      
      // Cache the data
      if (enableCache) {
        setCachedData(cacheKey, data);
      }
      
      // Calculate predictions and insights in background
      if (CONFIG.enablePredictions && statsWorkerRef.current) {
        statsWorkerRef.current.calculateTrends(data).then((results) => {
          if (mountedRef.current) {
            setState(prev => ({
              ...prev,
              predictions: results.predictions,
              insights: results.insights,
            }));
          }
        }).catch(() => {
          // Silent fail for predictions
        });
      }
      
      // Update state
      if (mountedRef.current) {
        setState(prev => ({
          ...prev,
          data,
          loading: false,
          error: null,
          retryCount: 0,
          cacheStatus: 'fresh',
          lastSuccessfulFetch: Date.now(),
          backgroundRefreshing: false,
        }));
        
        onStatsUpdate?.(data);
        onLoadingStateChange?.(false);
      }
      
      // Report performance
      reportMetric('data_fetch_success', measurement.duration, {
        cache: response.data.metadata.cache.hit,
        dataSize: JSON.stringify(data).length,
      });
      
    } catch (error) {
      measurement.end({ error: true });
      
      if (!axios.isCancel(error)) {
        // Check if we have stale cache to show
        if (!forceRefresh && enableCache) {
          const cached = getCachedData(cacheKey);
          if (cached.data && !background) {
            setState(prev => ({
              ...prev,
              data: cached.data,
              loading: false,
              cacheStatus: 'stale',
              lastSuccessfulFetch: Date.now(),
            }));
            onStatsUpdate?.(cached.data);
            
            // Still report the error but show cached data
            handleError(error, 'fetch_with_fallback');
            return;
          }
        }
        
        handleError(error, background ? 'background_refresh' : 'initial_fetch');
        
        if (!background) {
          onLoadingStateChange?.(false);
        }
      }
    }
  }, [
    websiteId, teamId, timeframe, compareMode, enableCache, CONFIG,
    measure, trackEvent, reportMetric, onStatsUpdate, onLoadingStateChange,
    getCachedData, setCachedData, handleError,
  ]);

  // Polling management
  const startPolling = useCallback(() => {
    if (CONFIG.pollingInterval > 0 && !pollingIntervalRef.current) {
      pollingIntervalRef.current = setInterval(() => {
        if (mountedRef.current && 
            document.visibilityState === 'visible' && 
            navigator.onLine &&
            state.lastSuccessfulFetch &&
            Date.now() - state.lastSuccessfulFetch > CONFIG.pollingInterval
        ) {
          fetchData(true, true);
        }
      }, CONFIG.pollingInterval);
    }
  }, [CONFIG.pollingInterval, fetchData, state.lastSuccessfulFetch]);

  // Initial load and effects
  useEffect(() => {
    mountedRef.current = true;
    
    // Track component load
    trackEvent('quick_stats_mounted', { timeframe });
    
    // Clear old cache
    cacheStore.current.storage.clearOld();
    
    // Initial fetch
    fetchData(false, false);
    
    // Start polling if enabled
    if (autoRefresh) {
      startPolling();
    }
    
    // Network status listener
    const handleOnline = () => {
      setState(prev => ({ ...prev, offline: false }));
      if (state.error?.code === 'NETWORK_ERROR') {
        fetchData(true, false);
      }
    };
    
    const handleOffline = () => {
      setState(prev => ({ ...prev, offline: true }));
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Visibility change listener
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && 
          state.lastSuccessfulFetch &&
          Date.now() - state.lastSuccessfulFetch > CONFIG.backgroundRefreshThreshold
      ) {
        fetchData(true, true);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup
    return () => {
      cleanup();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // Empty dependency array - only run on mount

  // Handle timeframe changes
  useEffect(() => {
    if (mountedRef.current && state.lastSuccessfulFetch) {
      fetchData(false, false);
    }
  }, [timeframe, websiteId, teamId]);

  // Derived calculations
  const derivedMetrics = useMemo(() => {
    if (!state.data) return null;
    
    const data = state.data;
    
    return {
      // Basic metrics
      totalIssues: data.topIssues.reduce((sum, issue) => sum + issue.count, 0),
      avgScoreChange: data.scoreChange,
      
      // Efficiency metrics
      autoFixRate: data.totalFixes > 0 ? 
        (data.autoFixesApplied / data.totalFixes) * 100 : 0,
      
      scanSuccessRate: data.totalScans > 0 ? 
        ((data.totalScans - data.topIssues.reduce((sum, issue) => sum + issue.count, 0)) / data.totalScans) * 100 : 100,
      
      // Trend calculations
      dailyAverageScans: data.totalScans / parseInt(timeframe),
      fixVelocity: data.totalFixes / parseInt(timeframe),
      
      // Business metrics
      estimatedSavings: data.autoFixesApplied * 0.5, // $0.50 per auto-fix
      roi: data.scoreChange > 0 ? data.scoreChange * 100 : 0,
    };
  }, [state.data, timeframe]);

  // Formatting helpers
  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }, []);

  const formatLargeNumber = useCallback((num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }, []);

  // Render loading state
  if (state.loading && !state.data) {
    return <LoadingSkeleton type="quickStats" />;
  }

  // Render error state with recovery options
  if (state.error && !state.data) {
    return (
      <ErrorBoundary
        error={state.error}
        componentName="QuickStats"
        onRetry={() => fetchData(true, false)}
        showDetails={process.env.NODE_ENV === 'development'}
        fallback={
          <div className="quick-stats-error">
            <h3>Unable to load statistics</h3>
            <p>{state.error.message}</p>
            {state.error.retryable && (
              <button onClick={() => fetchData(true, false)}>
                Retry
              </button>
            )}
          </div>
        }
      />
    );
  }

  if (!state.data) return null;

  // Main render
  return (
    <div className="quick-stats" data-testid="quick-stats">
      {/* Header with controls */}
      <div className="stats-header">
        <h2>Performance Overview</h2>
        
        <div className="controls">
          {/* Timeframe selector */}
          <select 
            value={timeframe}
            onChange={(e) => window.dispatchEvent(new CustomEvent('timeframe:change', {
              detail: { timeframe: e.target.value }
            }))}
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
          
          {/* Refresh button */}
          <button
            onClick={() => fetchData(true, false)}
            disabled={state.loading || state.backgroundRefreshing}
            aria-label="Refresh statistics"
          >
            {state.backgroundRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          
          {/* Export button */}
          <button
            onClick={() => window.dispatchEvent(new Event('stats:export'))}
            aria-label="Export statistics"
          >
            Export
          </button>
        </div>
      </div>
      
      {/* Stats grid */}
      <div className="stats-grid">
        {/* Total Scans */}
        <div className="stat-card">
          <div className="stat-icon">🔍</div>
          <div className="stat-value">{formatLargeNumber(state.data.totalScans)}</div>
          <div className="stat-label">Total Scans</div>
          {derivedMetrics && (
            <div className="stat-trend">
              {derivedMetrics.dailyAverageScans.toFixed(1)} avg/day
            </div>
          )}
        </div>
        
        {/* Issues Fixed */}
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{formatLargeNumber(state.data.totalFixes)}</div>
          <div className="stat-label">Issues Fixed</div>
          {derivedMetrics && (
            <div className="stat-trend">
              {derivedMetrics.autoFixRate.toFixed(0)}% auto-fixed
            </div>
          )}
        </div>
        
        {/* Average Score */}
        <div className="stat-card">
          <div className="stat-icon">📈</div>
          <div className="stat-value">{state.data.averageScore.toFixed(0)}</div>
          <div className="stat-label">Average Score</div>
          <div className={`stat-trend ${state.data.scoreChange >= 0 ? 'positive' : 'negative'}`}>
            {state.data.scoreChange >= 0 ? '+' : ''}{state.data.scoreChange.toFixed(1)}%
          </div>
        </div>
        
        {/* Estimated Savings */}
        {derivedMetrics && (
          <div className="stat-card">
            <div className="stat-icon">💰</div>
            <div className="stat-value">{formatCurrency(derivedMetrics.estimatedSavings)}</div>
            <div className="stat-label">Estimated Savings</div>
            <div className="stat-trend">
              From auto-fixes
            </div>
          </div>
        )}
      </div>
      
      {/* Performance metrics */}
      {state.data.performanceMetrics && (
        <div className="performance-metrics">
          <h3>System Performance</h3>
          <div className="metrics-grid">
            <MetricItem
              label="Avg Scan Time"
              value={`${state.data.performanceMetrics.avgScanTime}s`}
              status={state.data.performanceMetrics.avgScanTime < 10 ? 'good' : 'warning'}
            />
            <MetricItem
              label="Success Rate"
              value={`${state.data.performanceMetrics.successRate}%`}
              status={state.data.performanceMetrics.successRate >= 95 ? 'good' : 'warning'}
            />
            <MetricItem
              label="Uptime"
              value={`${state.data.performanceMetrics.uptime}%`}
              status={state.data.performanceMetrics.uptime >= 99.9 ? 'good' : 'warning'}
            />
          </div>
        </div>
      )}
      
      {/* Predictions */}
      {state.predictions && CONFIG.enablePredictions && (
        <div className="predictions">
          <h3>Predictions</h3>
          <div className="prediction-card">
            <div className="prediction-value">
              {state.predictions.nextWeekScore.toFixed(0)}
            </div>
            <div className="prediction-label">
              Expected score next week ({(state.predictions.confidence * 100).toFixed(0)}% confidence)
            </div>
          </div>
        </div>
      )}
      
      {/* Insights */}
      {state.insights.length > 0 && (
        <div className="insights">
          <h3>Insights</h3>
          <ul>
            {state.insights.map((insight, index) => (
              <li key={index}>{insight}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Footer */}
      <div className="stats-footer">
        <div className="cache-status">
          {state.cacheStatus === 'stale' && (
            <span className="warning">Showing cached data</span>
          )}
          {state.offline && (
            <span className="offline">Offline mode</span>
          )}
        </div>
        
        <div className="last-updated">
          {state.lastSuccessfulFetch && (
            <>
              Updated: {new Date(state.lastSuccessfulFetch).toLocaleTimeString()}
              {state.backgroundRefreshing && ' • Refreshing...'}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Metric sub-component
const MetricItem: React.FC<{
  label: string;
  value: string;
  status: 'good' | 'warning' | 'critical';
}> = ({ label, value, status }) => (
  <div className={`metric-item ${status}`}>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
  </div>
);

// Performance monitoring wrapper
const QuickStatsWithMonitoring = (props: QuickStatsProps) => {
  const PerformanceWrapper = usePerformanceMonitor('QuickStats');
  
  return (
    <PerformanceWrapper>
      <ErrorBoundary>
        <QuickStats {...props} />
      </ErrorBoundary>
    </PerformanceWrapper>
  );
};

export default React.memo(QuickStatsWithMonitoring);