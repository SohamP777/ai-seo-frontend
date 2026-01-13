// frontend/src/hooks/useAutoFix.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import axios, { AxiosError, CancelTokenSource } from 'axios';
import { fixerService, FixRequest, FixResponse, FixStatus, FixOperation } from '../services/fixer';

// TypeScript interfaces for auto-fix state
export interface AutoFixState {
  isFixing: boolean;
  fixProgress: number;
  currentStatus: FixStatus;
  fixResults: FixResponse | null;
  error: string | null;
  lastFixedUrl: string | null;
  fixHistory: FixHistoryEntry[];
  appliedFixes: FixOperation[];
  pendingFixes: FixOperation[];
  estimatedTimeRemaining: number;
}

export interface FixHistoryEntry {
  id: string;
  url: string;
  timestamp: Date;
  totalFixes: number;
  successfulFixes: number;
  failedFixes: number;
  scoreImprovement: number;
}

export interface UseAutoFixReturn extends AutoFixState {
  startAutoFix: (scanId: string, options?: FixOptions) => Promise<void>;
  stopAutoFix: () => void;
  retryFix: (fixId: string) => Promise<void>;
  approveFix: (fixId: string) => Promise<boolean>;
  rollbackFix: (fixId: string) => Promise<boolean>;
  scheduleFix: (scanId: string, scheduleTime: Date) => string;
  cancelScheduledFix: (scheduleId: string) => boolean;
  getFixRecommendations: (scanId: string) => FixOperation[];
  batchApplyFixes: (fixIds: string[]) => Promise<BatchFixResult>;
  calculateFixImpact: (fixes: FixOperation[]) => FixImpact;
  exportFixReport: (format: 'json' | 'pdf' | 'csv') => string;
}

