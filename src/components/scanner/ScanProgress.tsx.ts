// frontend/src/components/scanner/ScanProgress.tsx

import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useErrorBoundary } from 'react-error-boundary';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { captureException } from '@sentry/react';
import { 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  ExternalLink,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  XCircle,
  Play,
  Pause
} from 'lucide-react';
import { useScannerStore } from '../../store/scannerStore';
import { formatDistanceToNow } from 'date-fns';
import WebSocketManager from '../../services/WebSocketManager';
import { ScanProgress as ScanProgressType, ScanStatus, ScanIssue } from '../../types/scanner.types';

interface ScanProgressProps {
  scanId: string;
  className?: string;
  onCompleted?: (results: ScanResult) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
  autoRefresh?: boolean;
}

interface ScanResult {
  id: string;
  url: string;
  score: number;
  issues: ScanIssue[];
  metrics: {
    performance: number;
    accessibility: number;
    seo: number;
    security: number;
  };
  recommendations: string[];
  timestamp: Date;
  scanDuration: number;
  rawData?: Record<string, unknown>;
}

interface ProgressState {
  currentTask: string;
  progress: number;
  estimatedTime: number;
  scannedPages: number;
  totalPages: number;
  currentPage: string;
  speed: number; // pages/minute
  memoryUsage: number; // MB
  cpuUsage: number; // percentage
}

// Constants
const POLLING_INTERVAL = 2000; // 2 seconds
const MAX_RETRIES = 3;
const TIMEOUT = 30000; // 30 seconds
const TASKS = {
  INITIALIZING: 'Initializing scanner...',
  CRAWLING: 'Crawling website structure',
  PERFORMANCE: 'Analyzing page speed and Core Web Vitals',
  SEO: 'Checking meta tags and SEO elements',
  ACCESSIBILITY: 'Validating accessibility (WCAG 2.1)',
  SECURITY: 'Checking security headers and vulnerabilities',
  MOBILE: 'Testing mobile responsiveness',
  CONTENT: 'Analyzing content quality and structure',
  LINKS: 'Checking internal/external links',
  GENERATING: 'Generating comprehensive report',
  FINALIZING: 'Finalizing scan results'
} as const;

