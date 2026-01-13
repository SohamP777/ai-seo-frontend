import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { 
  Save, 
  Bell, 
  Shield, 
  Globe, 
  Mail, 
  Key, 
  User, 
  Database,
  Zap,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Download,
  Upload,
  ShieldAlert,
  Lock,
  Unlock,
  Activity,
  Settings as SettingsIcon,
  Cpu,
  Network,
  Server,
  HardDrive,
  Wifi,
  ShieldCheck,
  BellRing,
  MailCheck,
  Smartphone,
  Monitor,
  Tablet,
  Trash2,
  Backup,
  RotateCcw,
  Cloud,
  ShieldOff,
  Users,
  Building,
  Calendar,
  Clock,
  Languages,
  Palette,
  Moon,
  Sun,
  Monitor as MonitorIcon,
  WifiOff,
  BellOff,
  KeyRound,
  Scan,
  Target,
  Timer,
  FileText,
  Globe2,
  Robot,
  History,
  ChevronRight,
  ChevronLeft
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { settingsService } from '../services/settings';
import { encryptApiKey, decryptApiKey } from '../utils/security';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ApiKeyInput from '../components/settings/ApiKeyInput';
import SecuritySettings from '../components/settings/SecuritySettings';
import NotificationSettings from '../components/settings/NotificationSettings';
import ScannerSettings from '../components/settings/ScannerSettings';
import GeneralSettings from '../components/settings/GeneralSettings';
import { 
  validateIPAddress, 
  validateApiKeyFormat,
  sanitizeInput 
} from '../utils/validationUtils';
import { formatDate } from '../utils/dateUtils';
import { STORAGE_KEYS } from '../utils/constants';

// ============== COMPREHENSIVE VALIDATION SCHEMAS ==============
const userSettingsSchema = z.object({
  email: z.string()
    .email('Valid email is required')
    .min(1, 'Email is required')
    .max(255, 'Email too long')
    .transform(val => sanitizeInput(val)),
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name too long')
    .transform(val => sanitizeInput(val)),
  company: z.string()
    .max(200, 'Company name too long')
    .optional()
    .transform(val => val ? sanitizeInput(val) : val),
  notificationEmail: z.boolean().default(true),
  notificationBrowser: z.boolean().default(true),
  notificationFrequency: z.enum(['realtime', 'daily', 'weekly']).default('daily'),
  timezone: z.string().default('UTC'),
  language: z.enum(['en', 'es', 'fr', 'de', 'ja', 'zh', 'ko', 'ru']).default('en'),
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  avatarUrl: z.string().url('Invalid URL format').optional().nullable(),
  jobTitle: z.string().max(100, 'Job title too long').optional(),
  department: z.string().max(100, 'Department name too long').optional()
});

const securitySettingsSchema = z.object({
  twoFactorEnabled: z.boolean().default(false),
  sessionTimeout: z.number()
    .min(5, 'Minimum 5 minutes')
    .max(480, 'Maximum 480 minutes (8 hours)')
    .default(60),
  ipWhitelist: z.array(
    z.string()
      .refine(validateIPAddress, 'Invalid IP address format')
      .transform(val => sanitizeInput(val))
  ).default([]),
  passwordChangeRequired: z.boolean().default(false),
  loginNotifications: z.boolean().default(true),
  maxLoginAttempts: z.number()
    .min(1, 'Minimum 1 attempt')
    .max(10, 'Maximum 10 attempts')
    .default(5),
  sessionInactivityTimeout: z.number()
    .min(1, 'Minimum 1 minute')
    .max(120, 'Maximum 120 minutes (2 hours)')
    .default(30),
  allowPasswordAutofill: z.boolean().default(false),
  requireComplexPasswords: z.boolean().default(true),
  passwordExpiryDays: z.number()
    .min(0, 'Minimum 0 days (no expiry)')
    .max(365, 'Maximum 365 days')
    .default(90),
  autoLogoutOnInactivity: z.boolean().default(true)
});

const scannerSettingsSchema = z.object({
  maxConcurrentScans: z.number()
    .min(1, 'Minimum 1 concurrent scan')
    .max(50, 'Maximum 50 concurrent scans')
    .default(5),
  scanDepth: z.number()
    .min(1, 'Minimum depth 1')
    .max(10, 'Maximum depth 10')
    .default(3),
  respectRobotsTxt: z.boolean().default(true),
  scanThrottle: z.number()
    .min(100, 'Minimum 100ms delay')
    .max(10000, 'Maximum 10000ms (10s) delay')
    .default(1000),
  userAgent: z.string()
    .default('SEOAutomationBot/1.0')
    .transform(val => sanitizeInput(val)),
  timeout: z.number()
    .min(1000, 'Minimum 1000ms (1s) timeout')
    .max(30000, 'Maximum 30000ms (30s) timeout')
    .default(10000),
  maxPagesPerScan: z.number()
    .min(10, 'Minimum 10 pages')
    .max(10000, 'Maximum 10000 pages')
    .default(1000),
  enableJavascript: z.boolean().default(false),
  followRedirects: z.boolean().default(true),
  cacheScans: z.boolean().default(true),
  ignoreSslErrors: z.boolean().default(false),
  scanSchedule: z.object({
    enabled: z.boolean().default(false),
    frequency: z.enum(['daily', 'weekly', 'monthly', 'hourly']).default('weekly'),
    dayOfWeek: z.number().min(0).max(6).optional(),
    time: z.string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)')
      .default('02:00'),
    timezone: z.string().default('UTC')
  }).default({}),
  deviceEmulation: z.object({
    enabled: z.boolean().default(false),
    device: z.enum(['desktop', 'mobile', 'tablet']).default('desktop'),
    viewportWidth: z.number().default(1920),
    viewportHeight: z.number().default(1080)
  }).default({}),
  proxySettings: z.object({
    enabled: z.boolean().default(false),
    proxyUrl: z.string().url('Invalid proxy URL').optional(),
    proxyPort: z.number().min(1).max(65535).optional(),
    proxyUsername: z.string().optional(),
    proxyPassword: z.string().optional()
  }).default({})
});