export interface FixOptions {
  dryRun?: boolean;
  confirmEach?: boolean;
  maxConcurrentFixes?: number;
  rollbackOnError?: boolean;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface BatchFixResult {
  successful: string[];
  failed: string[];
  skipped: string[];
  totalTime: number;
}

export interface FixImpact {
  estimatedScoreImprovement: number;
  estimatedTime: number;
  riskLevel: 'low' | 'medium' | 'high';
  affectedPages: number;
  dependencies: string[];
}

// Constants for auto-fix configuration
const AUTO_FIX_CONFIG = {
  MAX_FIX_TIME: 600000, // 10 minutes
  POLLING_INTERVAL: 3000, // 3 seconds
  MAX_RETRIES: 2,
  RETRY_DELAY: 2000,
  PROGRESS_UPDATE_INTERVAL: 150,
  MAX_CONCURRENT_FIXES: 5,
} as const;

// Auto-fix hook implementation
export const useAutoFix = (): UseAutoFixReturn => {
  // State management
  const [state, setState] = useState<AutoFixState>({
    isFixing: false,
    fixProgress: 0,
    currentStatus: 'idle',
    fixResults: null,
    error: null,
    lastFixedUrl: null,
    fixHistory: [],
    appliedFixes: [],
    pendingFixes: [],
    estimatedTimeRemaining: 0,
  });

  // Refs for cleanup and state management
  const cancelTokenSource = useRef<CancelTokenSource | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const fixStartTime = useRef<Date | null>(null);
  const scheduledFixes = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup function
  const cleanup = useCallback(() => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
      pollingInterval.current = null;
    }
    
    if (cancelTokenSource.current) {
      cancelTokenSource.current.cancel('Auto-fix cancelled by user');
      cancelTokenSource.current = null;
    }
    
    fixStartTime.current = null;
  }, []);

  // Simulate progress updates
  const startProgressSimulation = useCallback(() => {
    progressInterval.current = setInterval(() => {
      setState(prev => {
        if (prev.fixProgress >= 95) {
          if (progressInterval.current) {
            clearInterval(progressInterval.current);
          }
          return prev;
        }
        
        const increment = Math.random() * 3;
        const newProgress = Math.min(prev.fixProgress + increment, 95);
        
        // Calculate estimated time remaining
        if (fixStartTime.current) {
          const elapsed = Date.now() - fixStartTime.current.getTime();
          const estimatedTotal = (elapsed / newProgress) * 100;
          const remaining = Math.max(0, estimatedTotal - elapsed);
          
          return {
            ...prev,
            fixProgress: newProgress,
            estimatedTimeRemaining: Math.round(remaining / 1000),
          };
        }
        
        return {
          ...prev,
          fixProgress: newProgress,
        };
      });
    }, AUTO_FIX_CONFIG.PROGRESS_UPDATE_INTERVAL);
  }, []);

  // Process fix results
  const processFixResults = useCallback((results: FixResponse) => {
    // Create history entry
    const historyEntry: FixHistoryEntry = {
      id: `fix_${Date.now()}`,
      url: results.url,
      timestamp: new Date(),
      totalFixes: results.totalFixes,
      successfulFixes: results.successfulFixes,
      failedFixes: results.failedFixes,
      scoreImprovement: results.scoreImprovement,
    };

    // Update applied and pending fixes
    const appliedFixes = results.appliedFixes || [];
    const pendingFixes = results.pendingFixes || [];

    setState(prev => ({
      ...prev,
      isFixing: false,
      fixProgress: 100,
      currentStatus: 'completed',
      fixResults: results,
      error: null,
      appliedFixes,
      pendingFixes,
      estimatedTimeRemaining: 0,
      fixHistory: [historyEntry, ...prev.fixHistory.slice(0, 9)], // Keep last 10 fixes
    }));

    // Store in localStorage
    try {
      const storedHistory = JSON.parse(localStorage.getItem('fixHistory') || '[]');
      const updatedHistory = [historyEntry, ...storedHistory.slice(0, 49)];
      localStorage.setItem('fixHistory', JSON.stringify(updatedHistory));
    } catch (error) {
      console.error('Failed to store fix history:', error);
    }
  }, []);

  // Handle fix errors
  const handleFixError = useCallback(async (
    error: AxiosError,
    scanId: string,
    options: FixOptions,
    retryCount = 0
  ): Promise<void> => {
    console.error('Fix error:', error);
    
    let errorMessage = 'Auto-fix failed. Please try again.';
    
    if (error.response) {
      switch (error.response.status) {
        case 400:
          errorMessage = 'Invalid scan data. Please run a new scan.';
          break;
        case 401:
          errorMessage = 'Authentication required for fixes.';
          break;
        case 403:
          errorMessage = 'You do not have permission to apply fixes.';
          break;
        case 409:
          errorMessage = 'Fix conflict detected. Please review manually.';
          break;
        case 422:
          errorMessage = 'Fix validation failed.';
          break;
        case 500:
          errorMessage = 'Fix service error.';
          break;
        default:
          errorMessage = `Fix failed with status ${error.response.status}`;
      }
    } else if (error.request) {
      errorMessage = 'Network error during fix.';
    } else if (axios.isCancel(error)) {
      errorMessage = 'Fix was cancelled.';
    }

    setState(prev => ({
      ...prev,
      isFixing: false,
      currentStatus: 'error',
      error: errorMessage,
      fixProgress: 0,
    }));

    // Auto-retry for network errors
    if (error.code === 'ECONNABORTED' || !error.response) {
      if (retryCount < AUTO_FIX_CONFIG.MAX_RETRIES) {
        setTimeout(() => {
          startAutoFix(scanId, options);
        }, AUTO_FIX_CONFIG.RETRY_DELAY * (retryCount + 1));
      }
    }
  }, []);

  // Main auto-fix function
  const startAutoFix = useCallback(async (
    scanId: string,
    options: FixOptions = {}
  ): Promise<void> => {
    if (!scanId) {
      setState(prev => ({
        ...prev,
        error: 'Scan ID is required',
      }));
      return;
    }

    // Cleanup any existing fix operations
    cleanup();

    // Initialize fix state
    setState(prev => ({
      ...prev,
      isFixing: true,
      fixProgress: 0,
      currentStatus: 'preparing',
      error: null,
      estimatedTimeRemaining: 0,
    }));

    // Create cancellation token
    cancelTokenSource.current = axios.CancelToken.source();
    fixStartTime.current = new Date();

    try {
      // Start progress simulation
      startProgressSimulation();

      // Prepare fix request
      const fixRequest: FixRequest = {
        scanId,
        options: {
          dryRun: options.dryRun || false,
          confirmEach: options.confirmEach || false,
          maxConcurrentFixes: options.maxConcurrentFixes || AUTO_FIX_CONFIG.MAX_CONCURRENT_FIXES,
          rollbackOnError: options.rollbackOnError !== false,
          priority: options.priority || 'medium',
        },
      };

      // Update status to fixing
      setState(prev => ({ ...prev, currentStatus: 'applying' }));

      // Start auto-fix
      const response = await fixerService.startAutoFix(
        fixRequest,
        cancelTokenSource.current.token
      );

      // Handle async fixing with polling
      if (response.status === 'processing') {
        const fixId = response.fixId;
        
        // Start polling for results
        pollingInterval.current = setInterval(async () => {
          try {
            const pollResponse = await fixerService.checkFixStatus(fixId);
            
            if (pollResponse.status === 'completed') {
              if (pollingInterval.current) {
                clearInterval(pollingInterval.current);
              }
              processFixResults(pollResponse);
            } else if (pollResponse.status === 'failed') {
              if (pollingInterval.current) {
                clearInterval(pollingInterval.current);
              }
              throw new Error(pollResponse.error || 'Fix failed');
            }
            
            // Update progress from server
            if (pollResponse.progress !== undefined) {
              setState(prev => ({
                ...prev,
                fixProgress: pollResponse.progress,
              }));
            }
            
            // Update applied fixes in real-time
            if (pollResponse.appliedFixes) {
              setState(prev => ({
                ...prev,
                appliedFixes: pollResponse.appliedFixes,
              }));
            }
          } catch (error) {
            if (pollingInterval.current) {
              clearInterval(pollingInterval.current);
            }
            handleFixError(error as AxiosError, scanId, options);
          }
        }, AUTO_FIX_CONFIG.POLLING_INTERVAL);
      } else if (response.status === 'completed') {
        // Immediate completion
        processFixResults(response);
      }
    } catch (error) {
      handleFixError(error as AxiosError, scanId, options);
    } finally {
      // Cleanup progress simulation
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
    }
  }, [cleanup, startProgressSimulation, processFixResults, handleFixError]);

  // Stop current fix operation
  const stopAutoFix = useCallback(() => {
    cleanup();
    
    setState(prev => ({
      ...prev,
      isFixing: false,
      currentStatus: 'cancelled',
      fixProgress: 0,
      error: 'Auto-fix cancelled by user',
      estimatedTimeRemaining: 0,
    }));
  }, [cleanup]);

  // Retry a specific fix
  const retryFix = useCallback(async (fixId: string) => {
    try {
      setState(prev => ({
        ...prev,
        currentStatus: 'retrying',
      }));
      
      const response = await fixerService.retryFix(fixId);
      
      if (response.success) {
        setState(prev => ({
          ...prev,
          currentStatus: 'completed',
          error: null,
        }));
        return true;
      } else {
        throw new Error(response.error || 'Retry failed');
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Retry failed',
      }));
      return false;
    }
  }, []);

  // Approve a fix before applying
  const approveFix = useCallback(async (fixId: string): Promise<boolean> => {
    try {
      const response = await fixerService.approveFix(fixId);
      return response.approved;
    } catch (error) {
      console.error('Fix approval failed:', error);
      return false;
    }
  }, []);

  // Rollback an applied fix
  const rollbackFix = useCallback(async (fixId: string): Promise<boolean> => {
    try {
      setState(prev => ({
        ...prev,
        currentStatus: 'rollback',
      }));
      
      const response = await fixerService.rollbackFix(fixId);
      
      if (response.success) {
        // Remove from applied fixes
        setState(prev => ({
          ...prev,
          appliedFixes: prev.appliedFixes.filter(fix => fix.id !== fixId),
          currentStatus: 'completed',
          error: null,
        }));
        return true;
      }
      return false;
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Rollback failed',
      }));
      return false;
    }
  }, []);

  // Schedule a fix for later execution
  const scheduleFix = useCallback((scanId: string, scheduleTime: Date): string => {
    const scheduleId = `schedule_${Date.now()}`;
    const now = new Date();
    const delay = scheduleTime.getTime() - now.getTime();
    
    if (delay <= 0) {
      setState(prev => ({
        ...prev,
        error: 'Schedule time must be in the future',
      }));
      return '';
    }
    
    const timeout = setTimeout(() => {
      startAutoFix(scanId);
      scheduledFixes.current.delete(scheduleId);
    }, delay);
    
    scheduledFixes.current.set(scheduleId, timeout);
    
    return scheduleId;
  }, [startAutoFix]);

  // Cancel a scheduled fix
  const cancelScheduledFix = useCallback((scheduleId: string): boolean => {
    const timeout = scheduledFixes.current.get(scheduleId);
    if (timeout) {
      clearTimeout(timeout);
      scheduledFixes.current.delete(scheduleId);
      return true;
    }
    return false;
  }, []);

  // Get fix recommendations for a scan
  const getFixRecommendations = useCallback((scanId: string): FixOperation[] => {
    // In a real implementation, this would call an API
    // For now, return mock recommendations
    return [
      {
        id: 'fix_meta_title',
        type: 'meta_tag',
        description: 'Add missing meta title',
        impact: 'high',
        estimatedTime: 30,
        risk: 'low',
        automatic: true,
      },
      {
        id: 'fix_broken_link',
        type: 'link_fix',
        description: 'Fix broken external link',
        impact: 'medium',
        estimatedTime: 60,
        risk: 'low',
        automatic: true,
      },
    ];
  }, []);

  // Apply multiple fixes in batch
  const batchApplyFixes = useCallback(async (fixIds: string[]): Promise<BatchFixResult> => {
    const startTime = Date.now();
    const result: BatchFixResult = {
      successful: [],
      failed: [],
      skipped: [],
      totalTime: 0,
    };
    
    try {
      setState(prev => ({
        ...prev,
        currentStatus: 'batch_processing',
      }));
      
      // Apply fixes sequentially with error handling
      for (const fixId of fixIds) {
        try {
          const response = await fixerService.applyFix(fixId);
          if (response.success) {
            result.successful.push(fixId);
          } else {
            result.failed.push(fixId);
          }
        } catch (error) {
          result.failed.push(fixId);
        }
      }
      
      result.totalTime = Date.now() - startTime;
      
      setState(prev => ({
        ...prev,
        currentStatus: 'completed',
      }));
      
      return result;
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: 'Batch fix failed',
      }));
      throw error;
    }
  }, []);

  // Calculate fix impact
  const calculateFixImpact = useCallback((fixes: FixOperation[]): FixImpact => {
    const estimatedScoreImprovement = fixes.reduce((sum, fix) => {
      switch (fix.impact) {
        case 'high': return sum + 15;
        case 'medium': return sum + 8;
        case 'low': return sum + 3;
        default: return sum + 5;
      }
    }, 0);
    
    const estimatedTime = fixes.reduce((sum, fix) => sum + (fix.estimatedTime || 0), 0);
    
    // Determine risk level
    const highRiskFixes = fixes.filter(fix => fix.risk === 'high');
    const riskLevel = highRiskFixes.length > 0 ? 'high' : 
                     fixes.some(fix => fix.risk === 'medium') ? 'medium' : 'low';
    
    return {
      estimatedScoreImprovement,
      estimatedTime,
      riskLevel,
      affectedPages: 1, // Would calculate based on fix type
      dependencies: [], // Would analyze dependencies
    };
  }, []);

  // Export fix report
  const exportFixReport = useCallback((format: 'json' | 'pdf' | 'csv'): string => {
    if (!state.fixResults) return '';
    
    if (format === 'json') {
      return JSON.stringify(state.fixResults, null, 2);
    } else if (format === 'csv') {
      const headers = ['Fix ID', 'Type', 'Status', 'Impact', 'Time Taken', 'Result'];
      const rows = state.appliedFixes.map(fix => [
        fix.id,
        fix.type,
        'completed',
        fix.impact,
        fix.estimatedTime?.toString() || '0',
        'success',
      ].join(','));
      
      return [headers.join(','), ...rows].join('\n');
    } else if (format === 'pdf') {
      // In a real implementation, this would generate a PDF
      return 'PDF generation not implemented in this example';
    }
    
    return '';
  }, [state.fixResults, state.appliedFixes]);

  // Load fix history on mount
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem('fixHistory');
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory);
        const formattedHistory = parsedHistory.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
        
        setState(prev => ({
          ...prev,
          fixHistory: formattedHistory,
        }));
      }
    } catch (error) {
      console.error('Failed to load fix history:', error);
    }
    
    // Cleanup on unmount
    return () => {
      cleanup();
      // Clear all scheduled fixes
      scheduledFixes.current.forEach(timeout => clearTimeout(timeout));
      scheduledFixes.current.clear();
    };
  }, [cleanup]);

  // Expose all methods and state
  return {
    ...state,
    startAutoFix,
    stopAutoFix,
    retryFix,
    approveFix,
    rollbackFix,
    scheduleFix,
    cancelScheduledFix,
    getFixRecommendations,
    batchApplyFixes,
    calculateFixImpact,
    exportFixReport,
  };
};

// Custom hook for fix analytics
export const useFixAnalytics = () => {
  const [analytics, setAnalytics] = useState({
    totalFixesApplied: 0,
    averageFixTime: 0,
    successRate: 0,
    mostFixedIssue: '',
    timeSaved: 0,
  });

  // Calculate analytics from fix history
  const calculateAnalytics = useCallback((fixHistory: FixHistoryEntry[]) => {
    if (fixHistory.length === 0) return;
    
    const totalFixes = fixHistory.reduce((sum, fix) => sum + fix.totalFixes, 0);
    const successfulFixes = fixHistory.reduce((sum, fix) => sum + fix.successfulFixes, 0);
    const successRate = (successfulFixes / totalFixes) * 100;
    
    setAnalytics({
      totalFixesApplied: totalFixes,
      averageFixTime: 45, // Would calculate from actual data
      successRate: Math.round(successRate * 10) / 10,
      mostFixedIssue: 'Meta Tags',
      timeSaved: totalFixes * 30, // Estimated 30 minutes saved per fix
    });
  }, []);

  return {
    analytics,
    calculateAnalytics,
  };
};