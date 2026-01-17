// frontend/src/hooks/useSEOState.ts
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useScanner, ScannerState } from './useScanner';
import { useAutoFix, AutoFixState } from './useAutoFix';
import { useReports, ReportsState } from './useReports';

export interface SEOGlobalState {
  scanner: ScannerState;
  fixer: AutoFixState;
  reports: ReportsState;
  dashboard: DashboardState;
  notifications: Notification[];
  preferences: UserPreferences;
}

export interface DashboardState {
  overallScore: number;
  weeklyProgress: number;
  totalIssuesFixed: number;
  activeFixes: ActiveFix[];
  recentScans: RecentScan[];
  quickStats: QuickStats;
  isLoading: boolean;
}

export interface ActiveFix {
  id: string;
  type: string;
  progress: number;
  estimatedTime: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface RecentScan {
  id: string;
  url: string;
  score: number;
  timestamp: Date;
  issuesFound: number;
}

export interface QuickStats {
  dailyFixes: number;
  weeklyFixes: number;
  monthlyFixes: number;
  averageScore: number;
  scoreImprovement: number;
  timeSaved: number; // in minutes
}

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface UserPreferences {
  autoFixEnabled: boolean;
  notificationsEnabled: boolean;
  weeklyReportsEnabled: boolean;
  theme: 'light' | 'dark' | 'auto';
  scanDepth: 'basic' | 'standard' | 'deep';
  defaultFixPriority: 'critical' | 'high' | 'medium' | 'low';
  emailReports: boolean;
  autoScanInterval: number | null; // in hours
}

export interface UseSEOReturn {
  // State
  state: SEOGlobalState;
  
  // Dashboard actions
  refreshDashboard: () => Promise<void>;
  getSEOHealth: () => Promise<number>;
  getWeeklyReport: () => Promise<void>;
  
  // Notification actions
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (notificationId: string) => void;
  clearNotifications: () => void;
  
  // Preference actions
  updatePreferences: (preferences: Partial<UserPreferences>) => void;
  resetPreferences: () => void;
  
  // Combined actions
  scanAndFix: (url: string) => Promise<void>;
  getOneClickFixStatus: () => 'available' | 'running' | 'completed' | 'failed';
  exportAllData: () => Promise<string>;
  
