// File: frontend/src/components/fixer/AutoFixToggle.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '../../store/useStore';
import { useAutoFix } from '../../hooks/useAutoFix';
import { useToast } from '../../hooks/useToast';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useDebounce } from '../../hooks/useDebounce';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Skeleton } from '../ui/Skeleton';
import { cn } from '../../utils/cn';
import { API_CONFIG, APP_CONFIG } from '../../utils/constants';
import { 
  FixSetting, 
  SeverityLevel, 
  FixCategory, 
  AutoFixConfig,
  Website 
} from '../../types/seo';
import { logger } from '../../utils/logger';
import { performanceMonitor } from '../../utils/performance';
import { withProfiler } from '../../utils/profiler';

interface AutoFixToggleProps {
  scanId?: string;
  websiteId: string;
  initialEnabled?: boolean;
  onToggleChange?: (enabled: boolean) => void;
  showLabel?: boolean;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'minimal' | 'detailed';
  theme?: 'light' | 'dark';
}

interface FetchSettingsResponse {
  success: boolean;
  data?: {
    settings: FixSetting[];
    enabled: boolean;
    lastModified: string;
    requiresApproval: boolean;
    version: string;
    limits?: {
      maxAutoFixesPerDay: number;
      remainingFixes: number;
      resetTime: string;
    };
    compliance?: {
      gdpr: boolean;
      ccpa: boolean;
      hipaa: boolean;
    };
  };
  error?: string;
  code?: string;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

// Performance: Memoized constants outside component
const SEVERITY_CONFIG: Record<SeverityLevel, {
  bg: string;
  text: string;
  border: string;
  icon: string;
  priority: number;
}> = {
  critical: { 
    bg: 'bg-red-100 dark:bg-red-900/30', 
    text: 'text-red-800 dark:text-red-200', 
    border: 'border-red-200 dark:border-red-800',
    icon: '🔴',
    priority: 0
  },
  high: { 
    bg: 'bg-orange-100 dark:bg-orange-900/30', 
    text: 'text-orange-800 dark:text-orange-200', 
    border: 'border-orange-200 dark:border-orange-800',
    icon: '🟠',
    priority: 1
  },
  medium: { 
    bg: 'bg-yellow-100 dark:bg-yellow-900/30', 
    text: 'text-yellow-800 dark:text-yellow-200', 
    border: 'border-yellow-200 dark:border-yellow-800',
    icon: '🟡',
    priority: 2
  },
  low: { 
    bg: 'bg-green-100 dark:bg-green-900/30', 
    text: 'text-green-800 dark:text-green-200', 
    border: 'border-green-200 dark:border-green-800',
    icon: '🟢',
    priority: 3
  },
};

const CATEGORY_CONFIG: Record<FixCategory, {
  border: string;
  bg: string;
  icon: string;
  name: string;
  descriptionKey: string;
}> = {
  technical: { 
    border: 'border-l-blue-500 dark:border-l-blue-400', 
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    icon: '🔧',
    name: 'technical',
    descriptionKey: 'category.technical.description'
  },
  content: { 
    border: 'border-l-purple-500 dark:border-l-purple-400', 
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    icon: '📝',
    name: 'content',
    descriptionKey: 'category.content.description'
  },
  performance: { 
    border: 'border-l-green-500 dark:border-l-green-400', 
    bg: 'bg-green-50 dark:bg-green-900/20',
    icon: '⚡',
    name: 'performance',
    descriptionKey: 'category.performance.description'
  },
  security: { 
    border: 'border-l-red-500 dark:border-l-red-400', 
    bg: 'bg-red-50 dark:bg-red-900/20',
    icon: '🔒',
    name: 'security',
    descriptionKey: 'category.security.description'
  },
  accessibility: {
    border: 'border-l-indigo-500 dark:border-l-indigo-400',
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    icon: '♿',
    name: 'accessibility',
    descriptionKey: 'category.accessibility.description'
  },
  'meta-tags': {
    border: 'border-l-cyan-500 dark:border-l-cyan-400',
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    icon: '🏷️',
    name: 'metaTags',
    descriptionKey: 'category.metaTags.description'
  }
};

// API Service with comprehensive error handling
class AutoFixApiService {
  private static async fetchWithRetry(
    url: string, 
    options: RequestInit, 
    retries = 3
  ): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), APP_CONFIG.API_TIMEOUT);
        
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.status === 429) { // Rate limit
          const retryAfter = response.headers.get('Retry-After');
          await new Promise(resolve => 
            setTimeout(resolve, parseInt(retryAfter || '1') * 1000)
          );
          continue;
        }
        
        return response;
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error('Max retries exceeded');
  }

  static async fetchSettings(websiteId: string): Promise<FetchSettingsResponse> {
    const requestId = crypto.randomUUID();
    const startTime = performance.now();
    
    try {
      const response = await this.fetchWithRetry(
        `${API_CONFIG.BASE_URL}/v1/websites/${websiteId}/auto-fix/settings`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
            'X-Client-Version': APP_CONFIG.VERSION,
            'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          credentials: 'include',
          cache: 'no-cache',
        }
      );

      const endTime = performance.now();
      performanceMonitor.recordApiCall('fetchSettings', endTime - startTime);

      if (!response.ok) {
        const error = await this.parseError(response);
        throw error;
      }

      const data = await response.json();
      
      // Validate response schema
      if (!this.validateSettingsResponse(data)) {
        throw new Error('Invalid response schema');
      }

      return {
        success: true,
        data: {
          settings: data.settings,
          enabled: data.enabled,
          lastModified: data.lastModified,
          requiresApproval: data.requiresApproval,
          version: data.version,
          limits: data.limits,
          compliance: data.compliance,
        },
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
        }
      };
    } catch (error: any) {
      logger.error('Failed to fetch auto-fix settings', {
        websiteId,
        requestId,
        error: error.message,
        duration: performance.now() - startTime,
      });
      
      return {
        success: false,
        error: error.message || 'Failed to fetch settings',
        code: error.code || 'NETWORK_ERROR',
        meta: { requestId, timestamp: new Date().toISOString() },
      };
    }
  }

  private static async parseError(response: Response): Promise<Error> {
    const contentType = response.headers.get('content-type');
    let errorData: any;
    
    if (contentType?.includes('application/json')) {
      errorData = await response.json();
    } else {
      errorData = { message: await response.text() };
    }
    
    const error = new Error(errorData.message || `HTTP ${response.status}`);
    (error as any).code = errorData.code || `HTTP_${response.status}`;
    (error as any).retryable = response.status >= 500 || response.status === 429;
    
    return error;
  }

  private static validateSettingsResponse(data: any): boolean {
    return (
      data &&
      typeof data.enabled === 'boolean' &&
      Array.isArray(data.settings) &&
      data.settings.every((s: any) => 
        s.id && s.name && s.severity && s.category && typeof s.enabled === 'boolean'
      )
    );
  }
}

