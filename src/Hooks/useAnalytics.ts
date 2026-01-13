// frontend/src/hooks/useAnalytics.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import { useScanner } from './useScanner';
import { useAutoFix } from './useAutoFix';
import { useReports } from './useReports';

export interface AnalyticsEvent {
  id: string;
  type: 'scan' | 'fix' | 'report' | 'error' | 'user_action' | 'performance';
  name: string;
  timestamp: Date;
  duration?: number;
  metadata: Record<string, any>;
  userId?: string;
  sessionId: string;
}

export interface AnalyticsData {
  dailyEvents: AnalyticsEvent[];
  weeklyTrends: TrendData[];
  userEngagement: EngagementMetrics;
  performanceMetrics: PerformanceData;
  businessMetrics: BusinessMetrics;
}

export interface TrendData {
  date: string;
  scans: number;
  fixes: number;
  reports: number;
  score: number;
}

export interface EngagementMetrics {
  activeUsers: number;
  sessionsPerUser: number;
  averageSessionDuration: number;
  featureUsage: Record<string, number>;
  retentionRate: number;
}

export interface PerformanceData {
  pageLoadTime: number;
  scanSpeed: number;
  fixSpeed: number;
  apiResponseTime: number;
  errorRate: number;
  uptime: number;
}

export interface BusinessMetrics {
  totalScans: number;
  totalFixes: number;
  averageScoreImprovement: number;
  timeSaved: number;
  costSaved: number;
  conversionRate: number;
  churnRate: number;
}

export interface UseAnalyticsReturn {
  // State
  analytics: AnalyticsData;
  isLoading: boolean;
  
  // Event Tracking
  trackEvent: (type: AnalyticsEvent['type'], name: string, metadata?: Record<string, any>) => void;
  trackError: (error: Error, context?: string) => void;
  trackPerformance: (metric: string, value: number) => void;
  
  // Data Management
  refreshAnalytics: () => Promise<void>;
  exportAnalytics: (format: 'json' | 'csv') => string;
  clearAnalytics: () => Promise<void>;
  
  // Analytics Queries
  getTopPages: (limit?: number) => Promise<Array<{ url: string; score: number; scans: number }>>;
  getCommonIssues: (limit?: number) => Promise<Array<{ issue: string; count: number; severity: string }>>;
  getFixSuccessRate: () => Promise<number>;
  getTrendAnalysis: (period: 'day' | 'week' | 'month') => Promise<TrendData[]>;
  getROICalculation: () => Promise<{ timeSaved: number; costSaved: number; roi: number }>;
  
  // User Analytics
  getUserActivity: (userId?: string) => Promise<UserActivity>;
  getHeatmapData: (url: string) => Promise<HeatmapData>;
  getFunnelAnalysis: () => Promise<FunnelData>;
}

export interface UserActivity {
  userId: string;
  lastActive: Date;
  totalScans: number;
  totalFixes: number;
  favoriteFeatures: string[];
  averageScore: number;
  improvementRate: number;
}

export interface HeatmapData {
  url: string;
  clicks: Array<{ x: number; y: number; count: number }>;
  scrollDepth: number[];
  timeOnPage: number;
}

export interface FunnelData {
  stages: Array<{
    name: string;
    users: number;
    conversionRate: number;
    dropOffRate: number;
  }>;
  totalConversions: number;
  averageTimeToConvert: number;
}

