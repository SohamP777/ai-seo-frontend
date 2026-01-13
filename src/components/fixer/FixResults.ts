// File: src/components/fixer/FixResults.tsx
'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, memo, Suspense } from 'react';
import { 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  RefreshCw, 
  Download, 
  Filter, 
  ChevronDown, 
  ChevronUp,
  Clock,
  Zap,
  AlertTriangle,
  BarChart3,
  Settings,
  PlayCircle,
  PauseCircle,
  SkipForward,
  RotateCcw,
  Shield,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertOctagon,
  ExternalLink,
  Loader2,
  Sparkles,
  Timer,
  Tag,
  Users,
  FileText,
  Globe,
  Smartphone,
  Database,
  Lock,
  Unlock,
  Trash2,
  Save,
  Upload,
  Calendar,
  Bell,
  ShieldCheck,
  TrendingUp
} from 'lucide-react';
import { useFixer } from '../../hooks/useAutoFix';
import { useScanner } from '../../hooks/useScanner';
import { FixStatus, type FixResult, type SEOIssue, type FixHistory } from '../../types/seo';
import { formatSeoScore } from '../../utils/formatSeoScore';
import { calculateImpact, calculatePriorityScore } from '../../utils/calculateImpact';
import { FIX_CATEGORIES, FIX_STATUS_LABELS, SEVERITY_COLORS, API_ENDPOINTS } from '../../utils/constants';
import Button from '../ui/Button';
import FixCard from '../ui/FixCard';
import ProgressRing from '../ui/ProgressRing';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDebounce, useLocalStorage, useMeasure } from 'react-use';
import { ErrorBoundary } from 'react-error-boundary';
import dynamic from 'next/dynamic';
import * as DOMPurify from 'dompurify';

// Lazy load heavy components
const FixDetailsModal = dynamic(() => import('./FixDetailsModal'), {
  loading: () => <div className="animate-pulse bg-gray-200 h-64 rounded-lg" />
});

const ExportModal = dynamic(() => import('./ExportModal'), {
  loading: () => <div className="animate-pulse bg-gray-200 h-48 rounded-lg" />
});

interface FixResultsProps {
  scanId: string;
  websiteUrl: string;
  issues: SEOIssue[];
  autoFixEnabled?: boolean;
  onFixApplied: (results: FixResult[]) => void;
  onFixStatusChange: (stats: FixStats) => void;
  onRetry: () => void;
  onExportComplete?: (format: string) => void;
  className?: string;
  showAdvanced?: boolean;
  userId?: string;
  teamId?: string;
  projectId?: string;
}

interface FixStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  pending: number;
  successRate: number;
  avgImpact: number;
  avgPriority: number;
  estimatedTime: string;
  criticalCount: number;
  autoFixableCount: number;
}

interface BatchOperation {
  id: string;
  type: 'apply' | 'retry' | 'rollback' | 'schedule' | 'ignore' | 'approve';
  issueIds: string[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

type SortField = 'priority' | 'severity' | 'impact' | 'status' | 'name' | 'category' | 'estimatedTime' | 'confidence' | 'createdAt' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
type FilterType = FixStatus | 'all' | 'fixable' | 'autoFix' | 'critical' | 'high' | 'medium' | 'low' | 'requiresApproval' | 'ignored';
type ViewMode = 'list' | 'grid' | 'compact' | 'timeline';
type ExportFormat = 'json' | 'csv' | 'pdf' | 'html' | 'excel' | 'markdown';

// Error boundary fallback
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => (
  <div className="flex flex-col items-center justify-center p-8 space-y-4 bg-red-50 border border-red-200 rounded-xl">
    <AlertOctagon className="w-12 h-12 text-red-500" />
    <h3 className="text-lg font-semibold text-gray-900">Something went wrong</h3>
    <p className="text-sm text-gray-600 text-center max-w-md">{error.message}</p>
    <div className="flex gap-3">
      <Button onClick={resetErrorBoundary} variant="primary" size="sm">
        Try again
      </Button>
      <Button onClick={() => window.location.reload()} variant="outline" size="sm">
        Reload page
      </Button>
    </div>
  </div>
);

// Loading skeleton
const LoadingSkeleton = () => (
  <div className="space-y-4">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            <div className="w-5 h-5 bg-gray-200 rounded mt-1"></div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 bg-gray-200 rounded"></div>
                <div className="h-6 bg-gray-200 rounded w-64"></div>
                <div className="h-6 bg-gray-200 rounded w-20"></div>
              </div>
              <div className="h-4 bg-gray-200 rounded w-full"></div>
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="flex gap-4">
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-4 bg-gray-200 rounded w-24"></div>
                <div className="h-4 bg-gray-200 rounded w-24"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ))}
  </div>
);