// Custom hooks for production features
const useAutoFixSettings = (websiteId: string) => {
  return useQuery({
    queryKey: ['autoFixSettings', websiteId],
    queryFn: () => AutoFixApiService.fetchSettings(websiteId),
    retry: (failureCount, error: any) => {
      return failureCount < 3 && error?.retryable !== false;
    },
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 10000),
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 30 * 1000, // 30 seconds for real-time updates
    enabled: !!websiteId,
    meta: {
      persistent: true,
    },
  });
};

const useUpdateAutoFixSettings = () => {
  const queryClient = useQueryClient();
  const { trackEvent } = useAnalytics();
  
  return useMutation({
    mutationFn: async ({ websiteId, settings }: { websiteId: string; settings: FixSetting[] }) => {
      const response = await fetch(`${API_CONFIG.BASE_URL}/v1/websites/${websiteId}/auto-fix/settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ settings }),
      });
      
      if (!response.ok) throw new Error('Failed to update settings');
      return response.json();
    },
    onMutate: async ({ websiteId, settings }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['autoFixSettings', websiteId] });
      
      // Snapshot the previous value
      const previousSettings = queryClient.getQueryData(['autoFixSettings', websiteId]);
      
      // Optimistically update to the new value
      queryClient.setQueryData(['autoFixSettings', websiteId], (old: any) => ({
        ...old,
        data: { ...old?.data, settings }
      }));
      
      return { previousSettings };
    },
    onError: (err, { websiteId }, context: any) => {
      // Rollback on error
      if (context?.previousSettings) {
        queryClient.setQueryData(['autoFixSettings', websiteId], context.previousSettings);
      }
      
      trackEvent('auto_fix_settings_update_error', {
        websiteId,
        error: err.message,
      });
    },
    onSettled: (data, error, { websiteId }) => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['autoFixSettings', websiteId] });
    },
  });
};

// Main Component with Profiler
const AutoFixToggleContent: React.FC<AutoFixToggleProps> = withProfiler(({
  scanId,
  websiteId,
  initialEnabled = false,
  onToggleChange,
  showLabel = true,
  compact = false,
  disabled = false,
  className,
  variant = 'default',
  theme = 'light',
}) => {
  // Refs
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const isMountedRef = useRef(true);
  
  // Translations
  const { t, i18n } = useTranslation(['autoFix', 'common']);
  
  // Global state
  const { user, website, updateWebsite } = useStore(state => ({
    user: state.user,
    website: state.websites.find(w => w.id === websiteId),
    updateWebsite: state.updateWebsite,
  }));
  
  // Queries
  const { 
    data: settingsResponse, 
    isLoading: isLoadingSettings,
    error: settingsError,
    refetch: refetchSettings 
  } = useAutoFixSettings(websiteId);
  
  // Mutations
  const updateSettingsMutation = useUpdateAutoFixSettings();
  const { mutateAsync: toggleAutoFix } = useMutation({
    mutationFn: async (enabled: boolean) => {
      const url = `${API_CONFIG.BASE_URL}/v1/websites/${websiteId}/auto-fix/${enabled ? 'enable' : 'disable'}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scanId }),
      });
      
      if (!response.ok) throw new Error('Failed to toggle auto-fix');
      return response.json();
    },
  });
  
  // Local state
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [localEnabled, setLocalEnabled] = useState<boolean>(initialEnabled);
  const [optimisticSettings, setOptimisticSettings] = useState<FixSetting[]>([]);
  
  // Hooks
  const { toast } = useToast();
  const { trackEvent, trackPerformance } = useAnalytics();
  const debouncedToggle = useDebounce(handleToggle, 300, { leading: true, maxWait: 1000 });
  useClickOutside(settingsPanelRef, () => setShowSettings(false), { 
    excludeRef: toggleRef 
  });
  
  // Derived data
  const settings = useMemo(() => 
    optimisticSettings.length > 0 ? optimisticSettings : settingsResponse?.data?.settings || [],
    [optimisticSettings, settingsResponse]
  );
  
  const enabled = useMemo(() => 
    localEnabled || settingsResponse?.data?.enabled || false,
    [localEnabled, settingsResponse]
  );
  
  const requiresApproval = useMemo(() => 
    settingsResponse?.data?.requiresApproval || false,
    [settingsResponse]
  );
  
  const limits = useMemo(() => 
    settingsResponse?.data?.limits,
    [settingsResponse]
  );
  
  // Component lifecycle
  useEffect(() => {
    isMountedRef.current = true;
    performanceMonitor.startMeasurement('AutoFixToggle');
    
    return () => {
      isMountedRef.current = false;
      performanceMonitor.endMeasurement('AutoFixToggle');
    };
  }, []);
  
  // Sync with API state
  useEffect(() => {
    if (settingsResponse?.data?.enabled !== undefined) {
      setLocalEnabled(settingsResponse.data.enabled);
    }
  }, [settingsResponse]);
  
  // Error handling
  useEffect(() => {
    if (settingsError && isMountedRef.current) {
      logger.error('AutoFixToggle settings error', {
        websiteId,
        error: settingsError,
      });
      
      toast.error({
        title: t('errors.settingsLoadFailed'),
        description: t('errors.checkConnection'),
        duration: 8000,
        action: {
          label: t('actions.retry'),
          onClick: () => refetchSettings(),
        },
      });
    }
  }, [settingsError, toast, t, refetchSettings, websiteId]);
  
  // Toggle handler with comprehensive business logic
  const handleToggle = useCallback(async () => {
    if (disabled || isLoadingSettings || !isMountedRef.current) {
      return;
    }
    
    const newEnabled = !enabled;
    const measurementId = `toggle_${websiteId}_${Date.now()}`;
    performanceMonitor.startMeasurement(measurementId);
    
    // Business logic validation
    if (newEnabled) {
      // Check if user has permission
      if (!user?.permissions?.includes('manage_auto_fix')) {
        toast.error({
          title: t('errors.permissionDenied'),
          description: t('errors.insufficientPermissions'),
          duration: 5000,
        });
        return;
      }
      
      // Check if website is active
      if (website?.status !== 'active') {
        toast.error({
          title: t('errors.websiteInactive'),
          description: t('errors.activateWebsiteFirst'),
          duration: 5000,
        });
        return;
      }
      
      // Check daily limits
      if (limits && limits.remainingFixes <= 0) {
        toast.error({
          title: t('errors.dailyLimitReached'),
          description: t('errors.limitReset', { time: limits.resetTime }),
          duration: 8000,
        });
        return;
      }
      
      // Check if at least one setting is enabled
      const enabledSettings = settings.filter(s => s.enabled);
      if (enabledSettings.length === 0) {
        toast.warning({
          title: t('warnings.noSettingsEnabled'),
          description: t('warnings.enableAtLeastOne'),
          duration: 5000,
          action: {
            label: t('actions.configure'),
            onClick: () => setShowSettings(true),
          },
        });
        return;
      }
      
      // Check for critical settings requiring approval
      const criticalSettings = enabledSettings.filter(s => s.severity === 'critical');
      if (criticalSettings.length > 0 && !requiresApproval) {
        const confirmed = window.confirm(
          t('confirmations.criticalFixesWarning', { count: criticalSettings.length })
        );
        if (!confirmed) return;
      }
    }
    
    // Optimistic update
    setLocalEnabled(newEnabled);
    
    // Track event
    trackEvent('auto_fix_toggled', {
      websiteId,
      fromState: enabled,
      toState: newEnabled,
      userId: user?.id,
      scanId,
      settingsCount: settings.length,
      enabledSettingsCount: settings.filter(s => s.enabled).length,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
    });
    
    try {
      // Update global state
      if (website) {
        updateWebsite(websiteId, { autoFixEnabled: newEnabled });
      }
      
      // Call API
      await toggleAutoFix(newEnabled);
      
      // Update parent
      onToggleChange?.(newEnabled);
      
      // Show success message
      toast.success({
        title: newEnabled ? t('success.autoFixEnabled') : t('success.autoFixDisabled'),
        description: newEnabled 
          ? (requiresApproval 
            ? t('success.criticalFixesRequireApproval')
            : t('success.issuesWillBeFixed')
          )
          : t('success.issuesRequireApproval'),
        duration: 4000,
      });
      
      // Track performance
      performanceMonitor.endMeasurement(measurementId);
      trackPerformance('auto_fix_toggle', performanceMonitor.getMeasurement(measurementId));
      
    } catch (error: any) {
      if (!isMountedRef.current) return;
      
      // Revert optimistic update
      setLocalEnabled(enabled);
      
      // Log error
      logger.error('Failed to toggle auto-fix', {
        websiteId,
        error: error.message,
        stack: error.stack,
      });
      
      // Show error
      toast.error({
        title: t('errors.toggleFailed'),
        description: error.message || t('errors.pleaseTryAgain'),
        duration: 6000,
        action: error.retryable ? {
          label: t('actions.retry'),
          onClick: () => handleToggle(),
        } : undefined,
      });
      
      // Track error
      trackEvent('auto_fix_toggle_error', {
        websiteId,
        error: error.message,
        errorCode: error.code,
        retryable: error.retryable,
      });
    }
  }, [
    disabled,
    isLoadingSettings,
    enabled,
    websiteId,
    user,
    website,
    limits,
    settings,
    requiresApproval,
    toggleAutoFix,
    onToggleChange,
    toast,
    trackEvent,
    updateWebsite,
    t,
  ]);
  
  // Setting toggle handler
  const handleSettingToggle = useCallback(async (settingId: string) => {
    const updatedSettings = settings.map(setting => 
      setting.id === settingId 
        ? { ...setting, enabled: !setting.enabled }
        : setting
    );
    
    // Optimistic update
    setOptimisticSettings(updatedSettings);
    
    const toggledSetting = settings.find(s => s.id === settingId);
    const isNowEnabled = !toggledSetting?.enabled;
    
    // Business logic: Check for compliance
    if (isNowEnabled && toggledSetting?.compliance?.requiresReview) {
      const confirmed = window.confirm(
        t('confirmations.complianceReviewRequired', { setting: toggledSetting.name })
      );
      if (!confirmed) {
        setOptimisticSettings(settings);
        return;
      }
    }
    
    try {
      await updateSettingsMutation.mutateAsync({ websiteId, settings: updatedSettings });
      
      // Check if auto-fix should be disabled
      const anyEnabled = updatedSettings.some(s => s.enabled);
      if (!anyEnabled && enabled) {
        await handleToggle();
      }
      
      toast.success({
        title: t('success.settingUpdated'),
        description: t('success.settingStateChanged', {
          setting: toggledSetting?.name,
          state: isNowEnabled ? t('states.enabled') : t('states.disabled'),
        }),
        duration: 3000,
      });
      
      trackEvent('auto_fix_setting_toggled', {
        settingId,
        settingName: toggledSetting?.name,
        enabled: isNowEnabled,
        websiteId,
        severity: toggledSetting?.severity,
        category: toggledSetting?.category,
        userId: user?.id,
      });
      
    } catch (error) {
      // Revert on error
      setOptimisticSettings(settings);
      
      toast.error({
        title: t('errors.settingUpdateFailed'),
        description: t('errors.changesNotSaved'),
        action: {
          label: t('actions.tryAgain'),
          onClick: () => handleSettingToggle(settingId),
        },
      });
    }
  }, [settings, websiteId, enabled, updateSettingsMutation, toast, trackEvent, user, t, handleToggle]);
  
  // Enable all settings
  const handleEnableAll = useCallback(async () => {
    const updatedSettings = settings.map(setting => ({ 
      ...setting, 
      enabled: true,
      enabledAt: new Date().toISOString(),
      enabledBy: user?.id,
    }));
    
    setOptimisticSettings(updatedSettings);
    
    try {
      await updateSettingsMutation.mutateAsync({ websiteId, settings: updatedSettings });
      
      if (!enabled) {
        await handleToggle();
      }
      
      toast.success({
        title: t('success.allSettingsEnabled'),
        description: t('success.autoFixAllIssueTypes'),
        duration: 4000,
      });
      
      trackEvent('auto_fix_all_enabled', { 
        websiteId,
        userId: user?.id,
        settingsCount: settings.length,
      });
      
    } catch (error) {
      setOptimisticSettings(settings);
      toast.error(t('errors.enableAllFailed'));
    }
  }, [settings, websiteId, enabled, updateSettingsMutation, toast, trackEvent, user, t, handleToggle]);
  
  // Disable all settings
  const handleDisableAll = useCallback(async () => {
    const updatedSettings = settings.map(setting => ({ 
      ...setting, 
      enabled: false,
      disabledAt: new Date().toISOString(),
      disabledBy: user?.id,
    }));
    
    setOptimisticSettings(updatedSettings);
    
    try {
      await updateSettingsMutation.mutateAsync({ websiteId, settings: updatedSettings });
      
      if (enabled) {
        await handleToggle();
      }
      
      toast.success({
        title: t('success.allSettingsDisabled'),
        description: t('success.autoFixTurnedOff'),
        duration: 4000,
      });
      
      trackEvent('auto_fix_all_disabled', { 
        websiteId,
        userId: user?.id,
        settingsCount: settings.length,
      });
      
    } catch (error) {
      setOptimisticSettings(settings);
      toast.error(t('errors.disableAllFailed'));
    }
  }, [settings, websiteId, enabled, updateSettingsMutation, toast, trackEvent, user, t, handleToggle]);
  
  // Memoized computed values with business logic
  const enabledSettingsCount = useMemo(() => 
    settings.filter(s => s.enabled).length,
  [settings]);
  
  const criticalSettingsEnabled = useMemo(() =>
    settings.filter(s => s.enabled && s.severity === 'critical').length > 0,
  [settings]);
  
  const settingsByCategory = useMemo(() => 
    settings.reduce((acc, setting) => {
      if (!acc[setting.category]) acc[setting.category] = [];
      acc[setting.category].push(setting);
      return acc;
    }, {} as Record<FixCategory, FixSetting[]>),
  [settings]);
  
  const toggleLabel = useMemo(() => {
    if (isLoadingSettings) return t('labels.loading');
    if (!settings.length) return t('labels.autoFix');
    
    if (enabled) {
      if (variant === 'detailed') {
        return t('labels.autoFixWithCount', { 
          count: enabledSettingsCount, 
          total: settings.length 
        });
      }
      return t('labels.autoFixEnabled');
    }
    return t('labels.autoFixDisabled');
  }, [isLoadingSettings, settings.length, enabled, enabledSettingsCount, variant, t]);
  
  const toggleDescription = useMemo(() => {
    if (isLoadingSettings) return t('descriptions.loadingSettings');
    if (!settings.length) return t('descriptions.noSettingsAvailable');
    
    if (enabled) {
      if (requiresApproval && criticalSettingsEnabled) {
        return t('descriptions.criticalFixesRequireApproval');
      }
      if (limits && limits.remainingFixes < 5) {
        return t('descriptions.lowRemainingFixes', { 
          remaining: limits.remainingFixes 
        });
      }
      return t('descriptions.issuesBeingFixed');
    }
    return t('descriptions.issuesRequireApproval');
  }, [isLoadingSettings, settings.length, enabled, requiresApproval, criticalSettingsEnabled, limits, t]);
  
  // Loading state
  if (isLoadingSettings && !settingsResponse) {
    return (
      <div 
        className={cn(
          "flex items-center space-x-3", 
          theme === 'dark' && "text-gray-300",
          className
        )} 
        data-testid="auto-fix-toggle-loading"
      >
        <Skeleton className="w-11 h-6 rounded-full" />
        {showLabel && (
          <div className="space-y-1">
            <Skeleton className="w-24 h-4" />
            <Skeleton className="w-32 h-3" />
          </div>
        )}
      </div>
    );
  }
  
  // Error state
  if (settingsError && !isLoadingSettings) {
    return (
      <div 
        className={cn("flex items-center space-x-2", className)} 
        data-testid="auto-fix-toggle-error"
      >
        <button
          onClick={() => refetchSettings()}
          className={cn(
            "px-3 py-1.5 text-sm font-medium rounded-lg",
            "bg-red-600 text-white hover:bg-red-700",
            "focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2",
            "transition-colors dark:bg-red-700 dark:hover:bg-red-800"
          )}
          aria-label={t('actions.retry')}
        >
          {t('actions.retry')}
        </button>
        {showLabel && (
          <span className={cn(
            "text-sm",
            theme === 'dark' ? "text-red-300" : "text-red-600"
          )}>
            {t('errors.failedToLoad')}
          </span>
        )}
      </div>
    );
  }
  
  // No settings available
  if (!settings.length && !isLoadingSettings && !settingsError) {
    return (
      <div 
        className={cn("flex items-center space-x-2", className)} 
        data-testid="auto-fix-toggle-empty"
      >
        <div className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full",
          theme === 'dark' ? "bg-gray-700" : "bg-gray-200"
        )}>
          <span className={cn(
            "inline-block h-4 w-4 transform rounded-full",
            theme === 'dark' ? "bg-gray-600" : "bg-white",
            "translate-x-1"
          )} />
        </div>
        {showLabel && (
          <span className={cn(
            "text-sm",
            theme === 'dark' ? "text-gray-400" : "text-gray-500"
          )}>
            {t('descriptions.noSettingsAvailable')}
          </span>
        )}
      </div>
    );
  }
  
  return (
    <div className={cn("relative", className)} data-testid="auto-fix-toggle">
      <div className="flex items-center space-x-3">
        {/* Toggle Switch */}
        <button
          ref={toggleRef}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? t('aria.disableAutoFix') : t('aria.enableAutoFix')}
          aria-describedby={showSettings ? 'autoFixSettingsDescription' : undefined}
          onClick={debouncedToggle}
          disabled={disabled || isLoadingSettings || !settings.length}
          data-state={enabled ? 'checked' : 'unchecked'}
          data-loading={isLoadingSettings ? 'true' : 'false'}
          data-testid="toggle-switch"
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full",
            "transition-all duration-200 ease-in-out",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-gray-300",
            "dark:data-[state=unchecked]:bg-gray-600",
            "data-[loading=true]:opacity-75 data-[loading=true]:cursor-wait",
            compact && "h-5 w-10",
            variant === 'minimal' && "h-4 w-8",
            theme === 'dark' && "focus:ring-offset-gray-800"
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 transform rounded-full bg-white transition-all duration-200 ease-in-out",
              "shadow-sm",
              "data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1",
              compact && "h-3 w-3",
              compact && "data-[state=checked]:translate-x-5",
              variant === 'minimal' && "h-2 w-2",
              variant === 'minimal' && "data-[state=checked]:translate-x-4",
              theme === 'dark' && "bg-gray-100"
            )}
            data-state={enabled ? 'checked' : 'unchecked'}
            aria-hidden="true"
          />
          {isLoadingSettings && (
            <span className="sr-only">{t('states.loading')}</span>
          )}
        </button>
        
        {/* Label and Status */}
        {showLabel && variant !== 'minimal' && (
          <div className="flex flex-col min-w-0">
            <div className="flex items-center space-x-2">
              <span className={cn(
                "text-sm font-medium truncate",
                theme === 'dark' ? "text-gray-100" : "text-gray-900"
              )}>
                {toggleLabel}
              </span>
              {enabled && variant === 'detailed' && (
                <span className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded-full",
                  theme === 'dark' 
                    ? "bg-blue-900 text-blue-200" 
                    : "bg-blue-100 text-blue-800"
                )}>
                  {enabledSettingsCount}/{settings.length}
                </span>
              )}
              {requiresApproval && criticalSettingsEnabled && enabled && (
                <span className={cn(
                  "px-2 py-0.5 text-xs font-medium rounded-full",
                  theme === 'dark'
                    ? "bg-yellow-900 text-yellow-200"
                    : "bg-yellow-100 text-yellow-800"
                )}>
                  {t('states.needsApproval')}
                </span>
              )}
            </div>
            <span className={cn(
              "text-xs truncate",
              theme === 'dark' ? "text-gray-400" : "text-gray-500"
            )}>
              {toggleDescription}
            </span>
            {variant === 'detailed' && settingsResponse?.data?.lastModified && (
              <span className={cn(
                "text-xs mt-1",
                theme === 'dark' ? "text-gray-500" : "text-gray-400"
              )}>
                {t('labels.lastUpdated')} {new Date(settingsResponse.data.lastModified).toLocaleDateString(i18n.language)}
              </span>
            )}
          </div>
        )}
        
        {/* Settings Button */}
        {!compact && !disabled && settings.length > 0 && variant !== 'minimal' && (
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            disabled={isLoadingSettings}
            aria-expanded={showSettings}
            aria-controls="autoFixSettingsPanel"
            aria-label={t('aria.configureSettings')}
            data-testid="settings-button"
            className={cn(
              "ml-2 p-1.5 rounded-lg transition-all",
              "focus:outline-none focus:ring-2 focus:ring-blue-500",
              "disabled:opacity-50",
              theme === 'dark'
                ? "text-gray-400 hover:text-gray-200 hover:bg-gray-700 focus:ring-offset-gray-800"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 focus:ring-offset-white",
              showSettings && (theme === 'dark' ? "text-blue-400 bg-gray-700" : "text-blue-600 bg-blue-50")
            )}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        )}
        
        {/* Loading Indicator */}
        {isLoadingSettings && (
          <div className="ml-1" aria-live="polite" aria-busy="true">
            <svg
              className="animate-spin h-4 w-4 text-blue-600 dark:text-blue-400"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span className="sr-only">{t('states.loading')}</span>
          </div>
        )}
      </div>
      
      {/* Settings Panel */}
      {showSettings && !compact && !disabled && settings.length > 0 && (
        <div
          ref={settingsPanelRef}
          id="autoFixSettingsPanel"
          role="dialog"
          aria-label={t('aria.settingsPanel')}
          aria-modal="true"
          data-testid="settings-panel"
          className={cn(
            "absolute right-0 mt-3 w-96 rounded-xl shadow-2xl z-50",
            "animate-in fade-in slide-in-from-top-2 duration-200",
            theme === 'dark' 
              ? "bg-gray-800 border border-gray-700" 
              : "bg-white border border-gray-200"
          )}
        >
          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className={cn(
                  "text-lg font-semibold",
                  theme === 'dark' ? "text-gray-100" : "text-gray-900"
                )}>
                  {t('headers.settings')}
                </h3>
                <p 
                  id="autoFixSettingsDescription"
                  className={cn(
                    "text-sm mt-1",
                    theme === 'dark' ? "text-gray-400" : "text-gray-600"
                  )}
                >
                  {t('descriptions.configureAutoFix')}
                  {requiresApproval && ` • ${t('descriptions.criticalRequiresApproval')}`}
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={handleEnableAll}
                  disabled={isLoadingSettings || settings.every(s => s.enabled)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500",
                    theme === 'dark'
                      ? "bg-blue-700 text-white hover:bg-blue-600 focus:ring-offset-gray-800"
                      : "bg-blue-600 text-white hover:bg-blue-700 focus:ring-offset-white",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {t('actions.enableAll')}
                </button>
                <button
                  type="button"
                  onClick={handleDisableAll}
                  disabled={isLoadingSettings || settings.every(s => !s.enabled)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-blue-500",
                    theme === 'dark'
                      ? "bg-gray-700 text-gray-200 hover:bg-gray-600 focus:ring-offset-gray-800"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-offset-white",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {t('actions.disableAll')}
                </button>
              </div>
            </div>
            
            {/* Limits Warning */}
            {limits && limits.remainingFixes < 10 && (
              <div className={cn(
                "mb-4 p-3 rounded-lg",
                limits.remainingFixes < 3
                  ? theme === 'dark' ? "bg-red-900/30 border border-red-800" : "bg-red-50 border border-red-200"
                  : theme === 'dark' ? "bg-yellow-900/30 border border-yellow-800" : "bg-yellow-50 border border-yellow-200"
              )}>
                <div className="flex items-center">
                  <svg className={cn(
                    "w-4 h-4 mr-2",
                    limits.remainingFixes < 3
                      ? theme === 'dark' ? "text-red-400" : "text-red-600"
                      : theme === 'dark' ? "text-yellow-400" : "text-yellow-600"
                  )} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.732 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className={cn(
                    "text-sm font-medium",
                    limits.remainingFixes < 3
                      ? theme === 'dark' ? "text-red-300" : "text-red-800"
                      : theme === 'dark' ? "text-yellow-300" : "text-yellow-800"
                  )}>
                    {t('warnings.lowRemainingFixes', { 
                      remaining: limits.remainingFixes,
                      resetTime: new Date(limits.resetTime).toLocaleTimeString(i18n.language, { 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })
                    })}
                  </span>
                </div>
              </div>
            )}
            
            {/* Settings List */}
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
              {Object.entries(settingsByCategory).map(([category, categorySettings]) => (
                <div key={category}>
                  <h4 className={cn(
                    "text-sm font-semibold mb-2",
                    theme === 'dark' ? "text-gray-300" : "text-gray-700"
                  )}>
                    {t(`categories.${category}`, CATEGORY_CONFIG[category as FixCategory].name)}
                  </h4>
                  <div className="space-y-2">
                    {categorySettings.map((setting) => (
                      <div
                        key={setting.id}
                        className={cn(
                          "p-3 border rounded-lg border-l-4 transition-all",
                          CATEGORY_CONFIG[setting.category].border,
                          theme === 'dark' 
                            ? "hover:bg-gray-700/50" 
                            : "hover:bg-gray-50",
                          setting.enabled && CATEGORY_CONFIG[setting.category].bg
                        )}
                        data-testid={`setting-${setting.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-1">
                              <span className="text-sm" aria-hidden="true">
                                {CATEGORY_CONFIG[setting.category].icon}
                              </span>
                              <h4 className={cn(
                                "font-medium",
                                theme === 'dark' ? "text-gray-100" : "text-gray-900"
                              )}>
                                {setting.name}
                              </h4>
                              <span
                                className={cn(
                                  "px-2 py-0.5 text-xs font-medium rounded-full",
                                  SEVERITY_CONFIG[setting.severity].bg,
                                  SEVERITY_CONFIG[setting.severity].text,
                                  SEVERITY_CONFIG[setting.severity].border
                                )}
                              >
                                {SEVERITY_CONFIG[setting.severity].icon} {t(`severity.${setting.severity}`)}
                              </span>
                            </div>
                            <p className={cn(
                              "text-sm",
                              theme === 'dark' ? "text-gray-400" : "text-gray-600"
                            )}>
                              {setting.description}
                            </p>
                            {setting.requiresApproval && (
                              <p className={cn(
                                "text-xs mt-1 flex items-center",
                                theme === 'dark' ? "text-yellow-400" : "text-yellow-600"
                              )}>
                                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                                {t('descriptions.requiresApproval')}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={setting.enabled}
                            aria-label={t(`aria.toggleSetting`, { 
                              setting: setting.name,
                              state: setting.enabled ? t('states.disable') : t('states.enable')
                            })}
                            onClick={() => handleSettingToggle(setting.id)}
                            disabled={isLoadingSettings}
                            data-state={setting.enabled ? 'checked' : 'unchecked'}
                            className={cn(
                              "ml-4 relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ease-in-out",
                              "focus:outline-none focus:ring-2 focus:ring-blue-500",
                              "disabled:opacity-50",
                              theme === 'dark'
                                ? "data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-gray-600 focus:ring-offset-gray-800"
                                : "data-[state=checked]:bg-blue-600 data-[state=unchecked]:bg-gray-300 focus:ring-offset-white"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full transition-transform duration-200 ease-in-out",
                                "data-[state=checked]:translate-x-6 data-[state=unchecked]:translate-x-1",
                                theme === 'dark' ? "bg-gray-300" : "bg-white"
                              )}
                              data-state={setting.enabled ? 'checked' : 'unchecked'}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Footer */}
            <div className={cn(
              "mt-4 pt-4 border-t",
              theme === 'dark' ? "border-gray-700" : "border-gray-200"
            )}>
              <div className="flex items-center justify-between">
                <p className={cn(
                  "text-sm",
                  theme === 'dark' ? "text-gray-400" : "text-gray-600"
                )}>
                  <strong>{t('labels.note')}:</strong> {requiresApproval 
                    ? t('descriptions.criticalFixesManualApproval')
                    : t('descriptions.allFixesAutomatic')
                  }
                </p>
                {settingsResponse?.data?.lastModified && (
                  <span className={cn(
                    "text-xs",
                    theme === 'dark' ? "text-gray-500" : "text-gray-500"
                  )}>
                    {t('labels.updated')} {new Date(settingsResponse.data.lastModified).toLocaleDateString(i18n.language)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}, 'AutoFixToggleContent');

// Main component with Error Boundary and React.memo
const AutoFixToggle: React.FC<AutoFixToggleProps> = React.memo((props) => {
  const { trackError } = useAnalytics();
  
  return (
    <ErrorBoundary
      fallback={({ error, resetErrorBoundary }) => (
        <div 
          className={cn(
            "p-3 rounded-lg",
            props.theme === 'dark' 
              ? "bg-red-900/30 border border-red-800 text-red-300" 
              : "bg-red-50 border border-red-200 text-red-600"
          )}
          data-testid="auto-fix-toggle-error-boundary"
        >
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{props.theme === 'dark' ? '⚠️' : '⚠️'} Failed to load auto-fix controls</span>
          </div>
          <div className="mt-2 text-sm opacity-80">
            {error?.message || 'An unexpected error occurred'}
          </div>
          <div className="mt-3 flex space-x-2">
            <button
              onClick={resetErrorBoundary}
              className={cn(
                "px-3 py-1 text-sm font-medium rounded",
                props.theme === 'dark'
                  ? "bg-red-700 hover:bg-red-600 text-white"
                  : "bg-red-600 hover:bg-red-700 text-white"
              )}
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className={cn(
                "px-3 py-1 text-sm font-medium border rounded",
                props.theme === 'dark'
                  ? "border-gray-600 hover:bg-gray-700 text-gray-300"
                  : "border-gray-300 hover:bg-gray-100 text-gray-700"
              )}
            >
              Refresh page
            </button>
          </div>
        </div>
      )}
      onError={(error, errorInfo) => {
        logger.critical('AutoFixToggle Error Boundary', {
          error: error.toString(),
          errorInfo,
          componentStack: errorInfo.componentStack,
          props,
        });
        
        trackError('component_error', {
          component: 'AutoFixToggle',
          error: error.message,
          stack: error.stack,
          props: JSON.stringify(props),
        });
      }}
    >
      <AutoFixToggleContent {...props} />
    </ErrorBoundary>
  );
});

AutoFixToggle.displayName = 'AutoFixToggle';

export default AutoFixToggle;