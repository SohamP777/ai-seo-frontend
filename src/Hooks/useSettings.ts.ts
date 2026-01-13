// frontend/src/hooks/useSettings.ts
import { useState, useCallback, useEffect } from 'react';

export interface AppSettings {
  // General
  language: string;
  timezone: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  
  // SEO Preferences
  defaultScanDepth: 'basic' | 'standard' | 'deep';
  autoFixEnabled: boolean;
  autoFixPriority: 'critical' | 'high' | 'medium' | 'low';
  maxConcurrentFixes: number;
  scanFrequency: 'never' | 'daily' | 'weekly' | 'monthly';
  
  // Notifications
  emailNotifications: boolean;
  pushNotifications: boolean;
  notificationFrequency: 'immediate' | 'digest' | 'weekly';
  notifyOnCriticalIssues: boolean;
  notifyOnScanComplete: boolean;
  notifyOnFixComplete: boolean;
  
  // Reporting
  weeklyReportEnabled: boolean;
  weeklyReportDay: number; // 0-6 (Sunday-Saturday)
  weeklyReportTime: string; // HH:MM
  reportFormat: 'pdf' | 'html' | 'csv';
  includeChartsInReports: boolean;
  emailReportsTo: string[];
  
  // Performance
  cacheEnabled: boolean;
  cacheDuration: number; // hours
  batchOperations: boolean;
  maxBatchSize: number;
  
  // Security
  twoFactorEnabled: boolean;
  sessionTimeout: number; // minutes
  ipWhitelist: string[];
  
  // API & Integrations
  apiAccessEnabled: boolean;
  webhookUrl: string;
  slackWebhookUrl: string;
  googleAnalyticsId: string;
  googleSearchConsole: boolean;
}

export interface UseSettingsReturn {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  
  // CRUD Operations
  loadSettings: () => Promise<void>;
  saveSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
  exportSettings: () => string;
  importSettings: (jsonString: string) => Promise<void>;
  
  // Validation
  validateSettings: (settings: Partial<AppSettings>) => ValidationResult;
  