  // Analytics
  getAnalytics: () => AnalyticsData;
  getPerformanceMetrics: () => PerformanceMetrics;
}

export interface AnalyticsData {
  totalScans: number;
  totalFixes: number;
  averageScoreImprovement: number;
  mostCommonIssue: string;
  timeSaved: number;
  costSaved: number;
}

export interface PerformanceMetrics {
  scanSpeed: number; // ms per page
  fixSuccessRate: number; // percentage
  reportAccuracy: number; // percentage
  systemUptime: number; // percentage
}

export const useSEOState = (): UseSEOReturn => {
  // Initialize all individual hooks
  const scanner = useScanner();
  const fixer = useAutoFix();
  const reports = useReports();
  
  // Dashboard state
  const [dashboard, setDashboard] = useState<DashboardState>({
    overallScore: 0,
    weeklyProgress: 0,
    totalIssuesFixed: 0,
    activeFixes: [],
    recentScans: [],
    quickStats: {
      dailyFixes: 0,
      weeklyFixes: 0,
      monthlyFixes: 0,
      averageScore: 0,
      scoreImprovement: 0,
      timeSaved: 0,
    },
    isLoading: false,
  });
  
  // Notifications
  const [notifications, setNotifications] = useState<Notification[]>([]);
  
  // Preferences (load from localStorage)
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    const saved = localStorage.getItem('seo_preferences');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Failed to parse preferences:', error);
      }
    }
    
    return {
      autoFixEnabled: true,
      notificationsEnabled: true,
      weeklyReportsEnabled: true,
      theme: 'light',
      scanDepth: 'standard',
      defaultFixPriority: 'high',
      emailReports: true,
      autoScanInterval: 24, // 24 hours
    };
  });
  
  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('seo_preferences', JSON.stringify(preferences));
  }, [preferences]);
  
  // Refresh dashboard data
  const refreshDashboard = useCallback(async () => {
    setDashboard(prev => ({ ...prev, isLoading: true }));
    
    try {
      // Fetch all dashboard data in parallel
      const [healthScore, recentScans, quickStatsData] = await Promise.all([
        getSEOHealth(),
        getRecentScans(),
        calculateQuickStats(),
      ]);
      
      // Update active fixes from fixer state
      const activeFixes: ActiveFix[] = fixer.appliedFixes.map(fix => ({
        id: fix.id,
        type: fix.type,
        progress: fixer.fixProgress,
        estimatedTime: fix.estimatedTime,
        status: 'running',
      }));
      
      setDashboard({
        overallScore: healthScore,
        weeklyProgress: calculateWeeklyProgress(),
        totalIssuesFixed: quickStatsData.monthlyFixes,
        activeFixes,
        recentScans,
        quickStats: quickStatsData,
        isLoading: false,
      });
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
      setDashboard(prev => ({ ...prev, isLoading: false }));
    }
  }, [fixer.appliedFixes, fixer.fixProgress]);
  
  // Get SEO health score
  const getSEOHealth = useCallback(async (): Promise<number> => {
    // Calculate based on recent scans and fixes
    const recentScores = dashboard.recentScans.map(scan => scan.score);
    const averageScore = recentScores.length > 0
      ? recentScores.reduce((sum, score) => sum + score, 0) / recentScores.length
      : 0;
    
    // Adjust based on active issues
    const issuePenalty = scanner.scanResults?.issues
      ? scanner.scanResults.issues.filter(i => i.severity === 'critical').length * 5
      : 0;
    
    return Math.max(0, Math.min(100, averageScore - issuePenalty));
  }, [dashboard.recentScans, scanner.scanResults]);
  
  // Get recent scans
  const getRecentScans = useCallback(async (): Promise<RecentScan[]> => {
    // Get from scanner history
    return scanner.scanHistory.slice(0, 5).map(scan => ({
      id: scan.id,
      url: scan.url,
      score: scan.score,
      timestamp: scan.timestamp,
      issuesFound: scan.totalIssues,
    }));
  }, [scanner.scanHistory]);
  
  // Calculate quick stats
  const calculateQuickStats = useCallback(async (): Promise<QuickStats> => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    // Calculate fixes by timeframe
    const dailyFixes = fixer.fixHistory.filter(fix => 
      new Date(fix.timestamp) > oneDayAgo
    ).length;
    
    const weeklyFixes = fixer.fixHistory.filter(fix => 
      new Date(fix.timestamp) > oneWeekAgo
    ).length;
    
    const monthlyFixes = fixer.fixHistory.filter(fix => 
      new Date(fix.timestamp) > oneMonthAgo
    ).length;
    
    // Calculate average score improvement
    const improvements = fixer.fixHistory.map(fix => fix.scoreImprovement);
    const averageImprovement = improvements.length > 0
      ? improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length
      : 0;
    
    // Calculate time saved (estimated 30 minutes per fix)
    const timeSaved = monthlyFixes * 30;
    
    return {
      dailyFixes,
      weeklyFixes,
      monthlyFixes,
      averageScore: dashboard.overallScore,
      scoreImprovement: averageImprovement,
      timeSaved,
    };
  }, [fixer.fixHistory, dashboard.overallScore]);
  
  // Calculate weekly progress
  const calculateWeeklyProgress = useCallback((): number => {
    const improvements = fixer.fixHistory
      .filter(fix => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        return new Date(fix.timestamp) > weekAgo;
      })
      .map(fix => fix.scoreImprovement);
    
    return improvements.length > 0
      ? improvements.reduce((sum, imp) => sum + imp, 0)
      : 0;
  }, [fixer.fixHistory]);
  
  // Get weekly report
  const getWeeklyReport = useCallback(async () => {
    try {
      const report = await reports.generateReport('comprehensive', {
        includeDetails: true,
        compareWithPrevious: true,
      });
      
      addNotification({
        type: 'success',
        title: 'Weekly Report Generated',
        message: `Your SEO report for the week is ready. Score: ${report.score}`,
      });
      
      return report;
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Report Generation Failed',
        message: 'Failed to generate weekly report. Please try again.',
      });
      throw error;
    }
  }, [reports]);
  
  // Add notification
  const addNotification = useCallback((
    notification: Omit<Notification, 'id' | 'timestamp' | 'read'>
  ) => {
    const newNotification: Notification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      read: false,
    };
    
    setNotifications(prev => [newNotification, ...prev.slice(0, 49)]); // Keep last 50
    
    // Auto-remove success notifications after 5 seconds
    if (notification.type === 'success') {
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
      }, 5000);
    }
  }, []);
  
  // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev =>
      prev.map(notif =>
        notif.id === notificationId ? { ...notif, read: true } : notif
      )
    );
  }, []);
  
  // Clear all notifications
  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);
  
  // Update preferences
  const updatePreferences = useCallback((newPreferences: Partial<UserPreferences>) => {
    setPreferences(prev => ({ ...prev, ...newPreferences }));
    
    addNotification({
      type: 'success',
      title: 'Preferences Updated',
      message: 'Your settings have been saved successfully.',
    });
  }, [addNotification]);
  
  // Reset preferences to default
  const resetPreferences = useCallback(() => {
    const defaultPrefs: UserPreferences = {
      autoFixEnabled: true,
      notificationsEnabled: true,
      weeklyReportsEnabled: true,
      theme: 'light',
      scanDepth: 'standard',
      defaultFixPriority: 'high',
      emailReports: true,
      autoScanInterval: 24,
    };
    
    setPreferences(defaultPrefs);
    localStorage.setItem('seo_preferences', JSON.stringify(defaultPrefs));
    
    addNotification({
      type: 'info',
      title: 'Preferences Reset',
      message: 'All settings have been reset to default values.',
    });
  }, [addNotification]);
  
  // Combined scan and fix action
  const scanAndFix = useCallback(async (url: string) => {
    addNotification({
      type: 'info',
      title: 'Starting Scan & Fix',
      message: `Beginning SEO analysis for ${url}`,
    });
    
    try {
      // Start scan
      await scanner.startScan(url, {
        deepScan: preferences.scanDepth === 'deep',
        priority: preferences.defaultFixPriority as any,
      });
      
      // Wait for scan to complete
      while (scanner.isScanning) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      if (scanner.scanResults && preferences.autoFixEnabled) {
        // Start auto-fix
        addNotification({
          type: 'info',
          title: 'Applying Fixes',
          message: `Fixing ${scanner.scanResults.totalIssues} issues found`,
        });
        
        await fixer.startAutoFix(scanner.scanResults.id, {
          priority: preferences.defaultFixPriority as any,
        });
        
        // Wait for fixes to complete
        while (fixer.isFixing) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        addNotification({
          type: 'success',
          title: 'Scan & Fix Complete',
          message: `Fixed ${fixer.fixResults?.successfulFixes || 0} issues. Score improved by ${fixer.fixResults?.scoreImprovement || 0} points.`,
        });
      }
      
      // Refresh dashboard
      await refreshDashboard();
      
    } catch (error) {
      addNotification({
        type: 'error',
        title: 'Scan & Fix Failed',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
      throw error;
    }
  }, [scanner, fixer, preferences, addNotification, refreshDashboard]);
  
  // Get one-click fix status
  const getOneClickFixStatus = useCallback((): 'available' | 'running' | 'completed' | 'failed' => {
    if (scanner.isScanning || fixer.isFixing) return 'running';
    if (fixer.fixResults && fixer.fixResults.successfulFixes > 0) return 'completed';
    if (scanner.error || fixer.error) return 'failed';
    return 'available';
  }, [scanner, fixer]);
  
  // Export all data
  const exportAllData = useCallback(async (): Promise<string> => {
    const allData = {
      scanner: scanner.scanHistory,
      fixer: fixer.fixHistory,
      reports: reports.reports,
      dashboard,
      preferences,
      exportedAt: new Date().toISOString(),
    };
    
    const jsonString = JSON.stringify(allData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    addNotification({
      type: 'success',
      title: 'Data Exported',
      message: 'All your SEO data has been exported successfully.',
    });
    
    return url;
  }, [scanner.scanHistory, fixer.fixHistory, reports.reports, dashboard, preferences, addNotification]);
  
  // Get analytics data
  const getAnalytics = useCallback((): AnalyticsData => {
    const totalScans = scanner.scanHistory.length;
    const totalFixes = fixer.fixHistory.reduce((sum, fix) => sum + fix.totalFixes, 0);
    
    const improvements = fixer.fixHistory.map(fix => fix.scoreImprovement);
    const averageImprovement = improvements.length > 0
      ? improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length
      : 0;
    
    // Calculate most common issue
    const issueCounts: Record<string, number> = {};
    scanner.scanHistory.forEach(scan => {
      // In real implementation, would track actual issues
      issueCounts['Broken Links'] = (issueCounts['Broken Links'] || 0) + 1;
      issueCounts['Missing Meta Tags'] = (issueCounts['Missing Meta Tags'] || 0) + 1;
    });
    
    const mostCommonIssue = Object.entries(issueCounts)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || 'Unknown';
    
    // Calculate time and cost savings
    const timeSaved = totalFixes * 30; // 30 minutes per fix
    const costSaved = timeSaved * (50 / 60); // $50/hour average SEO cost
    
    return {
      totalScans,
      totalFixes,
      averageScoreImprovement: Math.round(averageImprovement * 10) / 10,
      mostCommonIssue,
      timeSaved,
      costSaved: Math.round(costSaved),
    };
  }, [scanner.scanHistory, fixer.fixHistory]);
  
  // Get performance metrics
  const getPerformanceMetrics = useCallback((): PerformanceMetrics => {
    // Calculate average scan speed
    const scanTimes = scanner.scanHistory.map(scan => {
      // Mock calculation - in real app would track actual times
      return Math.random() * 5000 + 1000; // 1-6 seconds
    });
    
    const scanSpeed = scanTimes.length > 0
      ? scanTimes.reduce((sum, time) => sum + time, 0) / scanTimes.length
      : 0;
    
    // Calculate fix success rate
    const successfulFixes = fixer.fixHistory.reduce((sum, fix) => sum + fix.successfulFixes, 0);
    const totalFixes = fixer.fixHistory.reduce((sum, fix) => sum + fix.totalFixes, 0);
    const fixSuccessRate = totalFixes > 0 ? (successfulFixes / totalFixes) * 100 : 0;
    
    return {
      scanSpeed: Math.round(scanSpeed),
      fixSuccessRate: Math.round(fixSuccessRate * 10) / 10,
      reportAccuracy: 95.5, // Mock data
      systemUptime: 99.9, // Mock data
    };
  }, [scanner.scanHistory, fixer.fixHistory]);
  
  // Set up auto-scan interval if enabled
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    if (preferences.autoScanInterval && preferences.autoScanInterval > 0) {
      const intervalMs = preferences.autoScanInterval * 60 * 60 * 1000;
      
      intervalId = setInterval(() => {
        // Auto-scan primary website
        const primaryUrl = scanner.lastScannedUrl || localStorage.getItem('primary_website');
        if (primaryUrl) {
          scanAndFix(primaryUrl);
        }
      }, intervalMs);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [preferences.autoScanInterval, scanner.lastScannedUrl, scanAndFix]);
  
  // Listen to scanner and fixer events
  useEffect(() => {
    // Scanner notifications
    if (scanner.currentStatus === 'completed' && scanner.scanResults) {
      addNotification({
        type: 'success',
        title: 'Scan Complete',
        message: `Found ${scanner.scanResults.totalIssues} issues on ${scanner.scanResults.url}`,
        action: scanner.scanResults.totalIssues > 0 ? {
          label: 'View Issues',
          onClick: () => window.location.hash = '#scan-results',
        } : undefined,
      });
    }
    
    if (scanner.currentStatus === 'error' && scanner.error) {
      addNotification({
        type: 'error',
        title: 'Scan Failed',
        message: scanner.error,
      });
    }
    
    // Fixer notifications
    if (fixer.currentStatus === 'completed' && fixer.fixResults) {
      addNotification({
        type: 'success',
        title: 'Fixes Applied',
        message: `Successfully fixed ${fixer.fixResults.successfulFixes} issues`,
      });
    }
    
    if (fixer.currentStatus === 'error' && fixer.error) {
      addNotification({
        type: 'error',
        title: 'Fix Failed',
        message: fixer.error,
      });
    }
  }, [
    scanner.currentStatus,
    scanner.scanResults,
    scanner.error,
    fixer.currentStatus,
    fixer.fixResults,
    fixer.error,
    addNotification,
  ]);
  
  // Combined state object
  const state: SEOGlobalState = useMemo(() => ({
    scanner: scanner,
    fixer: fixer,
    reports: reports,
    dashboard,
    notifications,
    preferences,
  }), [scanner, fixer, reports, dashboard, notifications, preferences]);
  
  return {
    state,
    refreshDashboard,
    getSEOHealth,
    getWeeklyReport,
    addNotification,
    markAsRead,
    clearNotifications,
    updatePreferences,
    resetPreferences,
    scanAndFix,
    getOneClickFixStatus,
    exportAllData,
    getAnalytics,
    getPerformanceMetrics,
  };
};

// Custom hook for theme management
export const useTheme = () => {
  const [theme, setTheme] = useState<'light' | 'dark' | 'auto'>(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark' || saved === 'auto') {
      return saved;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'auto';
    }
    
    return 'light';
  });
  
  useEffect(() => {
    const root = document.documentElement;
    
    const effectiveTheme = theme === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      if (prev === 'light') return 'dark';
      if (prev === 'dark') return 'auto';
      return 'light';
    });
  }, []);
  
  return {
    theme,
    setTheme,
    toggleTheme,
  };
};