const FixResults: React.FC<FixResultsProps> = ({
  scanId,
  websiteUrl,
  issues,
  autoFixEnabled = false,
  onFixApplied,
  onFixStatusChange,
  onRetry,
  onExportComplete,
  className = '',
  showAdvanced = false,
  userId,
  teamId,
  projectId
}) => {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController>(new AbortController());
  const wsRef = useRef<WebSocket | null>(null);
  const [containerRect, { width, height }] = useMeasure();
  
  // State
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useLocalStorage<SortField>('fixResults_sortField', 'priority');
  const [sortDirection, setSortDirection] = useLocalStorage<SortDirection>('fixResults_sortDirection', 'desc');
  const [filterStatus, setFilterStatus] = useLocalStorage<FilterType>('fixResults_filterStatus', 'all');
  const [viewMode, setViewMode] = useLocalStorage<ViewMode>('fixResults_viewMode', 'list');
  const [showIgnored, setShowIgnored] = useLocalStorage<boolean>('fixResults_showIgnored', false);
  const [showDetailsModal, setShowDetailsModal] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [batchOperations, setBatchOperations] = useState<BatchOperation[]>([]);
  const [activeBatch, setActiveBatch] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch] = useDebounce(searchQuery, 300);
  
  // Hooks
  const { 
    fixResults, 
    isLoading, 
    error, 
    applyFixes, 
    retryFix, 
    rollbackFix, 
    scheduleFix, 
    ignoreFix,
    approveFix,
    getFixResults,
    clearFixResults,
    exportResults,
    syncResults,
    realTimeStats
  } = useFixer();
  
  const { scanProgress, isScanning } = useScanner();
  
  // Initialize WebSocket for real-time updates
  useEffect(() => {
    const setupWebSocket = () => {
      try {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        
        const wsUrl = `${API_ENDPOINTS.WS_BASE}/fixes/${scanId}/updates?userId=${userId}&teamId=${teamId}`;
        const ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
          setConnectionStatus('connected');
          console.log('WebSocket connected for real-time updates');
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'fix_update') {
              handleRealTimeUpdate(data.payload);
            } else if (data.type === 'batch_update') {
              handleBatchUpdate(data.payload);
            } else if (data.type === 'stats_update') {
              handleStatsUpdate(data.payload);
            }
          } catch (err) {
            console.error('WebSocket message parse error:', err);
          }
        };
        
        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setConnectionStatus('reconnecting');
        };
        
        ws.onclose = () => {
          setConnectionStatus('disconnected');
          // Attempt reconnection after delay
          setTimeout(setupWebSocket, 5000);
        };
        
        wsRef.current = ws;
      } catch (err) {
        console.error('WebSocket setup failed:', err);
        setConnectionStatus('disconnected');
      }
    };
    
    if (scanId && userId) {
      setupWebSocket();
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [scanId, userId, teamId]);
  
  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  // Initialize results
  useEffect(() => {
    const initialize = async () => {
      try {
        await getFixResults(scanId);
        
        // If no results but we have issues, create pending fix results
        if (fixResults.length === 0 && issues.length > 0) {
          const pendingResults = issues.map(issue => createFixResultFromIssue(issue));
          await syncResults(scanId, pendingResults);
        }
        
        // Auto-fix if enabled
        if (autoFixEnabled && fixResults.some(r => r.autoFixAvailable && r.status === FixStatus.PENDING)) {
          handleAutoFix();
        }
      } catch (err) {
        toast.error('Failed to initialize fix results');
        console.error('Initialization error:', err);
      }
    };
    
    initialize();
    
    // Set up periodic sync
    const syncInterval = setInterval(async () => {
      if (isOnline) {
        await getFixResults(scanId);
        setLastUpdate(new Date());
      }
    }, 30000); // Sync every 30 seconds
    
    return () => {
      clearInterval(syncInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [scanId, issues.length, autoFixEnabled, isOnline]);
  
  // Real-time update handlers
  const handleRealTimeUpdate = useCallback((update: Partial<FixResult>) => {
    // Update fixResults state
    // This would be handled by the fixer context
    console.log('Real-time update:', update);
  }, []);
  
  const handleBatchUpdate = useCallback((update: Partial<BatchOperation>) => {
    setBatchOperations(prev => {
      const index = prev.findIndex(op => op.id === update.id);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = { ...updated[index], ...update };
        return updated;
      }
      return prev;
    });
  }, []);
  
  const handleStatsUpdate = useCallback((stats: FixStats) => {
    onFixStatusChange(stats);
  }, [onFixStatusChange]);
  
  // Create fix result from issue
  const createFixResultFromIssue = useCallback((issue: SEOIssue): FixResult => {
    const now = new Date().toISOString();
    const priority = calculatePriorityScore(issue.severity, issue.confidence, issue.impactScore);
    const impact = calculateImpact(issue.severity, issue.confidence);
    
    return {
      id: `fix_${scanId}_${issue.id}_${Date.now()}`,
      scanId,
      issueId: issue.id,
      issueName: issue.name,
      description: issue.description,
      severity: issue.severity,
      confidence: issue.confidence,
      status: FixStatus.PENDING,
      element: issue.element,
      location: issue.location,
      category: issue.category,
      fixType: determineFixType(issue),
      estimatedTime: calculateEstimatedTime(issue),
      priority,
      impactScore: impact,
      fixable: issue.fixable,
      autoFixAvailable: issue.autoFixAvailable,
      requiresApproval: determineRequiresApproval(issue),
      riskLevel: determineRiskLevel(issue),
      tags: generateTags(issue),
      metadata: {
        firstDetected: issue.createdAt,
        occurrences: 1,
        lastOccurrence: now,
        affectedPages: [issue.location],
        websiteUrl,
        detectedBy: 'auto-scanner'
      },
      details: {
        steps: generateFixSteps(issue),
        codeSnippet: generateCodeSnippet(issue),
        recommendations: generateRecommendations(issue),
        validationSteps: generateValidationSteps(issue),
        rollbackSteps: generateRollbackSteps(issue),
        resources: generateResources(issue)
      },
      history: [{
        timestamp: now,
        action: 'detected',
        status: FixStatus.PENDING,
        details: 'Issue detected by SEO scanner',
        performedBy: 'system'
      }],
      appliedAt: undefined,
      completedAt: undefined,
      scheduledFor: undefined,
      error: undefined,
      warnings: [],
      notes: [],
      ignored: false,
      beforeValue: issue.data?.currentValue,
      afterValue: undefined,
      createdAt: now,
      updatedAt: now,
      userId,
      teamId,
      projectId
    };
  }, [scanId, websiteUrl, userId, teamId, projectId]);
  
  // Helper functions with complete business logic
  const determineFixType = useCallback((issue: SEOIssue): 'automated' | 'manual' | 'semi-automated' => {
    if (!issue.fixable) return 'manual';
    if (issue.autoFixAvailable) {
      // High severity issues with auto-fix need review
      if (issue.severity === 'high' || issue.severity === 'critical') {
        return 'semi-automated';
      }
      return 'automated';
    }
    return issue.fixable ? 'semi-automated' : 'manual';
  }, []);
  
  const calculateEstimatedTime = useCallback((issue: SEOIssue): string => {
    const baseTime = {
      critical: 30,
      high: 15,
      medium: 8,
      low: 3
    }[issue.severity] || 5;
    
    const categoryMultiplier = {
      'security': 2.0,
      'performance': 1.8,
      'accessibility': 1.5,
      'meta-tags': 1.2,
      'headers': 1.3,
      'images': 1.4,
      'links': 1.6,
      'content': 1.7
    }[issue.category] || 1.0;
    
    const confidenceMultiplier = issue.confidence > 90 ? 0.8 : 1.0;
    
    const estimatedMinutes = Math.ceil(baseTime * categoryMultiplier * confidenceMultiplier);
    
    if (estimatedMinutes < 1) return '< 1 min';
    if (estimatedMinutes === 1) return '1 min';
    if (estimatedMinutes < 60) return `${estimatedMinutes} mins`;
    
    const hours = Math.floor(estimatedMinutes / 60);
    const minutes = estimatedMinutes % 60;
    
    if (minutes === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return `${hours}h ${minutes}m`;
  }, []);
  
  const determineRequiresApproval = useCallback((issue: SEOIssue): boolean => {
    // High severity, high impact, or security-related issues require approval
    return (
      issue.severity === 'critical' ||
      (issue.severity === 'high' && issue.confidence > 80) ||
      issue.category === 'security' ||
      issue.impactScore > 85
    );
  }, []);
  
  const determineRiskLevel = useCallback((issue: SEOIssue): 'low' | 'medium' | 'high' | 'critical' => {
    const score = issue.confidence * (issue.severity === 'critical' ? 1.0 : 
                    issue.severity === 'high' ? 0.8 : 
                    issue.severity === 'medium' ? 0.6 : 0.4);
    
    if (score > 80) return 'critical';
    if (score > 60) return 'high';
    if (score > 40) return 'medium';
    return 'low';
  }, []);
  
  const generateTags = useCallback((issue: SEOIssue): string[] => {
    const tags = [issue.category, `severity-${issue.severity}`];
    
    if (issue.autoFixAvailable) tags.push('auto-fixable');
    if (issue.fixable) tags.push('fixable');
    if (issue.impactScore > 70) tags.push('high-impact');
    if (issue.confidence > 90) tags.push('high-confidence');
    if (determineRequiresApproval(issue)) tags.push('requires-approval');
    
    // Add platform-specific tags
    if (issue.location.includes('.php')) tags.push('php');
    if (issue.location.includes('.js') || issue.location.includes('.ts')) tags.push('javascript');
    if (issue.location.includes('.css')) tags.push('css');
    if (issue.element?.includes('mobile')) tags.push('mobile');
    if (issue.element?.includes('desktop')) tags.push('desktop');
    
    return [...new Set(tags)];
  }, [determineRequiresApproval]);
  
  const generateFixSteps = useCallback((issue: SEOIssue): string[] => {
    const commonSteps = [
      'Review the issue details and impact analysis',
      'Check if similar issues have been fixed before',
      'Prepare the necessary changes or code updates',
      'Test the fix in a development/staging environment',
      'Verify the fix resolves the issue without side effects',
      'Document the changes made for future reference'
    ];
    
    const categorySpecificSteps: Record<string, string[]> = {
      'meta-tags': [
        'Locate the HTML template file',
        'Find the head section',
        'Add or update meta description (150-160 characters)',
        'Add or update meta keywords if relevant',
        'Add Open Graph tags for social sharing',
        'Add Twitter Card meta tags',
        'Set canonical URL',
        'Add robots meta tag if needed',
        'Test with Google Rich Results Test'
      ],
      'headers': [
        'Analyze current heading hierarchy',
        'Ensure only one H1 per page',
        'Fix heading order (H1 → H2 → H3)',
        'Add missing headings for content sections',
        'Make headings descriptive and keyword-rich',
        'Add ARIA labels for accessibility',
        'Test with screen readers'
      ],
      'images': [
        'Identify all unoptimized images',
        'Compress images using appropriate tools',
        'Convert to WebP format for better compression',
        'Add descriptive alt text with keywords',
        'Implement lazy loading',
        'Set proper width and height attributes',
        'Add srcset for responsive images',
        'Monitor Core Web Vitals impact'
      ],
      'performance': [
        'Analyze performance metrics',
        'Minify CSS and JavaScript files',
        'Implement code splitting',
        'Optimize critical rendering path',
        'Defer non-critical JavaScript',
        'Preload key resources',
        'Implement browser caching',
        'Optimize server response time'
      ]
    };
    
    return categorySpecificSteps[issue.category] || commonSteps;
  }, []);
  
  const generateCodeSnippet = useCallback((issue: SEOIssue): string => {
    // Sanitize any user input in code snippets
    const sanitize = (input: string) => DOMPurify.sanitize(input, { ALLOWED_TAGS: [] });
    
    const snippets: Record<string, string> = {
      'meta-tags': `<!-- Before: Missing or poor meta tags -->
<!-- <meta name="description" content=""> -->

<!-- After: Optimized meta tags -->
<meta name="description" content="${sanitize(issue.element || 'A clear, compelling description of your page content that includes primary keywords and value proposition. Keep between 150-160 characters.')}">
<meta name="keywords" content="${sanitize(issue.element ? `${issue.element}, related terms` : 'primary, secondary, tertiary keywords')}">
<meta property="og:title" content="${sanitize(issue.element || 'Your Page Title for Social Media')}">
<meta property="og:description" content="${sanitize(issue.element || 'Share-worthy description for social media platforms')}">
<meta property="og:image" content="/social-image.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://yourdomain.com${sanitize(issue.location || '')}">`,
      
      'headers': `<!-- Before: Poor heading structure -->
<!-- <div class="title">${sanitize(issue.element || 'Page Title')}</div> -->
<!-- <h3>Subheading</h3> -->
<!-- <h2>Another Heading</h2> -->

<!-- After: Proper semantic hierarchy -->
<h1>${sanitize(issue.element || 'Main Page Heading (H1)')}</h1>
<nav aria-label="Main navigation">...</nav>
<main>
  <section aria-labelledby="section1">
    <h2 id="section1">${sanitize(issue.element || 'Main Section Heading (H2)')}</h2>
    <article>
      <h3>${sanitize(issue.element || 'Subsection Heading (H3)')}</h3>
      <p>Your content here...</p>
    </article>
  </section>
</main>`,
      
      'images': `<!-- Before: Unoptimized image -->
<!-- <img src="large-image.jpg"> -->

<!-- After: Optimized responsive image -->
<picture>
  <source srcset="image.webp" type="image/webp">
  <source srcset="image.jpg" type="image/jpeg">
  <img 
    src="image.jpg" 
    alt="${sanitize(issue.element || 'Detailed, descriptive alternative text explaining the image content and context. Include keywords naturally.')}"
    width="800" 
    height="600"
    loading="lazy"
    decoding="async"
    class="responsive-image"
  >
</picture>`
    };
    
    return snippets[issue.category] || 
      `// Fix implementation for: ${sanitize(issue.name)}
// Category: ${sanitize(issue.category)}
// Severity: ${sanitize(issue.severity)}
// Impact Score: ${issue.impactScore}
// Auto-fix available: ${issue.autoFixAvailable ? 'Yes' : 'No'}

// Implementation steps:
// 1. ${sanitize(issue.description)}
// 2. Follow best practices for ${sanitize(issue.category)}
// 3. Test thoroughly before deployment
// 4. Monitor after deployment`;
  }, []);
  
  const generateValidationSteps = useCallback((issue: SEOIssue): string[] => [
    'Run automated test suite',
    'Check browser console for errors',
    'Validate HTML structure (W3C Validator)',
    'Test accessibility (axe-core, Lighthouse)',
    'Verify mobile responsiveness',
    'Check cross-browser compatibility',
    'Test page speed before/after',
    'Verify SEO markup (Structured Data Testing Tool)',
    'Check for broken links',
    'Validate form submissions if applicable',
    'Test user interactions',
    'Monitor error logs for 24 hours',
    'Verify analytics tracking still works',
    'Check CDN/edge delivery'
  ], []);
  
  const generateRollbackSteps = useCallback((issue: SEOIssue): string[] => [
    'Create backup of current production state',
    'Document current configuration and settings',
    'Prepare rollback script or procedure',
    'Test rollback in staging environment',
    'Schedule maintenance window if needed',
    'Notify stakeholders about rollback',
    'Execute rollback procedure',
    'Verify previous functionality is restored',
    'Update documentation with lessons learned',
    'Analyze root cause of failure',
    'Plan improved fix approach',
    'Schedule re-application if appropriate'
  ], []);
  
  const generateResources = useCallback((issue: SEOIssue): string[] => [
    'Google Search Console',
    'Google PageSpeed Insights',
    'Mozilla Developer Network (MDN)',
    'Web Content Accessibility Guidelines (WCAG)',
    'Google Rich Results Test',
    'Structured Data Testing Tool',
    'W3C Validator',
    'Lighthouse Audit',
    'SEO best practices documentation',
    'Industry benchmarks and standards'
  ], []);
  
  const generateRecommendations = useCallback((issue: SEOIssue): string[] => {
    const recommendations: string[] = [];
    
    // Severity-based recommendations
    if (issue.severity === 'critical' || issue.severity === 'high') {
      recommendations.push('Fix immediately to prevent significant SEO ranking drops');
      recommendations.push('Monitor Search Console for impact after fixing');
    }
    
    // Confidence-based recommendations
    if (issue.confidence >= 95) {
      recommendations.push('High confidence issue - strongly recommended to fix');
    } else if (issue.confidence >= 80) {
      recommendations.push('Good confidence - recommended to fix');
    }
    
    // Auto-fix recommendations
    if (issue.autoFixAvailable) {
      recommendations.push('Auto-fix available - can be scheduled immediately');
      recommendations.push('Recommended to review auto-fix before production deployment');
    }
    
    // Impact-based recommendations
    if (issue.impactScore > 80) {
      recommendations.push('High impact on SEO performance - prioritize in current sprint');
    } else if (issue.impactScore > 60) {
      recommendations.push('Moderate impact - schedule for upcoming sprint');
    }
    
    // General best practices
    recommendations.push('Review with development team before implementation');
    recommendations.push('Update regression tests to prevent regression');
    recommendations.push('Schedule follow-up audit in 2-4 weeks');
    recommendations.push('Document resolution in knowledge base/wiki');
    recommendations.push('Share learnings with team during next standup');
    
    return recommendations;
  }, []);
  
  // Core business logic functions
  const handleAutoFix = useCallback(async () => {
    const autoFixableIssues = fixResults.filter(r => 
      r.autoFixAvailable && 
      r.status === FixStatus.PENDING && 
      !r.requiresApproval &&
      !r.ignored
    );
    
    if (autoFixableIssues.length === 0) {
      toast.info('No auto-fixable issues available');
      return;
    }
    
    const issueIds = autoFixableIssues.map(r => r.issueId);
    const batchId = `batch_auto_${Date.now()}`;
    
    const batchOp: BatchOperation = {
      id: batchId,
      type: 'apply',
      issueIds,
      status: 'running',
      progress: 0,
      createdAt: new Date(),
      startedAt: new Date(),
      userId,
      metadata: {
        autoFix: true,
        count: issueIds.length
      }
    };
    
    setBatchOperations(prev => [...prev, batchOp]);
    setActiveBatch(batchId);
    
    try {
      toast.loading(`Applying ${issueIds.length} auto-fixes...`);
      
      const results = await applyFixes(scanId, issueIds, true, {
        batchId,
        signal: abortControllerRef.current.signal,
        onProgress: (progress) => {
          setBatchOperations(prev => prev.map(op => 
            op.id === batchId ? { ...op, progress } : op
          ));
        }
      });
      
      // Update batch operation
      setBatchOperations(prev => prev.map(op => 
        op.id === batchId ? { 
          ...op, 
          status: 'completed', 
          progress: 100,
          completedAt: new Date()
        } : op
      ));
      
      toast.success(`Successfully applied ${results.filter(r => r.status === FixStatus.COMPLETED).length} auto-fixes`);
      
      // Analytics event
      window.gtag?.('event', 'auto_fix_complete', {
        event_category: 'fix_operations',
        event_label: scanId,
        value: results.length,
        success_count: results.filter(r => r.status === FixStatus.COMPLETED).length
      });
      
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Auto-fix failed');
      
      setBatchOperations(prev => prev.map(op => 
        op.id === batchId ? { 
          ...op, 
          status: 'failed', 
          error: error.message,
          completedAt: new Date()
        } : op
      ));
      
      toast.error(`Auto-fix failed: ${error.message}`);
      
      // Analytics event
      window.gtag?.('event', 'auto_fix_error', {
        event_category: 'fix_operations',
        event_label: scanId,
        error: error.message
      });
      
      throw err;
    } finally {
      setActiveBatch(null);
    }
  }, [fixResults, applyFixes, scanId, userId]);
  
  const handleBatchApply = useCallback(async (issueIds: string[], type: 'auto' | 'manual' = 'manual') => {
    if (issueIds.length === 0) {
      toast.error('No issues selected');
      return;
    }
    
    const requiresApproval = fixResults.some(r => 
      issueIds.includes(r.issueId) && r.requiresApproval
    );
    
    if (requiresApproval && type === 'manual') {
      toast.error('Some issues require approval before fixing');
      return;
    }
    
    const batchId = `batch_${type}_${Date.now()}`;
    
    const batchOp: BatchOperation = {
      id: batchId,
      type: 'apply',
      issueIds,
      status: 'running',
      progress: 0,
      createdAt: new Date(),
      startedAt: new Date(),
      userId,
      metadata: {
        type,
        count: issueIds.length
      }
    };
    
    setBatchOperations(prev => [...prev, batchOp]);
    setActiveBatch(batchId);
    
    try {
      toast.loading(`Applying ${issueIds.length} fixes...`);
      
      const results = await applyFixes(scanId, issueIds, type === 'auto', {
        batchId,
        signal: abortControllerRef.current.signal,
        onProgress: (progress) => {
          setBatchOperations(prev => prev.map(op => 
            op.id === batchId ? { ...op, progress } : op
          ));
        }
      });
      
      // Update selected issues
      setSelectedIssues(prev => {
        const newSet = new Set(prev);
        issueIds.forEach(id => newSet.delete(id));
        return newSet;
      });
      
      // Update batch operation
      setBatchOperations(prev => prev.map(op => 
        op.id === batchId ? { 
          ...op, 
          status: 'completed', 
          progress: 100,
          completedAt: new Date()
        } : op
      ));
      
      const successCount = results.filter(r => r.status === FixStatus.COMPLETED).length;
      toast.success(`Successfully applied ${successCount} of ${issueIds.length} fixes`);
      
      onFixApplied(results);
      
      // Analytics event
      window.gtag?.('event', 'batch_fix_complete', {
        event_category: 'fix_operations',
        event_label: scanId,
        batch_type: type,
        total_count: issueIds.length,
        success_count: successCount
      });
      
      return results;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Batch apply failed');
      
      setBatchOperations(prev => prev.map(op => 
        op.id === batchId ? { 
          ...op, 
          status: 'failed', 
          error: error.message,
          completedAt: new Date()
        } : op
      ));
      
      toast.error(`Batch apply failed: ${error.message}`);
      
      // Analytics event
      window.gtag?.('event', 'batch_fix_error', {
        event_category: 'fix_operations',
        event_label: scanId,
        batch_type: type,
        error: error.message,
        count: issueIds.length
      });
      
      throw err;
    } finally {
      setActiveBatch(null);
    }
  }, [fixResults, applyFixes, scanId, userId, onFixApplied]);
  
  const handleRetryFailed = useCallback(async () => {
    const failedIssues = fixResults
      .filter(r => r.status === FixStatus.FAILED && r.fixable && !r.ignored)
      .map(r => r.issueId);
    
    if (failedIssues.length === 0) {
      toast.error('No failed fixes to retry');
      return;
    }
    
    await handleBatchApply(failedIssues, 'manual');
  }, [fixResults, handleBatchApply]);
  
  const handleIgnoreIssues = useCallback(async (issueIds: string[]) => {
    try {
      toast.loading('Ignoring selected issues...');
      
      for (const issueId of issueIds) {
        await ignoreFix(issueId);
      }
      
      setSelectedIssues(prev => {
        const newSet = new Set(prev);
        issueIds.forEach(id => newSet.delete(id));
        return newSet;
      });
      
      toast.success(`Ignored ${issueIds.length} issue${issueIds.length !== 1 ? 's' : ''}`);
      
      // Analytics event
      window.gtag?.('event', 'issues_ignored', {
        event_category: 'fix_operations',
        event_label: scanId,
        count: issueIds.length
      });
    } catch (err) {
      toast.error('Failed to ignore issues');
      throw err;
    }
  }, [ignoreFix, scanId]);
  
  const handleApproveIssues = useCallback(async (issueIds: string[]) => {
    try {
      toast.loading('Approving selected issues...');
      
      for (const issueId of issueIds) {
        await approveFix(issueId);
      }
      
      toast.success(`Approved ${issueIds.length} issue${issueIds.length !== 1 ? 's' : ''}`);
      
      // Analytics event
      window.gtag?.('event', 'issues_approved', {
        event_category: 'fix_operations',
        event_label: scanId,
        count: issueIds.length
      });
    } catch (err) {
      toast.error('Failed to approve issues');
      throw err;
    }
  }, [approveFix, scanId]);
  
  const handleExport = useCallback(async (format: ExportFormat) => {
    try {
      setShowExportModal(false);
      toast.loading(`Exporting as ${format.toUpperCase()}...`);
      
      const data = await exportResults(scanId, format);
      
      // Create download
      const blob = new Blob([data], { type: getMimeType(format) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seo-fixes-${websiteUrl.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`Exported as ${format.toUpperCase()}`);
      onExportComplete?.(format);
      
      // Analytics event
      window.gtag?.('event', 'export_complete', {
        event_category: 'reports',
        event_label: scanId,
        format,
        count: fixResults.length
      });
    } catch (err) {
      toast.error('Export failed');
      throw err;
    }
  }, [exportResults, scanId, websiteUrl, fixResults.length, onExportComplete]);
  
  // Virtualization for large lists
  const virtualizer = useVirtualizer({
    count: filteredResults.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => viewMode === 'compact' ? 60 : 120,
    overscan: 10,
  });
  
  // Filter and sort results
  const filteredResults = useMemo(() => {
    let results = [...fixResults];
    
    // Apply search filter
    if (debouncedSearch) {
      const query = debouncedSearch.toLowerCase();
      results = results.filter(r => 
        r.issueName.toLowerCase().includes(query) ||
        r.description.toLowerCase().includes(query) ||
        r.category.toLowerCase().includes(query) ||
        r.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    // Apply status filter
    if (filterStatus !== 'all') {
      switch (filterStatus) {
        case 'fixable':
          results = results.filter(r => r.fixable);
          break;
        case 'autoFix':
          results = results.filter(r => r.autoFixAvailable);
          break;
        case 'critical':
          results = results.filter(r => r.severity === 'critical');
          break;
        case 'high':
          results = results.filter(r => r.severity === 'high');
          break;
        case 'medium':
          results = results.filter(r => r.severity === 'medium');
          break;
        case 'low':
          results = results.filter(r => r.severity === 'low');
          break;
        case 'requiresApproval':
          results = results.filter(r => r.requiresApproval);
          break;
        case 'ignored':
          results = results.filter(r => r.ignored);
          break;
        default:
          results = results.filter(r => r.status === filterStatus);
      }
    }
    
    if (!showIgnored) {
      results = results.filter(r => !r.ignored);
    }
    
    // Apply sorting
    results.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortField) {
        case 'priority':
          aValue = a.priority || 0;
          bValue = b.priority || 0;
          break;
        case 'severity':
          const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          aValue = severityOrder[a.severity] || 0;
          bValue = severityOrder[b.severity] || 0;
          break;
        case 'impact':
          aValue = a.impactScore || 0;
          bValue = b.impactScore || 0;
          break;
        case 'confidence':
          aValue = a.confidence;
          bValue = b.confidence;
          break;
        case 'estimatedTime':
          const getTime = (time: string) => {
            const match = time.match(/(\d+)/);
            return match ? parseInt(match[1]) : 0;
          };
          aValue = getTime(a.estimatedTime || '0');
          bValue = getTime(b.estimatedTime || '0');
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        case 'updatedAt':
          aValue = new Date(a.updatedAt).getTime();
          bValue = new Date(b.updatedAt).getTime();
          break;
        default:
          aValue = (a as any)[sortField] || '';
          bValue = (b as any)[sortField] || '';
      }
      
      return sortDirection === 'asc' ? 
        (aValue > bValue ? 1 : -1) : 
        (aValue < bValue ? 1 : -1);
    });
    
    return results;
  }, [fixResults, debouncedSearch, filterStatus, showIgnored, sortField, sortDirection]);
  
  // Calculate statistics
  const statistics = useMemo((): FixStats => {
    const total = fixResults.length;
    const completed = fixResults.filter(r => r.status === FixStatus.COMPLETED).length;
    const failed = fixResults.filter(r => r.status === FixStatus.FAILED).length;
    const inProgress = fixResults.filter(r => r.status === FixStatus.IN_PROGRESS).length;
    const pending = fixResults.filter(r => r.status === FixStatus.PENDING).length;
    
    const fixable = fixResults.filter(r => r.fixable).length;
    const autoFixable = fixResults.filter(r => r.autoFixAvailable).length;
    const critical = fixResults.filter(r => r.severity === 'critical').length;
    
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const avgImpact = fixResults.length > 0 
      ? fixResults.reduce((sum, result) => sum + (result.impactScore || 0), 0) / fixResults.length
      : 0;

    const estimatedTotalTime = fixResults.reduce((total, result) => {
      const match = (result.estimatedTime || '0').match(/(\d+)/);
      return total + (match ? parseInt(match[1]) : 0);
    }, 0);

    const avgPriority = fixResults.length > 0
      ? fixResults.reduce((sum, result) => sum + (result.priority || 0), 0) / fixResults.length
      : 0;

    return {
      total,
      completed,
      failed,
      inProgress,
      pending,
      successRate,
      avgImpact,
      avgPriority: Math.round(avgPriority),
      estimatedTotalTime: estimatedTotalTime < 60 ? 
        `${estimatedTotalTime} min` : 
        `${Math.floor(estimatedTotalTime / 60)}h ${estimatedTotalTime % 60}m`,
      criticalCount: critical,
      autoFixableCount: autoFixable
    };
  }, [fixResults]);
  
  // Update parent with stats
  useEffect(() => {
    onFixStatusChange(statistics);
  }, [statistics, onFixStatusChange]);
  
  // Helper functions
  const getMimeType = (format: ExportFormat): string => {
    const mimes: Record<ExportFormat, string> = {
      json: 'application/json',
      csv: 'text/csv',
      pdf: 'application/pdf',
      html: 'text/html',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      markdown: 'text/markdown'
    };
    return mimes[format];
  };
  
  const getStatusIcon = useCallback((status: FixStatus) => {
    switch (status) {
      case FixStatus.COMPLETED:
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case FixStatus.FAILED:
        return <XCircle className="w-5 h-5 text-red-500" />;
      case FixStatus.IN_PROGRESS:
        return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
      case FixStatus.PENDING:
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case FixStatus.SCHEDULED:
        return <Calendar className="w-5 h-5 text-purple-500" />;
      case FixStatus.IGNORED:
        return <EyeOff className="w-5 h-5 text-gray-500" />;
      default:
        return null;
    }
  }, []);
  
  const getSeverityBadge = useCallback((severity: string) => {
    const config = SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] || SEVERITY_COLORS.low;
    return (
      <span className={`px-3 py-1 text-xs font-semibold rounded-full ${config.bg} ${config.text}`}>
        {severity.toUpperCase()}
      </span>
    );
  }, []);
  
  const formatTimeAgo = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }, []);
  
  // Render functions
  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <Globe className="w-16 h-16 text-gray-300 mb-4" />
      <h3 className="text-xl font-semibold text-gray-900 mb-2">No Fix Results Yet</h3>
      <p className="text-gray-600 max-w-md mb-6">
        Run an SEO scan to identify issues that need fixing. Once scanned, issues will appear here with recommended fixes.
      </p>
      <Button onClick={onRetry} variant="primary" icon={<RefreshCw className="w-4 h-4" />}>
        Run New Scan
      </Button>
    </div>
  );
  
  const renderLoadingState = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
      <LoadingSkeleton />
    </div>
  );
  
  const renderErrorState = () => (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <AlertOctagon className="w-16 h-16 text-red-500 mb-4" />
      <h3 className="text-xl font-semibold text-gray-900 mb-2">Failed to Load Results</h3>
      <p className="text-gray-600 max-w-md mb-2">{error}</p>
      <p className="text-sm text-gray-500 mb-6">Check your connection and try again</p>
      <div className="flex gap-3">
        <Button onClick={onRetry} variant="primary" icon={<RefreshCw className="w-4 h-4" />}>
          Retry
        </Button>
        <Button onClick={clearFixResults} variant="outline" icon={<Trash2 className="w-4 h-4" />}>
          Clear Results
        </Button>
      </div>
    </div>
  );
  
  const renderConnectionStatus = () => (
    <div className={`px-3 py-2 rounded-lg text-sm font-medium ${
      connectionStatus === 'connected' ? 'bg-green-100 text-green-800' :
      connectionStatus === 'reconnecting' ? 'bg-yellow-100 text-yellow-800' :
      'bg-red-100 text-red-800'
    }`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          connectionStatus === 'connected' ? 'bg-green-500' :
          connectionStatus === 'reconnecting' ? 'bg-yellow-500' :
          'bg-red-500'
        }`} />
        <span>
          {connectionStatus === 'connected' ? 'Live updates connected' :
           connectionStatus === 'reconnecting' ? 'Reconnecting...' :
           'Disconnected - updates paused'}
        </span>
      </div>
    </div>
  );
  
  const renderStatsCards = () => (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-blue-700 font-medium">Total Issues</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{statistics.total}</p>
          </div>
          <Database className="w-8 h-8 text-blue-600 opacity-70" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-xl border border-green-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-green-700 font-medium">Fixed</p>
            <p className="text-2xl font-bold text-green-900 mt-1">{statistics.completed}</p>
          </div>
          <CheckCircle className="w-8 h-8 text-green-600 opacity-70" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-red-50 to-red-100 p-4 rounded-xl border border-red-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-red-700 font-medium">Failed</p>
            <p className="text-2xl font-bold text-red-900 mt-1">{statistics.failed}</p>
          </div>
          <AlertTriangle className="w-8 h-8 text-red-600 opacity-70" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-purple-700 font-medium">Success Rate</p>
            <p className="text-2xl font-bold text-purple-900 mt-1">{statistics.successRate}%</p>
          </div>
          <TrendingUp className="w-8 h-8 text-purple-600 opacity-70" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-xl border border-orange-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-orange-700 font-medium">Est. Time</p>
            <p className="text-2xl font-bold text-orange-900 mt-1">{statistics.estimatedTime}</p>
          </div>
          <Timer className="w-8 h-8 text-orange-600 opacity-70" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-cyan-50 to-cyan-100 p-4 rounded-xl border border-cyan-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-cyan-700 font-medium">Priority</p>
            <p className="text-2xl font-bold text-cyan-900 mt-1">{statistics.avgPriority}/100</p>
          </div>
          <Sparkles className="w-8 h-8 text-cyan-600 opacity-70" />
        </div>
      </div>
    </div>
  );
  
  const renderIssueCard = (result: FixResult, index: number) => (
    <motion.div
      key={result.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            <input
              type="checkbox"
              checked={selectedIssues.has(result.issueId)}
              onChange={() => setSelectedIssues(prev => {
                const next = new Set(prev);
                if (next.has(result.issueId)) {
                  next.delete(result.issueId);
                } else {
                  next.add(result.issueId);
                }
                return next;
              })}
              disabled={result.status === FixStatus.IN_PROGRESS || result.ignored}
              className="mt-1.5 h-4 w-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300 disabled:opacity-50"
            />
            
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {getStatusIcon(result.status)}
                  <h3 className="font-semibold text-gray-900 text-lg">{result.issueName}</h3>
                  {getSeverityBadge(result.severity)}
                  {result.requiresApproval && !result.ignored && (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                      <Shield className="w-3 h-3 inline mr-1" />
                      Needs Approval
                    </span>
                  )}
                  {result.ignored && (
                    <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700">
                      <EyeOff className="w-3 h-3 inline mr-1" />
                      Ignored
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-900">
                      {formatSeoScore(result.impactScore)}
                    </div>
                    <div className="text-xs text-gray-500">Impact</div>
                  </div>
                  
                  <button
                    onClick={() => setExpandedIssues(prev => {
                      const next = new Set(prev);
                      if (next.has(result.id)) {
                        next.delete(result.id);
                      } else {
                        next.add(result.id);
                      }
                      return next;
                    })}
                    className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    {expandedIssues.has(result.id) ? (
                      <ChevronUp className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    )}
                  </button>
                </div>
              </div>
              
              <p className="mt-2 text-gray-600">{result.description}</p>
              
              <div className="mt-4 flex flex-wrap gap-4">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">Category:</span>
                  <span className="text-sm font-medium text-gray-900">{result.category}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Confidence:</span>
                  <span className="text-sm font-semibold text-gray-900">{result.confidence}%</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">{result.estimatedTime}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">Priority:</span>
                  <span className="text-sm font-bold text-gray-900">{result.priority}/100</span>
                </div>
                
                {result.autoFixAvailable && !result.ignored && (
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-orange-500" />
                    <span className="text-sm font-medium text-orange-600">Auto-fix available</span>
                  </div>
                )}
              </div>
              
              {result.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.tags.map(tag => (
                    <span key={tag} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Expanded details */}
        {expandedIssues.has(result.id) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 pt-6 border-t border-gray-200 space-y-6"
          >
            <FixCard
              issue={result}
              onApplyFix={() => handleBatchApply([result.issueId], result.autoFixAvailable ? 'auto' : 'manual')}
              onRetryFix={() => retryFix(result.id)}
              onRollback={() => rollbackFix(result.id)}
              onSchedule={(date) => scheduleFix(result.id, date)}
              onIgnore={() => handleIgnoreIssues([result.issueId])}
              onApprove={() => handleApproveIssues([result.issueId])}
              isApplying={activeBatch?.includes('apply')}
              showActions={!result.ignored}
              requiresApproval={result.requiresApproval}
              isIgnored={result.ignored}
            />
            
            {/* History */}
            {result.history.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  History
                </h4>
                <div className="space-y-2">
                  {result.history.slice(-5).map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-gray-300" />
                      <div className="flex-1">
                        <div className="flex justify-between">
                          <span className="font-medium text-gray-900">{entry.action}</span>
                          <span className="text-gray-500">{formatTimeAgo(entry.timestamp)}</span>
                        </div>
                        <p className="text-gray-600">{entry.details}</p>
                        {entry.performedBy && (
                          <p className="text-xs text-gray-500">By {entry.performedBy}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
  
  // Main render
  if (isLoading && fixResults.length === 0) {
    return renderLoadingState();
  }
  
  if (error && fixResults.length === 0) {
    return renderErrorState();
  }
  
  if (fixResults.length === 0) {
    return renderEmptyState();
  }
  
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <div ref={containerRef} className={`space-y-6 ${className}`}>
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">Fix Results</h2>
              {renderConnectionStatus()}
            </div>
            <p className="text-gray-600 mt-1">
              {websiteUrl} • Last updated: {formatTimeAgo(lastUpdate.toISOString())}
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            {showAdvanced && (
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search issues..."
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <Filter className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              </div>
            )}
            
            <Button
              onClick={() => setShowExportModal(true)}
              variant="outline"
              icon={<Download className="w-4 h-4" />}
            >
              Export
            </Button>
            
            <Button
              onClick={handleAutoFix}
              variant="primary"
              icon={<Zap className="w-4 h-4" />}
              disabled={statistics.autoFixableCount === 0}
              loading={activeBatch?.includes('auto')}
            >
              Auto-fix All ({statistics.autoFixableCount})
            </Button>
          </div>
        </div>
        
        {/* Statistics */}
        {renderStatsCards()}
        
        {/* Filters and Actions */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div className="flex flex-wrap gap-2">
              {(['all', 'critical', 'high', 'medium', 'low', FixStatus.PENDING, FixStatus.IN_PROGRESS, FixStatus.COMPLETED, FixStatus.FAILED, 'fixable', 'autoFix', 'requiresApproval', 'ignored'] as FilterType[]).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    filterStatus === status
                      ? status === 'all' ? 'bg-blue-600 text-white' :
                        status === 'critical' ? 'bg-red-600 text-white' :
                        status === 'high' ? 'bg-orange-600 text-white' :
                        status === 'medium' ? 'bg-yellow-600 text-white' :
                        status === 'low' ? 'bg-green-600 text-white' :
                        status === FixStatus.COMPLETED ? 'bg-green-600 text-white' :
                        status === FixStatus.FAILED ? 'bg-red-600 text-white' :
                        status === FixStatus.IN_PROGRESS ? 'bg-blue-600 text-white' :
                        status === 'fixable' ? 'bg-purple-600 text-white' :
                        status === 'autoFix' ? 'bg-orange-600 text-white' :
                        status === 'requiresApproval' ? 'bg-yellow-600 text-white' :
                        status === 'ignored' ? 'bg-gray-600 text-white' :
                        'bg-yellow-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {status === 'all' ? 'All' :
                   status === 'critical' ? 'Critical' :
                   status === 'high' ? 'High' :
                   status === 'medium' ? 'Medium' :
                   status === 'low' ? 'Low' :
                   status === 'fixable' ? 'Fixable' :
                   status === 'autoFix' ? 'Auto-fix' :
                   status === 'requiresApproval' ? 'Needs Approval' :
                   status === 'ignored' ? 'Ignored' :
                   FIX_STATUS_LABELS[status as FixStatus]}
                  <span className="ml-2 opacity-90">
                    {(() => {
                      switch (status) {
                        case 'all': return `(${statistics.total})`;
                        case 'critical': return `(${statistics.criticalCount})`;
                        case 'fixable': return `(${fixResults.filter(r => r.fixable).length})`;
                        case 'autoFix': return `(${statistics.autoFixableCount})`;
                        case FixStatus.COMPLETED: return `(${statistics.completed})`;
                        case FixStatus.FAILED: return `(${statistics.failed})`;
                        case FixStatus.IN_PROGRESS: return `(${statistics.inProgress})`;
                        case FixStatus.PENDING: return `(${statistics.pending})`;
                        case 'ignored': return `(${fixResults.filter(r => r.ignored).length})`;
                        default: return '';
                      }
                    })()}
                  </span>
                </button>
              ))}
              
              <button
                onClick={() => setShowIgnored(!showIgnored)}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  showIgnored 
                    ? 'bg-gray-800 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {showIgnored ? <EyeOff className="w-4 h-4 inline mr-1" /> : <Eye className="w-4 h-4 inline mr-1" />}
                Show Ignored
              </button>
            </div>
            
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select 
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="priority">Priority</option>
                  <option value="severity">Severity</option>
                  <option value="impact">Impact</option>
                  <option value="confidence">Confidence</option>
                  <option value="name">Name</option>
                  <option value="category">Category</option>
                  <option value="estimatedTime">Time</option>
                  <option value="createdAt">Created</option>
                  <option value="updatedAt">Updated</option>
                </select>
              </div>
              
              {selectedIssues.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">
                    {selectedIssues.size} selected
                  </span>
                  <Button
                    onClick={() => handleBatchApply(Array.from(selectedIssues), 'manual')}
                    variant="primary"
                    size="sm"
                    disabled={selectedIssues.size === 0}
                    loading={activeBatch?.includes('apply')}
                  >
                    Apply Selected
                  </Button>
                  <Button
                    onClick={() => handleIgnoreIssues(Array.from(selectedIssues))}
                    variant="outline"
                    size="sm"
                  >
                    Ignore
                  </Button>
                  <Button
                    onClick={() => setSelectedIssues(new Set())}
                    variant="outline"
                    size="sm"
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>
          </div>
          
          {selectedIssues.size > 0 && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-blue-700 font-medium">
                  {selectedIssues.size} issue{selectedIssues.size !== 1 ? 's' : ''} selected
                </span>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      if (selectedIssues.size === filteredResults.length) {
                        setSelectedIssues(new Set());
                      } else {
                        setSelectedIssues(new Set(filteredResults.map(r => r.issueId)));
                      }
                    }}
                    variant="outline"
                    size="xs"
                  >
                    {selectedIssues.size === filteredResults.length ? 'Deselect All' : 'Select All Visible'}
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
        
        {/* Results List */}
        <div ref={parentRef} className="space-y-4 max-h-[600px] overflow-y-auto">
          <Suspense fallback={<LoadingSkeleton />}>
            <AnimatePresence>
              {filteredResults.map((result, index) => renderIssueCard(result, index))}
            </AnimatePresence>
          </Suspense>
          
          {filteredResults.length === 0 && (
            <div className="text-center py-12">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No issues match your filters</h3>
              <p className="text-gray-600">Try changing your filter criteria or search terms</p>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-6 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Showing {filteredResults.length} of {fixResults.length} results
            {selectedIssues.size > 0 && ` • ${selectedIssues.size} selected`}
            {!isOnline && ' • Offline mode'}
          </div>
          
          <div className="flex gap-3">
            <Button
              onClick={handleRetryFailed}
              variant="outline"
              icon={<RotateCcw className="w-4 h-4" />}
              disabled={statistics.failed === 0}
            >
              Retry Failed ({statistics.failed})
            </Button>
            
            <Button
              onClick={() => {
                const pendingIds = filteredResults
                  .filter(r => r.status === FixStatus.PENDING && !r.requiresApproval && !r.ignored)
                  .map(r => r.issueId);
                if (pendingIds.length > 0) handleBatchApply(pendingIds, 'manual');
              }}
              variant="primary"
              icon={<Zap className="w-4 h-4" />}
              disabled={!filteredResults.some(r => r.status === FixStatus.PENDING && !r.requiresApproval && !r.ignored)}
            >
              Apply All Pending ({filteredResults.filter(r => r.status === FixStatus.PENDING && !r.requiresApproval && !r.ignored).length})
            </Button>
          </div>
        </div>
        
        {/* Modals */}
        {showDetailsModal && (
          <FixDetailsModal
            fixResult={fixResults.find(r => r.id === showDetailsModal)!}
            onClose={() => setShowDetailsModal(null)}
            onApplyFix={(id) => handleBatchApply([id], 'manual')}
            onRetryFix={retryFix}
            onRollback={rollbackFix}
            onSchedule={scheduleFix}
            onIgnore={ignoreFix}
          />
        )}
        
        {showExportModal && (
          <ExportModal
            onClose={() => setShowExportModal(false)}
            onExport={handleExport}
            formats={['json', 'csv', 'pdf', 'html', 'excel', 'markdown']}
            defaultFormat="json"
            fileName={`seo-fixes-${websiteUrl.replace(/[^a-z0-9]/gi, '-')}`}
          />
        )}
        
        {/* Batch Operations Panel */}
        {batchOperations.length > 0 && (
          <div className="fixed bottom-4 right-4 space-y-2 max-w-sm">
            {batchOperations.slice(-3).map(op => (
              <div
                key={op.id}
                className="bg-white rounded-lg shadow-lg border p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">
                    {op.type === 'apply' ? 'Applying fixes' :
                     op.type === 'retry' ? 'Retrying fixes' :
                     op.type === 'ignore' ? 'Ignoring issues' :
                     op.type === 'approve' ? 'Approving issues' :
                     'Operation'}
                  </span>
                  {op.status === 'running' && (
                    <button
                      onClick={() => {
                        abortControllerRef.current.abort();
                        abortControllerRef.current = new AbortController();
                        setBatchOperations(prev => prev.map(o => 
                          o.id === op.id ? { ...o, status: 'cancelled' } : o
                        ));
                      }}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Progress</span>
                    <span className="font-medium">{op.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        op.status === 'completed' ? 'bg-green-600' :
                        op.status === 'failed' ? 'bg-red-600' :
                        op.status === 'cancelled' ? 'bg-gray-600' :
                        'bg-blue-600'
                      }`}
                      style={{ width: `${op.progress}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500">
                    {op.status === 'completed' ? 'Completed' :
                     op.status === 'failed' ? `Failed: ${op.error}` :
                     op.status === 'cancelled' ? 'Cancelled' :
                     `Processing ${op.issueIds.length} issue${op.issueIds.length !== 1 ? 's' : ''}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
};

// Export with memo for performance
export default memo(FixResults);