  // Specific Actions
  toggleAutoFix: () => Promise<void>;
  updateScanFrequency: (frequency: AppSettings['scanFrequency']) => Promise<void>;
  addEmailToReports: (email: string) => Promise<void>;
  removeEmailFromReports: (email: string) => Promise<void>;
  testNotification: () => Promise<boolean>;
  testWebhook: () => Promise<boolean>;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

const DEFAULT_SETTINGS: AppSettings = {
  // General
  language: 'en',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: '24h',
  
  // SEO Preferences
  defaultScanDepth: 'standard',
  autoFixEnabled: true,
  autoFixPriority: 'high',
  maxConcurrentFixes: 3,
  scanFrequency: 'weekly',
  
  // Notifications
  emailNotifications: true,
  pushNotifications: true,
  notificationFrequency: 'immediate',
  notifyOnCriticalIssues: true,
  notifyOnScanComplete: true,
  notifyOnFixComplete: true,
  
  // Reporting
  weeklyReportEnabled: true,
  weeklyReportDay: 1, // Monday
  weeklyReportTime: '09:00',
  reportFormat: 'pdf',
  includeChartsInReports: true,
  emailReportsTo: [],
  
  // Performance
  cacheEnabled: true,
  cacheDuration: 24,
  batchOperations: true,
  maxBatchSize: 10,
  
  // Security
  twoFactorEnabled: false,
  sessionTimeout: 60,
  ipWhitelist: [],
  
  // API & Integrations
  apiAccessEnabled: false,
  webhookUrl: '',
  slackWebhookUrl: '',
  googleAnalyticsId: '',
  googleSearchConsole: false,
};

export const useSettings = (): UseSettingsReturn => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load settings from localStorage/API
  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Try localStorage first
      const savedSettings = localStorage.getItem('seo_app_settings');
      
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        
        // Merge with defaults to ensure all fields exist
        const mergedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        setSettings(mergedSettings);
      } else {
        // Load from API
        // const response = await fetch('/api/settings');
        // const data = await response.json();
        // setSettings({ ...DEFAULT_SETTINGS, ...data });
        
        // For now, use defaults
        setSettings(DEFAULT_SETTINGS);
      }
    } catch (err) {
      setError('Failed to load settings');
      console.error('Settings load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Save settings
  const saveSettings = useCallback(async (newSettings: Partial<AppSettings>) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const updatedSettings = { ...settings, ...newSettings };
      
      // Validate before saving
      const validation = validateSettings(updatedSettings);
      if (!validation.isValid) {
        throw new Error('Invalid settings: ' + Object.values(validation.errors).join(', '));
      }
      
      // Save to localStorage
      localStorage.setItem('seo_app_settings', JSON.stringify(updatedSettings));
      
      // Save to API
      // await fetch('/api/settings', {
      //   method: 'PUT',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(updatedSettings),
      // });
      
      setSettings(updatedSettings);
      
      // Apply runtime changes
      applyRuntimeSettings(updatedSettings);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [settings]);

  // Reset to defaults
  const resetToDefaults = useCallback(async () => {
    await saveSettings(DEFAULT_SETTINGS);
  }, [saveSettings]);

  // Export settings as JSON
  const exportSettings = useCallback((): string => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  // Import settings from JSON
  const importSettings = useCallback(async (jsonString: string) => {
    try {
      const imported = JSON.parse(jsonString);
      await saveSettings(imported);
    } catch (err) {
      throw new Error('Invalid settings format');
    }
  }, [saveSettings]);

  // Validate settings
  const validateSettings = useCallback((settingsToValidate: Partial<AppSettings>): ValidationResult => {
    const errors: Record<string, string> = {};
    const warnings: Record<string, string> = {};

    // Validate email reports
    if (settingsToValidate.emailReportsTo) {
      settingsToValidate.emailReportsTo.forEach((email, index) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors[`emailReportsTo.${index}`] = `Invalid email format: ${email}`;
        }
      });
    }

    // Validate webhook URL if provided
    if (settingsToValidate.webhookUrl && settingsToValidate.webhookUrl.trim() !== '') {
      try {
        new URL(settingsToValidate.webhookUrl);
      } catch {
        errors.webhookUrl = 'Invalid webhook URL';
      }
    }

    // Validate Slack webhook URL if provided
    if (settingsToValidate.slackWebhookUrl && settingsToValidate.slackWebhookUrl.trim() !== '') {
      if (!settingsToValidate.slackWebhookUrl.startsWith('https://hooks.slack.com/')) {
        warnings.slackWebhookUrl = 'This does not appear to be a valid Slack webhook URL';
      }
    }

    // Validate cache duration
    if (settingsToValidate.cacheDuration !== undefined) {
      if (settingsToValidate.cacheDuration < 1 || settingsToValidate.cacheDuration > 720) {
        warnings.cacheDuration = 'Cache duration should be between 1 and 720 hours';
      }
    }

    // Validate max concurrent fixes
    if (settingsToValidate.maxConcurrentFixes !== undefined) {
      if (settingsToValidate.maxConcurrentFixes < 1 || settingsToValidate.maxConcurrentFixes > 10) {
        errors.maxConcurrentFixes = 'Maximum concurrent fixes must be between 1 and 10';
      }
    }

    // Validate session timeout
    if (settingsToValidate.sessionTimeout !== undefined) {
      if (settingsToValidate.sessionTimeout < 5 || settingsToValidate.sessionTimeout > 1440) {
        errors.sessionTimeout = 'Session timeout must be between 5 and 1440 minutes';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
      warnings,
    };
  }, []);

  // Toggle auto-fix
  const toggleAutoFix = useCallback(async () => {
    await saveSettings({
      autoFixEnabled: !settings.autoFixEnabled,
    });
  }, [settings.autoFixEnabled, saveSettings]);

  // Update scan frequency
  const updateScanFrequency = useCallback(async (
    frequency: AppSettings['scanFrequency']
  ) => {
    await saveSettings({ scanFrequency: frequency });
  }, [saveSettings]);

  // Add email to reports
  const addEmailToReports = useCallback(async (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }

    const updatedEmails = [...settings.emailReportsTo, email];
    await saveSettings({ emailReportsTo: updatedEmails });
  }, [settings.emailReportsTo, saveSettings]);

  // Remove email from reports
  const removeEmailFromReports = useCallback(async (email: string) => {
    const updatedEmails = settings.emailReportsTo.filter(e => e !== email);
    await saveSettings({ emailReportsTo: updatedEmails });
  }, [settings.emailReportsTo, saveSettings]);

  // Test notification
  const testNotification = useCallback(async (): Promise<boolean> => {
    try {
      // Send test notification
      // await fetch('/api/settings/test-notification', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ type: 'test' }),
      // });
      
      return true;
    } catch (err) {
      console.error('Test notification failed:', err);
      return false;
    }
  }, []);

  // Test webhook
  const testWebhook = useCallback(async (): Promise<boolean> => {
    if (!settings.webhookUrl) {
      throw new Error('Webhook URL not configured');
    }

    try {
      // Send test webhook
      // await fetch(settings.webhookUrl, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ event: 'test', timestamp: new Date().toISOString() }),
      // });
      
      return true;
    } catch (err) {
      console.error('Webhook test failed:', err);
      return false;
    }
  }, [settings.webhookUrl]);

  // Apply runtime settings
  const applyRuntimeSettings = useCallback((newSettings: AppSettings) => {
    // Apply theme/language changes
    if (newSettings.language !== settings.language) {
      document.documentElement.lang = newSettings.language;
    }

    // Set up scan schedule if enabled
    if (newSettings.scanFrequency !== 'never') {
      // Schedule automatic scans
      // This would be implemented with a scheduler
    }

    // Update service worker cache settings
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(registration => {
        if (registration.active) {
          registration.active.postMessage({
            type: 'UPDATE_CACHE_SETTINGS',
            cacheEnabled: newSettings.cacheEnabled,
            cacheDuration: newSettings.cacheDuration,
          });
        }
      });
    }
  }, [settings]);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Auto-save settings on change
  useEffect(() => {
    const autoSave = setTimeout(() => {
      if (!isLoading) {
        saveSettings(settings);
      }
    }, 2000); // Debounce auto-save

    return () => clearTimeout(autoSave);
  }, [settings, isLoading, saveSettings]);

  return {
    settings,
    isLoading,
    error,
    loadSettings,
    saveSettings,
    resetToDefaults,
    exportSettings,
    importSettings,
    validateSettings,
    toggleAutoFix,
    updateScanFrequency,
    addEmailToReports,
    removeEmailFromReports,
    testNotification,
    testWebhook,
  };
};