const apiSettingsSchema = z.object({
  openaiApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'openai'),
      'OpenAI API key must start with sk-'
    )
    .optional(),
  googleApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'google'),
      'Google API key must start with AIza'
    )
    .optional(),
  serpapiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'serpapi'),
      'Invalid SERP API key format'
    )
    .optional(),
  bingApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'bing'),
      'Invalid Bing API key format'
    )
    .optional(),
  mozApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'moz'),
      'Invalid Moz API key format'
    )
    .optional(),
  ahrefsApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'ahrefs'),
      'Invalid Ahrefs API key format'
    )
    .optional(),
  semrushApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'semrush'),
      'Invalid SEMrush API key format'
    )
    .optional(),
  deepseekApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'deepseek'),
      'Invalid DeepSeek API key format'
    )
    .optional(),
  anthropicApiKey: z.string()
    .refine(
      (val) => !val || validateApiKeyFormat(val, 'anthropic'),
      'Invalid Anthropic API key format'
    )
    .optional(),
  useApiCache: z.boolean().default(true),
  apiRateLimit: z.number()
    .min(1, 'Minimum 1 request per minute')
    .max(1000, 'Maximum 1000 requests per minute')
    .default(60),
  retryFailedRequests: z.boolean().default(true),
  maxRetries: z.number().min(0).max(10).default(3)
});

const notificationSettingsSchema = z.object({
  scanComplete: z.boolean().default(true),
  fixComplete: z.boolean().default(true),
  weeklyReport: z.boolean().default(true),
  criticalIssues: z.boolean().default(true),
  scoreDrop: z.boolean().default(true),
  newBacklinks: z.boolean().default(true),
  keywordRankChanges: z.boolean().default(false),
  competitorUpdates: z.boolean().default(false),
  systemAlerts: z.boolean().default(true),
  apiLimitWarnings: z.boolean().default(true),
  maintenanceAlerts: z.boolean().default(true),
  emailDigest: z.object({
    enabled: z.boolean().default(true),
    frequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
    includeSummary: z.boolean().default(true),
    includeCharts: z.boolean().default(true),
    includeRecommendations: z.boolean().default(true),
    includeIssues: z.boolean().default(true),
    includeCompetitors: z.boolean().default(false),
    sendTime: z.string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format')
      .default('09:00'),
    timezone: z.string().default('UTC')
  }).default({}),
  pushNotifications: z.object({
    enabled: z.boolean().default(false),
    criticalOnly: z.boolean().default(true),
    soundEnabled: z.boolean().default(true),
    vibrateEnabled: z.boolean().default(false)
  }).default({}),
  slackIntegration: z.object({
    enabled: z.boolean().default(false),
    webhookUrl: z.string().url('Invalid webhook URL').optional(),
    channel: z.string().optional(),
    username: z.string().optional()
  }).default({}),
  teamsIntegration: z.object({
    enabled: z.boolean().default(false),
    webhookUrl: z.string().url('Invalid webhook URL').optional(),
    channel: z.string().optional()
  }).default({})
});

