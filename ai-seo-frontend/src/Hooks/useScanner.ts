// frontend/src/hooks/useScanner.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import axios, { AxiosError, CancelTokenSource } from 'axios';
import { scannerService, ScannerRequest, ScannerResponse, ScanStatus, ScanIssue } from '../services/scanner';

// TypeScript interfaces for scanner state
export interface ScannerState {
  isScanning: boolean;
  scanProgress: number;
  currentStatus: ScanStatus;
  scanResults: ScannerResponse | null;
  error: string | null;
  lastScannedUrl: string | null;
  scanHistory: ScanHistoryEntry[];
  issuesBySeverity: Record<string, ScanIssue[]>;
}

export interface ScanHistoryEntry {
  id: string;
  url: string;
  timestamp: Date;
  score: number;
  totalIssues: number;
  criticalIssues: number;
}

export interface UseScannerReturn extends ScannerState {
  startScan: (url: string, options?: ScanOptions) => Promise<void>;
  stopScan: () => void;
  retryScan: (url: string) => Promise<void>;
  clearResults: () => void;
  getIssueDetails: (issueId: string) => ScanIssue | undefined;
  exportResults: (format: 'json' | 'csv') => string;
  getScanStatistics: () => ScanStatistics;
}

export interface ScanOptions {
  deepScan?: boolean;
  maxPages?: number;
  includeRecommendations?: boolean;
  priority?: 'critical' | 'high' | 'medium' | 'low';
}

export interface ScanStatistics {
  totalScans: number;
  averageScore: number;
  mostCommonIssue: string;
  scanSuccessRate: number;
  totalIssuesFixed: number;
}

// Constants for scanner configuration
const SCANNER_CONFIG = {
  MAX_SCAN_TIME: 300000, // 5 minutes
  POLLING_INTERVAL: 2000, // 2 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,
  PROGRESS_UPDATE_INTERVAL: 100,
} as const;