// Custom hook for scan scheduling
export const useScanScheduler = () => {
  const { settings } = useSettings();
  const [scheduledScans, setScheduledScans] = useState<Array<{
    id: string;
    url: string;
    schedule: string;
    nextRun: Date;
    enabled: boolean;
  }>>([]);

  const addScheduledScan = useCallback(async (url: string, schedule: string) => {
    // Implementation would save to API
    const newScan = {
      id: `scan_${Date.now()}`,
      url,
      schedule,
      nextRun: calculateNextRun(schedule),
      enabled: true,
    };

    setScheduledScans(prev => [...prev, newScan]);
    return newScan.id;
  }, []);

  const removeScheduledScan = useCallback(async (scanId: string) => {
    setScheduledScans(prev => prev.filter(scan => scan.id !== scanId));
  }, []);

  const toggleScheduledScan = useCallback(async (scanId: string, enabled: boolean) => {
    setScheduledScans(prev =>
      prev.map(scan =>
        scan.id === scanId ? { ...scan, enabled } : scan
      )
    );
  }, []);

  const calculateNextRun = useCallback((schedule: string): Date => {
    // Parse schedule string and calculate next run time
    const now = new Date();
    const nextRun = new Date(now);
    
    // Simple implementation - would parse cron expression
    nextRun.setHours(nextRun.getHours() + 1);
    
    return nextRun;
  }, []);

  return {
    scheduledScans,
    addScheduledScan,
    removeScheduledScan,
    toggleScheduledScan,
  };
};