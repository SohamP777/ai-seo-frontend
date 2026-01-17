/**
 * SEO Automation Tool - Application Constants
 * All constants used throughout the application
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_URL || 'https://api.seo-automation.com/v1',
  TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

// SEO Issue Severity Levels
export const SEVERITY_LEVELS = {
  CRITICAL: {
    level: 'critical',
    label: 'Critical',
    color: 'bg-red-500',
    textColor: 'text-red-500',
    priority: 0,
    impact: 40,
  },
  HIGH: {
    level: 'high',
    label: 'High',
    color: 'bg-orange-500',
    textColor: 'text-orange-500',
    priority: 1,
    impact: 20,
  },
  MEDIUM: {
    level: 'medium',
    label: 'Medium',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-500',
    priority: 2,
    impact: 10,
  },
  LOW: {
    level: 'low',
    label: 'Low',
    color: 'bg-blue-500',
    textColor: 'text-blue-500',
    priority: 3,
    impact: 5,
  },
  INFO: {
    level: 'info',
    label: 'Info',
    color: 'bg-gray-500',
    textColor: 'text-gray-500',
    priority: 4,
    impact: 0,
  },
} as const;

// SEO Issue Categories
export const ISSUE_CATEGORIES = {
  PERFORMANCE: {
    id: 'performance',
    label: 'Performance',
    icon: '⚡',
    description: 'Page speed and loading optimization issues',
  },
  SEO: {
    id: 'seo',
    label: 'SEO',
    icon: '🔍',
    description: 'Search engine optimization issues',
  },
  ACCESSIBILITY: {
    id: 'accessibility',
    label: 'Accessibility',
    icon: '♿',
    description: 'Web accessibility compliance issues',
  },
  SECURITY: {
    id: 'security',
    label: 'Security',
    icon: '🔒',
    description: 'Security vulnerabilities and best practices',
  },
  BEST_PRACTICES: {
    id: 'best_practices',
    label: 'Best Practices',
    icon: '✅',
    description: 'Web development best practices',
  },
} as const;

// Fix Status Types
export const FIX_STATUS = {
  PENDING: {
    status: 'pending',
    label: 'Pending',
    color: 'bg-yellow-100 text-yellow-800',
  },
  IN_PROGRESS: {
    status: 'in_progress',
    label: 'In Progress',
    color: 'bg-blue-100 text-blue-800',
  },
  COMPLETED: {
    status: 'completed',
    label: 'Completed',
    color: 'bg-green-100 text-green-800',
  },
  FAILED: {
    status: 'failed',
    label: 'Failed',
    color: 'bg-red-100 text-red-800',
  },
  SKIPPED: {
    status: 'skipped',
    label: 'Skipped',
    color: 'bg-gray-100 text-gray-800',
  },
} as const;

// Scan Status Types
export const SCAN_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

// Health Score Ranges
export const HEALTH_SCORE_RANGES = {
  EXCELLENT: { min: 90, max: 100, color: 'text-green-600', bgColor: 'bg-green-100' },
  GOOD: { min: 70, max: 89, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  FAIR: { min: 50, max: 69, color: 'text-yellow-600', bgColor: 'bg-yellow-100' },
  POOR: { min: 0, max: 49, color: 'text-red-600', bgColor: 'bg-red-100' },
} as const;

// Fix Types
export const FIX_TYPES = {
  AUTOMATIC: 'automatic',
  MANUAL: 'manual',
  SEMI_AUTOMATIC: 'semi_automatic',
} as const;

// Cache Durations (in milliseconds)
export const CACHE_DURATIONS = {
  SCAN_RESULTS: 5 * 60 * 1000, // 5 minutes
  HEALTH_SCORE: 10 * 60 * 1000, // 10 minutes
  REPORTS: 30 * 60 * 1000, // 30 minutes
  FIX_HISTORY: 60 * 60 * 1000, // 1 hour
} as const;

// Validation Constants
export const VALIDATION = {
  URL_REGEX: /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/,
  MAX_URL_LENGTH: 2048,
  MIN_SCAN_INTERVAL: 300, // 5 minutes in seconds
  MAX_SCAN_INTERVAL: 2592000, // 30 days in seconds
} as const;

// Pagination Constants
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  PAGE_SIZES: [10, 25, 50, 100],
} as const;

// Notification Types
export const NOTIFICATION_TYPES = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'seo_auth_token',
  USER_PREFERENCES: 'seo_user_preferences',
  RECENT_SCANS: 'seo_recent_scans',
  AUTO_FIX_ENABLED: 'seo_auto_fix_enabled',
} as const;

// Time Constants
export const TIME = {
  ONE_MINUTE: 60 * 1000,
  FIVE_MINUTES: 5 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Chart Colors
export const CHART_COLORS = {
  PRIMARY: '#3B82F6',
  SUCCESS: '#10B981',
  WARNING: '#F59E0B',
  DANGER: '#EF4444',
  INFO: '#6B7280',
  PERFORMANCE: '#8B5CF6',
  SEO: '#06B6D4',
  ACCESSIBILITY: '#EC4899',
  SECURITY: '#F97316',
} as const;

// Performance Metrics Thresholds
export const PERFORMANCE_THRESHOLDS = {
  FCP: { good: 1800, poor: 3000 }, // First Contentful Paint (ms)
  LCP: { good: 2500, poor: 4000 }, // Largest Contentful Paint (ms)
  FID: { good: 100, poor: 300 }, // First Input Delay (ms)
  CLS: { good: 0.1, poor: 0.25 }, // Cumulative Layout Shift
  TTFB: { good: 800, poor: 1800 }, // Time to First Byte (ms)
} as const;

// Type Definitions for Constants
export type SeverityLevel = keyof typeof SEVERITY_LEVELS;
export type IssueCategory = keyof typeof ISSUE_CATEGORIES;
export type FixStatus = keyof typeof FIX_STATUS;
export type ScanStatus = (typeof SCAN_STATUS)[keyof typeof SCAN_STATUS];
export type FixType = (typeof FIX_TYPES)[keyof typeof FIX_TYPES];
export type HealthScoreRange = keyof typeof HEALTH_SCORE_RANGES;
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

// Helper function to get severity by level
export const getSeverity = (level: string) => {
  return (
    Object.values(SEVERITY_LEVELS).find(s => s.level === level) || SEVERITY_LEVELS.INFO
  );
};

// Helper function to get fix status by status string
export const getFixStatus = (status: string) => {
  return (
    Object.values(FIX_STATUS).find(s => s.status === status) || FIX_STATUS.PENDING
  );
};

// Helper function to check if URL is valid
export const isValidUrl = (url: string): boolean => {
  if (url.length > VALIDATION.MAX_URL_LENGTH) return false;
  try {
    const parsedUrl = new URL(url);
    return VALIDATION.URL_REGEX.test(parsedUrl.href);
  } catch {
    return VALIDATION.URL_REGEX.test(url);
  }
};

// Default scan configuration
export const DEFAULT_SCAN_CONFIG = {
  device: 'desktop',
  location: 'us-east-1',
  throttle: 'fast3g',
  categories: Object.keys(ISSUE_CATEGORIES),
  depth: 1,
  maxPages: 10,
} as const;