// Scanner hook implementation
export const useScanner = (): UseScannerReturn => {
  // State management
  const [state, setState] = useState<ScannerState>({
    isScanning: false,
    scanProgress: 0,
    currentStatus: 'idle',
    scanResults: null,
    error: null,
    lastScannedUrl: null,
    scanHistory: [],
    issuesBySeverity: {},
  });

  // Refs for cleanup and cancellation
  const cancelTokenSource = useRef<CancelTokenSource | null>(null);
  const progressInterval = useRef<NodeJS.Timeout | null>(null);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);
  const scanStartTime = useRef<Date | null>(null);

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
      cancelTokenSource.current.cancel('Scan cancelled by user');
      cancelTokenSource.current = null;
    }
    
    scanStartTime.current = null;
  }, []);

  // Simulate progress updates for better UX
  const startProgressSimulation = useCallback(() => {
    progressInterval.current = setInterval(() => {
      setState(prev => {
        if (prev.scanProgress >= 95) {
          if (progressInterval.current) {
            clearInterval(progressInterval.current);
          }
          return prev;
        }
        
        const increment = Math.random() * 5;
        return {
          ...prev,
          scanProgress: Math.min(prev.scanProgress + increment, 95),
        };
      });
    }, SCANNER_CONFIG.PROGRESS_UPDATE_INTERVAL);
  }, []);

  // Process scan results and update state
  const processScanResults = useCallback((results: ScannerResponse) => {
    // Group issues by severity for easier access
    const issuesBySeverity = results.issues.reduce((acc, issue) => {
      const severity = issue.severity.toLowerCase();
      if (!acc[severity]) {
        acc[severity] = [];
      }
      acc[severity].push(issue);
      return acc;
    }, {} as Record<string, ScanIssue[]>);

    // Create history entry
    const historyEntry: ScanHistoryEntry = {
      id: `scan_${Date.now()}`,
      url: results.url,
      timestamp: new Date(),
      score: results.score,
      totalIssues: results.totalIssues,
      criticalIssues: results.issues.filter(i => i.severity === 'critical').length,
    };

    setState(prev => ({
      ...prev,
      isScanning: false,
      scanProgress: 100,
      currentStatus: 'completed',
      scanResults: results,
      error: null,
      issuesBySeverity,
      scanHistory: [historyEntry, ...prev.scanHistory.slice(0, 9)], // Keep last 10 scans
    }));

    // Store in localStorage for persistence
    try {
      const storedHistory = JSON.parse(localStorage.getItem('scanHistory') || '[]');
      const updatedHistory = [historyEntry, ...storedHistory.slice(0, 49)]; // Keep last 50 scans
      localStorage.setItem('scanHistory', JSON.stringify(updatedHistory));
    } catch (error) {
      console.error('Failed to store scan history:', error);
    }
  }, []);

  // Handle scan errors with retry logic
  const handleScanError = useCallback(async (
    error: AxiosError,
    url: string,
    options: ScanOptions,
    retryCount = 0
  ): Promise<void> => {
    console.error('Scan error:', error);
    
    let errorMessage = 'Scan failed. Please try again.';
    
    if (error.response) {
      switch (error.response.status) {
        case 400:
          errorMessage = 'Invalid URL format. Please check and try again.';
          break;
        case 401:
          errorMessage = 'Authentication required. Please log in again.';
          break;
        case 403:
          errorMessage = 'Access denied. You don\'t have permission to scan this URL.';
          break;
        case 404:
          errorMessage = 'URL not found. Please verify the website is accessible.';
          break;
        case 429:
          errorMessage = 'Too many scan requests. Please wait a moment and try again.';
          break;
        case 500:
          errorMessage = 'Server error. Please try again later.';
          break;
        case 503:
          errorMessage = 'Scanner service is temporarily unavailable.';
          break;
        default:
          errorMessage = `Scan failed with status ${error.response.status}`;
      }
    } else if (error.request) {
      errorMessage = 'Network error. Please check your connection.';
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = 'Scan timeout. The website might be too slow or blocking our scanner.';
    } else if (axios.isCancel(error)) {
      errorMessage = 'Scan was cancelled.';
    }

    setState(prev => ({
      ...prev,
      isScanning: false,
      currentStatus: 'error',
      error: errorMessage,
    }));

    // Auto-retry logic for network errors
    if (error.code === 'ECONNABORTED' || !error.response) {
      if (retryCount < SCANNER_CONFIG.MAX_RETRIES) {
        setTimeout(() => {
          startScan(url, options);
        }, SCANNER_CONFIG.RETRY_DELAY * (retryCount + 1));
      }
    }
  }, []);

  // Main scan function
  const startScan = useCallback(async (
    url: string,
    options: ScanOptions = {}
  ): Promise<void> => {
    // Input validation
    if (!url || typeof url !== 'string') {
      setState(prev => ({
        ...prev,
        error: 'Please provide a valid URL',
      }));
      return;
    }

    // Clean URL
    const cleanUrl = url.trim().toLowerCase();
    if (!cleanUrl.startsWith('http')) {
      setState(prev => ({
        ...prev,
        error: 'URL must start with http:// or https://',
      }));
      return;
    }

    // Cleanup any existing scans
    cleanup();

    // Initialize new scan state
    setState(prev => ({
      ...prev,
      isScanning: true,
      scanProgress: 0,
      currentStatus: 'initializing',
      error: null,
      lastScannedUrl: cleanUrl,
    }));

    // Create cancellation token
    cancelTokenSource.current = axios.CancelToken.source();
    scanStartTime.current = new Date();

    try {
      // Start progress simulation
      startProgressSimulation();

      // Prepare scan request
      const scanRequest: ScannerRequest = {
        url: cleanUrl,
        options: {
          deepScan: options.deepScan || false,
          maxPages: options.maxPages || 10,
          includeRecommendations: options.includeRecommendations !== false,
          priority: options.priority || 'medium',
        },
      };

      // Update status to scanning
      setState(prev => ({ ...prev, currentStatus: 'scanning' }));

      // Start scan
      const response = await scannerService.startScan(
        scanRequest,
        cancelTokenSource.current.token
      );

      // Handle async scanning with polling
      if (response.status === 'processing') {
        const scanId = response.scanId;
        
        // Start polling for results
        pollingInterval.current = setInterval(async () => {
          try {
            const pollResponse = await scannerService.checkScanStatus(scanId);
            
            if (pollResponse.status === 'completed') {
              if (pollingInterval.current) {
                clearInterval(pollingInterval.current);
              }
              processScanResults(pollResponse);
            } else if (pollResponse.status === 'failed') {
              if (pollingInterval.current) {
                clearInterval(pollingInterval.current);
              }
              throw new Error(pollResponse.error || 'Scan failed');
            }
            // Update progress from server if available
            if (pollResponse.progress !== undefined) {
              setState(prev => ({
                ...prev,
                scanProgress: pollResponse.progress,
              }));
            }
          } catch (error) {
            if (pollingInterval.current) {
              clearInterval(pollingInterval.current);
            }
            handleScanError(error as AxiosError, cleanUrl, options);
          }
        }, SCANNER_CONFIG.POLLING_INTERVAL);
      } else if (response.status === 'completed') {
        // Immediate completion
        processScanResults(response);
      }
    } catch (error) {
      handleScanError(error as AxiosError, cleanUrl, options);
    } finally {
      // Cleanup progress simulation
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
        progressInterval.current = null;
      }
    }
  }, [cleanup, startProgressSimulation, processScanResults, handleScanError]);

  // Stop current scan
  const stopScan = useCallback(() => {
    cleanup();
    
    setState(prev => ({
      ...prev,
      isScanning: false,
      currentStatus: 'cancelled',
      scanProgress: 0,
      error: 'Scan cancelled by user',
    }));
  }, [cleanup]);

  // Retry last scan
  const retryScan = useCallback(async (url: string) => {
    await startScan(url);
  }, [startScan]);

  // Clear scan results
  const clearResults = useCallback(() => {
    setState(prev => ({
      ...prev,
      scanResults: null,
      issuesBySeverity: {},
      error: null,
    }));
  }, []);

  // Get detailed issue information
  const getIssueDetails = useCallback((issueId: string) => {
    if (!state.scanResults) return undefined;
    return state.scanResults.issues.find(issue => issue.id === issueId);
  }, [state.scanResults]);

  // Export scan results in different formats
  const exportResults = useCallback((format: 'json' | 'csv'): string => {
    if (!state.scanResults) return '';
    
    if (format === 'json') {
      return JSON.stringify(state.scanResults, null, 2);
    } else if (format === 'csv') {
      const headers = ['URL', 'Score', 'Total Issues', 'Critical Issues', 'Timestamp'];
      const data = [
        state.scanResults.url,
        state.scanResults.score.toString(),
        state.scanResults.totalIssues.toString(),
        state.scanResults.issues.filter(i => i.severity === 'critical').length.toString(),
        new Date().toISOString(),
      ];
      
      return [headers.join(','), data.join(',')].join('\n');
    }
    
    return '';
  }, [state.scanResults]);

  // Calculate scan statistics
  const getScanStatistics = useCallback((): ScanStatistics => {
    const totalScans = state.scanHistory.length;
    
    if (totalScans === 0) {
      return {
        totalScans: 0,
        averageScore: 0,
        mostCommonIssue: 'No scans yet',
        scanSuccessRate: 0,
        totalIssuesFixed: 0,
      };
    }
    
    const totalScore = state.scanHistory.reduce((sum, scan) => sum + scan.score, 0);
    const averageScore = totalScore / totalScans;
    
    // Count issue occurrences (simplified)
    const issueCounts: Record<string, number> = {};
    state.scanHistory.forEach(scan => {
      // In a real app, you'd track specific issues
      issueCounts['Broken Links'] = (issueCounts['Broken Links'] || 0) + 1;
      issueCounts['Missing Meta Tags'] = (issueCounts['Missing Meta Tags'] || 0) + 1;
    });
    
    const mostCommonIssue = Object.entries(issueCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'Unknown';
    
    // Calculate success rate (scans with score > 50)
    const successfulScans = state.scanHistory.filter(scan => scan.score > 50).length;
    const scanSuccessRate = (successfulScans / totalScans) * 100;
    
    return {
      totalScans,
      averageScore: Math.round(averageScore * 10) / 10,
      mostCommonIssue,
      scanSuccessRate: Math.round(scanSuccessRate * 10) / 10,
      totalIssuesFixed: state.scanHistory.reduce((sum, scan) => sum + scan.totalIssues, 0),
    };
  }, [state.scanHistory]);

  // Load scan history from localStorage on mount
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem('scanHistory');
      if (storedHistory) {
        const parsedHistory = JSON.parse(storedHistory);
        const formattedHistory = parsedHistory.map((entry: any) => ({
          ...entry,
          timestamp: new Date(entry.timestamp),
        }));
        
        setState(prev => ({
          ...prev,
          scanHistory: formattedHistory,
        }));
      }
    } catch (error) {
      console.error('Failed to load scan history:', error);
    }
    
    // Cleanup on unmount
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // Expose all methods and state
  return {
    ...state,
    startScan,
    stopScan,
    retryScan,
    clearResults,
    getIssueDetails,
    exportResults,
    getScanStatistics,
  };
};

// Custom hook for scan monitoring
export const useScanMonitor = (scanId?: string) => {
  const [monitorState, setMonitorState] = useState({
    isActive: false,
    lastUpdate: new Date(),
    elapsedTime: 0,
    resourceUsage: {
      memory: 0,
      cpu: 0,
    },
  });

  useEffect(() => {
    if (!scanId) return;

    const interval = setInterval(() => {
      setMonitorState(prev => ({
        ...prev,
        elapsedTime: prev.elapsedTime + 1,
        lastUpdate: new Date(),
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [scanId]);

  return monitorState;
};