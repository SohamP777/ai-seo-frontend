// frontend/src/pages/Scan.tsx
import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Performance: Lazy load heavy components
const UrlInput = lazy(() => import('../components/scanner/UrlInput'));
const ScanProgress = lazy(() => import('../components/scanner/ScanProgress'));
const ScanResults = lazy(() => import('../components/scanner/ScanResults'));

// Components
import MainLayout from '../components/layout/MainLayout';
import Button from '../components/ui/Button';
import ProgressRing from '../components/ui/ProgressRing';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import LoadingSkeleton from '../components/ui/LoadingSkeleton';

// Hooks
import { useScanner } from '../hooks/useScanner';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { usePerformanceMetrics } from '../hooks/usePerformanceMetrics';
import { useSecurity } from '../hooks/useSecurity';

// Services
import { scanService, type ScanConfig } from '../services/scanner';
import { reportService } from '../services/reports';
import { monitoringService } from '../services/monitoring';

// Utils
import { formatSeoScore, getScoreColor } from '../utils/seoCalculations';
import { SEO_ISSUE_TYPES, DEFAULT_SCANNER_CONFIG, RATE_LIMITS } from '../utils/constants';
import { validateUrl, sanitizeInput, escapeHtml } from '../utils/security';
import { debounce, throttle } from '../utils/performance';
import { logError, logEvent } from '../utils/analytics';
import { generateTraceId } from '../utils/tracing';

// Types
interface ScanFormData {
  url: string;
  scanType: 'full' | 'quick' | 'custom';
  includeSubpages: boolean;
  maxPages: number;
  checkTypes: string[];
  depth: number;
  priority: 'normal' | 'high' | 'low';
}

interface ScanHistoryItem {
  id: string;
  url: string;
  status: 'completed' | 'failed' | 'cancelled' | 'processing' | 'queued' | 'paused';
  score: number;
  issuesFound: number;
  createdAt: string;
  completedAt?: string;
  scanType: string;
  duration?: number;
  pagesScanned: number;
  userId: string;
}

interface ScannerConfig {
  timeout: number;
  maxRetries: number;
  concurrentRequests: number;
  respectRobotsTxt: boolean;
  userAgent: string;
  followRedirects: boolean;
  maxRedirects: number;
  delayBetweenRequests: number;
  maxResponseSize: number;
  enableJavascript: boolean;
  screenshotCapture: boolean;
  lighthouseMetrics: boolean;
}

interface ScanStatistics {
  totalScans: number;
  completedScans: number;
  failedScans: number;
  successRate: number;
  averageScore: number;
  totalIssues: number;
  avgScanDuration: number;
  scansThisMonth: number;
  lastScanDate?: string;
}

// Security: Input validation schema with strict rules
const scanFormSchema = z.object({
  url: z.string()
    .min(1, 'URL is required')
    .max(2048, 'URL too long (max 2048 characters)')
    .refine((url) => {
      try {
        const validated = validateUrl(url);
        // Security: Prevent SSRF attempts
        const urlObj = new URL(validated);
        const hostname = urlObj.hostname.toLowerCase();
        
        // Block internal IPs and localhost
        const blockedHosts = [
          'localhost',
          '127.0.0.1',
          '0.0.0.0',
          '192.168.',
          '10.',
          '172.16.',
          '172.31.',
        ];
        
        return !blockedHosts.some(blocked => hostname.includes(blocked));
      } catch {
        return false;
      }
    }, {
      message: 'Please enter a valid external URL starting with http:// or https://',
    }),
  scanType: z.enum(['full', 'quick', 'custom']),
  includeSubpages: z.boolean().default(false),
  maxPages: z.number()
    .min(1, 'Must scan at least 1 page')
    .max(RATE_LIMITS.MAX_PAGES_PER_SCAN, `Cannot scan more than ${RATE_LIMITS.MAX_PAGES_PER_SCAN} pages`)
    .default(10),
  depth: z.number()
    .min(1, 'Depth must be at least 1')
    .max(5, 'Depth cannot exceed 5')
    .default(2),
  priority: z.enum(['normal', 'high', 'low']).default('normal'),
  checkTypes: z.array(z.string())
    .min(1, 'Select at least one check type')
    .max(RATE_LIMITS.MAX_CHECKS_PER_SCAN, `Cannot select more than ${RATE_LIMITS.MAX_CHECKS_PER_SCAN} checks`)
    .refine((types) => types.every(type => Object.keys(SEO_ISSUE_TYPES).includes(type)), {
      message: 'Invalid check type selected',
    }),
}).superRefine((data, ctx) => {
  // Security: Additional cross-field validation
  if (data.includeSubpages && data.maxPages > RATE_LIMITS.MAX_PAGES_WITH_SUBPAGES) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: RATE_LIMITS.MAX_PAGES_WITH_SUBPAGES,
      type: "number",
      inclusive: true,
      path: ["maxPages"],
      message: `With subpages enabled, maximum pages is ${RATE_LIMITS.MAX_PAGES_WITH_SUBPAGES}`,
    });
  }
});

