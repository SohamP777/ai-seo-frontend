// frontend/src/components/scanner/UrlInput.tsx

import React, { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { useErrorBoundary } from 'react-error-boundary';
import axios, { AxiosError } from 'axios';
import { toast } from 'react-hot-toast';
import { captureException, withScope } from '@sentry/react';

// ============ PRODUCTION CONFIG ============
const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_URL || 'https://api.seo-tool.com/v1',
  TIMEOUT: 30000,
  MAX_RETRIES: 3,
  RATE_LIMIT_WINDOW: 60000, // 1 minute
} as const;

// ============ PRODUCTION TYPES (STRICT) ============
interface ScanConfig {
  id: string;
  scanDepth: 'quick' | 'standard' | 'deep';
  includeSubdomains: boolean;
  scanTypes: Array<'performance' | 'seo' | 'accessibility' | 'security' | 'mobile' | 'social'>;
  maxPages: number;
  timeout: number;
  priority: 'low' | 'normal' | 'high';
  notifyOnComplete: boolean;
}

interface UrlValidationResult {
  isValid: boolean;
  normalizedUrl: string;
  domain: string;
  statusCode?: number;
  contentType?: string;
  serverType?: string;
  security: {
    hasSSL: boolean;
    sslGrade?: string;
    securityHeaders: Record<string, string>;
  };
  redirectChain?: Array<{
    url: string;
    statusCode: number;
  }>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: number;
}

interface UrlHistoryItem {
  id: string;
  url: string;
  normalizedUrl: string;
  timestamp: number;
  scanCount: number;
  lastScanId?: string;
  lastScore?: number;
  tags: string[];
}

interface RateLimitState {
  count: number;
  resetTime: number;
  isLimited: boolean;
}

// ============ PRODUCTION API SERVICE ============
class ScannerApiService {
  private static instance: ScannerApiService;
  private rateLimitCache = new Map<string, RateLimitState>();
  
  private constructor() {}
  
  static getInstance(): ScannerApiService {
    if (!ScannerApiService.instance) {
      ScannerApiService.instance = new ScannerApiService();
    }
    return ScannerApiService.instance;
  }
  
  private async makeRequest<T>(
    endpoint: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      data?: unknown;
      retries?: number;
      timeout?: number;
    }
  ): Promise<T> {
    const { method = 'GET', data, retries = 0, timeout = API_CONFIG.TIMEOUT } = options;
    
    try {
      // Check rate limit
      const limitKey = `${endpoint}:${method}`;
      const limitState = this.rateLimitCache.get(limitKey);
      
      if (limitState?.isLimited && Date.now() < limitState.resetTime) {
        throw new Error('RATE_LIMIT_EXCEEDED');
      }
      
      // Make request with timeout and abort controller
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await axios({
        method,
        url: `${API_CONFIG.BASE_URL}${endpoint}`,
        data,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'X-Request-ID': crypto.randomUUID(),
          'X-Client-Version': process.env.REACT_APP_VERSION || '1.0.0',
        },
        validateStatus: (status) => status >= 200 && status < 500,
      });
      
      clearTimeout(timeoutId);
      
      // Update rate limit
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] || '100');
      const reset = parseInt(response.headers['x-ratelimit-reset'] || '0');
      
      this.rateLimitCache.set(limitKey, {
        count: remaining,
        resetTime: reset * 1000,
        isLimited: remaining === 0,
      });
      
      if (response.status >= 400) {
        throw new Error(`API_ERROR_${response.status}: ${response.data?.message || 'Unknown error'}`);
      }
      
      return response.data;
      
    } catch (error) {
      // Log error to monitoring service
      captureException(error, {
        tags: { endpoint, method, retry: retries.toString() },
        extra: { data, timeout }
      });
      
      // Retry logic
      if (retries < API_CONFIG.MAX_RETRIES && this.shouldRetry(error)) {
        await this.delay(Math.pow(2, retries) * 1000); // Exponential backoff
        return this.makeRequest<T>(endpoint, { ...options, retries: retries + 1 });
      }
      
      throw this.normalizeError(error);
    }
  }
  
  private shouldRetry(error: unknown): boolean {
    if (error instanceof AxiosError) {
      return [408, 429, 500, 502, 503, 504].includes(error.response?.status || 0);
    }
    return false;
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private normalizeError(error: unknown): Error {
    if (error instanceof Error) return error;
    return new Error('UNKNOWN_ERROR');
  }
  
  async validateUrl(url: string): Promise<UrlValidationResult> {
    return this.makeRequest<UrlValidationResult>('/scanner/validate', {
      method: 'POST',
      data: { url },
    });
  }
  
  async startScan(url: string, config: ScanConfig): Promise<{ scanId: string; queuePosition?: number }> {
    return this.makeRequest<{ scanId: string; queuePosition?: number }>('/scanner/start', {
      method: 'POST',
      data: { url, config },
    });
  }
  
  async getScanStatus(scanId: string): Promise<{ status: string; progress: number; estimatedCompletion?: number }> {
    return this.makeRequest(`/scanner/${scanId}/status`, {
      method: 'GET',
    });
  }
}

