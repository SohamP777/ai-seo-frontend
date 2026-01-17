import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios, { AxiosError, CancelTokenSource } from 'axios';
import { formatSeoScore, calculateImpact } from '../../utils/formatSeoScore';
import { SEOIssue, API_ENDPOINTS } from '../../utils/constants';

// Type definitions
interface HealthScoreData {
  currentScore: number;
  previousScore: number;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
  scoreBreakdown: {
    performance: number;
    seo: number;
    accessibility: number;
    bestPractices: number;
  };
  topIssues: SEOIssue[];
  scannedAt: string;
  nextScanAt: string;
  websiteUrl: string;
}

interface HealthScoreProps {
  url?: string;
  refreshTrigger?: number;
  autoRefresh?: boolean;
  onScoreUpdate?: (score: number) => void;
  onError?: (error: string) => void;
}

interface ApiErrorResponse {
  message: string;
  code: string;
  retryAfter?: number;
}

// Performance optimization: Memoized component
const HealthScore: React.FC<HealthScoreProps> = React.memo(({
  url,
  refreshTrigger = 0,
  autoRefresh = true,
  onScoreUpdate,
  onError
}) => {
  // State management with proper typing
  const [data, setData] = useState<HealthScoreData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  
  // Refs for cleanup
  const cancelTokenSourceRef = React.useRef<CancelTokenSource | null>(null);
  const pollingIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const mountedRef = React.useRef<boolean>(true);

  // API configuration
  const API_CONFIG = useMemo(() => ({
    timeout: 30000,
    retries: 3,
    retryDelay: 1000,
    pollingInterval: autoRefresh ? 60000 : 0, // 1 minute for auto-refresh
  }), [autoRefresh]);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (cancelTokenSourceRef.current) {
      cancelTokenSourceRef.current.cancel('Component unmounted');
      cancelTokenSourceRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    mountedRef.current = false;
  }, []);

  // Error handler with proper logging
  const handleError = useCallback((err: unknown, context: string) => {
    let errorMessage = 'An unexpected error occurred';
    let shouldRetry = false;
    
    if (axios.isAxiosError(err)) {
      const axiosError = err as AxiosError<ApiErrorResponse>;
      
      if (axiosError.response) {
        // Server responded with error
        const { status, data } = axiosError.response;
        
        switch (status) {
          case 401:
            errorMessage = 'Authentication failed. Please login again.';
            // Redirect to login
            window.location.href = '/auth/login';
            break;
          case 403:
            errorMessage = 'You do not have permission to view this data.';
            break;
          case 404:
            errorMessage = 'Health score data not found for this URL.';
            break;
          case 429:
            errorMessage = 'Too many requests. Please wait before trying again.';
            const retryAfter = data?.retryAfter || 30;
            shouldRetry = true;
            setTimeout(() => {
              if (mountedRef.current) {
                fetchHealthScore();
              }
            }, retryAfter * 1000);
            break;
          case 500:
            errorMessage = 'Server error occurred. Please try again later.';
            shouldRetry = retryCount < API_CONFIG.retries;
            break;
          default:
            errorMessage = data?.message || `Error ${status}: ${axiosError.message}`;
        }
      } else if (axiosError.request) {
        // No response received
        errorMessage = 'Network error. Please check your connection.';
        shouldRetry = retryCount < API_CONFIG.retries;
      } else {
        // Request setup error
        errorMessage = `Request error: ${axiosError.message}`;
      }
    } else if (err instanceof Error) {
      errorMessage = err.message;
    }

    console.error(`HealthScore Error [${context}]:`, err);
    
    if (mountedRef.current) {
      setError(errorMessage);
      onError?.(errorMessage);
      
      if (shouldRetry && retryCount < API_CONFIG.retries) {
        setTimeout(() => {
          if (mountedRef.current) {
            setRetryCount(prev => prev + 1);
            fetchHealthScore();
          }
        }, API_CONFIG.retryDelay);
      }
    }
  }, [API_CONFIG.retries, API_CONFIG.retryDelay, retryCount, onError]);

  // Main data fetching function
  const fetchHealthScore = useCallback(async (isPolling = false) => {
    if (!mountedRef.current) return;
    
    if (!isPolling) {
      setLoading(true);
    }

    // Cancel previous request if exists
    if (cancelTokenSourceRef.current) {
      cancelTokenSourceRef.current.cancel('New request initiated');
    }

    cancelTokenSourceRef.current = axios.CancelToken.source();

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Authentication token not found');
      }

      const response = await axios.get<HealthScoreData>(API_ENDPOINTS.HEALTH_SCORE, {
        params: { url },
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Request-ID': `healthscore_${Date.now()}`,
        },
        timeout: API_CONFIG.timeout,
        cancelToken: cancelTokenSourceRef.current.token,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      if (mountedRef.current) {
        setData(response.data);
        setError(null);
        setRetryCount(0);
        setLastUpdated(new Date());
        
        // Callback for parent components
        onScoreUpdate?.(response.data.currentScore);
        
        // Update document title with score
        const scoreData = formatSeoScore(response.data.currentScore);
        document.title = `SEO Health: ${response.data.currentScore} - ${scoreData.label}`;
      }
    } catch (err) {
      if (!axios.isCancel(err)) {
        handleError(err, isPolling ? 'polling' : 'initial');
      }
    } finally {
      if (mountedRef.current && !isPolling) {
        setLoading(false);
      }
    }
  }, [url, API_CONFIG.timeout, handleError, onScoreUpdate]);

  // Start polling
  const startPolling = useCallback(() => {
    if (API_CONFIG.pollingInterval > 0 && !pollingIntervalRef.current) {
      pollingIntervalRef.current = setInterval(() => {
        if (mountedRef.current && document.visibilityState === 'visible') {
          fetchHealthScore(true);
        }
      }, API_CONFIG.pollingInterval);
      setIsPolling(true);
    }
  }, [API_CONFIG.pollingInterval, fetchHealthScore]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setIsPolling(false);
    }
  }, []);

  // Effect for initial fetch and refresh
  useEffect(() => {
    mountedRef.current = true;
    
    const fetchData = async () => {
      await fetchHealthScore();
      if (autoRefresh) {
        startPolling();
      }
    };
    
    fetchData();
    
    return () => {
      cleanup();
    };
  }, [refreshTrigger, fetchHealthScore, autoRefresh, startPolling, cleanup]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && autoRefresh) {
        fetchHealthScore(true);
        startPolling();
      } else {
        stopPolling();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [autoRefresh, fetchHealthScore, startPolling, stopPolling]);

  // Handle retry
  const handleRetry = useCallback(() => {
    setError(null);
    setRetryCount(0);
    fetchHealthScore();
  }, [fetchHealthScore]);

  // Handle manual refresh
  const handleRefresh = useCallback(() => {
    setLoading(true);
    fetchHealthScore();
  }, [fetchHealthScore]);

  // Format date helper
  const formatDate = useCallback((dateString: string) => {
    try {
      return new Date(dateString).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Invalid date';
    }
  }, []);

  // Calculate derived metrics
  const derivedMetrics = useMemo(() => {
    if (!data) return null;
    
    const totalIssues = data.topIssues.length;
    const criticalIssues = data.topIssues.filter(issue => issue.type === 'critical').length;
    const autoFixable = data.topIssues.filter(issue => issue.fixable).length;
    
    return {
      totalIssues,
      criticalIssues,
      autoFixable,
      fixablePercentage: totalIssues > 0 ? Math.round((autoFixable / totalIssues) * 100) : 0,
      impactScore: calculateImpact(data.topIssues),
    };
  }, [data]);

  // Loading skeleton
  if (loading && !data) {
    return (
      <div 
        className="bg-white rounded-xl shadow-lg p-6 animate-pulse"
        role="status"
        aria-label="Loading SEO health score"
      >
        <div className="h-7 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="flex items-center justify-center h-64">
          <div className="h-48 w-48 rounded-full bg-gray-200"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div 
              key={i}
              className="h-24 bg-gray-200 rounded-lg"
              aria-hidden="true"
            ></div>
          ))}
        </div>
        <span className="sr-only">Loading health score data...</span>
      </div>
    );
  }

  // Error state
  if (error && !data) {
    return (
      <div 
        className="bg-white rounded-xl shadow-lg p-6"
        role="alert"
        aria-live="assertive"
      >
        <div className="text-center py-8">
          <div 
            className="text-red-500 text-5xl mb-4"
            aria-hidden="true"
          >
            ⚠️
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Failed to Load SEO Health Score
          </h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">{error}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Retry loading health score"
            >
              Retry Now
            </button>
            {retryCount > 0 && (
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Refresh Page
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Main component render
  const scoreData = formatSeoScore(data.currentScore);
  const scoreChange = data.currentScore - data.previousScore;
  const changePercentage = data.trendPercentage;

  return (
    <div 
      className="bg-white rounded-xl shadow-lg p-6"
      role="region"
      aria-label="SEO Health Score Dashboard"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8">
        <div>
          <h2 
            className="text-2xl font-bold text-gray-900"
            id="health-score-title"
          >
            SEO Health Score
          </h2>
          <p className="text-gray-600 mt-1">{scoreData.description}</p>
          {data.websiteUrl && (
            <p className="text-sm text-gray-500 mt-2">
              Website: <span className="font-medium">{data.websiteUrl}</span>
            </p>
          )}
        </div>
        
        <div className="flex items-center space-x-4 mt-4 md:mt-0">
          <div className="flex flex-col items-end">
            <div className="flex items-center space-x-2">
              <span 
                className={`px-3 py-1.5 rounded-full text-sm font-medium ${scoreData.bgColor} ${scoreData.color}`}
                aria-label={`Score rating: ${scoreData.label}`}
              >
                {scoreData.label}
              </span>
              <div 
                className={`flex items-center ${scoreChange >= 0 ? 'text-green-600' : 'text-red-600'}`}
                aria-label={`Score trend: ${scoreChange >= 0 ? 'up' : 'down'} by ${Math.abs(scoreChange)} points`}
              >
                {scoreChange >= 0 ? (
                  <svg 
                    className="w-5 h-5" 
                    fill="currentColor" 
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg 
                    className="w-5 h-5" 
                    fill="currentColor" 
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="ml-1 font-medium">
                  {Math.abs(scoreChange)} pts
                </span>
              </div>
            </div>
            {lastUpdated && (
              <span 
                className="text-xs text-gray-500 mt-2"
                aria-label={`Last updated: ${lastUpdated.toLocaleTimeString()}`}
              >
                Updated: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {isPolling && ' • Auto-refresh on'}
              </span>
            )}
          </div>
          
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Refresh health score"
            title="Refresh data"
          >
            <svg 
              className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Score Visualization */}
      <div className="relative flex items-center justify-center my-10">
        <div className="relative" aria-labelledby="health-score-title">
          {/* Background score ring */}
          <svg 
            className="w-72 h-72 transform -rotate-90" 
            aria-hidden="true"
          >
            <circle
              cx="144"
              cy="144"
              r="136"
              stroke="currentColor"
              strokeWidth="12"
              fill="none"
              className="text-gray-100"
            />
            {/* Score progress */}
            <circle
              cx="144"
              cy="144"
              r="136"
              stroke="currentColor"
              strokeWidth="12"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${(data.currentScore / 100) * 854} 854`}
              className={scoreData.color.replace('text-', 'stroke-')}
              strokeDashoffset="0"
            />
          </svg>
          
          {/* Score display */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span 
              className={`text-6xl font-bold ${scoreData.color}`}
              aria-label={`Current score: ${data.currentScore} out of 100`}
            >
              {data.currentScore}
            </span>
            <span className="text-gray-500 text-lg mt-2">/ 100</span>
            <div className="mt-4 text-sm text-gray-600">
              Previous: {data.previousScore}
            </div>
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="mt-10" role="group" aria-label="Score breakdown by category">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Category Breakdown</h3>
          {derivedMetrics && (
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-600">
                {derivedMetrics.totalIssues} issues
              </span>
              {derivedMetrics.criticalIssues > 0 && (
                <span className="text-red-600 font-medium">
                  {derivedMetrics.criticalIssues} critical
                </span>
              )}
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(data.scoreBreakdown).map(([category, score]) => {
            const categoryScore = formatSeoScore(score);
            return (
              <div
                key={category}
                className="group bg-gray-50 rounded-xl p-5 hover:bg-gray-100 transition-all duration-200 border border-transparent hover:border-gray-200"
                role="article"
                aria-label={`${category} score: ${score}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="font-semibold text-gray-800 capitalize">
                    {category.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span 
                    className={`text-xl font-bold ${categoryScore.color}`}
                    aria-label={`${score} points`}
                  >
                    {score}
                  </span>
                </div>
                
                {/* Progress bar */}
                <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`absolute top-0 left-0 h-full rounded-full ${categoryScore.bgColor} transition-all duration-500`}
                    style={{ width: `${score}%` }}
                    role="progressbar"
                    aria-valuenow={score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  ></div>
                </div>
                
                {/* Status indicator */}
                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm text-gray-600">
                    {categoryScore.label}
                  </span>
                  {score < 70 && (
                    <span className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded-full">
                      Needs attention
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top Issues Section */}
      {data.topIssues.length > 0 && (
        <div className="mt-10 pt-8 border-t border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Priority Issues</h3>
              <p className="text-sm text-gray-600 mt-1">
                {derivedMetrics?.fixablePercentage}% can be auto-fixed
              </p>
            </div>
            {derivedMetrics && (
              <div className="text-sm">
                <span className="text-gray-700">
                  Impact score: <strong>{derivedMetrics.impactScore}/100</strong>
                </span>
              </div>
            )}
          </div>
          
          <div 
            className="space-y-4"
            role="list"
            aria-label="Top SEO issues"
          >
            {data.topIssues.slice(0, 5).map((issue, index) => (
              <div
                key={issue.id}
                className={`group flex items-start space-x-4 p-4 rounded-lg border transition-all hover:shadow-sm ${
                  issue.type === 'critical' ? 'bg-red-50 border-red-200' :
                  issue.type === 'warning' ? 'bg-yellow-50 border-yellow-200' :
                  'bg-blue-50 border-blue-200'
                }`}
                role="listitem"
                aria-label={`${issue.type} issue: ${issue.title}`}
              >
                {/* Issue icon */}
                <div 
                  className={`p-3 rounded-lg ${
                    issue.type === 'critical' ? 'bg-red-100' :
                    issue.type === 'warning' ? 'bg-yellow-100' :
                    'bg-blue-100'
                  }`}
                  aria-hidden="true"
                >
                  <span className="text-xl">
                    {issue.type === 'critical' ? '🚨' :
                     issue.type === 'warning' ? '⚠️' : 'ℹ️'}
                  </span>
                </div>
                
                {/* Issue details */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h4 className="font-semibold text-gray-900 truncate">
                      {issue.title}
                    </h4>
                    <div className="flex items-center space-x-2">
                      <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                        issue.impact === 'high' ? 'bg-red-100 text-red-800' :
                        issue.impact === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {issue.impact} impact
                      </span>
                      {issue.fixable && (
                        <span className="px-3 py-1 text-xs bg-green-100 text-green-800 font-medium rounded-full">
                          Auto-fixable
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <p className="text-gray-600 mt-2 line-clamp-2">
                    {issue.description}
                  </p>
                  
                  {/* Meta information */}
                  <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-500">
                    <span className="capitalize">{issue.category}</span>
                    <span>•</span>
                    <span>Detected: {formatDate(issue.detectedAt.toString())}</span>
                    {issue.fixable && issue.fixDetails && (
                      <>
                        <span>•</span>
                        <span>{issue.fixDetails.estimatedTime} min fix</span>
                      </>
                    )}
                  </div>
                </div>
                
                {/* Action button */}
                <div className="flex-shrink-0">
                  <button
                    onClick={() => {
                      // Navigate to fix page or open fix modal
                      window.dispatchEvent(new CustomEvent('openFixPanel', {
                        detail: { issueId: issue.id }
                      }));
                    }}
                    className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded-lg hover:bg-blue-200 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label={`Fix ${issue.title}`}
                  >
                    {issue.fixable ? 'Fix Now' : 'View Details'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          
          {/* View all issues link */}
          {data.topIssues.length > 5 && (
            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  // Navigate to issues page
                  window.location.href = '/scan?tab=issues';
                }}
                className="text-blue-600 hover:text-blue-800 font-medium text-sm flex items-center justify-center space-x-2"
                aria-label="View all issues"
              >
                <span>View all {data.topIssues.length} issues</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Footer with metadata */}
      <div className="mt-8 pt-6 border-t border-gray-200 text-sm text-gray-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span>Last scan: {formatDate(data.scannedAt)}</span>
            {data.nextScanAt && (
              <span className="ml-4">
                Next scan: {formatDate(data.nextScanAt)}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => {
                // Trigger rescan
                window.dispatchEvent(new Event('triggerRescan'));
              }}
              className="text-blue-600 hover:text-blue-800 font-medium"
            >
              Run New Scan
            </button>
            <button
              onClick={() => {
                // Download report
                window.dispatchEvent(new Event('downloadReport'));
              }}
              className="text-gray-600 hover:text-gray-800 font-medium"
            >
              Download Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// Add display name for debugging
HealthScore.displayName = 'HealthScore';

export default HealthScore;