const Scan: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, refreshUserData } = useAuth();
  const { showNotification, showError, showSuccess } = useNotification();
  const { trackMetric, startTimer, endTimer } = usePerformanceMetrics();
  const { checkRateLimit, validateRequest } = useSecurity();
  
  // Performance: Use refs for non-rendering values
  const scanStartTime = React.useRef<number>(0);
  const lastScanRequest = React.useRef<number>(0);
  const requestCount = React.useRef<number>(0);
  
  // State
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [selectedScan, setSelectedScan] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<ScanStatistics | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [config, setConfig] = useState<ScannerConfig>(DEFAULT_SCANNER_CONFIG);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [quickScanUrls, setQuickScanUrls] = useState<string[]>([]);
  const [urlSuggestions, setUrlSuggestions] = useState<string[]>([]);
  const [isCheckingUrl, setIsCheckingUrl] = useState(false);
  const [urlStatus, setUrlStatus] = useState<'valid' | 'invalid' | 'checking' | null>(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitReset, setRateLimitReset] = useState<number>(0);

  // Performance: Memoize expensive calculations
  const memoizedSEOIssueTypes = useMemo(() => SEO_ISSUE_TYPES, []);
  
  // Form
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid, isDirty },
    watch,
    setValue,
    reset,
    trigger,
    setError,
    clearErrors,
    getValues,
  } = useForm<ScanFormData>({
    resolver: zodResolver(scanFormSchema),
    defaultValues: {
      url: '',
      scanType: 'quick',
      includeSubpages: false,
      maxPages: 10,
      depth: 2,
      priority: 'normal',
      checkTypes: ['meta-tags', 'headers', 'images', 'links', 'performance', 'accessibility'],
    },
    mode: 'onChange',
    reValidateMode: 'onChange',
  });

  // Scanner hook
  const {
    currentScan,
    scanProgress,
    scanResults,
    isScanning,
    scanError,
    startScan: startScanner,
    stopScan: stopScanner,
    retryScan: retryScanner,
    clearResults: clearScannerResults,
    getScanStatus,
    pauseScan,
    resumeScan,
  } = useScanner();

  const selectedUrl = watch('url');
  const selectedScanType = watch('scanType');
  const includeSubpages = watch('includeSubpages');
  const maxPages = watch('maxPages');

  // Performance: Track component mount
  useEffect(() => {
    const traceId = generateTraceId();
    startTimer('page_load', traceId);
    logEvent('page_view', { page: 'scan', traceId });
    
    return () => {
      endTimer('page_load', traceId);
    };
  }, [startTimer, endTimer]);

  // Load data on component mount
  useEffect(() => {
    if (isAuthenticated) {
      loadInitialData();
    } else {
      setIsLoadingHistory(false);
      setIsLoadingStats(false);
    }
  }, [isAuthenticated]);

  // Load quick scan URLs with caching
  useEffect(() => {
    const loadData = async () => {
      const cached = localStorage.getItem('quick_scan_urls_cache');
      const cacheTime = localStorage.getItem('quick_scan_urls_cache_time');
      
      if (cached && cacheTime && Date.now() - parseInt(cacheTime) < 300000) { // 5 min cache
        setQuickScanUrls(JSON.parse(cached));
      } else {
        await loadQuickScanUrls();
      }
    };
    
    loadData();
  }, []);

  // Performance: Debounced URL validation with request limiting
  const validateUrlDebounced = useCallback(
    debounce(async (url: string) => {
      if (!url || url.length < 5) return;
      
      // Security: Rate limiting
      const now = Date.now();
      requestCount.current++;
      
      if (requestCount.current > RATE_LIMITS.MAX_VALIDATION_REQUESTS_PER_MINUTE) {
        setIsRateLimited(true);
        setRateLimitReset(now + 60000); // 1 minute
        return;
      }
      
      setIsCheckingUrl(true);
      setUrlStatus('checking');
      
      try {
        // Security: Validate request
        const validationResult = await validateRequest({
          type: 'url_validation',
          data: { url },
          userId: user?.id,
        });
        
        if (!validationResult.allowed) {
          throw new Error(validationResult.reason || 'Request not allowed');
        }
        
        // Check if URL is accessible with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);
        
        try {
          const isValid = await scanService.validateUrl(url, controller.signal);
          
          if (isValid) {
            setUrlStatus('valid');
            clearErrors('url');
            
            // Get suggestions for similar URLs with caching
            const suggestions = await scanService.getUrlSuggestions(url);
            setUrlSuggestions(suggestions.slice(0, 5)); // Limit suggestions
          } else {
            setUrlStatus('invalid');
            setError('url', { 
              type: 'manual', 
              message: 'URL is not accessible or returns an error' 
            });
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          setUrlStatus('invalid');
          setError('url', { 
            type: 'manual', 
            message: 'URL validation timed out' 
          });
        } else {
          setUrlStatus('invalid');
          setError('url', { 
            type: 'manual', 
            message: error.message || 'Failed to validate URL' 
          });
          logError('url_validation_failed', error, { url });
        }
      } finally {
        setIsCheckingUrl(false);
      }
    }, 500),
    [clearErrors, setError, config.timeout, user?.id, validateRequest]
  );

  // Watch URL changes for validation
  useEffect(() => {
    if (selectedUrl && selectedUrl.length > 4) {
      validateUrlDebounced(selectedUrl);
    } else {
      setUrlStatus(null);
      setUrlSuggestions([]);
    }
  }, [selectedUrl, validateUrlDebounced]);

  // Monitor rate limit reset
  useEffect(() => {
    if (isRateLimited && rateLimitReset > 0) {
      const interval = setInterval(() => {
        if (Date.now() > rateLimitReset) {
          setIsRateLimited(false);
          requestCount.current = 0;
          clearInterval(interval);
        }
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [isRateLimited, rateLimitReset]);

  const loadInitialData = useCallback(async () => {
    const traceId = generateTraceId();
    startTimer('data_load', traceId);
    
    try {
      await Promise.all([
        loadScanHistory(),
        loadStatistics(),
        loadScannerConfig(),
      ]);
      trackMetric('data_load_success', { traceId, duration: endTimer('data_load', traceId) });
    } catch (error) {
      showError('Failed to load initial data');
      logError('data_load_failed', error, { traceId });
      trackMetric('data_load_failed', { traceId, error: error.message });
    } finally {
      setIsLoadingHistory(false);
      setIsLoadingStats(false);
    }
  }, [showError, startTimer, endTimer, trackMetric]);

  const loadScanHistory = useCallback(async () => {
    if (!user) return;
    
    try {
      const history = await scanService.getScanHistory({
        userId: user.id,
        limit: 15,
        offset: 0,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        status: 'all',
      });
      setScanHistory(history);
      logEvent('history_loaded', { count: history.length, userId: user.id });
    } catch (error) {
      console.error('Failed to load scan history:', error);
      showError('Failed to load scan history');
      monitoringService.captureException(error as Error, {
        context: 'loadScanHistory',
        userId: user.id,
      });
    }
  }, [user, showError]);

  const loadStatistics = useCallback(async () => {
    if (!user) return;
    
    try {
      const stats = await scanService.getStatistics(user.id);
      setStatistics(stats);
    } catch (error) {
      console.error('Failed to load statistics:', error);
      showError('Failed to load statistics');
      monitoringService.captureException(error as Error, {
        context: 'loadStatistics',
        userId: user.id,
      });
    }
  }, [user, showError]);

  const loadScannerConfig = useCallback(async () => {
    if (!user) return;
    
    try {
      const userConfig = await scanService.getUserConfig(user.id);
      if (userConfig) {
        setConfig(prev => ({ ...prev, ...userConfig }));
      }
    } catch (error) {
      console.error('Failed to load scanner config:', error);
      showError('Failed to load scanner configuration');
    }
  }, [user, showError]);

  const loadQuickScanUrls = useCallback(async () => {
    try {
      const urls = await scanService.getQuickScanUrls();
      setQuickScanUrls(urls);
      // Cache the results
      localStorage.setItem('quick_scan_urls_cache', JSON.stringify(urls));
      localStorage.setItem('quick_scan_urls_cache_time', Date.now().toString());
    } catch (error) {
      console.error('Failed to load quick scan URLs:', error);
      // Don't show error for non-critical feature
    }
  }, []);

  const handleStartScan = useCallback(async (data: ScanFormData) => {
    const traceId = generateTraceId();
    startTimer('scan_start', traceId);
    
    // Security: Rate limiting check
    const now = Date.now();
    if (now - lastScanRequest.current < RATE_LIMITS.MIN_TIME_BETWEEN_SCANS) {
      showError(`Please wait ${Math.ceil(RATE_LIMITS.MIN_TIME_BETWEEN_SCANS / 1000)} seconds between scans`);
      return;
    }
    
    if (!isAuthenticated) {
      navigate('/auth/login', { state: { from: '/scan' } });
      return;
    }

    // Security: Check rate limits
    const rateLimitCheck = await checkRateLimit('scan_start', user?.id);
    if (!rateLimitCheck.allowed) {
      showError(`Rate limit exceeded. ${rateLimitCheck.retryAfter ? `Try again in ${rateLimitCheck.retryAfter} seconds` : 'Please try again later.'}`);
      setIsRateLimited(true);
      return;
    }

    // Check user's scan limits
    if (user && user.scansUsed >= user.scanLimit) {
      showError('Scan limit reached. Please upgrade your plan.');
      return;
    }

    try {
      // Security: Sanitize and validate input
      const sanitizedUrl = sanitizeInput(data.url);
      const escapedUrl = escapeHtml(sanitizedUrl);
      
      // Security: Additional validation
      if (sanitizedUrl !== data.url) {
        showError('Invalid characters detected in URL');
        return;
      }

      // Prepare scan configuration with security headers
      const scanConfig: ScanConfig = {
        url: sanitizedUrl,
        scanType: data.scanType,
        config: {
          ...config,
          includeSubpages: data.includeSubpages,
          maxPages: Math.min(data.maxPages, RATE_LIMITS.MAX_PAGES_PER_SCAN),
          depth: Math.min(data.depth, 5),
          priority: data.priority,
          checks: data.checkTypes.slice(0, RATE_LIMITS.MAX_CHECKS_PER_SCAN),
          userId: user!.id,
          metadata: {
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            referrer: document.referrer || '',
            traceId,
            clientIp: await getClientIp(),
          },
          security: {
            enableCSP: true,
            enableHSTS: true,
            enableXSSProtection: true,
            timeout: config.timeout,
            maxRedirects: config.maxRedirects,
          },
        },
      };

      // Log scan attempt
      logEvent('scan_started', {
        url: escapedUrl,
        scanType: data.scanType,
        userId: user!.id,
        traceId,
      });

      // Show scan started notification
      showNotification({
        type: 'info',
        title: 'Scan Started',
        message: `Scanning ${escapedUrl}...`,
        duration: 3000,
      });

      // Update last request time
      lastScanRequest.current = now;
      scanStartTime.current = now;

      // Start the scan
      await startScanner(scanConfig);
      
      // Track successful start
      trackMetric('scan_start_success', {
        duration: endTimer('scan_start', traceId),
        scanType: data.scanType,
        traceId,
      });

      // Refresh user data to update scan count
      await refreshUserData();
      
      // Reload history and statistics
      await Promise.all([
        loadScanHistory(),
        loadStatistics(),
      ]);

    } catch (error: any) {
      console.error('Failed to start scan:', error);
      
      // Track failed start
      trackMetric('scan_start_failed', {
        duration: endTimer('scan_start', traceId),
        error: error.message,
        traceId,
      });
      
      // Log error
      logError('scan_start_failed', error, {
        url: data.url,
        scanType: data.scanType,
        userId: user?.id,
        traceId,
      });
      
      // Show appropriate error message
      if (error.response?.status === 429) {
        showError('Too many scan requests. Please try again later.');
        setIsRateLimited(true);
      } else if (error.response?.status === 403) {
        showError('You do not have permission to scan this URL.');
      } else if (error.response?.status === 422) {
        showError('Invalid URL or scan configuration.');
      } else if (error.response?.status === 413) {
        showError('Scan request too large. Please reduce the number of pages or checks.');
      } else {
        showError('Failed to start scan. Please try again.');
      }
      
      // Clear form errors
      if (error.errors) {
        Object.entries(error.errors).forEach(([field, message]) => {
          setError(field as keyof ScanFormData, {
            type: 'manual',
            message: message as string,
          });
        });
      }
    }
  }, [
    isAuthenticated,
    user,
    navigate,
    startScanner,
    config,
    refreshUserData,
    loadScanHistory,
    loadStatistics,
    showNotification,
    showError,
    setError,
    checkRateLimit,
    startTimer,
    endTimer,
    trackMetric,
  ]);

  // Performance: Throttle expensive operations
  const throttledStopScan = useCallback(
    throttle(async () => {
      if (!currentScan?.id) return;
      
      try {
        await stopScanner(currentScan.id);
        showNotification({
          type: 'warning',
          title: 'Scan Stopped',
          message: 'Scan was successfully stopped',
          duration: 3000,
        });
        logEvent('scan_stopped', { scanId: currentScan.id });
      } catch (error) {
        showError('Failed to stop scan');
        logError('scan_stop_failed', error, { scanId: currentScan.id });
      }
    }, 1000),
    [currentScan, stopScanner, showNotification, showError]
  );

  const handleStopScan = throttledStopScan;

  const handlePauseScan = useCallback(async () => {
    if (!currentScan?.id) return;
    
    try {
      await pauseScan(currentScan.id);
      showNotification({
        type: 'info',
        title: 'Scan Paused',
        message: 'Scan was paused',
        duration: 3000,
      });
    } catch (error) {
      showError('Failed to pause scan');
    }
  }, [currentScan, pauseScan, showNotification, showError]);

  const handleResumeScan = useCallback(async () => {
    if (!currentScan?.id) return;
    
    try {
      await resumeScan(currentScan.id);
      showNotification({
        type: 'info',
        title: 'Scan Resumed',
        message: 'Scan was resumed',
        duration: 3000,
      });
    } catch (error) {
      showError('Failed to resume scan');
    }
  }, [currentScan, resumeScan, showNotification, showError]);

  const handleRetryScan = useCallback(async (scanId: string) => {
    try {
      await retryScanner(scanId);
      showSuccess('Scan retry initiated');
      await loadScanHistory();
      logEvent('scan_retried', { scanId });
    } catch (error) {
      showError('Failed to retry scan');
      logError('scan_retry_failed', error, { scanId });
    }
  }, [retryScanner, loadScanHistory, showSuccess, showError]);

  const handleViewReport = useCallback(async (scanId: string) => {
    try {
      // First, ensure the report is generated
      const report = await reportService.generateReport(scanId);
      
      if (report) {
        navigate(`/reports/${scanId}`, { 
          state: { report, fromScan: true } 
        });
        logEvent('report_viewed', { scanId });
      } else {
        showError('Report not available for this scan');
      }
    } catch (error) {
      showError('Failed to generate report');
      logError('report_generation_failed', error, { scanId });
    }
  }, [navigate, showError]);

  const handleDeleteScan = useCallback(async (scanId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    
    if (!window.confirm('Are you sure you want to delete this scan? This action cannot be undone.')) {
      return;
    }

    try {
      await scanService.deleteScan(scanId);
      showSuccess('Scan deleted successfully');
      
      // Update local state
      setScanHistory(prev => prev.filter(scan => scan.id !== scanId));
      
      // Refresh statistics
      await loadStatistics();
      
      logEvent('scan_deleted', { scanId });
    } catch (error) {
      showError('Failed to delete scan');
      logError('scan_delete_failed', error, { scanId });
    }
  }, [loadStatistics, showSuccess, showError]);

  const handleExportScan = useCallback(async (scanId: string, format: 'json' | 'csv' | 'pdf') => {
    try {
      const exportData = await scanService.exportScan(scanId, format);
      
      // Security: Sanitize filename
      const sanitizedScanId = scanId.replace(/[^a-zA-Z0-9-_]/g, '');
      const sanitizedDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      
      // Create download link
      const blob = new Blob([exportData], { 
        type: format === 'json' ? 'application/json' : 
              format === 'csv' ? 'text/csv' : 'application/pdf' 
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan-${sanitizedScanId}-${sanitizedDate}.${format}`;
      a.setAttribute('rel', 'noopener noreferrer');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showSuccess(`Scan exported as ${format.toUpperCase()}`);
      logEvent('scan_exported', { scanId, format });
    } catch (error) {
      showError('Failed to export scan');
      logError('scan_export_failed', error, { scanId, format });
    }
  }, [showSuccess, showError]);

  const handleConfigUpdate = useCallback(async (updates: Partial<ScannerConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    
    // Save to backend if user is authenticated
    if (user) {
      try {
        await scanService.saveUserConfig(user.id, newConfig);
        showSuccess('Scanner configuration saved');
        logEvent('config_updated', { userId: user.id });
      } catch (error) {
        showError('Failed to save configuration');
      }
    }
  }, [config, user, showSuccess, showError]);

  const handleQuickScan = useCallback((url: string) => {
    setValue('url', url, { shouldValidate: true });
    setValue('scanType', 'quick');
    setValue('includeSubpages', false);
    setValue('maxPages', 5);
    trigger();
    logEvent('quick_scan_selected', { url });
  }, [setValue, trigger]);

  const handleScheduleScan = useCallback(async (scheduleTime: Date) => {
    if (!user) return;
    
    const data = getValues();
    
    try {
      await scanService.scheduleScan({
        ...data,
        scheduleTime: scheduleTime.toISOString(),
        userId: user.id,
      });
      
      showSuccess('Scan scheduled successfully');
      reset();
      logEvent('scan_scheduled', { userId: user.id, scheduleTime: scheduleTime.toISOString() });
    } catch (error) {
      showError('Failed to schedule scan');
    }
  }, [user, reset, showSuccess, showError, getValues]);

  const handleBulkScan = useCallback(async (urls: string[]) => {
    if (!user) return;
    
    if (urls.length > RATE_LIMITS.MAX_URLS_PER_BULK_SCAN && user.plan === 'free') {
      showError(`Free plan limited to ${RATE_LIMITS.MAX_URLS_PER_BULK_SCAN} URLs per bulk scan`);
      return;
    }
    
    // Security: Validate all URLs
    const validatedUrls = urls.filter(url => {
      try {
        return validateUrl(url);
      } catch {
        return false;
      }
    }).slice(0, RATE_LIMITS.MAX_URLS_PER_BULK_SCAN);
    
    try {
      const results = await scanService.bulkScan(validatedUrls, user.id);
      showSuccess(`Started scanning ${validatedUrls.length} URLs`);
      
      // Refresh history
      await loadScanHistory();
      logEvent('bulk_scan_started', { count: validatedUrls.length, userId: user.id });
    } catch (error) {
      showError('Failed to start bulk scan');
      logError('bulk_scan_failed', error, { count: urls.length, userId: user.id });
    }
  }, [user, loadScanHistory, showSuccess, showError]);

  // Performance: Memoized statistics display
  const scanStatistics = useMemo(() => {
    if (!statistics) return null;
    
    return {
      ...statistics,
      formattedSuccessRate: `${statistics.successRate.toFixed(1)}%`,
      formattedAvgDuration: statistics.avgScanDuration > 60 
        ? `${(statistics.avgScanDuration / 60).toFixed(1)} min`
        : `${statistics.avgScanDuration.toFixed(0)} sec`,
      remainingScans: user ? Math.max(0, user.scanLimit - user.scansUsed) : 0,
      scanUsagePercentage: user ? (user.scansUsed / user.scanLimit) * 100 : 0,
    };
  }, [statistics, user]);

  // Performance: Memoized scan history by status
  const groupedScanHistory = useMemo(() => {
    const groups = {
      completed: [] as ScanHistoryItem[],
      processing: [] as ScanHistoryItem[],
      failed: [] as ScanHistoryItem[],
      queued: [] as ScanHistoryItem[],
      paused: [] as ScanHistoryItem[],
    };
    
    scanHistory.forEach(scan => {
      if (scan.status === 'completed') groups.completed.push(scan);
      else if (scan.status === 'processing') groups.processing.push(scan);
      else if (scan.status === 'failed') groups.failed.push(scan);
      else if (scan.status === 'queued') groups.queued.push(scan);
      else if (scan.status === 'paused') groups.paused.push(scan);
    });
    
    return groups;
  }, [scanHistory]);

  // Format scan type display
  const formatScanType = (type: string): string => {
    const types: Record<string, string> = {
      'full': 'Full Scan',
      'quick': 'Quick Scan',
      'custom': 'Custom Scan',
    };
    return types[type] || type;
  };

  // Get status color and icon - Accessibility: Use semantic colors
  const getStatusInfo = (status: string) => {
    const info: Record<string, { 
      color: string; 
      icon: string; 
      ariaLabel: string;
      bgColor: string;
    }> = {
      'completed': { 
        color: 'text-green-800', 
        bgColor: 'bg-green-100',
        icon: '✓',
        ariaLabel: 'Completed' 
      },
      'failed': { 
        color: 'text-red-800', 
        bgColor: 'bg-red-100',
        icon: '✗',
        ariaLabel: 'Failed' 
      },
      'cancelled': { 
        color: 'text-yellow-800', 
        bgColor: 'bg-yellow-100',
        icon: '⏹',
        ariaLabel: 'Cancelled' 
      },
      'processing': { 
        color: 'text-blue-800', 
        bgColor: 'bg-blue-100',
        icon: '⟳',
        ariaLabel: 'Processing' 
      },
      'queued': { 
        color: 'text-gray-800', 
        bgColor: 'bg-gray-100',
        icon: '⏳',
        ariaLabel: 'Queued' 
      },
      'paused': { 
        color: 'text-orange-800', 
        bgColor: 'bg-orange-100',
        icon: '⏸',
        ariaLabel: 'Paused' 
      },
    };
    return info[status] || { 
      color: 'text-gray-800', 
      bgColor: 'bg-gray-100',
      icon: '?',
      ariaLabel: 'Unknown' 
    };
  };

  // Accessibility: Keyboard navigation handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsConfigOpen(false);
    }
    if (e.key === 'Enter' && e.ctrlKey && isValid && !isScanning) {
      handleSubmit(handleStartScan)();
    }
  }, [isValid, isScanning, handleStartScan, handleSubmit]);

  // Get client IP for security logging
  const getClientIp = async (): Promise<string> => {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch {
      return 'unknown';
    }
  };

  // Render loading state with accessibility
  if (isLoadingHistory || isLoadingStats) {
    return (
      <MainLayout>
        <div 
          className="min-h-screen bg-gray-50 flex items-center justify-center"
          role="status"
          aria-label="Loading scanner"
        >
          <div className="text-center">
            <div 
              className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"
              aria-hidden="true"
            ></div>
            <p className="text-gray-600">Loading scanner...</p>
            <span className="sr-only">Loading scanner interface, please wait</span>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div 
        className="min-h-screen bg-gray-50 py-8"
        onKeyDown={handleKeyDown}
        role="main"
        aria-label="SEO Scanner"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header with Stats */}
          <header className="mb-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900" id="page-title">
                  SEO Scanner
                </h1>
                <p className="mt-2 text-gray-600" id="page-description">
                  Scan your website for SEO issues and get actionable recommendations
                </p>
              </div>
              
              {scanStatistics && (
                <div className="flex flex-wrap gap-4" role="region" aria-label="Scan Statistics">
                  <div className="bg-white px-4 py-3 rounded-lg shadow-sm border border-gray-200" role="group" aria-label="Remaining Scans">
                    <div className="text-sm text-gray-500">Remaining Scans</div>
                    <div className="text-2xl font-bold text-gray-900" aria-live="polite">
                      {scanStatistics.remainingScans}
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-2" role="progressbar" 
                         aria-valuenow={scanStatistics.scanUsagePercentage} 
                         aria-valuemin="0" 
                         aria-valuemax="100">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(scanStatistics.scanUsagePercentage, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                  
                  <div className="bg-white px-4 py-3 rounded-lg shadow-sm border border-gray-200" role="group" aria-label="Success Rate">
                    <div className="text-sm text-gray-500">Success Rate</div>
                    <div className="text-2xl font-bold text-gray-900" aria-live="polite">
                      {scanStatistics.formattedSuccessRate}
                    </div>
                    <div className="text-sm text-gray-500">
                      {scanStatistics.completedScans}/{scanStatistics.totalScans} scans
                    </div>
                  </div>
                  
                  <div className="bg-white px-4 py-3 rounded-lg shadow-sm border border-gray-200" role="group" aria-label="Average Score">
                    <div className="text-sm text-gray-500">Avg. Score</div>
                    <div className="text-2xl font-bold text-gray-900" aria-live="polite">
                      {scanStatistics.averageScore.toFixed(0)}/100
                    </div>
                    <div className="text-sm text-gray-500">
                      {scanStatistics.totalIssues} total issues
                    </div>
                  </div>
                </div>
              )}
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column - Scanner Form & History */}
            <div className="lg:col-span-2 space-y-8">
              {/* Scanner Form */}
              <section 
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
                aria-labelledby="scan-form-title"
              >
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 id="scan-form-title" className="text-xl font-semibold text-gray-800">
                      New Scan
                    </h2>
                    <p className="text-sm text-gray-500 mt-1" id="scan-form-description">
                      Enter a URL to analyze for SEO issues
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsConfigOpen(!isConfigOpen)}
                      aria-expanded={isConfigOpen}
                      aria-controls="advanced-settings"
                    >
                      {isConfigOpen ? 'Hide Settings' : 'Show Settings'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/scan/bulk')}
                      aria-label="Go to bulk scan page"
                    >
                      Bulk Scan
                    </Button>
                  </div>
                </div>

                <form 
                  onSubmit={handleSubmit(handleStartScan)} 
                  className="space-y-6"
                  aria-describedby="scan-form-description"
                  noValidate
                >
                  {/* URL Input with Validation */}
                  <div className="space-y-2">
                    <label htmlFor="url-input" className="block text-sm font-medium text-gray-700">
                      Website URL *
                    </label>
                    <Suspense fallback={<LoadingSkeleton height="40px" />}>
                      <UrlInput
                        id="url-input"
                        register={register('url')}
                        error={errors.url?.message}
                        disabled={isScanning || isRateLimited}
                        onUrlChange={(url) => {
                          setValue('url', url, { shouldValidate: true });
                        }}
                        status={urlStatus}
                        isChecking={isCheckingUrl}
                        suggestions={urlSuggestions}
                        onSuggestionClick={handleQuickScan}
                        aria-required="true"
                        aria-invalid={!!errors.url}
                        aria-describedby={errors.url ? "url-error" : undefined}
                      />
                    </Suspense>
                    {errors.url && (
                      <p id="url-error" className="text-sm text-red-600" role="alert">
                        {errors.url.message}
                      </p>
                    )}
                    {urlStatus === 'valid' && (
                      <p className="text-sm text-green-600 flex items-center gap-1">
                        <span className="w-2 h-2 bg-green-600 rounded-full" aria-hidden="true"></span>
                        URL is accessible and valid
                      </p>
                    )}
                    {isRateLimited && (
                      <p className="text-sm text-yellow-600" role="alert">
                        Rate limit exceeded. Please wait before making another request.
                      </p>
                    )}
                  </div>

                  {/* Quick Scan URLs */}
                  {quickScanUrls.length > 0 && (
                    <div role="region" aria-label="Quick scan suggestions">
                      <p className="text-sm text-gray-500 mb-2">Quick scan suggestions:</p>
                      <div className="flex flex-wrap gap-2">
                        {quickScanUrls.slice(0, 5).map((url, index) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => handleQuickScan(url)}
                            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            aria-label={`Scan ${new URL(url).hostname}`}
                          >
                            {new URL(url).hostname}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Scan Configuration */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Scan Type */}
                    <div role="radiogroup" aria-labelledby="scan-type-label">
                      <label id="scan-type-label" className="block text-sm font-medium text-gray-700 mb-2">
                        Scan Type
                      </label>
                      <div className="space-y-2">
                        {(['full', 'quick', 'custom'] as const).map((type) => (
                          <label
                            key={type}
                            className={`flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors ${
                              selectedScanType === type ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                            }`}
                          >
                            <input
                              type="radio"
                              value={type}
                              {...register('scanType')}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                              aria-checked={selectedScanType === type}
                            />
                            <div className="flex-1">
                              <span className="font-medium text-gray-700">
                                {formatScanType(type)}
                              </span>
                              <p className="text-sm text-gray-500 mt-0.5">
                                {type === 'quick' && 'Basic SEO checks (1-2 minutes)'}
                                {type === 'full' && 'Comprehensive analysis (5-10 minutes)'}
                                {type === 'custom' && 'Choose specific checks'}
                              </p>
                            </div>
                            {type === 'quick' && (
                              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                                Recommended
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Scan Options */}
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Scan Options
                        </label>
                        <div className="space-y-3">
                          <label className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                            <div>
                              <div className="font-medium text-gray-700">Include subpages</div>
                              <div className="text-sm text-gray-500">
                                Scan linked pages within the same domain
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              {...register('includeSubpages')}
                              className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                          </label>

                          <div className="p-3 border border-gray-200 rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <label htmlFor="max-pages" className="font-medium text-gray-700">
                                Maximum Pages: {maxPages}
                              </label>
                              <span className="text-sm text-gray-500">
                                {includeSubpages ? 'Subpages included' : 'Main page only'}
                              </span>
                            </div>
                            <input
                              id="max-pages"
                              type="range"
                              min="1"
                              max={includeSubpages ? "100" : "1"}
                              step="1"
                              {...register('maxPages', { valueAsNumber: true })}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                              disabled={!includeSubpages}
                              aria-valuemin={1}
                              aria-valuemax={includeSubpages ? 100 : 1}
                              aria-valuenow={maxPages}
                            />
                            <div className="flex justify-between text-xs text-gray-500 mt-1">
                              <span>1</span>
                              <span>{includeSubpages ? '50' : '1'}</span>
                              <span>{includeSubpages ? '100' : '1'}</span>
                            </div>
                          </div>

                          <div>
                            <label htmlFor="depth-select" className="block text-sm font-medium text-gray-700 mb-1">
                              Crawl Depth
                            </label>
                            <select
                              id="depth-select"
                              {...register('depth', { valueAsNumber: true })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                              aria-label="Select crawl depth"
                            >
                              <option value={1}>Level 1 - Main page only</option>
                              <option value={2}>Level 2 - Main page + 1 click deep</option>
                              <option value={3}>Level 3 - Main page + 2 clicks deep</option>
                              <option value={4}>Level 4 - Main page + 3 clicks deep</option>
                              <option value={5}>Level 5 - Deep crawl (slower)</option>
                            </select>
                          </div>

                          <div>
                            <label htmlFor="priority-select" className="block text-sm font-medium text-gray-700 mb-1">
                              Priority
                            </label>
                            <select
                              id="priority-select"
                              {...register('priority')}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                              aria-label="Select scan priority"
                            >
                              <option value="low">Low - Run when resources available</option>
                              <option value="normal">Normal - Standard priority</option>
                              <option value="high">High - Run immediately</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Advanced Configuration */}
                  {isConfigOpen && (
                    <div 
                      id="advanced-settings"
                      className="border-t pt-6 mt-6 space-y-6"
                      role="region"
                      aria-labelledby="advanced-settings-title"
                    >
                      <h3 id="advanced-settings-title" className="font-semibold text-gray-700">
                        Advanced Settings
                      </h3>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Performance Settings */}
                        <div className="space-y-4">
                          <h4 className="font-medium text-gray-600">Performance</h4>
                          
                          <div>
                            <label htmlFor="timeout-input" className="block text-sm font-medium text-gray-700 mb-1">
                              Timeout (seconds)
                            </label>
                            <input
                              id="timeout-input"
                              type="number"
                              min="10"
                              max="300"
                              value={config.timeout / 1000}
                              onChange={(e) => handleConfigUpdate({ 
                                timeout: parseInt(e.target.value) * 1000 
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                              aria-label="Set timeout in seconds"
                            />
                          </div>

                          <div>
                            <label htmlFor="concurrent-input" className="block text-sm font-medium text-gray-700 mb-1">
                              Concurrent Requests
                            </label>
                            <input
                              id="concurrent-input"
                              type="number"
                              min="1"
                              max="20"
                              value={config.concurrentRequests}
                              onChange={(e) => handleConfigUpdate({ 
                                concurrentRequests: parseInt(e.target.value) 
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                              aria-label="Set concurrent requests"
                            />
                          </div>

                          <div>
                            <label htmlFor="delay-input" className="block text-sm font-medium text-gray-700 mb-1">
                              Delay Between Requests (ms)
                            </label>
                            <input
                              id="delay-input"
                              type="number"
                              min="0"
                              max="5000"
                              step="100"
                              value={config.delayBetweenRequests}
                              onChange={(e) => handleConfigUpdate({ 
                                delayBetweenRequests: parseInt(e.target.value) 
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                              aria-label="Set delay between requests in milliseconds"
                            />
                          </div>
                        </div>

                        {/* Behavior Settings */}
                        <div className="space-y-4">
                          <h4 className="font-medium text-gray-600">Behavior</h4>
                          
                          <div className="space-y-3">
                            <label className="flex items-center justify-between">
                              <div>
                                <div className="font-medium text-gray-700">Respect robots.txt</div>
                                <div className="text-sm text-gray-500">
                                  Follow website's robot exclusion rules
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={config.respectRobotsTxt}
                                onChange={(e) => handleConfigUpdate({ 
                                  respectRobotsTxt: e.target.checked 
                                })}
                                className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                aria-label="Respect robots.txt"
                              />
                            </label>

                            <label className="flex items-center justify-between">
                              <div>
                                <div className="font-medium text-gray-700">Follow Redirects</div>
                                <div className="text-sm text-gray-500">
                                  Automatically follow HTTP redirects
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={config.followRedirects}
                                onChange={(e) => handleConfigUpdate({ 
                                  followRedirects: e.target.checked 
                                })}
                                className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                aria-label="Follow redirects"
                              />
                            </label>

                            <label className="flex items-center justify-between">
                              <div>
                                <div className="font-medium text-gray-700">Enable JavaScript</div>
                                <div className="text-sm text-gray-500">
                                  Execute JavaScript on pages (slower)
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={config.enableJavascript}
                                onChange={(e) => handleConfigUpdate({ 
                                  enableJavascript: e.target.checked 
                                })}
                                className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                aria-label="Enable JavaScript execution"
                              />
                            </label>

                            <label className="flex items-center justify-between">
                              <div>
                                <div className="font-medium text-gray-700">Capture Screenshots</div>
                                <div className="text-sm text-gray-500">
                                  Take screenshots of each page
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={config.screenshotCapture}
                                onChange={(e) => handleConfigUpdate({ 
                                  screenshotCapture: e.target.checked 
                                })}
                                className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                aria-label="Capture screenshots"
                              />
                            </label>
                          </div>
                        </div>
                      </div>

                      {config.followRedirects && (
                        <div>
                          <label htmlFor="redirects-input" className="block text-sm font-medium text-gray-700 mb-1">
                            Maximum Redirects
                          </label>
                          <input
                            id="redirects-input"
                            type="number"
                            min="1"
                            max="20"
                            value={config.maxRedirects}
                            onChange={(e) => handleConfigUpdate({ 
                              maxRedirects: parseInt(e.target.value) 
                            })}
                            className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            aria-label="Set maximum redirects"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Custom Check Types */}
                  {selectedScanType === 'custom' && (
                    <div className="border-t pt-6" role="region" aria-labelledby="check-types-title">
                      <h3 id="check-types-title" className="font-medium text-gray-700 mb-4">
                        Select Checks to Perform
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {Object.entries(memoizedSEOIssueTypes).map(([key, label]) => (
                          <label 
                            key={key} 
                            className="flex items-center space-x-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              value={key}
                              {...register('checkTypes')}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              aria-label={`Select ${label} check`}
                            />
                            <div>
                              <span className="text-sm font-medium text-gray-700">{label}</span>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {key === 'performance' && 'Page speed and performance metrics'}
                                {key === 'accessibility' && 'WCAG accessibility compliance'}
                                {key === 'security' && 'Security headers and HTTPS'}
                                {key === 'mobile' && 'Mobile responsiveness'}
                                {key === 'structured-data' && 'Schema.org markup validation'}
                                {key === 'social' && 'Social media meta tags'}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {errors.checkTypes && (
                        <p className="mt-2 text-sm text-red-600" role="alert">
                          {errors.checkTypes.message}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Form Actions */}
                  <div className="flex items-center justify-between pt-6 border-t">
                    <div className="text-sm text-gray-500">
                      {isScanning ? (
                        <div className="flex items-center space-x-2">
                          <div className="w-3 h-3 bg-blue-600 rounded-full animate-pulse" aria-hidden="true"></div>
                          <span aria-live="polite">Scan in progress...</span>
                        </div>
                      ) : (
                        <div>
                          {isAuthenticated ? (
                            <span aria-live="polite">
                              Scans used: {user?.scansUsed || 0}/{user?.scanLimit || 0}
                            </span>
                          ) : (
                            <span className="text-yellow-600">
                              Sign in to save scan results
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex space-x-3">
                      {isScanning ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handlePauseScan}
                            disabled={currentScan?.status !== 'processing'}
                            aria-label="Pause current scan"
                          >
                            Pause
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={handleStopScan}
                            aria-label="Stop current scan"
                          >
                            Stop Scan
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => reset()}
                            disabled={isSubmitting || !isDirty}
                            aria-label="Clear form"
                          >
                            Clear
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => handleScheduleScan(
                              new Date(Date.now() + 3600000) // 1 hour from now
                            )}
                            disabled={!isValid || !isAuthenticated}
                            aria-label="Schedule scan for later"
                          >
                            Schedule
                          </Button>
                          <Button
                            type="submit"
                            variant="primary"
                            loading={isSubmitting}
                            disabled={!isValid || isScanning || isRateLimited}
                            className="min-w-[120px]"
                            aria-label="Start SEO scan"
                          >
                            {isSubmitting ? 'Starting...' : 'Start Scan'}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </form>
              </section>

              {/* Current Scan Progress */}
              {isScanning && currentScan && (
                <Suspense fallback={<LoadingSkeleton height="200px" />}>
                  <ScanProgress
                    progress={scanProgress}
                    currentTask={currentScan.currentTask}
                    estimatedTime={currentScan.estimatedTime}
                    scannedPages={currentScan.scannedPages}
                    totalPages={currentScan.totalPages}
                    issuesFound={currentScan.issuesFound}
                    onStop={handleStopScan}
                    onPause={handlePauseScan}
                    onResume={handleResumeScan}
                    status={currentScan.status}
                  />
                </Suspense>
              )}

              {/* Scan Results */}
              {scanResults && (
                <Suspense fallback={<LoadingSkeleton height="300px" />}>
                  <ScanResults
                    results={scanResults}
                    onRetry={handleRetryScan}
                    onViewReport={handleViewReport}
                    onDelete={handleDeleteScan}
                    onExport={handleExportScan}
                  />
                </Suspense>
              )}

              {/* Scan History */}
              <section 
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
                aria-labelledby="scan-history-title"
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 id="scan-history-title" className="text-xl font-semibold text-gray-800">
                    Recent Scans
                  </h2>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadScanHistory}
                      loading={isLoadingHistory}
                      aria-label="Refresh scan history"
                    >
                      Refresh
                    </Button>
                    {scanHistory.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate('/reports')}
                        aria-label="View all reports"
                      >
                        View All
                      </Button>
                    )}
                  </div>
                </div>
                
                {scanHistory.length === 0 ? (
                  <div className="text-center py-12" role="status" aria-label="No scans yet">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No scans yet</h3>
                    <p className="text-gray-500 mb-6">Start your first SEO scan to see results here</p>
                    <Button
                      variant="primary"
                      onClick={() => setValue('url', 'https://example.com')}
                      aria-label="Try example scan with example.com"
                    >
                      Try Example Scan
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Active Scans */}
                    {groupedScanHistory.processing.length > 0 && (
                      <div className="mb-6" role="region" aria-label="Active scans">
                        <h3 className="text-sm font-medium text-gray-700 mb-3">Active Scans</h3>
                        <div className="space-y-3">
                          {groupedScanHistory.processing.map((scan) => (
                            <div
                              key={scan.id}
                              className="p-4 border border-blue-200 bg-blue-50 rounded-lg"
                              role="article"
                              aria-label={`Active scan of ${scan.url}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                    <div 
                                      className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"
                                      aria-hidden="true"
                                    ></div>
                                  </div>
                                  <div>
                                    <div className="font-medium text-gray-900 truncate max-w-md">
                                      {scan.url}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                      Started {new Date(scan.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => navigate(`/scan/status/${scan.id}`)}
                                    aria-label={`View status of scan ${scan.id}`}
                                  >
                                    View Status
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Scan History List */}
                    <div className="space-y-3" role="list" aria-label="Scan history">
                      {scanHistory
                        .filter(scan => scan.status !== 'processing')
                        .slice(0, 10)
                        .map((scan) => {
                          const statusInfo = getStatusInfo(scan.status);
                          const scoreColor = getScoreColor(scan.score);
                          
                          return (
                            <article
                              key={scan.id}
                              className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                              onClick={() => setSelectedScan(
                                selectedScan === scan.id ? null : scan.id
                              )}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedScan(selectedScan === scan.id ? null : scan.id);
                                }
                              }}
                              tabIndex={0}
                              role="button"
                              aria-label={`Scan of ${scan.url}, status: ${statusInfo.ariaLabel}, score: ${scan.score}`}
                              aria-expanded={selectedScan === scan.id}
                            >
                              <div className="flex items-center space-x-4">
                                <div 
                                  className={`px-3 py-1 rounded-full text-xs font-medium ${statusInfo.color} ${statusInfo.bgColor}`}
                                  aria-label={`Status: ${statusInfo.ariaLabel}`}
                                >
                                  <span className="mr-1" aria-hidden="true">{statusInfo.icon}</span>
                                  {scan.status.charAt(0).toUpperCase() + scan.status.slice(1)}
                                </div>
                                <div>
                                  <div className="font-medium text-gray-900 truncate max-w-md">
                                    {scan.url}
                                  </div>
                                  <div className="text-sm text-gray-500">
                                    {new Date(scan.createdAt).toLocaleDateString()} • 
                                    {formatScanType(scan.scanType)} • 
                                    {scan.pagesScanned} pages
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-center space-x-4">
                                {scan.status === 'completed' && (
                                  <>
                                    <div className="text-right">
                                      <div className="font-semibold text-gray-900">
                                        {scan.score}/100
                                      </div>
                                      <div className="text-sm text-gray-500">
                                        {scan.issuesFound} issues
                                      </div>
                                    </div>
                                    <div className="w-16" aria-hidden="true">
                                      <ProgressRing
                                        progress={scan.score}
                                        size={48}
                                        strokeWidth={4}
                                        showLabel={false}
                                        colorClass={scoreColor}
                                      />
                                    </div>
                                  </>
                                )}
                                
                                <div className="flex space-x-2 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">
                                  {scan.status === 'failed' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRetryScan(scan.id);
                                      }}
                                      aria-label={`Retry failed scan of ${scan.url}`}
                                    >
                                      Retry
                                    </Button>
                                  )}
                                  
                                  {scan.status === 'completed' && (
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleViewReport(scan.id);
                                      }}
                                      aria-label={`View report for scan of ${scan.url}`}
                                    >
                                      View Report
                                    </Button>
                                  )}
                                  
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteScan(scan.id, e);
                                    }}
                                    aria-label={`Delete scan of ${scan.url}`}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Right Column - Statistics & Quick Actions */}
            <div className="space-y-8">
              {/* Scan Tips */}
              <aside 
                className="bg-blue-50 rounded-xl border border-blue-200 p-6"
                role="complementary"
                aria-labelledby="scan-tips-title"
              >
                <h3 id="scan-tips-title" className="font-semibold text-blue-800 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  💡 Tips for Better Scans
                </h3>
                
                <ul className="space-y-3" role="list">
                  <li className="flex items-start gap-3" role="listitem">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 text-sm font-medium">1</span>
                    </div>
                    <span className="text-sm text-blue-700">
                      <strong>Full Scan</strong> for comprehensive analysis including performance and accessibility
                    </span>
                  </li>
                  
                  <li className="flex items-start gap-3" role="listitem">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 text-sm font-medium">2</span>
                    </div>
                    <span className="text-sm text-blue-700">
                      <strong>Limit subpages to 10-20</strong> for quick results unless doing deep analysis
                    </span>
                  </li>
                  
                  <li className="flex items-start gap-3" role="listitem">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 text-sm font-medium">3</span>
                    </div>
                    <span className="text-sm text-blue-700">
                      <strong>Run scans during off-peak hours</strong> for better performance
                    </span>
                  </li>
                  
                  <li className="flex items-start gap-3" role="listitem">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 text-sm font-medium">4</span>
                    </div>
                    <span className="text-sm text-blue-700">
                      <strong>Check robots.txt</strong> if scan fails to access pages
                    </span>
                  </li>
                  
                  <li className="flex items-start gap-3" role="listitem">
                    <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-blue-600 text-sm font-medium">5</span>
                    </div>
                    <span className="text-sm text-blue-700">
                      <strong>Use Quick Scan</strong> for regular monitoring and Full Scan for monthly audits
                    </span>
                  </li>
                </ul>
              </aside>

              {/* Quick Actions */}
              <nav 
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6"
                aria-labelledby="quick-actions-title"
              >
                <h2 id="quick-actions-title" className="text-xl font-semibold text-gray-800 mb-6">
                  Quick Actions
                </h2>
                
                <div className="space-y-3" role="menu">
                  <Button
                    variant="outline"
                    fullWidth
                    onClick={() => navigate('/dashboard')}
                    className="justify-between"
                    role="menuitem"
                    aria-label="Navigate to dashboard"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      View Dashboard
                    </span>
                    <span className="text-gray-400" aria-hidden="true">→</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    fullWidth
                    onClick={() => navigate('/reports')}
                    className="justify-between"
                    role="menuitem"
                    aria-label="Navigate to reports"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Generate Report
                    </span>
                    <span className="text-gray-400" aria-hidden="true">→</span>
                  </Button>
                  
                  <Button
                    variant="outline"
                    fullWidth
                    onClick={() => navigate('/settings/scanner')}
                    className="justify-between"
                    role="menuitem"
                    aria-label="Navigate to scanner settings"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Scanner Settings
                    </span>
                    <span className="text-gray-400" aria-hidden="true">→</span>
                  </Button>
                  
                  {currentScan && (
                    <Button
                      variant="danger"
                      fullWidth
                      onClick={handleStopScan}
                      disabled={!isScanning}
                      className="justify-between"
                      role="menuitem"
                      aria-label="Stop current scan"
                    >
                      <span className="flex items-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                        </svg>
                        Stop Current Scan
                      </span>
                    </Button>
                  )}
                  
                  <Button
                    variant="outline"
                    fullWidth
                    onClick={() => handleBulkScan(quickScanUrls.slice(0, 3))}
                    disabled={!isAuthenticated || quickScanUrls.length === 0}
                    className="justify-between"
                    role="menuitem"
                    aria-label="Start quick bulk scan"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Quick Bulk Scan
                    </span>
                  </Button>
                </div>
              </nav>

              {/* Error Display */}
              {scanError && (
                <div 
                  className="bg-red-50 rounded-xl border border-red-200 p-6"
                  role="alert"
                  aria-live="assertive"
                >
                  <h3 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    Scan Error
                  </h3>
                  <p className="text-sm text-red-700 mb-4">{scanError.message}</p>
                  <div className="flex space-x-3">
                    {currentScan?.id && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => retryScanner(currentScan.id!)}
                        aria-label="Retry failed scan"
                      >
                        Retry Scan
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearScannerResults}
                      aria-label="Dismiss error"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              {/* Scan Limits */}
              {user && (
                <div 
                  className="bg-yellow-50 rounded-xl border border-yellow-200 p-6"
                  role="status"
                  aria-label="Scan usage information"
                >
                  <h3 className="font-semibold text-yellow-800 mb-2">Scan Limits</h3>
                  <p className="text-sm text-yellow-700 mb-4">
                    You have used <strong>{user.scansUsed}</strong> of <strong>{user.scanLimit}</strong> monthly scans
                  </p>
                  <div 
                    className="w-full bg-yellow-100 rounded-full h-2 mb-4"
                    role="progressbar"
                    aria-valuenow={(user.scansUsed / user.scanLimit) * 100}
                    aria-valuemin="0"
                    aria-valuemax="100"
                  >
                    <div 
                      className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${Math.min((user.scansUsed / user.scanLimit) * 100, 100)}%` 
                      }}
                    ></div>
                  </div>
                  {user.scansUsed >= user.scanLimit * 0.8 && (
                    <Button
                      variant="warning"
                      fullWidth
                      onClick={() => navigate('/settings/billing')}
                      aria-label="Upgrade plan for more scans"
                    >
                      Upgrade Plan
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default function ScanWithErrorBoundary() {
  return (
    <ErrorBoundary componentName="Scan">
      <Suspense fallback={
        <MainLayout>
          <div className="min-h-screen bg-gray-50 flex items-center justify-center">
            <LoadingSkeleton height="100vh" width="100%" />
          </div>
        </MainLayout>
      }>
        <Scan />
      </Suspense>
    </ErrorBoundary>
  );
}

// Infrastructure configuration constants
export const SCAN_CONFIG = {
  // Security headers
  SECURITY_HEADERS: {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.example.com;",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  },
  
  // Rate limiting configuration
  RATE_LIMITING: {
    MAX_REQUESTS_PER_MINUTE: 60,
    MAX_REQUESTS_PER_HOUR: 1000,
    BURST_LIMIT: 10,
    WINDOW_MS: 60000,
  },
  
  // Performance configuration
  PERFORMANCE: {
    CACHE_TTL: 300000, // 5 minutes
    DEBOUNCE_DELAY: 300,
    THROTTLE_DELAY: 1000,
    MAX_CONCURRENT_REQUESTS: 5,
    TIMEOUT: 30000,
  },
  
  // Monitoring configuration
  MONITORING: {
    SENTRY_DSN: process.env.REACT_APP_SENTRY_DSN,
    LOG_LEVEL: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    METRICS_SAMPLE_RATE: 0.1,
    ERROR_SAMPLE_RATE: 1.0,
  },
  
  // Infrastructure URLs (would be in environment variables)
  API_ENDPOINTS: {
    SCANNER: process.env.REACT_APP_SCANNER_API || 'https://api.example.com/scanner',
    REPORTS: process.env.REACT_APP_REPORTS_API || 'https://api.example.com/reports',
    AUTH: process.env.REACT_APP_AUTH_API || 'https://api.example.com/auth',
    MONITORING: process.env.REACT_APP_MONITORING_API || 'https://api.example.com/monitoring',
  },
};

// Helper function to get client IP
async function getClientIp(): Promise<string> {
  try {
    const response = await fetch('https://api.ipify.org?format=json', {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return data.ip || 'unknown';
  } catch {
    return 'unknown';
  }
}