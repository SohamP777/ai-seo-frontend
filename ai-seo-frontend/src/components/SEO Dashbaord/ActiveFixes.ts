// frontend/src/components/seo-dashboard/ActiveFixes.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAutoFix } from '../../../hooks/useAutoFix';
import { calculateImpact, getImpactLevel, getImpactColor } from '../../../utils/calculateImpact';
import { FixStatus, ActiveFix, FixPriority, FixMetrics } from '../../../types/seo.types';
import { 
  CheckCircleIcon, 
  ClockIcon, 
  ExclamationTriangleIcon, 
  ArrowPathIcon,
  XMarkIcon,
  PlayIcon,
  PauseIcon,
  ArrowTopRightOnSquareIcon,
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DocumentTextIcon,
  ServerIcon,
  CpuChipIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { formatDistanceToNow } from 'date-fns';

interface ActiveFixesProps {
  maxItems?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
  onFixSelect?: (fixId: string) => void;
  showMetrics?: boolean;
  workspaceId?: string;
}

interface FixStats {
  totalProcessed: number;
  successful: number;
  failed: number;
  averageTime: number;
}

// Define missing enum values if they don't exist in the imported types
enum FixStatusEnum {
  RUNNING = 'running',
  PENDING = 'pending',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

enum FixPriorityEnum {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

const ActiveFixes: React.FC<ActiveFixesProps> = React.memo(({ 
  maxItems = 5, 
  autoRefresh = true,
  refreshInterval = 10000,
  onFixSelect,
  showMetrics = true,
  workspaceId
}) => {
  // Refs for cleanup
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // State
  const [expandedFix, setExpandedFix] = useState<string | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<'today' | 'week' | 'month'>('today');
  const [stats, setStats] = useState<FixStats>({
    totalProcessed: 0,
    successful: 0,
    failed: 0,
    averageTime: 0
  });
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Custom hook with real API integration
  const { 
    activeFixes = [], 
    loading, 
    error, 
    metrics = {
      completedToday: 0,
      successRate: 0,
      averageTime: 0
    },
    pauseFix, 
    resumeFix, 
    cancelFix,
    retryFix,
    refreshActiveFixes,
    getFixDetails
  } = useAutoFix(workspaceId);

  // Memoized calculations
  const sortedFixes = useMemo(() => {
    if (!activeFixes || activeFixes.length === 0) return [];
    
    return [...activeFixes]
      .sort((a, b) => {
        // Priority order
        const priorityOrder: Record<string, number> = {
          [FixPriorityEnum.CRITICAL]: 0,
          [FixPriorityEnum.HIGH]: 1,
          [FixPriorityEnum.MEDIUM]: 2,
          [FixPriorityEnum.LOW]: 3,
          critical: 0,
          high: 1,
          medium: 2,
          low: 3
        };
        
        // Status order (running first, then paused, etc.)
        const statusOrder: Record<string, number> = {
          [FixStatusEnum.RUNNING]: 0,
          [FixStatusEnum.PENDING]: 1,
          [FixStatusEnum.PAUSED]: 2,
          [FixStatusEnum.COMPLETED]: 3,
          [FixStatusEnum.FAILED]: 4,
          [FixStatusEnum.CANCELLED]: 5,
          running: 0,
          pending: 1,
          paused: 2,
          completed: 3,
          failed: 4,
          cancelled: 5
        };
        
        // Sort by priority first, then status, then start time
        const aPriority = priorityOrder[a.priority] ?? 2;
        const bPriority = priorityOrder[b.priority] ?? 2;
        
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        const aStatus = statusOrder[a.status] ?? 2;
        const bStatus = statusOrder[b.status] ?? 2;
        
        if (aStatus !== bStatus) {
          return aStatus - bStatus;
        }
        
        const aTime = new Date(a.startedAt || new Date()).getTime();
        const bTime = new Date(b.startedAt || new Date()).getTime();
        return bTime - aTime;
      })
      .slice(0, maxItems);
  }, [activeFixes, maxItems]);

  // Calculate stats
  useEffect(() => {
    if (activeFixes && activeFixes.length > 0) {
      const totalProcessed = activeFixes.reduce((sum, fix) => sum + (fix.processedItems || 0), 0);
      const successful = activeFixes.filter(f => f.status === FixStatusEnum.COMPLETED || f.status === 'completed').length;
      const failed = activeFixes.filter(f => f.status === FixStatusEnum.FAILED || f.status === 'failed').length;
      const totalTime = activeFixes.reduce((sum, fix) => {
        if (fix.completedAt && fix.startedAt) {
          const duration = new Date(fix.completedAt).getTime() - new Date(fix.startedAt).getTime();
          return sum + duration;
        }
        return sum;
      }, 0);
      const completedFixes = activeFixes.filter(f => f.completedAt).length;
      
      setStats({
        totalProcessed,
        successful,
        failed,
        averageTime: completedFixes > 0 ? totalTime / completedFixes : 0
      });
    }
  }, [activeFixes]);

  // Polling setup with cleanup
  useEffect(() => {
    if (autoRefresh && !loading) {
      // Cancel previous polling
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      
      // Create new AbortController for this polling session
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      // Setup polling
      pollingRef.current = setInterval(async () => {
        try {
          await refreshActiveFixes(abortControllerRef.current?.signal);
          setLastUpdated(new Date());
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            // Polling was cancelled, ignore
            return;
          }
          console.error('Polling error:', err);
        }
      }, refreshInterval);
      
      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }
  }, [autoRefresh, loading, refreshInterval, refreshActiveFixes]);

  // Event handlers with proper error handling
  const handlePauseFix = useCallback(async (fixId: string, fixTitle: string) => {
    try {
      await pauseFix(fixId);
      toast.success(`Paused fix: ${fixTitle}`, {
        position: "bottom-right",
        autoClose: 3000,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to pause fix: ${errorMessage}`, {
        position: "bottom-right",
        autoClose: 5000,
      });
    }
  }, [pauseFix]);

  const handleResumeFix = useCallback(async (fixId: string, fixTitle: string) => {
    try {
      await resumeFix(fixId);
      toast.success(`Resumed fix: ${fixTitle}`, {
        position: "bottom-right",
        autoClose: 3000,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to resume fix: ${errorMessage}`, {
        position: "bottom-right",
        autoClose: 5000,
      });
    }
  }, [resumeFix]);

  const handleCancelFix = useCallback(async (fixId: string, fixTitle: string) => {
    if (!window.confirm(`Are you sure you want to cancel "${fixTitle}"? This cannot be undone.`)) {
      return;
    }
    
    try {
      await cancelFix(fixId);
      toast.success(`Cancelled fix: ${fixTitle}`, {
        position: "bottom-right",
        autoClose: 3000,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to cancel fix: ${errorMessage}`, {
        position: "bottom-right",
        autoClose: 5000,
      });
    }
  }, [cancelFix]);

  const handleRetryFix = useCallback(async (fixId: string, fixTitle: string) => {
    try {
      await retryFix(fixId);
      toast.success(`Retrying fix: ${fixTitle}`, {
        position: "bottom-right",
        autoClose: 3000,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to retry fix: ${errorMessage}`, {
        position: "bottom-right",
        autoClose: 5000,
      });
    }
  }, [retryFix]);

  const handleManualRefresh = useCallback(async () => {
    try {
      setManualRefreshCount(prev => prev + 1);
      await refreshActiveFixes();
      setLastUpdated(new Date());
      toast.info('Fixes refreshed', {
        position: "bottom-right",
        autoClose: 2000,
      });
    } catch (err) {
      toast.error('Failed to refresh fixes', {
        position: "bottom-right",
        autoClose: 5000,
      });
    }
  }, [refreshActiveFixes]);

  const handleFixClick = useCallback(async (fixId: string) => {
    if (expandedFix === fixId) {
      setExpandedFix(null);
    } else {
      setExpandedFix(fixId);
      if (onFixSelect) {
        onFixSelect(fixId);
      }
      
      // Preload details for better UX
      try {
        await getFixDetails(fixId);
      } catch (err) {
        console.warn('Could not preload fix details:', err);
      }
    }
  }, [expandedFix, onFixSelect, getFixDetails]);

  // Utility functions
  const getStatusConfig = (status: string) => {
    const configs: Record<string, {
      color: string;
      icon: React.ComponentType<{ className?: string }>;
      iconColor: string;
      bgColor: string;
    }> = {
      [FixStatusEnum.RUNNING]: {
        color: 'bg-blue-100 text-blue-800 border-blue-200',
        icon: ArrowPathIcon,
        iconColor: 'text-blue-600',
        bgColor: 'bg-blue-50'
      },
      [FixStatusEnum.PAUSED]: {
        color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        icon: PauseIcon,
        iconColor: 'text-yellow-600',
        bgColor: 'bg-yellow-50'
      },
      [FixStatusEnum.COMPLETED]: {
        color: 'bg-green-100 text-green-800 border-green-200',
        icon: CheckCircleIcon,
        iconColor: 'text-green-600',
        bgColor: 'bg-green-50'
      },
      [FixStatusEnum.FAILED]: {
        color: 'bg-red-100 text-red-800 border-red-200',
        icon: ExclamationCircleIcon,
        iconColor: 'text-red-600',
        bgColor: 'bg-red-50'
      },
      [FixStatusEnum.PENDING]: {
        color: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: ClockIcon,
        iconColor: 'text-gray-600',
        bgColor: 'bg-gray-50'
      },
      [FixStatusEnum.CANCELLED]: {
        color: 'bg-gray-100 text-gray-800 border-gray-200',
        icon: XMarkIcon,
        iconColor: 'text-gray-600',
        bgColor: 'bg-gray-50'
      }
    };
    
    return configs[status] || configs[FixStatusEnum.PENDING];
  };

  const getPriorityConfig = (priority: string) => {
    const configs: Record<string, {
      color: string;
      text: string;
      textColor: string;
    }> = {
      [FixPriorityEnum.CRITICAL]: {
        color: 'bg-red-500',
        text: 'Critical',
        textColor: 'text-red-700'
      },
      [FixPriorityEnum.HIGH]: {
        color: 'bg-orange-500',
        text: 'High',
        textColor: 'text-orange-700'
      },
      [FixPriorityEnum.MEDIUM]: {
        color: 'bg-yellow-500',
        text: 'Medium',
        textColor: 'text-yellow-700'
      },
      [FixPriorityEnum.LOW]: {
        color: 'bg-blue-500',
        text: 'Low',
        textColor: 'text-blue-700'
      }
    };
    return configs[priority] || configs[FixPriorityEnum.MEDIUM];
  };

  const formatDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();
    
    if (diffMs < 60000) {
      return `${Math.floor(diffMs / 1000)}s`;
    } else if (diffMs < 3600000) {
      return `${Math.floor(diffMs / 60000)}m`;
    } else if (diffMs < 86400000) {
      const hours = Math.floor(diffMs / 3600000);
      const minutes = Math.floor((diffMs % 3600000) / 60000);
      return `${hours}h ${minutes}m`;
    } else {
      const days = Math.floor(diffMs / 86400000);
      const hours = Math.floor((diffMs % 86400000) / 3600000);
      return `${days}d ${hours}h`;
    }
  };

  const calculateProgressPercentage = (processed: number = 0, total: number = 0) => {
    if (total === 0) return 0;
    const percentage = (processed / total) * 100;
    return Math.min(Math.round(percentage * 10) / 10, 100); // One decimal place
  };

  const handleBulkAction = useCallback(async (action: 'pauseAll' | 'resumeAll' | 'cancelAll') => {
    if (sortedFixes.length === 0) return;
    
    const actionText = {
      pauseAll: 'pause all',
      resumeAll: 'resume all',
      cancelAll: 'cancel all'
    }[action];
    
    if (!window.confirm(`Are you sure you want to ${actionText} active fixes?`)) {
      return;
    }
    
    try {
      const promises = sortedFixes
        .filter(fix => {
          if (action === 'pauseAll') return fix.status === FixStatusEnum.RUNNING || fix.status === 'running';
          if (action === 'resumeAll') return fix.status === FixStatusEnum.PAUSED || fix.status === 'paused';
          if (action === 'cancelAll') return [
            FixStatusEnum.RUNNING, 
            FixStatusEnum.PAUSED, 
            FixStatusEnum.PENDING,
            'running',
            'paused',
            'pending'
          ].includes(fix.status);
          return false;
        })
        .map(fix => {
          if (action === 'pauseAll') return pauseFix(fix.id);
          if (action === 'resumeAll') return resumeFix(fix.id);
          if (action === 'cancelAll') return cancelFix(fix.id);
          return Promise.resolve();
        });
      
      await Promise.all(promises);
      toast.success(`${actionText.charAt(0).toUpperCase() + actionText.slice(1)} completed`, {
        position: "bottom-right",
        autoClose: 3000,
      });
    } catch (err) {
      toast.error(`Failed to ${actionText}`, {
        position: "bottom-right",
        autoClose: 5000,
      });
    }
  }, [sortedFixes, pauseFix, resumeFix, cancelFix]);

  // Helper function to format bytes
  const formatBytes = (bytes: number, decimals = 2): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  // Render loading state
  if (loading && sortedFixes.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gray-200 rounded-lg animate-pulse" />
              <div>
                <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
                <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mt-2" />
              </div>
            </div>
            <div className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="p-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="mb-4 last:mb-0">
              <div className="flex items-center justify-between mb-2">
                <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
                <div className="h-5 w-20 bg-gray-200 rounded animate-pulse" />
              </div>
              <div className="h-2 bg-gray-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Render error state
  if (error && sortedFixes.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg border border-red-200 overflow-hidden">
        <div className="p-6 border-b border-red-200 bg-red-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <ExclamationCircleIcon className="w-8 h-8 text-red-600" />
              <div>
                <h3 className="text-lg font-semibold text-red-900">Connection Error</h3>
                <p className="text-sm text-red-700 mt-1">Unable to load active fixes</p>
              </div>
            </div>
            <button
              onClick={handleManualRefresh}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center space-x-2"
            >
              <ArrowPathIcon className="w-4 h-4" />
              <span>Retry</span>
            </button>
          </div>
        </div>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
            <p className="text-sm text-red-600 mt-2">
              Please check your internet connection and try again. If the problem persists, contact support.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer />
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <CpuChipIcon className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Active SEO Fixes</h2>
                <div className="flex items-center space-x-4 mt-1">
                  <p className="text-sm text-gray-600">
                    Real-time monitoring and control
                  </p>
                  {lastUpdated && (
                    <span className="text-xs text-gray-500">
                      Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  autoRefresh ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  <span className={`w-2 h-2 rounded-full mr-1.5 ${autoRefresh ? 'bg-green-500' : 'bg-gray-500'}`} />
                  Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
                </span>
                <button
                  onClick={handleManualRefresh}
                  disabled={loading}
                  className={`p-2 rounded-lg transition-all ${
                    loading 
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
                  }`}
                  aria-label={loading ? 'Refreshing...' : 'Refresh fixes'}
                >
                  <ArrowPathIcon className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              
              {sortedFixes.length > 0 && (
                <div className="hidden sm:flex items-center space-x-2">
                  <button
                    onClick={() => handleBulkAction('pauseAll')}
                    disabled={!sortedFixes.some(f => f.status === FixStatusEnum.RUNNING || f.status === 'running')}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      sortedFixes.some(f => f.status === FixStatusEnum.RUNNING || f.status === 'running')
                        ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                        : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    Pause All
                  </button>
                  <button
                    onClick={() => handleBulkAction('resumeAll')}
                    disabled={!sortedFixes.some(f => f.status === FixStatusEnum.PAUSED || f.status === 'paused')}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      sortedFixes.some(f => f.status === FixStatusEnum.PAUSED || f.status === 'paused')
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'bg-gray-50 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    Resume All
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Stats Bar */}
          {showMetrics && (
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-700">Active</p>
                    <p className="text-2xl font-bold text-blue-900 mt-1">
                      {sortedFixes.filter(f => 
                        [FixStatusEnum.RUNNING, FixStatusEnum.PENDING, 'running', 'pending'].includes(f.status)
                      ).length}
                    </p>
                  </div>
                  <ServerIcon className="w-8 h-8 text-blue-600 opacity-50" />
                </div>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-700">Completed Today</p>
                    <p className="text-2xl font-bold text-green-900 mt-1">
                      {metrics.completedToday}
                    </p>
                  </div>
                  <CheckCircleIcon className="w-8 h-8 text-green-600 opacity-50" />
                </div>
              </div>
              
              <div className="bg-purple-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-purple-700">Success Rate</p>
                    <p className="text-2xl font-bold text-purple-900 mt-1">
                      {metrics.successRate}%
                    </p>
                  </div>
                  <ArrowPathIcon className="w-8 h-8 text-purple-600 opacity-50" />
                </div>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Avg. Time</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {metrics.averageTime}
                    </p>
                  </div>
                  <ClockIcon className="w-8 h-8 text-gray-600 opacity-50" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fixes List */}
        <div className="divide-y divide-gray-100">
          {sortedFixes.length > 0 ? (
            sortedFixes.map((fix) => {
              const statusConfig = getStatusConfig(fix.status);
              const priorityConfig = getPriorityConfig(fix.priority);
              const progressPercentage = calculateProgressPercentage(fix.processedItems, fix.totalItems);
              
              // Safely calculate impact score with fallback values
              const impactScore = calculateImpact(
                fix.severity || 'medium', 
                fix.affectedPages || 0, 
                {
                  timeSinceDetection: fix.timeSinceDetection || 0,
                  competitorImpact: fix.competitorImpact || 0,
                  userExperienceImpact: fix.userExperienceImpact || 0
                }
              );
              
              const isExpanded = expandedFix === fix.id;
              const StatusIcon = statusConfig.icon;

              return (
                <div 
                  key={fix.id}
                  className={`transition-all duration-200 hover:bg-gray-50 ${
                    isExpanded ? 'bg-gray-50' : ''
                  }`}
                >
                  <div 
                    className="p-6 cursor-pointer"
                    onClick={() => handleFixClick(fix.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleFixClick(fix.id);
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      {/* Left Column - Fix Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start space-x-3">
                            <div className={`p-2 rounded-lg ${statusConfig.bgColor}`}>
                              <StatusIcon className={`w-5 h-5 ${statusConfig.iconColor}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center flex-wrap gap-2 mb-2">
                                <h3 className="text-base font-semibold text-gray-900 truncate">
                                  {fix.title}
                                </h3>
                                <span 
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusConfig.color}`}
                                >
                                  <StatusIcon className="w-3 h-3 mr-1.5" />
                                  {fix.status}
                                </span>
                                <span 
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityConfig.textColor} bg-opacity-10 ${priorityConfig.color.replace('500', '100')}`}
                                  title={`Priority: ${priorityConfig.text}`}
                                >
                                  <span className={`w-2 h-2 rounded-full mr-1.5 ${priorityConfig.color}`} />
                                  {priorityConfig.text}
                                </span>
                              </div>
                              
                              <p className="text-sm text-gray-600 mb-4">
                                {fix.description || 'No description available'}
                              </p>
                              
                              {/* Progress Bar */}
                              <div className="mb-4">
                                <div className="flex justify-between text-sm text-gray-700 mb-2">
                                  <span className="font-medium">Progress</span>
                                  <span className="font-semibold">{progressPercentage}%</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                  <div 
                                    className={`h-2.5 rounded-full transition-all duration-300 ${
                                      progressPercentage === 100 
                                        ? 'bg-green-600' 
                                        : 'bg-blue-600'
                                    }`}
                                    style={{ width: `${progressPercentage}%` }}
                                    role="progressbar"
                                    aria-valuenow={progressPercentage}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                  />
                                </div>
                                <div className="flex justify-between text-xs text-gray-500 mt-2">
                                  <span>{(fix.processedItems || 0).toLocaleString()} of {(fix.totalItems || 0).toLocaleString()} items</span>
                                  <span>{formatDuration(fix.startedAt || new Date().toISOString(), fix.completedAt)} elapsed</span>
                                </div>
                              </div>
                              
                              {/* Quick Stats */}
                              <div className="flex flex-wrap items-center gap-4 text-sm">
                                <div className="flex items-center text-gray-600">
                                  <ArrowTopRightOnSquareIcon className="w-4 h-4 mr-1.5" />
                                  <span>{(fix.affectedPages || 0).toLocaleString()} pages</span>
                                </div>
                                <div className="flex items-center text-gray-600">
                                  <DocumentTextIcon className="w-4 h-4 mr-1.5" />
                                  <span>{(fix.filesModified || 0).toLocaleString()} files</span>
                                </div>
                                <div className={`flex items-center px-3 py-1 rounded-full ${getImpactColor(impactScore)}`}>
                                  <InformationCircleIcon className="w-4 h-4 mr-1.5" />
                                  <span className="font-medium">{getImpactLevel(impactScore)}</span>
                                  <span className="ml-2 font-bold">({impactScore})</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          {/* Action Buttons */}
                          <div 
                            className="flex items-center space-x-2 ml-4"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {(fix.status === FixStatusEnum.RUNNING || fix.status === 'running') && (
                              <button
                                onClick={() => handlePauseFix(fix.id, fix.title)}
                                className="p-2 text-gray-500 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                                aria-label={`Pause ${fix.title}`}
                                title="Pause this fix"
                              >
                                <PauseIcon className="w-5 h-5" />
                              </button>
                            )}
                            
                            {(fix.status === FixStatusEnum.PAUSED || fix.status === 'paused') && (
                              <>
                                <button
                                  onClick={() => handleResumeFix(fix.id, fix.title)}
                                  className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                  aria-label={`Resume ${fix.title}`}
                                  title="Resume this fix"
                                >
                                  <PlayIcon className="w-5 h-5" />
                                </button>
                              </>
                            )}
                            
                            {(fix.status === FixStatusEnum.FAILED || fix.status === 'failed') && (
                              <button
                                onClick={() => handleRetryFix(fix.id, fix.title)}
                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                aria-label={`Retry ${fix.title}`}
                                title="Retry this fix"
                              >
                                <ArrowPathIcon className="w-5 h-5" />
                              </button>
                            )}
                            
                            {[
                              FixStatusEnum.RUNNING, 
                              FixStatusEnum.PAUSED, 
                              FixStatusEnum.PENDING,
                              'running',
                              'paused',
                              'pending'
                            ].includes(fix.status) && (
                              <button
                                onClick={() => handleCancelFix(fix.id, fix.title)}
                                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                aria-label={`Cancel ${fix.title}`}
                                title="Cancel this fix"
                              >
                                <XMarkIcon className="w-5 h-5" />
                              </button>
                            )}
                            
                            <button
                              onClick={() => handleFixClick(fix.id)}
                              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${fix.title}`}
                            >
                              {isExpanded ? (
                                <ChevronUpIcon className="w-5 h-5" />
                              ) : (
                                <ChevronDownIcon className="w-5 h-5" />
                              )}
                            </button>
                          </div>
                        </div>
                        
                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="mt-6 pt-6 border-t border-gray-200">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              {/* Fix Details */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                                  <InformationCircleIcon className="w-4 h-4 mr-2" />
                                  Fix Details
                                </h4>
                                <dl className="space-y-3">
                                  <div className="flex justify-between">
                                    <dt className="text-sm text-gray-500">Type</dt>
                                    <dd className="text-sm font-medium text-gray-900">{fix.type || 'Not specified'}</dd>
                                  </div>
                                  <div className="flex justify-between">
                                    <dt className="text-sm text-gray-500">Started</dt>
                                    <dd className="text-sm text-gray-900">
                                      {new Date(fix.startedAt || new Date()).toLocaleString()}
                                    </dd>
                                  </div>
                                  {fix.completedAt && (
                                    <div className="flex justify-between">
                                      <dt className="text-sm text-gray-500">Completed</dt>
                                      <dd className="text-sm text-gray-900">
                                        {new Date(fix.completedAt).toLocaleString()}
                                      </dd>
                                    </div>
                                  )}
                                  <div className="flex justify-between">
                                    <dt className="text-sm text-gray-500">Severity</dt>
                                    <dd className={`text-sm font-medium capitalize ${
                                      fix.severity === 'critical' ? 'text-red-600' :
                                      fix.severity === 'high' ? 'text-orange-600' :
                                      fix.severity === 'medium' ? 'text-yellow-600' :
                                      'text-blue-600'
                                    }`}>
                                      {fix.severity || 'medium'}
                                    </dd>
                                  </div>
                                  {fix.estimatedTime && (
                                    <div className="flex justify-between">
                                      <dt className="text-sm text-gray-500">Estimated Time</dt>
                                      <dd className="text-sm text-gray-900">{fix.estimatedTime}</dd>
                                    </div>
                                  )}
                                </dl>
                              </div>
                              
                              {/* Impact Analysis */}
                              <div>
                                <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                                  <ExclamationTriangleIcon className="w-4 h-4 mr-2" />
                                  Impact Analysis
                                </h4>
                                <dl className="space-y-3">
                                  <div className="flex justify-between">
                                    <dt className="text-sm text-gray-500">SEO Impact Score</dt>
                                    <dd className="text-sm font-semibold text-green-600">
                                      +{impactScore} points
                                    </dd>
                                  </div>
                                  <div className="flex justify-between">
                                    <dt className="text-sm text-gray-500">Files Modified</dt>
                                    <dd className="text-sm text-gray-900">{(fix.filesModified || 0).toLocaleString()}</dd>
                                  </div>
                                  {fix.sizeChange && (
                                    <div className="flex justify-between">
                                      <dt className="text-sm text-gray-500">Size Change</dt>
                                      <dd className={`text-sm font-medium ${
                                        fix.sizeChange > 0 ? 'text-red-600' : 'text-green-600'
                                      }`}>
                                        {fix.sizeChange > 0 ? '+' : ''}{formatBytes(Math.abs(fix.sizeChange))}
                                      </dd>
                                    </div>
                                  )}
                                  {fix.errorCount && fix.errorCount > 0 && (
                                    <div className="flex justify-between">
                                      <dt className="text-sm text-gray-500">Errors Encountered</dt>
                                      <dd className="text-sm font-medium text-red-600">
                                        {(fix.errorCount || 0).toLocaleString()}
                                      </dd>
                                    </div>
                                  )}
                                </dl>
                              </div>
                            </div>
                            
                            {/* Notes/Logs */}
                            {fix.notes && fix.notes.length > 0 && (
                              <div className="mt-6">
                                <h4 className="text-sm font-semibold text-gray-900 mb-3">Recent Activity</h4>
                                <div className="bg-gray-50 rounded-lg p-4 max-h-40 overflow-y-auto">
                                  <ul className="space-y-2 text-sm">
                                    {fix.notes.map((note: string, index: number) => (
                                      <li key={index} className="text-gray-600 flex">
                                        <span className="text-gray-400 mr-2">•</span>
                                        <span>{note}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-12 text-center">
              <div className="mx-auto w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                <CheckCircleIcon className="w-10 h-10 text-gray-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">No Active Fixes</h3>
              <p className="text-gray-600 max-w-md mx-auto mb-6">
                All SEO fixes are up to date. Run a new scan to identify issues that need fixing, or check the fix history for completed tasks.
              </p>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={handleManualRefresh}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Check for Updates
                </button>
                <button
                  onClick={() => window.location.href = '/scan'}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Run New Scan
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {sortedFixes.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="text-sm text-gray-600">
                Showing <span className="font-semibold">{sortedFixes.length}</span> of{' '}
                <span className="font-semibold">{activeFixes.length}</span> active fixes
              </div>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => handleBulkAction('cancelAll')}
                  disabled={!sortedFixes.some(f => 
                    [
                      FixStatusEnum.RUNNING, 
                      FixStatusEnum.PAUSED, 
                      FixStatusEnum.PENDING,
                      'running',
                      'paused',
                      'pending'
                    ].includes(f.status)
                  )}
                  className={`text-sm ${
                    sortedFixes.some(f => 
                      [
                        FixStatusEnum.RUNNING, 
                        FixStatusEnum.PAUSED, 
                        FixStatusEnum.PENDING,
                        'running',
                        'paused',
                        'pending'
                      ].includes(f.status)
                    )
                      ? 'text-red-600 hover:text-red-800'
                      : 'text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Cancel All Active
                </button>
                {onFixSelect && (
                  <button
                    onClick={() => onFixSelect('all')}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    View All Details →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
});

// Display name for debugging
ActiveFixes.displayName = 'ActiveFixes';

// Performance optimization: Only re-render when props change
const areEqual = (prevProps: ActiveFixesProps, nextProps: ActiveFixesProps) => {
  return (
    prevProps.maxItems === nextProps.maxItems &&
    prevProps.autoRefresh === nextProps.autoRefresh &&
    prevProps.refreshInterval === nextProps.refreshInterval &&
    prevProps.showMetrics === nextProps.showMetrics &&
    prevProps.workspaceId === nextProps.workspaceId
  );
};

export default React.memo(ActiveFixes, areEqual);