const systemSettingsSchema = z.object({
  autoUpdate: z.boolean().default(true),
  backupEnabled: z.boolean().default(true),
  backupFrequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  dataRetentionDays: z.number()
    .min(1, 'Minimum 1 day')
    .max(3650, 'Maximum 3650 days (10 years)')
    .default(365),
  maxStorageGB: z.number()
    .min(1, 'Minimum 1GB')
    .max(1000, 'Maximum 1000GB')
    .default(100),
  performanceMode: z.enum(['balanced', 'performance', 'economy']).default('balanced'),
  enableAnalytics: z.boolean().default(true),
  enableErrorReporting: z.boolean().default(true),
  enableTelemetry: z.boolean().default(false),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  autoCleanup: z.boolean().default(true),
  cleanupSchedule: z.object({
    enabled: z.boolean().default(true),
    frequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
    time: z.string()
      .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format')
      .default('03:00'),
    keepFailedScans: z.boolean().default(false),
    keepSuccessfulScans: z.boolean().default(true)
  }).default({}),
  regionalSettings: z.object({
    currency: z.enum(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']).default('USD'),
    dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']).default('MM/DD/YYYY'),
    timeFormat: z.enum(['12h', '24h']).default('12h'),
    firstDayOfWeek: z.enum(['sunday', 'monday']).default('sunday')
  }).default({})
});

const settingsSchema = z.object({
  user: userSettingsSchema,
  security: securitySettingsSchema,
  scanner: scannerSettingsSchema,
  api: apiSettingsSchema,
  notifications: notificationSettingsSchema,
  system: systemSettingsSchema
});

export type SettingsFormData = z.infer<typeof settingsSchema>;
export type SettingsTab = 'general' | 'security' | 'scanner' | 'api' | 'notifications' | 'system';

// ============== INTERFACES ==============
interface TestResult {
  success: boolean;
  message: string;
  timestamp: Date;
}

interface BackupInfo {
  id: string;
  timestamp: Date;
  size: number;
  automatic: boolean;
}

interface ApiUsage {
  service: string;
  used: number;
  limit: number;
  percentage: number;
  resetDate: Date;
}

// ============== MAIN SETTINGS COMPONENT ==============
const Settings: React.FC = () => {
  const { 
    settings, 
    updateSettings, 
    isLoading, 
    isSaving,
    error,
    refreshSettings,
    resetSettings
  } = useSettings();
  
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [backupInProgress, setBackupInProgress] = useState(false);
  const [importInProgress, setImportInProgress] = useState(false);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [apiUsage, setApiUsage] = useState<ApiUsage[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // ============== FORM INITIALIZATION ==============
  const {
    register,
    handleSubmit,
    formState: { errors, dirtyFields, isValid },
    reset,
    watch,
    setValue,
    getValues,
    trigger,
    control
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: useMemo(() => settings || {
      user: {
        email: '',
        name: '',
        company: '',
        notificationEmail: true,
        notificationBrowser: true,
        notificationFrequency: 'daily',
        timezone: 'UTC',
        language: 'en',
        theme: 'light',
        avatarUrl: null,
        jobTitle: '',
        department: ''
      },
      security: {
        twoFactorEnabled: false,
        sessionTimeout: 60,
        ipWhitelist: [],
        passwordChangeRequired: false,
        loginNotifications: true,
        maxLoginAttempts: 5,
        sessionInactivityTimeout: 30,
        allowPasswordAutofill: false,
        requireComplexPasswords: true,
        passwordExpiryDays: 90,
        autoLogoutOnInactivity: true
      },
      scanner: {
        maxConcurrentScans: 5,
        scanDepth: 3,
        respectRobotsTxt: true,
        scanThrottle: 1000,
        userAgent: 'SEOAutomationBot/1.0',
        timeout: 10000,
        maxPagesPerScan: 1000,
        enableJavascript: false,
        followRedirects: true,
        cacheScans: true,
        ignoreSslErrors: false,
        scanSchedule: {
          enabled: false,
          frequency: 'weekly',
          dayOfWeek: 0,
          time: '02:00',
          timezone: 'UTC'
        },
        deviceEmulation: {
          enabled: false,
          device: 'desktop',
          viewportWidth: 1920,
          viewportHeight: 1080
        },
        proxySettings: {
          enabled: false,
          proxyUrl: '',
          proxyPort: 8080,
          proxyUsername: '',
          proxyPassword: ''
        }
      },
      api: {
        openaiApiKey: '',
        googleApiKey: '',
        serpapiKey: '',
        bingApiKey: '',
        mozApiKey: '',
        ahrefsApiKey: '',
        semrushApiKey: '',
        deepseekApiKey: '',
        anthropicApiKey: '',
        useApiCache: true,
        apiRateLimit: 60,
        retryFailedRequests: true,
        maxRetries: 3
      },
      notifications: {
        scanComplete: true,
        fixComplete: true,
        weeklyReport: true,
        criticalIssues: true,
        scoreDrop: true,
        newBacklinks: true,
        keywordRankChanges: false,
        competitorUpdates: false,
        systemAlerts: true,
        apiLimitWarnings: true,
        maintenanceAlerts: true,
        emailDigest: {
          enabled: true,
          frequency: 'weekly',
          includeSummary: true,
          includeCharts: true,
          includeRecommendations: true,
          includeIssues: true,
          includeCompetitors: false,
          sendTime: '09:00',
          timezone: 'UTC'
        },
        pushNotifications: {
          enabled: false,
          criticalOnly: true,
          soundEnabled: true,
          vibrateEnabled: false
        },
        slackIntegration: {
          enabled: false,
          webhookUrl: '',
          channel: '',
          username: 'SEO Bot'
        },
        teamsIntegration: {
          enabled: false,
          webhookUrl: '',
          channel: ''
        }
      },
      system: {
        autoUpdate: true,
        backupEnabled: true,
        backupFrequency: 'weekly',
        dataRetentionDays: 365,
        maxStorageGB: 100,
        performanceMode: 'balanced',
        enableAnalytics: true,
        enableErrorReporting: true,
        enableTelemetry: false,
        logLevel: 'info',
        autoCleanup: true,
        cleanupSchedule: {
          enabled: true,
          frequency: 'weekly',
          time: '03:00',
          keepFailedScans: false,
          keepSuccessfulScans: true
        },
        regionalSettings: {
          currency: 'USD',
          dateFormat: 'MM/DD/YYYY',
          timeFormat: '12h',
          firstDayOfWeek: 'sunday'
        }
      }
    }, [settings]),
    mode: 'onChange'
  });

  // ============== REAL-TIME CHANGE DETECTION ==============
  const formData = watch();
  const dirtyFieldsCount = useMemo(() => Object.keys(dirtyFields).length, [dirtyFields]);

  useEffect(() => {
    if (settings && formData) {
      const isDifferent = JSON.stringify(settings) !== JSON.stringify(formData);
      setHasChanges(isDifferent);
    }
  }, [formData, settings]);

  // ============== LOAD SETTINGS ON MOUNT ==============
  useEffect(() => {
    const loadSettingsData = async () => {
      if (settings) {
        try {
          // Decrypt API keys before displaying
          const decryptedSettings = {
            ...settings,
            api: settings.api ? {
              ...settings.api,
              openaiApiKey: decryptApiKey(settings.api.openaiApiKey || ''),
              googleApiKey: decryptApiKey(settings.api.googleApiKey || ''),
              serpapiKey: decryptApiKey(settings.api.serpapiKey || ''),
              bingApiKey: decryptApiKey(settings.api.bingApiKey || ''),
              mozApiKey: decryptApiKey(settings.api.mozApiKey || ''),
              ahrefsApiKey: decryptApiKey(settings.api.ahrefsApiKey || ''),
              semrushApiKey: decryptApiKey(settings.api.semrushApiKey || ''),
              deepseekApiKey: decryptApiKey(settings.api.deepseekApiKey || ''),
              anthropicApiKey: decryptApiKey(settings.api.anthropicApiKey || '')
            } : {}
          };
          reset(decryptedSettings);

          // Load backups and API usage
          const [backupsData, usageData] = await Promise.all([
            settingsService.getBackups(),
            settingsService.getApiUsage()
          ]);
          
          setBackups(backupsData);
          setApiUsage(usageData);
        } catch (error) {
          console.error('Error loading settings data:', error);
          toast.error('Failed to load settings data', {
            position: 'top-right',
            autoClose: 5000
          });
        }
      }
    };

    loadSettingsData();
  }, [settings, reset]);

  // ============== BUSINESS LOGIC FUNCTIONS ==============
  const handleSaveSettings = useCallback(async (data: SettingsFormData) => {
    try {
      // Validate all fields before saving
      const isValid = await trigger();
      if (!isValid) {
        toast.error('Please fix validation errors before saving', {
          position: 'top-right',
          autoClose: 5000,
          icon: <AlertCircle className="text-red-500" />
        });
        return;
      }

      // Encrypt API keys before sending
      const encryptedData = {
        ...data,
        api: {
          ...data.api,
          openaiApiKey: encryptApiKey(data.api.openaiApiKey || ''),
          googleApiKey: encryptApiKey(data.api.googleApiKey || ''),
          serpapiKey: encryptApiKey(data.api.serpapiKey || ''),
          bingApiKey: encryptApiKey(data.api.bingApiKey || ''),
          mozApiKey: encryptApiKey(data.api.mozApiKey || ''),
          ahrefsApiKey: encryptApiKey(data.api.ahrefsApiKey || ''),
          semrushApiKey: encryptApiKey(data.api.semrushApiKey || ''),
          deepseekApiKey: encryptApiKey(data.api.deepseekApiKey || ''),
          anthropicApiKey: encryptApiKey(data.api.anthropicApiKey || '')
        }
      };

      await updateSettings(encryptedData);
      
      toast.success('Settings saved successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
      
      // Refresh API usage after save
      const usageData = await settingsService.getApiUsage();
      setApiUsage(usageData);
      
    } catch (err: any) {
      console.error('Save settings error:', err);
      toast.error(`Failed to save settings: ${err.message || 'Unknown error'}`, {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    }
  }, [updateSettings, trigger]);

  const handleTestApiKey = useCallback(async (apiName: string, apiKey: string) => {
    if (!apiKey) {
      toast.warning(`Please enter ${apiName} API key first`, {
        position: 'top-right',
        icon: <AlertCircle className="text-yellow-500" />
      });
      return;
    }

    setIsTesting(true);
    setTestResults(prev => ({
      ...prev,
      [apiName]: { 
        success: false, 
        message: 'Testing...', 
        timestamp: new Date() 
      }
    }));

    try {
      const result = await settingsService.testApiKey(apiName, apiKey);
      
      setTestResults(prev => ({
        ...prev,
        [apiName]: { 
          success: result.valid, 
          message: result.message,
          timestamp: new Date()
        }
      }));

      if (result.valid) {
        toast.success(`${apiName} API key is valid!`, {
          position: 'top-right',
          autoClose: 3000,
          icon: <CheckCircle2 className="text-green-500" />
        });
      } else {
        toast.error(`${apiName} API key test failed: ${result.message}`, {
          position: 'top-right',
          autoClose: 5000,
          icon: <AlertCircle className="text-red-500" />
        });
      }
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [apiName]: { 
          success: false, 
          message: err.message || 'Test failed',
          timestamp: new Date()
        }
      }));
      toast.error(`Failed to test ${apiName} API: ${err.message}`, {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    } finally {
      setIsTesting(false);
    }
  }, []);

  const handleExportSettings = useCallback(async () => {
    try {
      const data = getValues();
      const exportData = {
        ...data,
        metadata: {
          exportedAt: new Date().toISOString(),
          version: '1.0.0',
          tool: 'SEO Automation Tool'
        }
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seo-settings-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Settings exported successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err) {
      console.error('Export settings error:', err);
      toast.error('Failed to export settings', {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    }
  }, [getValues]);

  const handleImportSettings = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size exceeds 10MB limit', {
        position: 'top-right',
        autoClose: 5000
      });
      return;
    }

    setImportInProgress(true);
    
    try {
      const text = await file.text();
      const importedData = JSON.parse(text);
      
      // Validate imported settings structure
      if (!importedData.user || !importedData.api) {
        throw new Error('Invalid settings file format');
      }

      const validationResult = settingsSchema.safeParse(importedData);
      
      if (!validationResult.success) {
        console.error('Validation errors:', validationResult.error.errors);
        throw new Error('Invalid settings data format');
      }

      reset(validationResult.data);
      
      toast.success('Settings imported successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err: any) {
      console.error('Import settings error:', err);
      toast.error(`Failed to import settings: ${err.message}`, {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    } finally {
      setImportInProgress(false);
      event.target.value = ''; // Reset file input
    }
  }, [reset]);

  const handleBackupSettings = useCallback(async () => {
    setBackupInProgress(true);
    try {
      const backup = await settingsService.backupSettings();
      setBackups(prev => [backup, ...prev]);
      
      toast.success('Settings backup created successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err) {
      console.error('Backup error:', err);
      toast.error('Failed to create backup', {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    } finally {
      setBackupInProgress(false);
    }
  }, []);

  const handleRestoreBackup = useCallback(async (backupId: string) => {
    if (!window.confirm('Are you sure you want to restore this backup? Current settings will be replaced.')) {
      return;
    }

    try {
      await settingsService.restoreBackup(backupId);
      await refreshSettings();
      
      toast.success('Backup restored successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err) {
      console.error('Restore backup error:', err);
      toast.error('Failed to restore backup', {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    }
  }, [refreshSettings]);

  const handleDeleteBackup = useCallback(async (backupId: string) => {
    if (!window.confirm('Are you sure you want to delete this backup?')) {
      return;
    }

    try {
      await settingsService.deleteBackup(backupId);
      setBackups(prev => prev.filter(b => b.id !== backupId));
      
      toast.success('Backup deleted successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err) {
      console.error('Delete backup error:', err);
      toast.error('Failed to delete backup', {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    }
  }, []);

  const handleRestoreDefaults = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5000);
      return;
    }

    try {
      await resetSettings();
      setConfirmReset(false);
      
      toast.success('Settings restored to defaults!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err) {
      console.error('Reset defaults error:', err);
      toast.error('Failed to restore defaults', {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    }
  }, [confirmReset, resetSettings]);

  const handleClearApiCache = useCallback(async () => {
    try {
      await settingsService.clearApiCache();
      toast.success('API cache cleared successfully!', {
        position: 'top-right',
        autoClose: 3000,
        icon: <CheckCircle2 className="text-green-500" />
      });
    } catch (err) {
      console.error('Clear cache error:', err);
      toast.error('Failed to clear API cache', {
        position: 'top-right',
        autoClose: 5000,
        icon: <AlertCircle className="text-red-500" />
      });
    }
  }, []);

  // ============== PERFORMANCE OPTIMIZATIONS ==============
  const memoizedTabs = useMemo(() => [
    { 
      id: 'general' as SettingsTab, 
      label: 'General', 
      icon: SettingsIcon, 
      color: 'text-blue-600 dark:text-blue-400',
      description: 'User profile and preferences'
    },
    { 
      id: 'security' as SettingsTab, 
      label: 'Security', 
      icon: Shield, 
      color: 'text-green-600 dark:text-green-400',
      description: 'Account security and access control'
    },
    { 
      id: 'scanner' as SettingsTab, 
      label: 'Scanner', 
      icon: Scan, 
      color: 'text-purple-600 dark:text-purple-400',
      description: 'SEO scanning configuration'
    },
    { 
      id: 'api' as SettingsTab, 
      label: 'API Keys', 
      icon: Key, 
      color: 'text-yellow-600 dark:text-yellow-400',
      description: 'Third-party API integrations'
    },
    { 
      id: 'notifications' as SettingsTab, 
      label: 'Notifications', 
      icon: Bell, 
      color: 'text-pink-600 dark:text-pink-400',
      description: 'Alert and notification settings'
    },
    { 
      id: 'system' as SettingsTab, 
      label: 'System', 
      icon: Server, 
      color: 'text-gray-600 dark:text-gray-400',
      description: 'System and performance settings'
    }
  ], []);

  const toggleApiKeyVisibility = useCallback((apiName: string) => {
    setShowApiKeys(prev => ({
      ...prev,
      [apiName]: !prev[apiName]
    }));
  }, []);

  const apiKeys = useMemo(() => [
    { name: 'openaiApiKey', label: 'OpenAI API Key', placeholder: 'sk-...', testable: true, icon: Cpu },
    { name: 'googleApiKey', label: 'Google API Key', placeholder: 'AIza...', testable: true, icon: Globe },
    { name: 'serpapiKey', label: 'SERP API Key', placeholder: 'Enter SERP API key', testable: true, icon: Search },
    { name: 'bingApiKey', label: 'Bing Webmaster API', placeholder: 'Enter Bing API key', testable: true, icon: Target },
    { name: 'mozApiKey', label: 'Moz API Key', placeholder: 'Enter Moz API key', testable: true, icon: ChartBar },
    { name: 'ahrefsApiKey', label: 'Ahrefs API Key', placeholder: 'Enter Ahrefs API key', testable: true, icon: Link },
    { name: 'semrushApiKey', label: 'SEMrush API Key', placeholder: 'Enter SEMrush API key', testable: true, icon: TrendingUp },
    { name: 'deepseekApiKey', label: 'DeepSeek API Key', placeholder: 'Enter DeepSeek API key', testable: true, icon: Brain },
    { name: 'anthropicApiKey', label: 'Anthropic API Key', placeholder: 'Enter Anthropic API key', testable: true, icon: MessageSquare }
  ], []);

  // ============== RENDER FUNCTIONS ==============
  const renderApiKeySection = useCallback(() => {
    return (
      <div className="space-y-6">
        {/* Security Notice */}
        <div className="rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-4">
          <div className="flex">
            <ShieldAlert className="h-5 w-5 text-yellow-400 flex-shrink-0" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Security Notice
              </h3>
              <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                <p>
                  API keys are stored encrypted using AES-256 encryption. Never share your keys. 
                  Ensure you have proper usage limits set for each API service to avoid unexpected charges.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* API Keys Grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {apiKeys.map(({ name, label, placeholder, testable, icon: Icon }) => (
            <div key={name} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center">
                <Icon className="h-4 w-4 mr-2" />
                {label}
              </label>
              <div className="relative">
                <input
                  type={showApiKeys[name] ? 'text' : 'password'}
                  {...register(`api.${name as keyof SettingsFormData['api']}`)}
                  placeholder={placeholder}
                  className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 pr-20 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm transition-colors duration-200"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 space-x-2">
                  <button
                    type="button"
                    onClick={() => toggleApiKeyVisibility(name)}
                    className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300 focus:outline-none transition-colors"
                    aria-label={showApiKeys[name] ? 'Hide API key' : 'Show API key'}
                  >
                    {showApiKeys[name] ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                  {testable && (
                    <button
                      type="button"
                      onClick={() => handleTestApiKey(label, getValues(`api.${name as keyof SettingsFormData['api']}`) || '')}
                      disabled={isTesting}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-2 py-1 text-sm font-medium rounded"
                      aria-label={`Test ${label}`}
                    >
                      {isTesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Test'
                      )}
                    </button>
                  )}
                </div>
              </div>
              {errors.api?.[name as keyof typeof errors.api] && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {errors.api[name as keyof typeof errors.api]?.message}
                </p>
              )}
              {testResults[name] && (
                <div className={`text-sm ${testResults[name].success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  <span className="font-medium">
                    {testResults[name].success ? '✓' : '✗'} 
                  </span>
                  <span className="ml-2">{testResults[name].message}</span>
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                    {formatDate(testResults[name].timestamp, 'short')}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Advanced API Settings */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 focus:outline-none"
          >
            {showAdvanced ? (
              <ChevronRight className="h-4 w-4 mr-2 transform rotate-90" />
            ) : (
              <ChevronRight className="h-4 w-4 mr-2" />
            )}
            Advanced API Settings
          </button>
          
          {showAdvanced && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  API Rate Limit
                </label>
                <input
                  type="number"
                  {...register('api.apiRateLimit', { valueAsNumber: true })}
                  min="1"
                  max="1000"
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Requests per minute
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Max Retries
                </label>
                <input
                  type="number"
                  {...register('api.maxRetries', { valueAsNumber: true })}
                  min="0"
                  max="10"
                  className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  {...register('api.useApiCache')}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                  id="useApiCache"
                />
                <label htmlFor="useApiCache" className="text-sm text-gray-700 dark:text-gray-300">
                  Use API Cache
                </label>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  {...register('api.retryFailedRequests')}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
                  id="retryFailedRequests"
                />
                <label htmlFor="retryFailedRequests" className="text-sm text-gray-700 dark:text-gray-300">
                  Retry Failed Requests
                </label>
              </div>
            </div>
          )}
        </div>

        {/* API Usage Dashboard */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              API Usage Dashboard
            </h4>
            <button
              type="button"
              onClick={handleClearApiCache}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Clear Cache
            </button>
          </div>
          
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {apiUsage.map((usage) => (
              <div 
                key={usage.service}
                className="bg-gradient-to-br from-gray-50 to-white dark:from-gray-800 dark:to-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className={`p-2 rounded-lg ${
                      usage.percentage > 90 ? 'bg-red-100 dark:bg-red-900/20' :
                      usage.percentage > 75 ? 'bg-yellow-100 dark:bg-yellow-900/20' :
                      'bg-green-100 dark:bg-green-900/20'
                    }`}>
                      <Network className={`h-5 w-5 ${
                        usage.percentage > 90 ? 'text-red-600 dark:text-red-400' :
                        usage.percentage > 75 ? 'text-yellow-600 dark:text-yellow-400' :
                        'text-green-600 dark:text-green-400'
                      }`} />
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {usage.service}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {usage.used.toLocaleString()} / {usage.limit.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-bold ${
                      usage.percentage > 90 ? 'text-red-600 dark:text-red-400' :
                      usage.percentage > 75 ? 'text-yellow-600 dark:text-yellow-400' :
                      'text-green-600 dark:text-green-400'
                    }`}>
                      {usage.percentage}%
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Resets {formatDate(usage.resetDate, 'short')}
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        usage.percentage > 90 ? 'bg-red-500' :
                        usage.percentage > 75 ? 'bg-yellow-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(usage.percentage, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }, [apiKeys, showApiKeys, errors.api, testResults, isTesting, apiUsage, showAdvanced, register, getValues, handleTestApiKey, toggleApiKeyVisibility, handleClearApiCache]);

  const renderSystemSection = useCallback(() => {
    return (
      <div className="space-y-6">
        {/* Performance Settings */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Performance Mode
            </label>
            <select
              {...register('system.performanceMode')}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
            >
              <option value="economy">Economy (Low Resource Usage)</option>
              <option value="balanced">Balanced (Recommended)</option>
              <option value="performance">Performance (High Resource Usage)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Adjusts resource allocation for optimal performance
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Log Level
            </label>
            <select
              {...register('system.logLevel')}
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
            >
              <option value="error">Error Only</option>
              <option value="warn">Warning & Error</option>
              <option value="info">Info, Warning & Error</option>
              <option value="debug">Debug (All Messages)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Data Retention (Days)
            </label>
            <input
              type="number"
              {...register('system.dataRetentionDays', { valueAsNumber: true })}
              min="1"
              max="3650"
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              How long to keep scan results and reports
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Maximum Storage (GB)
            </label>
            <input
              type="number"
              {...register('system.maxStorageGB', { valueAsNumber: true })}
              min="1"
              max="1000"
              step="1"
              className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
            />
          </div>
        </div>

        {/* Checkbox Settings */}
        <div className="space-y-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('system.autoUpdate')}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
              id="autoUpdate"
            />
            <label htmlFor="autoUpdate" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Automatic Updates
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                (Recommended for security patches)
              </span>
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('system.backupEnabled')}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
              id="backupEnabled"
            />
            <label htmlFor="backupEnabled" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Enable Automatic Backups
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('system.enableAnalytics')}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
              id="enableAnalytics"
            />
            <label htmlFor="enableAnalytics" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Enable Usage Analytics
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                (Helps improve the tool)
              </span>
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('system.enableErrorReporting')}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
              id="enableErrorReporting"
            />
            <label htmlFor="enableErrorReporting" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Enable Error Reporting
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('system.enableTelemetry')}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
              id="enableTelemetry"
            />
            <label htmlFor="enableTelemetry" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Enable Telemetry Data Collection
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                (Performance and usage data)
              </span>
            </label>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              {...register('system.autoCleanup')}
              className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-blue-400"
              id="autoCleanup"
            />
            <label htmlFor="autoCleanup" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              Automatic Cleanup of Old Data
            </label>
          </div>
        </div>

        {/* Regional Settings */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
            Regional Settings
          </h4>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Currency
              </label>
              <select
                {...register('system.regionalSettings.currency')}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
                <option value="JPY">JPY (¥)</option>
                <option value="CAD">CAD ($)</option>
                <option value="AUD">AUD ($)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Date Format
              </label>
              <select
                {...register('system.regionalSettings.dateFormat')}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
              >
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Time Format
              </label>
              <select
                {...register('system.regionalSettings.timeFormat')}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
              >
                <option value="12h">12-hour (AM/PM)</option>
                <option value="24h">24-hour</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                First Day of Week
              </label>
              <select
                {...register('system.regionalSettings.firstDayOfWeek')}
                className="mt-1 block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 py-2 px-3 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 sm:text-sm"
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
            </div>
          </div>
        </div>

        {/* Backup Management */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              Backup Management
            </h4>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={handleBackupSettings}
                disabled={backupInProgress}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {backupInProgress ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Backup...
                  </>
                ) : (
                  <>
                    <Backup className="mr-2 h-4 w-4" />
                    Create Backup Now
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportSettings}
                className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                <Download className="mr-2 h-4 w-4" />
                Export Settings
              </button>

              <label className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                Import Settings
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportSettings}
                  className="hidden"
                  disabled={importInProgress}
                />
              </label>
            </div>
          </div>

          {backups.length > 0 && (
            <div className="mt-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center">
                  <Database className="h-5 w-5 text-gray-400 mr-2" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Available Backups ({backups.length})
                  </span>
                </div>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-64 overflow-y-auto">
                {backups.map((backup) => (
                  <div key={backup.id} className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/70 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center">
                          {backup.automatic ? (
                            <Cloud className="h-4 w-4 text-blue-400 mr-2" />
                          ) : (
                            <Backup className="h-4 w-4 text-green-400 mr-2" />
                          )}
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatDate(backup.timestamp, 'full')}
                          </span>
                          {backup.automatic && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              Automatic
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Size: {(backup.size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreBackup(backup.id)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                          title="Restore this backup"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBackup(backup.id)}
                          className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                          title="Delete this backup"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }, [backups, backupInProgress, importInProgress, register, handleBackupSettings, handleExportSettings, handleImportSettings, handleRestoreBackup, handleDeleteBackup]);

  // ============== MAIN RENDER ==============
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <LoadingSpinner message="Loading settings..." />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <ToastContainer
          position="top-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
          theme="colored"
          toastClassName="dark:bg-gray-800 dark:text-white"
          bodyClassName="dark:text-gray-100"
          progressClassName="dark:bg-blue-500"
        />
        
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 shadow">
          <div className="px-4 sm:px-6 lg:px-8 py-6">
            <div className="md:flex md:items-center md:justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center">
                  <SettingsIcon className="h-8 w-8 text-gray-400 dark:text-gray-500 mr-3" />
                  <div>
                    <h2 className="text-2xl font-bold leading-7 text-gray-900 dark:text-white sm:text-3xl sm:truncate">
                      Settings
                    </h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      Configure your SEO Automation Tool preferences and integrations
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-4 flex md:mt-0 md:ml-4 space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    if (confirmReset) {
                      handleRestoreDefaults();
                    } else {
                      setConfirmReset(true);
                    }
                  }}
                  className={`inline-flex items-center px-4 py-2 border ${
                    confirmReset 
                      ? 'border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30' 
                      : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700'
                  } rounded-md shadow-sm text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                    confirmReset ? 'focus:ring-red-500' : 'focus:ring-blue-500'
                  } transition-colors`}
                >
                  {confirmReset ? (
                    <>
                      <AlertCircle className="mr-2 h-4 w-4 animate-pulse" />
                      Click again to confirm
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Reset Defaults
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmit(handleSaveSettings)()}
                  disabled={!hasChanges || isSaving || !isValid}
                  className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                    hasChanges && !isSaving && isValid
                      ? 'bg-blue-600 hover:bg-blue-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                      : 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
                  } transition-colors`}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes
                      {hasChanges && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-800/30">
                          {dirtyFieldsCount}
                        </span>
                      )}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
            {/* Error Alert */}
            {error && (
              <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
                  <div className="ml-3">
                    <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                      Error Loading Settings
                    </h3>
                    <div className="mt-2 text-sm text-red-700 dark:text-red-300">
                      <p>{error}</p>
                      <button
                        type="button"
                        onClick={refreshSettings}
                        className="mt-2 inline-flex items-center text-sm font-medium text-red-800 dark:text-red-200 hover:text-red-900 dark:hover:text-red-100"
                      >
                        <RefreshCw className="h-4 w-4 mr-1" />
                        Retry
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="border-b border-gray-200 dark:border-gray-700">
              <nav className="-mb-px flex space-x-8 overflow-x-auto">
                {memoizedTabs.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`
                        group whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center transition-all duration-200
                        ${isActive
                          ? `border-blue-500 ${tab.color}`
                          : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                        }
                      `}
                      title={tab.description}
                    >
                      <Icon className={`mr-2 h-5 w-5 transition-transform duration-200 ${
                        isActive ? 'scale-110' : 'group-hover:scale-110'
                      }`} />
                      {tab.label}
                      {isActive && dirtyFieldsCount > 0 && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 animate-pulse">
                          {dirtyFieldsCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Main Form */}
            <form onSubmit={handleSubmit(handleSaveSettings)} className="mt-6">
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg overflow-hidden">
                <div className="px-4 py-5 sm:p-6">
                  {/* Active Tab Content */}
                  <Suspense fallback={<LoadingSpinner message="Loading settings..." />}>
                    {activeTab === 'general' && (
                      <GeneralSettings 
                        register={register} 
                        errors={errors} 
                        watch={watch}
                        control={control}
                      />
                    )}
                    {activeTab === 'security' && (
                      <SecuritySettings 
                        register={register} 
                        errors={errors} 
                        watch={watch}
                        control={control}
                      />
                    )}
                    {activeTab === 'scanner' && (
                      <ScannerSettings 
                        register={register} 
                        errors={errors} 
                        watch={watch}
                        control={control}
                      />
                    )}
                    {activeTab === 'api' && renderApiKeySection()}
                    {activeTab === 'notifications' && (
                      <NotificationSettings 
                        register={register} 
                        errors={errors} 
                        watch={watch}
                        control={control}
                      />
                    )}
                    {activeTab === 'system' && renderSystemSection()}
                  </Suspense>
                </div>

                {/* Form Actions */}
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700 sm:px-6">
                  <div className="flex justify-between items-center">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {hasChanges ? (
                        <div className="flex items-center">
                          <AlertCircle className="h-4 w-4 text-yellow-400 mr-2 animate-pulse" />
                          <span>You have {dirtyFieldsCount} unsaved change{dirtyFieldsCount !== 1 ? 's' : ''}</span>
                        </div>
                      ) : (
                        <div className="flex items-center">
                          <CheckCircle2 className="h-4 w-4 text-green-400 mr-2" />
                          <span>All changes saved</span>
                        </div>
                      )}
                    </div>
                    <div className="flex space-x-3">
                      <button
                        type="button"
                        onClick={() => window.history.back()}
                        className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!hasChanges || isSaving || !isValid}
                        className={`inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                          hasChanges && !isSaving && isValid
                            ? 'bg-blue-600 hover:bg-blue-700 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
                            : 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
                        } transition-colors`}
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Changes
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>

            {/* Statistics */}
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Activity className="h-6 w-6 text-blue-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                        Total Settings
                      </dt>
                      <dd className="text-lg font-medium text-gray-900 dark:text-white">
                        {Object.keys(getValues()).length}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <Wifi className="h-6 w-6 text-green-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                        Active API Connections
                      </dt>
                      <dd className="text-lg font-medium text-gray-900 dark:text-white">
                        {apiUsage.filter(u => u.used > 0).length}/{apiUsage.length}
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 hover:shadow-lg transition-shadow">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <ShieldCheck className="h-6 w-6 text-purple-400" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">
                        Security Score
                      </dt>
                      <dd className="text-lg font-medium text-gray-900 dark:text-white">
                        {getValues().security?.twoFactorEnabled ? '96' : '84'}/100
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Save Bar */}
        {hasChanges && (
          <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50 transform transition-transform duration-300 ease-in-out">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <AlertCircle className="h-5 w-5 text-yellow-400 mr-2 animate-pulse" />
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    You have {dirtyFieldsCount} unsaved change{dirtyFieldsCount > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => reset(settings)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                  >
                    Discard Changes
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmit(handleSaveSettings)()}
                    disabled={isSaving || !isValid}
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save All Changes
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

export default Settings;