// Custom hook for scan progress with retry logic
const useScanProgress = (scanId: string, enabled: boolean) => {
  const queryClient = useQueryClient();
  const { showBoundary } = useErrorBoundary();
  const retryCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController>();

  return useQuery({
    queryKey: ['scan-progress', scanId],
    queryFn: async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const timeoutId = setTimeout(() => {
        abortControllerRef.current?.abort();
      }, TIMEOUT);

      try {
        const response = await fetch(`/api/scans/${scanId}/progress`, {
          signal: abortControllerRef.current.signal,
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            'X-Request-ID': crypto.randomUUID(),
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Scan not found');
          }
          if (response.status === 429) {
            throw new Error('Rate limit exceeded');
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        retryCountRef.current = 0; // Reset retry count on success

        // Analytics
        if (window.gtag) {
          window.gtag('event', 'scan_progress', {
            scan_id: scanId,
            progress: data.progress,
            status: data.status,
          });
        }

        return data;
      } catch (error) {
        clearTimeout(timeoutId);
        
        // Don't retry aborted requests
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }

        // Increment retry count
        retryCountRef.current++;

        // Log error
        captureException(error, {
          tags: { scanId, retryCount: retryCountRef.current },
        });

        // Throw error if max retries reached
        if (retryCountRef.current >= MAX_RETRIES) {
          showBoundary(new Error('Failed to fetch scan progress after multiple attempts'));
        }

        throw error;
      }
    },
    enabled: enabled && !!scanId,
    refetchInterval: POLLING_INTERVAL,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => {
      // Don't retry on 404 or abort errors
      if (error instanceof Error) {
        if (error.message.includes('Scan not found')) return false;
        if (error.name === 'AbortError') return false;
      }
      return failureCount < MAX_RETRIES;
    },
    staleTime: 1000,
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
};

// WebSocket hook for real-time updates
const useScanWebSocket = (scanId: string, onUpdate: (data: any) => void) => {
  useEffect(() => {
    if (!scanId) return;

    const ws = WebSocketManager.getInstance();
    const subscriptionId = ws.subscribe(`scan:${scanId}`, (data) => {
      onUpdate(data);
      
      // Analytics
      if (window.gtag && data.type === 'progress') {
        window.gtag('event', 'scan_ws_update', {
          scan_id: scanId,
          progress: data.progress,
          event_type: data.type,
        });
      }
    });

    return () => {
      ws.unsubscribe(subscriptionId);
    };
  }, [scanId, onUpdate]);
};

// Progress bar component with gradient support
const ProgressBar = memo(({ 
  progress, 
  status,
  showAnimation = true
}: { 
  progress: number;
  status: ScanStatus;
  showAnimation?: boolean;
}) => {
  const getGradient = () => {
    switch (status) {
      case 'scanning':
        return 'from-blue-500 via-blue-400 to-cyan-500';
      case 'completed':
        return 'from-green-500 via-emerald-400 to-green-600';
      case 'failed':
        return 'from-red-500 via-rose-400 to-red-600';
      case 'paused':
        return 'from-yellow-500 via-amber-400 to-yellow-600';
      default:
        return 'from-gray-400 via-gray-300 to-gray-400';
    }
  };

  return (
    <div 
      className="w-full h-3 bg-gray-200 rounded-full overflow-hidden shadow-inner"
      role="progressbar"
      aria-valuenow={progress}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Scan progress: ${progress}% - ${status}`}
    >
      <div 
        className={`
          h-full rounded-full 
          bg-gradient-to-r ${getGradient()}
          transition-all duration-700 ease-out
          ${showAnimation && status === 'scanning' ? 'animate-pulse-subtle' : ''}
        `}
        style={{ 
          width: `${Math.min(100, Math.max(0, progress))}%`,
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  );
});

ProgressBar.displayName = 'ProgressBar';

// Task item component with animation
const TaskItem = memo(({ 
  task, 
  isActive, 
  isCompleted,
  duration,
  hasError
}: { 
  task: string;
  isActive: boolean;
  isCompleted: boolean;
  duration?: number;
  hasError?: boolean;
}) => {
  return (
    <div 
      className={`
        flex items-center justify-between p-4 rounded-xl border
        transition-all duration-300
        ${isActive 
          ? 'bg-blue-50 border-blue-200 shadow-sm scale-[1.02]' 
          : isCompleted
          ? 'bg-green-50 border-green-200'
          : 'bg-gray-50 border-gray-200'
        }
        ${hasError ? 'border-red-200 bg-red-50' : ''}
        hover:shadow-md
      `}
    >
      <div className="flex items-center space-x-4">
        <div className={`
          w-10 h-10 rounded-full flex items-center justify-center
          ${isCompleted 
            ? 'bg-green-100 text-green-600' 
            : isActive 
            ? 'bg-blue-100 text-blue-600 animate-pulse'
            : 'bg-gray-100 text-gray-400'
          }
          ${hasError ? 'bg-red-100 text-red-600' : ''}
          transition-colors duration-300
        `}>
          {hasError ? (
            <XCircle className="w-5 h-5" />
          ) : isCompleted ? (
            <CheckCircle className="w-5 h-5" />
          ) : isActive ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <div className="w-3 h-3 rounded-full" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <span className={`
              font-semibold truncate
              ${isCompleted 
                ? 'text-green-700' 
                : isActive 
                ? 'text-blue-700'
                : 'text-gray-600'
              }
              ${hasError ? 'text-red-700' : ''}
            `}>
              {task}
            </span>
            {isActive && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                In Progress
              </span>
            )}
          </div>
          
          {duration && (
            <p className="text-xs text-gray-500 mt-1">
              Completed in {duration}s
            </p>
          )}
          
          {hasError && (
            <p className="text-xs text-red-600 mt-1">
              Error occurred - will retry
            </p>
          )}
        </div>
      </div>
      
      {isActive && (
        <Loader2 className="w-5 h-5 text-blue-500 animate-spin ml-4" />
      )}
    </div>
  );
});

TaskItem.displayName = 'TaskItem';

// Main component
export const ScanProgress: React.FC<ScanProgressProps> = ({
  scanId,
  className = '',
  onCompleted,
  onError,
  onCancel,
  autoRefresh = true
}) => {
  // Refs
  const progressHistoryRef = useRef<number[]>([]);
  const startTimeRef = useRef<Date>(new Date());
  const cancellationRef = useRef<boolean>(false);

  // State
  const [progressState, setProgressState] = useState<ProgressState>({
    currentTask: TASKS.INITIALIZING,
    progress: 0,
    estimatedTime: 0,
    scannedPages: 0,
    totalPages: 1,
    currentPage: '',
    speed: 0,
    memoryUsage: 0,
    cpuUsage: 0
  });
  
  const [status, setStatus] = useState<ScanStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [taskHistory, setTaskHistory] = useState<Array<{
    task: string;
    startTime: Date;
    endTime?: Date;
    duration?: number;
    success: boolean;
  }>>([]);

  // Hooks
  const { showBoundary } = useErrorBoundary();
  const { data, error: queryError, isLoading } = useScanProgress(
    scanId, 
    autoRefresh && !isPaused && status === 'scanning'
  );
  const scannerStore = useScannerStore();

  // WebSocket for real-time updates
  useScanWebSocket(scanId, (data) => {
    if (data.type === 'progress') {
      setProgressState(prev => ({
        ...prev,
        ...data.payload,
        speed: data.payload.scannedPages / (elapsedTime / 60) || 0
      }));
      
      // Track progress for analytics
      progressHistoryRef.current.push(data.payload.progress);
      if (progressHistoryRef.current.length > 10) {
        progressHistoryRef.current.shift();
      }
    }
    
    if (data.type === 'task_completed') {
      setTaskHistory(prev => [
        ...prev,
        {
          task: data.payload.task,
          startTime: new Date(data.payload.startTime),
          endTime: new Date(),
          duration: data.payload.duration,
          success: true
        }
      ]);
    }
    
    if (data.type === 'error') {
      setError(data.payload.message);
      captureException(new Error(data.payload.message), {
        tags: { scanId, task: data.payload.task },
        extra: data.payload
      });
    }
  });

  // Update progress from query data
  useEffect(() => {
    if (data) {
      setProgressState(prev => ({
        ...prev,
        ...data,
        currentTask: data.currentTask || prev.currentTask
      }));
      
      setStatus(data.status);
      
      if (data.status === 'completed' && data.results) {
        handleScanComplete(data.results);
      }
      
      if (data.status === 'failed') {
        handleScanFailed(data.error);
      }
    }
  }, [data]);

  // Handle query errors
  useEffect(() => {
    if (queryError) {
      const error = queryError as Error;
      setError(error.message);
      onError?.(error);
      
      // Don't show boundary for network errors during scanning
      if (!error.message.includes('aborted') && status !== 'scanning') {
        showBoundary(error);
      }
    }
  }, [queryError, onError, showBoundary, status]);

  // Elapsed time timer
  useEffect(() => {
    if (status !== 'scanning') return;
    
    const intervalId = setInterval(() => {
      setElapsedTime(
        Math.floor((new Date().getTime() - startTimeRef.current.getTime()) / 1000)
      );
    }, 1000);
    
    return () => clearInterval(intervalId);
  }, [status]);

  // Handle scan completion
  const handleScanComplete = useCallback((results: any) => {
    const scanDuration = elapsedTime;
    
    const scanResult: ScanResult = {
      id: scanId,
      url: results.url,
      score: results.score,
      issues: results.issues,
      metrics: results.metrics,
      recommendations: results.recommendations,
      timestamp: new Date(),
      scanDuration,
      rawData: results
    };

    // Save to store
    scannerStore.addScanResult(scanResult);
    
    // Analytics
    if (window.gtag) {
      window.gtag('event', 'scan_completed', {
        scan_id: scanId,
        duration: scanDuration,
        score: results.score,
        pages: results.totalPages,
        category: 'scanner'
      });
    }

    // Toast notification
    toast.success(
      `Scan completed in ${Math.floor(scanDuration / 60)}m ${scanDuration % 60}s! Score: ${results.score}/100`,
      { duration: 5000 }
    );

    // Callback
    onCompleted?.(scanResult);
  }, [scanId, elapsedTime, scannerStore, onCompleted]);

  // Handle scan failure
  const handleScanFailed = useCallback((errorMessage: string) => {
    setError(errorMessage);
    
    captureException(new Error(errorMessage), {
      tags: { scanId, status: 'failed' },
      extra: { progressState, elapsedTime }
    });

    toast.error(`Scan failed: ${errorMessage}`, { duration: 10000 });

    onError?.(new Error(errorMessage));
  }, [scanId, progressState, elapsedTime, onError]);

  // Handle pause/resume
  const handlePauseResume = useCallback(async () => {
    try {
      if (isPaused) {
        // Resume scan
        const response = await fetch(`/api/scans/${scanId}/resume`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        });
        
        if (response.ok) {
          setIsPaused(false);
          toast.success('Scan resumed');
        }
      } else {
        // Pause scan
        const response = await fetch(`/api/scans/${scanId}/pause`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
        });
        
        if (response.ok) {
          setIsPaused(true);
          toast.info('Scan paused');
        }
      }
    } catch (error) {
      toast.error('Failed to update scan state');
      captureException(error);
    }
  }, [scanId, isPaused]);

  // Handle cancel
  const handleCancel = useCallback(async () => {
    if (cancellationRef.current) return;
    
    cancellationRef.current = true;
    
    try {
      const response = await fetch(`/api/scans/${scanId}/cancel`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      
      if (response.ok) {
        setStatus('failed');
        setError('Scan cancelled by user');
        toast.info('Scan cancelled');
        
        // Analytics
        if (window.gtag) {
          window.gtag('event', 'scan_cancelled', {
            scan_id: scanId,
            progress: progressState.progress,
            elapsed_time: elapsedTime
          });
        }
        
        onCancel?.();
      } else {
        throw new Error('Failed to cancel scan');
      }
    } catch (error) {
      toast.error('Failed to cancel scan');
      captureException(error);
      cancellationRef.current = false;
    }
  }, [scanId, progressState.progress, elapsedTime, onCancel]);

  // Handle retry
  const handleRetry = useCallback(async () => {
    try {
      setError(null);
      setStatus('pending');
      setProgressState(prev => ({ ...prev, progress: 0 }));
      startTimeRef.current = new Date();
      
      const response = await fetch(`/api/scans/${scanId}/retry`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      
      if (response.ok) {
        toast.success('Retrying scan...');
      } else {
        throw new Error('Failed to retry scan');
      }
    } catch (error) {
      toast.error('Failed to retry scan');
      captureException(error);
    }
  }, [scanId]);

  // Format time
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Get current task index
  const currentTaskIndex = Object.values(TASKS).findIndex(
    task => task === progressState.currentTask
  );

  // Loading state
  if (isLoading && !data) {
    return (
      <div className={`bg-white rounded-xl shadow-lg border border-gray-200 p-6 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-2/3"></div>
          <div className="h-4 bg-gray-200 rounded"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden ${className}`}
      data-testid="scan-progress"
      data-scan-id={scanId}
      data-status={status}
    >
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-800 truncate">
              SEO Scan Progress
            </h2>
            <div className="flex items-center space-x-2 mt-1">
              <code className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                {scanId.slice(0, 12)}...
              </code>
              <span className="text-xs text-gray-500">
                Started {formatDistanceToNow(startTimeRef.current)} ago
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Status badge */}
            <div className={`
              inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium
              ${status === 'completed' 
                ? 'bg-green-100 text-green-800' 
                : status === 'scanning'
                ? 'bg-blue-100 text-blue-800'
                : status === 'failed'
                ? 'bg-red-100 text-red-800'
                : 'bg-gray-100 text-gray-800'
              }
            `}>
              {status === 'scanning' && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              {status === 'completed' && <CheckCircle className="w-3 h-3 mr-1.5" />}
              {status === 'failed' && <AlertCircle className="w-3 h-3 mr-1.5" />}
              <span className="capitalize">{status}</span>
            </div>
            
            {/* Expand/collapse button */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
              aria-label={showDetails ? "Hide details" : "Show details"}
            >
              {showDetails ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
        
        {/* Progress and stats */}
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-gray-700">
                {progressState.currentTask}
              </span>
              <span className="text-lg font-bold text-gray-900">
                {Math.round(progressState.progress)}%
              </span>
            </div>
            <ProgressBar 
              progress={progressState.progress} 
              status={status}
              showAnimation={status === 'scanning'}
            />
          </div>
          
          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Time Elapsed</p>
              <p className="text-lg font-semibold text-gray-800">
                {formatTime(elapsedTime)}
              </p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Pages Scanned</p>
              <p className="text-lg font-semibold text-gray-800">
                {progressState.scannedPages} / {progressState.totalPages}
              </p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Scan Speed</p>
              <p className="text-lg font-semibold text-gray-800">
                {progressState.speed.toFixed(1)}/min
              </p>
            </div>
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500 mb-1">Estimated Time</p>
              <p className="text-lg font-semibold text-gray-800">
                {progressState.estimatedTime > 0 
                  ? formatTime(progressState.estimatedTime)
                  : 'Calculating...'
                }
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Details section */}
      {showDetails && (
        <>
          {/* Tasks */}
          <div className="p-6 border-b border-gray-200">
            <h3 className="font-semibold text-gray-700 mb-4">Scan Tasks</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
              {Object.values(TASKS).map((task, index) => (
                <TaskItem
                  key={task}
                  task={task}
                  isActive={index === currentTaskIndex && status === 'scanning'}
                  isCompleted={index < currentTaskIndex}
                  duration={taskHistory.find(t => t.task === task)?.duration}
                  hasError={error?.includes(task)}
                />
              ))}
            </div>
          </div>
          
          {/* Current page info */}
          {progressState.currentPage && (
            <div className="p-6 border-b border-gray-200 bg-blue-50">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Currently Scanning</h4>
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-800 truncate" title={progressState.currentPage}>
                  {progressState.currentPage}
                </p>
                <a
                  href={progressState.currentPage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center"
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Open
                </a>
              </div>
            </div>
          )}
        </>
      )}
      
      {/* Error display */}
      {error && (
        <div className="p-4 bg-red-50 border-b border-red-200">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Scan Error</p>
              <p className="text-sm text-red-600 mt-1">{error}</p>
              {status === 'failed' && (
                <button
                  onClick={handleRetry}
                  className="mt-2 inline-flex items-center text-sm font-medium text-red-700 hover:text-red-800"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Retry Scan
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Footer actions */}
      <div className="p-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {status === 'scanning' && (
              <div className="flex items-center">
                <Loader2 className="w-3 h-3 animate-spin mr-2" />
                {isPaused ? 'Scan paused' : 'Scanning in progress...'}
              </div>
            )}
            {status === 'completed' && (
              <div className="flex items-center text-green-600">
                <CheckCircle className="w-3 h-3 mr-2" />
                Scan completed successfully
              </div>
            )}
            {status === 'failed' && !error && (
              <div className="flex items-center text-red-600">
                <AlertCircle className="w-3 h-3 mr-2" />
                Scan failed
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-2">
            {status === 'scanning' && (
              <>
                <button
                  onClick={handlePauseResume}
                  className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center"
                  disabled={cancellationRef.current}
                >
                  {isPaused ? (
                    <>
                      <Play className="w-3 h-3 mr-1.5" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="w-3 h-3 mr-1.5" />
                      Pause
                    </>
                  )}
                </button>
                
                <button
                  onClick={handleCancel}
                  disabled={cancellationRef.current}
                  className="px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50 transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <XCircle className="w-3 h-3 mr-1.5" />
                  Cancel
                </button>
              </>
            )}
            
            {status === 'completed' && (
              <a
                href={`/scan/${scanId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors flex items-center"
              >
                <ExternalLink className="w-3 h-3 mr-1.5" />
                View Report
              </a>
            )}
            
            {status === 'failed' && !error && (
              <button
                onClick={handleRetry}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center"
              >
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Performance optimizations
export default memo(ScanProgress);