export const useAnalytics = (): UseAnalyticsReturn => {
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    dailyEvents: [],
    weeklyTrends: [],
    userEngagement: {
      activeUsers: 0,
      sessionsPerUser: 0,
      averageSessionDuration: 0,
      featureUsage: {},
      retentionRate: 0,
    },
    performanceMetrics: {
      pageLoadTime: 0,
      scanSpeed: 0,
      fixSpeed: 0,
      apiResponseTime: 0,
      errorRate: 0,
      uptime: 99.9,
    },
    businessMetrics: {
      totalScans: 0,
      totalFixes: 0,
      averageScoreImprovement: 0,
      timeSaved: 0,
      costSaved: 0,
      conversionRate: 0,
      churnRate: 0,
    },
  });
  
  const [isLoading, setIsLoading] = useState(false);
  
  const sessionId = useRef(`session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);
  const pageLoadTime = useRef(Date.now());
  
  // Other hooks
  const scanner = useScanner();
  const fixer = useAutoFix();
  const reports = useReports();
  
  // Track event
  const trackEvent = useCallback((
    type: AnalyticsEvent['type'],
    name: string,
    metadata: Record<string, any> = {}
  ) => {
    const event: AnalyticsEvent = {
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      name,
      timestamp: new Date(),
      metadata,
      sessionId: sessionId.current,
      userId: localStorage.getItem('user_id') || undefined,
    };
    
    setAnalytics(prev => ({
      ...prev,
      dailyEvents: [event, ...prev.dailyEvents.slice(0, 999)], // Keep last 1000 events
    }));
    
    // Send to analytics service (in production)
    if (process.env.NODE_ENV === 'production') {
      // navigator.sendBeacon('/api/analytics/events', JSON.stringify(event));
    }
    
    // Update feature usage
    if (type === 'user_action') {
      setAnalytics(prev => ({
        ...prev,
        userEngagement: {
          ...prev.userEngagement,
          featureUsage: {
            ...prev.userEngagement.featureUsage,
            [name]: (prev.userEngagement.featureUsage[name] || 0) + 1,
          },
        },
      }));
    }
  }, []);
  
  // Track error
  const trackError = useCallback((error: Error, context?: string) => {
    trackEvent('error', error.name, {
      message: error.message,
      stack: error.stack,
      context,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  }, [trackEvent]);
  
  // Track performance metric
  const trackPerformance = useCallback((metric: string, value: number) => {
    trackEvent('performance', metric, { value });
    
    setAnalytics(prev => ({
      ...prev,
      performanceMetrics: {
        ...prev.performanceMetrics,
        [metric]: value,
      },
    }));
  }, [trackEvent]);
  
  // Refresh analytics data
  const refreshAnalytics = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // Calculate all metrics in parallel
      const [
        weeklyTrends,
        userEngagement,
        performanceMetrics,
        businessMetrics,
      ] = await Promise.all([
        calculateWeeklyTrends(),
        calculateUserEngagement(),
        calculatePerformanceMetrics(),
        calculateBusinessMetrics(),
      ]);
      
      setAnalytics(prev => ({
        ...prev,
        weeklyTrends,
        userEngagement,
        performanceMetrics,
        businessMetrics,
      }));
      
    } catch (error) {
      trackError(error as Error, 'refreshAnalytics');
    } finally {
      setIsLoading(false);
    }
  }, [trackError]);
  
  // Calculate weekly trends
  const calculateWeeklyTrends = useCallback(async (): Promise<TrendData[]> => {
    const trends: TrendData[] = [];
    const now = new Date();
    
    // Generate last 7 days of data
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      // Filter events for this date
      const dayEvents = analytics.dailyEvents.filter(event => {
        const eventDate = event.timestamp.toISOString().split('T')[0];
        return eventDate === dateStr;
      });
      
      const scans = dayEvents.filter(e => e.type === 'scan').length;
      const fixes = dayEvents.filter(e => e.type === 'fix').length;
      const reportsCount = dayEvents.filter(e => e.type === 'report').length;
      
      // Calculate average score for the day
      const scanEvents = dayEvents.filter(e => e.type === 'scan');
      const totalScore = scanEvents.reduce((sum, event) => 
        sum + (event.metadata.score || 0), 0);
      const avgScore = scanEvents.length > 0 ? totalScore / scanEvents.length : 0;
      
      trends.push({
        date: dateStr,
        scans,
        fixes,
        reports: reportsCount,
        score: Math.round(avgScore * 10) / 10,
      });
    }
    
    return trends;
  }, [analytics.dailyEvents]);
  
  // Calculate user engagement metrics
  const calculateUserEngagement = useCallback(async (): Promise<EngagementMetrics> => {
    // Calculate active users (unique sessions in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentEvents = analytics.dailyEvents.filter(
      event => event.timestamp > thirtyDaysAgo
    );
    
    const uniqueSessions = new Set(recentEvents.map(e => e.sessionId));
    const activeUsers = uniqueSessions.size;
    
    // Calculate sessions per user (simplified)
    const sessionsPerUser = activeUsers > 0 ? recentEvents.length / activeUsers : 0;
    
    // Calculate average session duration (simplified)
    const sessionDurations: number[] = [];
    const sessions = new Map<string, Date>();
    
    recentEvents.forEach(event => {
      if (!sessions.has(event.sessionId)) {
        sessions.set(event.sessionId, event.timestamp);
      }
    });
    
    sessions.forEach((startTime, sessionId) => {
      const sessionEvents = recentEvents.filter(e => e.sessionId === sessionId);
      const endTime = sessionEvents[sessionEvents.length - 1]?.timestamp;
      if (endTime) {
        const duration = endTime.getTime() - startTime.getTime();
        sessionDurations.push(duration);
      }
    });
    
    const averageSessionDuration = sessionDurations.length > 0
      ? sessionDurations.reduce((sum, dur) => sum + dur, 0) / sessionDurations.length
      : 0;
    
    // Calculate retention rate (simplified)
    const retentionRate = 0.85; // Would calculate from actual data
    
    return {
      activeUsers,
      sessionsPerUser: Math.round(sessionsPerUser * 10) / 10,
      averageSessionDuration,
      featureUsage: analytics.userEngagement.featureUsage,
      retentionRate,
    };
  }, [analytics.dailyEvents, analytics.userEngagement.featureUsage]);
  
  // Calculate performance metrics
  const calculatePerformanceMetrics = useCallback(async (): Promise<PerformanceData> => {
    // Calculate page load time
    const loadTime = Date.now() - pageLoadTime.current;
    
    // Calculate scan speed from scanner history
    const scanTimes = scanner.scanHistory.map(scan => {
      // Mock calculation - would use actual timestamps
      return Math.random() * 5000 + 1000;
    });
    
    const scanSpeed = scanTimes.length > 0
      ? scanTimes.reduce((sum, time) => sum + time, 0) / scanTimes.length
      : 0;
    
    // Calculate fix speed
    const fixTimes = fixer.fixHistory.map(fix => {
      // Mock calculation
      return Math.random() * 30000 + 5000;
    });
    
    const fixSpeed = fixTimes.length > 0
      ? fixTimes.reduce((sum, time) => sum + time, 0) / fixTimes.length
      : 0;
    
    // Calculate error rate
    const totalEvents = analytics.dailyEvents.length;
    const errorEvents = analytics.dailyEvents.filter(e => e.type === 'error').length;
    const errorRate = totalEvents > 0 ? (errorEvents / totalEvents) * 100 : 0;
    
    return {
      pageLoadTime: loadTime,
      scanSpeed: Math.round(scanSpeed),
      fixSpeed: Math.round(fixSpeed),
      apiResponseTime: 250, // Mock data
      errorRate: Math.round(errorRate * 10) / 10,
      uptime: 99.9, // Mock data
    };
  }, [scanner.scanHistory, fixer.fixHistory, analytics.dailyEvents]);
  
  // Calculate business metrics
  const calculateBusinessMetrics = useCallback(async (): Promise<BusinessMetrics> => {
    const totalScans = scanner.scanHistory.length;
    const totalFixes = fixer.fixHistory.reduce((sum, fix) => sum + fix.totalFixes, 0);
    
    // Calculate average score improvement
    const improvements = fixer.fixHistory.map(fix => fix.scoreImprovement);
    const averageScoreImprovement = improvements.length > 0
      ? improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length
      : 0;
    
    // Calculate time saved (estimated 30 minutes per fix)
    const timeSaved = totalFixes * 30;
    
    // Calculate cost saved ($50/hour average SEO cost)
    const costSaved = timeSaved * (50 / 60);
    
    // Calculate conversion rate (scans to fixes)
    const conversionRate = totalScans > 0 ? (fixer.fixHistory.length / totalScans) * 100 : 0;
    
    // Calculate churn rate (simplified)
    const churnRate = 5.2; // Mock data
    
    return {
      totalScans,
      totalFixes,
      averageScoreImprovement: Math.round(averageScoreImprovement * 10) / 10,
      timeSaved,
      costSaved: Math.round(costSaved),
      conversionRate: Math.round(conversionRate * 10) / 10,
      churnRate,
    };
  }, [scanner.scanHistory, fixer.fixHistory]);
  
  // Export analytics data
  const exportAnalytics = useCallback((format: 'json' | 'csv'): string => {
    if (format === 'json') {
      return JSON.stringify(analytics, null, 2);
    } else if (format === 'csv') {
      // Convert events to CSV
      const headers = ['ID', 'Type', 'Name', 'Timestamp', 'Session ID', 'User ID'];
      const rows = analytics.dailyEvents.map(event => [
        event.id,
        event.type,
        event.name,
        event.timestamp.toISOString(),
        event.sessionId,
        event.userId || '',
      ]);
      
      return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }
    
    return '';
  }, [analytics]);
  
  // Clear analytics data
  const clearAnalytics = useCallback(async () => {
    setAnalytics({
      dailyEvents: [],
      weeklyTrends: [],
      userEngagement: {
        activeUsers: 0,
        sessionsPerUser: 0,
        averageSessionDuration: 0,
        featureUsage: {},
        retentionRate: 0,
      },
      performanceMetrics: {
        pageLoadTime: 0,
        scanSpeed: 0,
        fixSpeed: 0,
        apiResponseTime: 0,
        errorRate: 0,
        uptime: 99.9,
      },
      businessMetrics: {
        totalScans: 0,
        totalFixes: 0,
        averageScoreImprovement: 0,
        timeSaved: 0,
        costSaved: 0,
        conversionRate: 0,
        churnRate: 0,
      },
    });
  }, []);
  
  // Get top performing pages
  const getTopPages = useCallback(async (limit = 10) => {
    // Group scans by URL
    const urlStats = new Map<string, { scans: number; totalScore: number }>();
    
    scanner.scanHistory.forEach(scan => {
      const stats = urlStats.get(scan.url) || { scans: 0, totalScore: 0 };
      stats.scans += 1;
      stats.totalScore += scan.score;
      urlStats.set(scan.url, stats);
    });
    
    // Convert to array and sort
    const topPages = Array.from(urlStats.entries())
      .map(([url, stats]) => ({
        url,
        score: Math.round((stats.totalScore / stats.scans) * 10) / 10,
        scans: stats.scans,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    return topPages;
  }, [scanner.scanHistory]);
  
  // Get common issues
  const getCommonIssues = useCallback(async (limit = 10) => {
    // Aggregate issues from scans
    const issueCounts = new Map<string, { count: number; severity: string }>();
    
    scanner.scanHistory.forEach(scan => {
      // In real implementation, would access actual issues
      // Mock data for now
      ['Missing Meta Tags', 'Broken Links', 'Slow Images'].forEach(issue => {
        const severity = issue === 'Broken Links' ? 'critical' : 'medium';
        const counts = issueCounts.get(issue) || { count: 0, severity };
        counts.count += 1;
        issueCounts.set(issue, counts);
      });
    });
    
    return Array.from(issueCounts.entries())
      .map(([issue, { count, severity }]) => ({ issue, count, severity }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }, [scanner.scanHistory]);
  
  // Get fix success rate
  const getFixSuccessRate = useCallback(async () => {
    const successfulFixes = fixer.fixHistory.reduce((sum, fix) => sum + fix.successfulFixes, 0);
    const totalFixes = fixer.fixHistory.reduce((sum, fix) => sum + fix.totalFixes, 0);
    
    return totalFixes > 0 ? (successfulFixes / totalFixes) * 100 : 0;
  }, [fixer.fixHistory]);
  
  // Get trend analysis
  const getTrendAnalysis = useCallback(async (period: 'day' | 'week' | 'month') => {
    return analytics.weeklyTrends; // Simplified - would filter by period
  }, [analytics.weeklyTrends]);
  
  // Get ROI calculation
  const getROICalculation = useCallback(async () => {
    const timeSaved = analytics.businessMetrics.timeSaved;
    const costSaved = analytics.businessMetrics.costSaved;
    
    // Simple ROI calculation
    const monthlyCost = 99; // Mock subscription cost
    const roi = ((costSaved - monthlyCost) / monthlyCost) * 100;
    
    return {
      timeSaved,
      costSaved: Math.round(costSaved),
      roi: Math.round(roi * 10) / 10,
    };
  }, [analytics.businessMetrics]);
  
  // Get user activity
  const getUserActivity = useCallback(async (userId?: string) => {
    const userActivity: UserActivity = {
      userId: userId || 'anonymous',
      lastActive: new Date(),
      totalScans: scanner.scanHistory.length,
      totalFixes: fixer.fixHistory.length,
      favoriteFeatures: ['scanner', 'auto-fix'],
      averageScore: 0,
      improvementRate: 0,
    };
    
    return userActivity;
  }, [scanner.scanHistory, fixer.fixHistory]);
  
  // Get heatmap data
  const getHeatmapData = useCallback(async (url: string) => {
    // Mock heatmap data
    const heatmapData: HeatmapData = {
      url,
      clicks: Array.from({ length: 50 }, (_, i) => ({
        x: Math.floor(Math.random() * 1000),
        y: Math.floor(Math.random() * 800),
        count: Math.floor(Math.random() * 10) + 1,
      })),
      scrollDepth: [100, 85, 72, 58, 45, 32, 20, 15, 10, 5],
      timeOnPage: 45, // seconds
    };
    
    return heatmapData;
  }, []);
  
  // Get funnel analysis
  const getFunnelAnalysis = useCallback(async () => {
    const funnelData: FunnelData = {
      stages: [
        { name: 'Visited Site', users: 1000, conversionRate: 100, dropOffRate: 0 },
        { name: 'Started Scan', users: 650, conversionRate: 65, dropOffRate: 35 },
        { name: 'Completed Scan', users: 520, conversionRate: 52, dropOffRate: 13 },
        { name: 'Applied Fixes', users: 320, conversionRate: 32, dropOffRate: 20 },
        { name: 'Subscribed', users: 80, conversionRate: 8, dropOffRate: 24 },
      ],
      totalConversions: 80,
      averageTimeToConvert: 7.5, // days
    };
    
    return funnelData;
  }, []);
  
  // Track page load performance
  useEffect(() => {
    const onLoad = () => {
      const loadTime = Date.now() - pageLoadTime.current;
      trackPerformance('pageLoadTime', loadTime);
    };
    
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, [trackPerformance]);
  
  // Track user interactions
  useEffect(() => {
    const trackClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'BUTTON' || target.closest('button')) {
        const buttonText = target.textContent?.trim() || 'Unknown Button';
        trackEvent('user_action', `click_${buttonText}`, {
          x: event.clientX,
          y: event.clientY,
        });
      }
    };
    
    const trackNavigation = () => {
      trackEvent('user_action', 'page_navigation', {
        from: document.referrer,
        to: window.location.href,
      });
    };
    
    window.addEventListener('click', trackClick);
    window.addEventListener('popstate', trackNavigation);
    
    return () => {
      window.removeEventListener('click', trackClick);
      window.removeEventListener('popstate', trackNavigation);
    };
  }, [trackEvent]);
  
  // Auto-refresh analytics every 5 minutes
  useEffect(() => {
    refreshAnalytics();
    
    const interval = setInterval(() => {
      refreshAnalytics();
    }, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [refreshAnalytics]);
  
  // Track scanner and fixer events
  useEffect(() => {
    if (scanner.currentStatus === 'completed' && scanner.scanResults) {
      trackEvent('scan', 'scan_completed', {
        url: scanner.scanResults.url,
        score: scanner.scanResults.score,
        issues: scanner.scanResults.totalIssues,
      });
    }
    
    if (fixer.currentStatus === 'completed' && fixer.fixResults) {
      trackEvent('fix', 'fix_completed', {
        successfulFixes: fixer.fixResults.successfulFixes,
        scoreImprovement: fixer.fixResults.scoreImprovement,
      });
    }
  }, [scanner.currentStatus, scanner.scanResults, fixer.currentStatus, fixer.fixResults, trackEvent]);
  
  return {
    analytics,
    isLoading,
    trackEvent,
    trackError,
    trackPerformance,
    refreshAnalytics,
    exportAnalytics,
    clearAnalytics,
    getTopPages,
    getCommonIssues,
    getFixSuccessRate,
    getTrendAnalysis,
    getROICalculation,
    getUserActivity,
    getHeatmapData,
    getFunnelAnalysis,
  };
};