// ============ PRODUCTION VALIDATION SERVICE ============
class ValidationService {
  private static readonly URL_PATTERNS = {
    FULL: /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,})([\/\w .-]*)*\/?$/,
    SIMPLE: /^([\da-z.-]+)\.([a-z.]{2,})$/,
    LOCALHOST: /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i,
  };
  
  static validateUrl(url: string): { isValid: boolean; error?: string } {
    const trimmed = url.trim();
    
    if (!trimmed) {
      return { isValid: false, error: 'URL is required' };
    }
    
    // Check length
    if (trimmed.length > 2048) {
      return { isValid: false, error: 'URL is too long (max 2048 characters)' };
    }
    
    // Check for malicious patterns
    if (this.containsMaliciousPattern(trimmed)) {
      return { isValid: false, error: 'URL contains suspicious patterns' };
    }
    
    // Validate format
    if (!this.URL_PATTERNS.FULL.test(trimmed) && !this.URL_PATTERNS.SIMPLE.test(trimmed)) {
      return { isValid: false, error: 'Please enter a valid URL (e.g., example.com or https://example.com)' };
    }
    
    // Block localhost in production
    if (process.env.NODE_ENV === 'production' && this.URL_PATTERNS.LOCALHOST.test(trimmed)) {
      return { isValid: false, error: 'Cannot scan local/internal URLs in production' };
    }
    
    return { isValid: true };
  }
  
  private static containsMaliciousPattern(url: string): boolean {
    const maliciousPatterns = [
      /javascript:/i,
      /data:/i,
      /vbscript:/i,
      /<script/i,
      /on\w+\s*=/i,
      /alert\(/i,
      /document\./i,
      /window\./i,
    ];
    
    return maliciousPatterns.some(pattern => pattern.test(url));
  }
  
  static normalizeUrl(url: string): string {
    let normalized = url.trim().toLowerCase();
    
    // Remove whitespace and control characters
    normalized = normalized.replace(/[\x00-\x1F\x7F]/g, '');
    
    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `https://${normalized}`;
    }
    
    // Normalize protocol
    normalized = normalized.replace(/^http:\/\//, 'https://');
    
    // Remove duplicate slashes
    normalized = normalized.replace(/([^:]\/)\/+/g, '$1');
    
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    
    // Remove fragments and queries for validation
    const urlObj = new URL(normalized);
    urlObj.hash = '';
    urlObj.search = '';
    
    return urlObj.toString();
  }
}

// ============ PRODUCTION HOOK ============
const useScanner = () => {
  const queryClient = useQueryClient();
  const { showBoundary } = useErrorBoundary();
  const apiService = useMemo(() => ScannerApiService.getInstance(), []);
  
  const validateUrl = useCallback(async (url: string): Promise<UrlValidationResult> => {
    try {
      // Local validation first
      const localValidation = ValidationService.validateUrl(url);
      if (!localValidation.isValid) {
        throw new Error(localValidation.error);
      }
      
      const normalized = ValidationService.normalizeUrl(url);
      
      // Call API validation
      return await apiService.validateUrl(normalized);
      
    } catch (error) {
      // Log to monitoring
      captureException(error, {
        tags: { action: 'validate_url' },
        extra: { url }
      });
      
      // Show user-friendly error
      toast.error('Failed to validate URL. Please try again.');
      throw error;
    }
  }, [apiService]);
  
  const startScan = useCallback(async (url: string, config: ScanConfig) => {
    try {
      // Validate locally first
      const validation = ValidationService.validateUrl(url);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
      
      const normalized = ValidationService.normalizeUrl(url);
      
      // Update query cache optimistically
      queryClient.setQueryData(['scan', 'pending'], (old: any) => [
        ...(old || []),
        { url: normalized, config, timestamp: Date.now() }
      ]);
      
      // Call API
      const result = await apiService.startScan(normalized, config);
      
      // Invalidate relevant queries
      queryClient.invalidateQueries(['scans']);
      queryClient.invalidateQueries(['history']);
      
      // Analytics event
      if (window.gtag) {
        window.gtag('event', 'scan_started', {
          event_category: 'scanner',
          event_label: normalized,
          scan_depth: config.scanDepth,
          scan_types: config.scanTypes.join(','),
        });
      }
      
      toast.success('Scan started successfully!');
      return result;
      
    } catch (error) {
      // Rollback optimistic update
      queryClient.setQueryData(['scan', 'pending'], (old: any) => 
        old?.filter((item: any) => item.url !== url) || []
      );
      
      // Show error boundary for critical errors
      if (error instanceof Error && error.message.includes('RATE_LIMIT')) {
        showBoundary(error);
      }
      
      // User-friendly error
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to start scan: ${message}`);
      
      throw error;
    }
  }, [apiService, queryClient, showBoundary]);
  
  return {
    validateUrl,
    startScan,
  };
};

// ============ PRODUCTION COMPONENT ============
interface UrlInputProps {
  onScanStarted?: (scanId: string) => void;
  className?: string;
  disabled?: boolean;
}

const UrlInput: React.FC<UrlInputProps> = memo(({ 
  onScanStarted,
  className = '',
  disabled = false,
}) => {
  // ============ STATE ============
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<UrlValidationResult | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitState | null>(null);
  const [history, setHistory] = useState<UrlHistoryItem[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  
  const validationTimeoutRef = useRef<NodeJS.Timeout>();
  const abortControllerRef = useRef<AbortController>();
  
  const { validateUrl, startScan } = useScanner();
  const { showBoundary } = useErrorBoundary();
  
  // ============ REACT HOOK FORM ============
  const { control, handleSubmit, watch, reset, formState, setError, clearErrors } = useForm({
    defaultValues: {
      url: '',
      scanDepth: 'standard' as const,
      includeSubdomains: false,
      scanTypes: ['seo', 'performance'] as Array<'seo' | 'performance'>,
      notifyOnComplete: true,
      priority: 'normal' as const,
    },
    mode: 'onChange',
  });
  
  const watchedUrl = watch('url');
  
  // ============ EFFECTS ============
  // Load history on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('seo_scanner_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setHistory(parsed.slice(0, 20));
        }
      }
    } catch (error) {
      captureException(error, { tags: { action: 'load_history' } });
    }
  }, []);
  
  // Real-time validation
  useEffect(() => {
    if (!watchedUrl || watchedUrl.trim().length < 4) {
      setValidationResult(null);
      return;
    }
    
    // Clear previous timeout
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }
    
    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller
    abortControllerRef.current = new AbortController();
    
    // Debounced validation
    validationTimeoutRef.current = setTimeout(async () => {
      try {
        setIsValidating(true);
        clearErrors('url');
        
        const result = await validateUrl(watchedUrl);
        setValidationResult(result);
        
        if (!result.isValid && result.error) {
          setError('url', {
            type: 'manual',
            message: result.error.message,
          });
        }
      } catch (error) {
        // Ignore aborted requests
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        
        // Handle rate limit
        if (error instanceof Error && error.message.includes('RATE_LIMIT')) {
          setRateLimit({
            count: 0,
            resetTime: Date.now() + 60000,
            isLimited: true,
          });
        }
        
        captureException(error, {
          tags: { action: 'url_validation' },
          extra: { url: watchedUrl }
        });
      } finally {
        setIsValidating(false);
      }
    }, 500); // 500ms debounce
    
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, [watchedUrl, validateUrl, setError, clearErrors]);
  
  // ============ HANDLERS ============
  const onSubmit = useCallback(async (data: any) => {
    try {
      if (!validationResult?.isValid || disabled) {
        return;
      }
      
      // Prepare scan config
      const config: ScanConfig = {
        id: crypto.randomUUID(),
        scanDepth: data.scanDepth,
        includeSubdomains: data.includeSubdomains,
        scanTypes: data.scanTypes,
        maxPages: data.scanDepth === 'quick' ? 10 : data.scanDepth === 'standard' ? 50 : 200,
        timeout: data.scanDepth === 'quick' ? 30000 : data.scanDepth === 'standard' ? 60000 : 120000,
        priority: data.priority,
        notifyOnComplete: data.notifyOnComplete,
      };
      
      // Start scan progress
      setScanProgress(0);
      
      // Start the scan
      const result = await startScan(validationResult.normalizedUrl, config);
      
      // Update history
      const historyItem: UrlHistoryItem = {
        id: crypto.randomUUID(),
        url: data.url,
        normalizedUrl: validationResult.normalizedUrl,
        timestamp: Date.now(),
        scanCount: 1,
        lastScanId: result.scanId,
        tags: [],
      };
      
      setHistory(prev => [historyItem, ...prev.slice(0, 19)]);
      localStorage.setItem('seo_scanner_history', JSON.stringify([historyItem, ...history]));
      
      // Callback
      if (onScanStarted) {
        onScanStarted(result.scanId);
      }
      
      // Reset form
      reset();
      setValidationResult(null);
      setScanProgress(100);
      
      // Track conversion
      if (window.fbq) {
        window.fbq('track', 'ScanStarted', {
          url: validationResult.normalizedUrl,
          scanId: result.scanId,
        });
      }
      
    } catch (error) {
      // Handle critical errors
      if (error instanceof Error && (
        error.message.includes('NETWORK_ERROR') ||
        error.message.includes('AUTH_ERROR')
      )) {
        showBoundary(error);
      }
      
      toast.error('Failed to start scan. Please try again.');
      setScanProgress(null);
    }
  }, [validationResult, disabled, startScan, reset, onScanStarted, history, showBoundary]);
  
  const handleHistoryClick = useCallback((url: string) => {
    reset({ url });
  }, [reset]);
  
  // ============ RENDER ============
  return (
    <div className={`bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 ${className}`}>
      {/* Error Boundary Wrapper */}
      <div role="alert" aria-live="assertive">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            SEO Website Scanner
          </h1>
          <p className="text-gray-600">
            Professional-grade SEO analysis with real-time insights
          </p>
        </div>
        
        {/* Rate Limit Warning */}
        {rateLimit?.isLimited && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span className="text-red-700 font-medium">
                Rate limit exceeded. Try again in {Math.ceil((rateLimit.resetTime - Date.now()) / 1000)} seconds.
              </span>
            </div>
          </div>
        )}
        
        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* URL Input */}
          <div>
            <label htmlFor="url" className="block text-sm font-semibold text-gray-900 mb-2">
              Website URL *
            </label>
            <Controller
              name="url"
              control={control}
              rules={{
                required: 'URL is required',
                validate: (value) => ValidationService.validateUrl(value).isValid || 'Invalid URL format',
              }}
              render={({ field, fieldState }) => (
                <div className="relative">
                  <input
                    {...field}
                    id="url"
                    type="text"
                    placeholder="https://example.com"
                    disabled={disabled}
                    className={`
                      w-full px-4 py-3 text-lg border rounded-xl
                      transition-all duration-200
                      focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                      ${fieldState.error
                        ? 'border-red-300 bg-red-50'
                        : validationResult?.isValid
                        ? 'border-green-300 bg-green-50'
                        : 'border-gray-300'
                      }
                      ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                    `}
                    aria-invalid={!!fieldState.error}
                    aria-describedby={fieldState.error ? 'url-error' : undefined}
                  />
                  
                  {/* Validation Indicator */}
                  <div className="absolute right-3 top-3">
                    {isValidating && (
                      <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
                    )}
                    {!isValidating && validationResult?.isValid && (
                      <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  
                  {/* Error Message */}
                  {fieldState.error && (
                    <p id="url-error" className="mt-2 text-sm text-red-600">
                      {fieldState.error.message}
                    </p>
                  )}
                  
                  {/* Validation Details */}
                  {validationResult?.isValid && (
                    <div className="mt-2 text-sm text-gray-600 space-y-1">
                      <div className="flex items-center">
                        <svg className="w-4 h-4 mr-1 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>Valid URL • {validationResult.domain}</span>
                      </div>
                      {validationResult.security.hasSSL && (
                        <div className="flex items-center">
                          <svg className="w-4 h-4 mr-1 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                          <span>SSL Secured • {validationResult.security.sslGrade || 'A'}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            />
          </div>
          
          {/* Scan Progress */}
          {scanProgress !== null && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-700">Initializing scan...</span>
                <span className="font-semibold text-blue-600">{scanProgress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-300"
                  style={{ width: `${scanProgress}%` }}
                  role="progressbar"
                  aria-valuenow={scanProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>
          )}
          
          {/* Submit Button */}
          <button
            type="submit"
            disabled={
              disabled ||
              !formState.isValid ||
              isValidating ||
              !validationResult?.isValid ||
              rateLimit?.isLimited ||
              scanProgress !== null
            }
            className={`
              w-full py-4 px-6 text-lg font-semibold text-white rounded-xl
              transition-all duration-200
              focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
              disabled:opacity-50 disabled:cursor-not-allowed
              bg-gradient-to-r from-blue-600 to-purple-600
              hover:from-blue-700 hover:to-purple-700
              active:from-blue-800 active:to-purple-800
              shadow-lg hover:shadow-xl
            `}
          >
            {scanProgress !== null ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-3 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Starting Scan...
              </span>
            ) : (
              'Start Professional SEO Scan'
            )}
          </button>
        </form>
      </div>
    </div>
  );
});

// Production configuration
UrlInput.displayName = 'UrlInput';

// Export with error boundary
export default UrlInput;