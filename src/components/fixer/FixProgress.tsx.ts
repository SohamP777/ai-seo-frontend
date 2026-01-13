import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Play, 
  Pause, 
  RefreshCw, 
  XCircle,
  ChevronRight,
  ChevronDown,
  BarChart3,
  TrendingUp,
  Shield,
  DollarSign,
  Users,
  Globe,
  Cpu,
  Zap,
  Target,
  Filter,
  Download,
  Share2,
  Settings,
  ExternalLink,
  AlertTriangle,
  PieChart,
  Calendar,
  Timer,
  Battery,
  Server,
  Lock,
  RotateCcw,
  History,
  FileText,
  Image,
  Link,
  Search,
  Rocket,
  Sparkles,
  Star,
  Activity,
  Heart,
  Brain,
  Cloud,
  Database as DbIcon,
  Network,
  HardDrive,
  MemoryStick,
  ShieldAlert,
  Unlock,
  Archive,
  Code,
  Layout,
  Hash,
  Tag,
  BookOpen,
  Target as TargetIcon,
  TrendingDown,
  Sparkle,
  Zap as ZapIcon,
  Shield as ShieldIcon,
  DollarSign as DollarIcon
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import { useFixer } from '../../hooks/useFixer';
import { SEOAnalyticsChart } from '../charts/SEOAnalyticsChart';
import { CostBreakdownChart } from '../charts/CostBreakdownChart';
import { PerformanceMetricsChart } from '../charts/PerformanceMetricsChart';
import { TrafficImpactChart } from '../charts/TrafficImpactChart';
import { ExportModal } from '../modals/ExportModal';
import { ShareModal } from '../modals/ShareModal';
import { RollbackModal } from '../modals/RollbackModal';
import { FixDetailsModal } from '../modals/FixDetailsModal';
import type { FixJob, FixDetail, FixStatus, FixType, ImpactLevel } from '../../services/types';

// ==================== BUSINESS LOGIC CONSTANTS ====================
const FIX_TYPE_CONFIG: Record<FixType, { icon: any; color: string; label: string }> = {
  meta_title: { icon: FileText, color: 'text-blue-600 bg-blue-100', label: 'Meta Title' },
  meta_description: { icon: FileText, color: 'text-blue-600 bg-blue-100', label: 'Meta Description' },
  heading_structure: { icon: Hash, color: 'text-purple-600 bg-purple-100', label: 'Heading Structure' },
  image_alt_text: { icon: Image, color: 'text-green-600 bg-green-100', label: 'Image Alt Text' },
  canonical_url: { icon: Link, color: 'text-yellow-600 bg-yellow-100', label: 'Canonical URL' },
  broken_link_fix: { icon: Link, color: 'text-red-600 bg-red-100', label: 'Broken Links' },
  schema_markup_add: { icon: Code, color: 'text-indigo-600 bg-indigo-100', label: 'Schema Markup' },
  schema_markup_fix: { icon: Code, color: 'text-indigo-600 bg-indigo-100', label: 'Schema Fix' },
  robots_txt_fix: { icon: Shield, color: 'text-gray-600 bg-gray-100', label: 'Robots.txt' },
  sitemap_generate: { icon: Globe, color: 'text-teal-600 bg-teal-100', label: 'Sitemap' },
  security_header_add: { icon: ShieldAlert, color: 'text-red-600 bg-red-100', label: 'Security Headers' },
  performance_optimize: { icon: Zap, color: 'text-orange-600 bg-orange-100', label: 'Performance' },
  redirect_chain_fix: { icon: RefreshCw, color: 'text-pink-600 bg-pink-100', label: 'Redirect Chain' },
  open_graph_tags: { icon: Share2, color: 'text-blue-600 bg-blue-100', label: 'Open Graph' },
  twitter_cards: { icon: Share2, color: 'text-sky-600 bg-sky-100', label: 'Twitter Cards' },
  microdata_fix: { icon: Code, color: 'text-indigo-600 bg-indigo-100', label: 'Microdata' },
  structured_data: { icon: Code, color: 'text-indigo-600 bg-indigo-100', label: 'Structured Data' },
  hreflang_fix: { icon: Globe, color: 'text-cyan-600 bg-cyan-100', label: 'Hreflang' },
  breadcrumb_fix: { icon: Layout, color: 'text-amber-600 bg-amber-100', label: 'Breadcrumbs' },
  mobile_optimization: { icon: Smartphone, color: 'text-emerald-600 bg-emerald-100', label: 'Mobile' },
  core_web_vitals: { icon: Activity, color: 'text-red-600 bg-red-100', label: 'Core Vitals' },
  lazy_loading: { icon: Cloud, color: 'text-blue-600 bg-blue-100', label: 'Lazy Loading' },
  cache_optimization: { icon: DbIcon, color: 'text-purple-600 bg-purple-100', label: 'Cache' },
  cdn_optimization: { icon: Network, color: 'text-teal-600 bg-teal-100', label: 'CDN' },
  critical_css: { icon: Code, color: 'text-orange-600 bg-orange-100', label: 'Critical CSS' },
  font_optimization: { icon: Type, color: 'text-violet-600 bg-violet-100', label: 'Fonts' },
  third_party_scripts: { icon: Code, color: 'text-gray-600 bg-gray-100', label: '3rd Party Scripts' },
  server_timing: { icon: Timer, color: 'text-rose-600 bg-rose-100', label: 'Server Timing' },
  http2_push: { icon: Rocket, color: 'text-blue-600 bg-blue-100', label: 'HTTP/2 Push' },
  preload_hints: { icon: ZapIcon, color: 'text-yellow-600 bg-yellow-100', label: 'Preload Hints' },
  service_worker: { icon: Code, color: 'text-indigo-600 bg-indigo-100', label: 'Service Worker' },
  pwa_manifest: { icon: Smartphone, color: 'text-emerald-600 bg-emerald-100', label: 'PWA Manifest' }
};

const STATUS_CONFIG: Record<FixStatus, { color: string; bgColor: string; icon: any }> = {
  pending: { color: 'text-gray-600', bgColor: 'bg-gray-100', icon: Clock },
  queued: { color: 'text-blue-600', bgColor: 'bg-blue-100', icon: Clock },
  crawling: { color: 'text-indigo-600', bgColor: 'bg-indigo-100', icon: Globe },
  analyzing: { color: 'text-purple-600', bgColor: 'bg-purple-100', icon: Brain },
  applying: { color: 'text-yellow-600', bgColor: 'bg-yellow-100', icon: Zap },
  verifying: { color: 'text-teal-600', bgColor: 'bg-teal-100', icon: Shield },
  completed: { color: 'text-green-600', bgColor: 'bg-green-100', icon: CheckCircle },
  failed: { color: 'text-red-600', bgColor: 'bg-red-100', icon: XCircle },
  paused: { color: 'text-orange-600', bgColor: 'bg-orange-100', icon: Pause },
  cancelled: { color: 'text-gray-600', bgColor: 'bg-gray-100', icon: XCircle },
  requires_manual: { color: 'text-pink-600', bgColor: 'bg-pink-100', icon: AlertCircle },
  rolled_back: { color: 'text-red-600', bgColor: 'bg-red-100', icon: RotateCcw },
  scheduled: { color: 'text-blue-600', bgColor: 'bg-blue-100', icon: Calendar },
  validating: { color: 'text-teal-600', bgColor: 'bg-teal-100', icon: Shield },
  optimizing: { color: 'text-purple-600', bgColor: 'bg-purple-100', icon: Sparkle },
  testing: { color: 'text-indigo-600', bgColor: 'bg-indigo-100', icon: Activity }
};

const IMPACT_CONFIG: Record<ImpactLevel, { color: string; bgColor: string; label: string; multiplier: number }> = {
  critical: { color: 'text-red-600', bgColor: 'bg-red-100', label: 'Critical', multiplier: 4.0 },
  high: { color: 'text-orange-600', bgColor: 'bg-orange-100', label: 'High', multiplier: 2.0 },
  medium: { color: 'text-yellow-600', bgColor: 'bg-yellow-100', label: 'Medium', multiplier: 1.0 },
  low: { color: 'text-blue-600', bgColor: 'bg-blue-100', label: 'Low', multiplier: 0.5 }
};

// ==================== BUSINESS LOGIC HOOK ====================
const useFixProgressBusinessLogic = (jobId: string) => {
  const { getFixProgress, applyFixes, retryFix, cancelFix, pauseFix, resumeFix } = useFixer();
  const [job, setJob] = useState<FixJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout>();

  // Fetch job data with business logic
  const fetchJobData = useCallback(async () => {
    try {
      const data = await getFixProgress(jobId);
      setJob(data);
      setError(null);
      
      // Business rule: Auto-retry if confidence > 70% and failed
      if (data.status === 'failed' && data.fixes.some(f => f.confidence > 0.7 && f.retryCount < f.maxRetries)) {
        setTimeout(() => retryFix(jobId), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch job');
    } finally {
      setLoading(false);
    }
  }, [jobId, getFixProgress, retryFix]);

  // Start/stop polling based on job status
  useEffect(() => {
    const shouldPoll = job && !['completed', 'failed', 'cancelled'].includes(job.status);
    
    if (shouldPoll) {
      pollingRef.current = setInterval(fetchJobData, 5000);
    }
    
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [job, fetchJobData]);

  // Business logic calculations
  const businessMetrics = useMemo(() => {
    if (!job) return null;

    const totalCost = job.fixes.reduce((sum, fix) => sum + fix.costEstimate, 0);
    const completedCost = job.fixes
      .filter(f => f.status === 'completed')
      .reduce((sum, fix) => sum + fix.costEstimate, 0);
    
    const seoImpact = job.fixes.reduce((sum, fix) => {
      if (fix.status === 'completed') {
        const multiplier = IMPACT_CONFIG[fix.impact].multiplier;
        return sum + (fix.seoScoreImpact * multiplier * fix.confidence);
      }
      return sum;
    }, 0);
    
    const avgConfidence = job.fixes.length > 0 
      ? job.fixes.reduce((sum, fix) => sum + fix.confidence, 0) / job.fixes.length 
      : 0;
    
    const successRate = job.totalFixes > 0 
      ? (job.completedFixes / job.totalFixes) * 100 
      : 0;
    
    const efficiencyScore = job.executionTime && job.totalFixes > 0
      ? (job.completedFixes / job.executionTime) * 100
      : 0;

    return {
      totalCost,
      completedCost,
      seoImpact: Math.round(seoImpact),
      avgConfidence: Math.round(avgConfidence * 100),
      successRate: Math.round(successRate),
      efficiencyScore: Math.round(efficiencyScore),
      estimatedROI: seoImpact > 0 ? Math.round((seoImpact * 10) / totalCost) : 0,
      riskScore: Math.round((1 - avgConfidence) * 100)
    };
  }, [job]);

  return {
    job,
    loading,
    error,
    businessMetrics,
    actions: {
      fetchJobData,
      retry: () => retryFix(jobId),
      cancel: () => cancelFix(jobId),
      pause: () => pauseFix(jobId),
      resume: () => resumeFix(jobId)
    }
  };
};

// ==================== UI COMPONENTS ====================

const ProgressHeader: React.FC<{ job: FixJob }> = ({ job }) => {
  const config = STATUS_CONFIG[job.status];
  const Icon = config.icon;
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl shadow-xl p-6 text-white"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
            <Rocket className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">SEO Fix Progress</h1>
            <div className="flex items-center space-x-3 mt-2">
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.bgColor} ${config.color}`}>
                <Icon className="w-4 h-4 inline mr-1" />
                {job.status.replace('_', ' ').toUpperCase()}
              </span>
              <span className="text-white/80">
                <Globe className="w-4 h-4 inline mr-1" />
                {job.websiteName}
              </span>
              <span className="text-white/80">
                <Calendar className="w-4 h-4 inline mr-1" />
                {new Date(job.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex space-x-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur-sm"
          >
            <Settings className="w-5 h-5" />
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

const ProgressMetrics: React.FC<{ job: FixJob; metrics: any }> = ({ job, metrics }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* SEO Impact Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1 }}
        className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 border border-emerald-200"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-700">SEO Impact</p>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-emerald-900">
                +{metrics?.seoImpact || 0}
              </span>
              <TrendingUp className="w-5 h-5 text-emerald-600 ml-2" />
            </div>
            <p className="text-xs text-emerald-600 mt-1">{metrics?.successRate || 0}% success rate</p>
          </div>
          <Sparkles className="w-8 h-8 text-emerald-600" />
        </div>
      </motion.div>

      {/* Cost & ROI Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-700">Cost & ROI</p>
            <div className="mt-2">
              <div className="text-3xl font-bold text-blue-900">
                ${(metrics?.totalCost || 0) / 100}
              </div>
              <div className="flex items-center mt-1">
                <span className={`text-sm font-medium ${
                  (metrics?.estimatedROI || 0) >= 200 ? 'text-green-600' : 
                  (metrics?.estimatedROI || 0) >= 100 ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  <DollarIcon className="w-4 h-4 inline mr-1" />
                  {metrics?.estimatedROI || 0}% ROI
                </span>
              </div>
            </div>
          </div>
          <DollarIcon className="w-8 h-8 text-blue-600" />
        </div>
      </motion.div>

      {/* Confidence & Risk Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-purple-700">Confidence</p>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-purple-900">
                {metrics?.avgConfidence || 0}%
              </span>
              <Heart className="w-5 h-5 text-purple-600 ml-2" />
            </div>
            <p className="text-xs text-purple-600 mt-1">Risk: {metrics?.riskScore || 0}%</p>
          </div>
          <ShieldIcon className="w-8 h-8 text-purple-600" />
        </div>
      </motion.div>

      {/* Performance Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.4 }}
        className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-4 border border-orange-200"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-orange-700">Performance</p>
            <div className="mt-2">
              <div className="text-3xl font-bold text-orange-900">
                {metrics?.efficiencyScore || 0}%
              </div>
              {job.executionTime && (
                <p className="text-xs text-orange-600 mt-1">
                  {Math.round(job.executionTime / 60)} min execution
                </p>
              )}
            </div>
          </div>
          <ZapIcon className="w-8 h-8 text-orange-600" />
        </div>
      </motion.div>
    </div>
  );
};

const ProgressBar: React.FC<{ progress: number; job: FixJob }> = ({ progress, job }) => {
  const getColor = (value: number) => {
    if (value >= 90) return 'from-green-500 to-emerald-600';
    if (value >= 70) return 'from-blue-500 to-cyan-600';
    if (value >= 50) return 'from-yellow-500 to-amber-600';
    if (value >= 30) return 'from-orange-500 to-red-600';
    return 'from-red-500 to-pink-600';
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Fix Progress</h3>
          <p className="text-sm text-gray-600">
            {job.completedFixes} of {job.totalFixes} fixes completed
          </p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-bold text-gray-900">{progress}%</span>
          <p className="text-sm text-gray-500">Overall progress</p>
        </div>
      </div>
      
      <div className="relative pt-1">
        <div className="overflow-hidden h-3 mb-4 text-xs flex rounded-full bg-gray-200">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
            className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r ${getColor(progress)}`}
          />
        </div>
        
        <div className="flex justify-between text-xs text-gray-600">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>
      
      <div className="mt-6 grid grid-cols-4 gap-3">
        {['pending', 'applying', 'verifying', 'completed'].map((status, index) => {
          const count = job.fixes.filter(f => f.status === status).length;
          const config = STATUS_CONFIG[status as FixStatus];
          const Icon = config.icon;
          
          return (
            <motion.div 
              key={status}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="text-center"
            >
              <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full ${config.bgColor} mb-2`}>
                <Icon className={`w-6 h-6 ${config.color}`} />
              </div>
              <div className="text-2xl font-bold text-gray-900">{count}</div>
              <div className="text-xs text-gray-600 capitalize">{status.replace('_', ' ')}</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

const FixList: React.FC<{ fixes: FixDetail[]; onSelect: (fix: FixDetail) => void }> = ({ fixes, onSelect }) => {
  const [filter, setFilter] = useState<FixStatus | 'all'>('all');
  const [sortBy, setSortBy] = useState<'impact' | 'cost' | 'confidence'>('impact');

  const filteredAndSortedFixes = useMemo(() => {
    let result = fixes;
    
    if (filter !== 'all') {
      result = result.filter(f => f.status === filter);
    }
    
    return result.sort((a, b) => {
      if (sortBy === 'impact') {
        const impactOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0);
      }
      if (sortBy === 'cost') {
        return b.costEstimate - a.costEstimate;
      }
      if (sortBy === 'confidence') {
        return b.confidence - a.confidence;
      }
      return 0;
    });
  }, [fixes, filter, sortBy]);

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Individual Fixes</h3>
            <p className="text-sm text-gray-600 mt-1">
              {fixes.length} total • {fixes.filter(f => f.status === 'completed').length} completed • {fixes.filter(f => f.status === 'failed').length} failed
            </p>
          </div>
          
          <div className="flex space-x-3">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FixStatus | 'all')}
              className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
            >
              <option value="all">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="applying">Applying</option>
              <option value="pending">Pending</option>
            </select>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
            >
              <option value="impact">Sort by Impact</option>
              <option value="cost">Sort by Cost</option>
              <option value="confidence">Sort by Confidence</option>
            </select>
          </div>
        </div>
      </div>
      
      <div className="divide-y divide-gray-100">
        <AnimatePresence>
          {filteredAndSortedFixes.map((fix, index) => {
            const typeConfig = FIX_TYPE_CONFIG[fix.type];
            const statusConfig = STATUS_CONFIG[fix.status];
            const impactConfig = IMPACT_CONFIG[fix.impact];
            const TypeIcon = typeConfig.icon;
            const StatusIcon = statusConfig.icon;
            
            return (
              <motion.div
                key={fix.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.05 }}
                className="p-5 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => onSelect(fix)}
              >
                <div className="flex items-start space-x-4">
                  {/* Status Indicator */}
                  <div className="flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${statusConfig.bgColor}`}>
                      <StatusIcon className={`w-5 h-5 ${statusConfig.color}`} />
                    </div>
                  </div>
                  
                  {/* Fix Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className={`p-2 rounded-lg ${typeConfig.color.split(' ')[1]}`}>
                          <TypeIcon className={`w-4 h-4 ${typeConfig.color.split(' ')[0]}`} />
                        </div>
                        <h4 className="font-medium text-gray-900">
                          {typeConfig.label}
                        </h4>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${impactConfig.bgColor} ${impactConfig.color}`}>
                          {impactConfig.label}
                        </span>
                        <span className="text-sm font-medium text-gray-900">
                          ${(fix.costEstimate / 100).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    
                    <p className="mt-2 text-sm text-gray-600 truncate">
                      {fix.targetUrl}
                    </p>
                    
                    <div className="mt-3 flex items-center space-x-4">
                      <span className="inline-flex items-center text-xs text-gray-500">
                        <TargetIcon className="w-3 h-3 mr-1" />
                        {Math.round(fix.confidence * 100)}% confidence
                      </span>
                      
                      <span className="inline-flex items-center text-xs text-gray-500">
                        <Zap className="w-3 h-3 mr-1" />
                        {fix.seoScoreImpact} pts impact
                      </span>
                      
                      {fix.appliedAt && (
                        <span className="inline-flex items-center text-xs text-gray-500">
                          <Clock className="w-3 h-3 mr-1" />
                          {new Date(fix.appliedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Action Button */}
                  <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                </div>
                
                {/* Error Display */}
                {fix.error && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100"
                  >
                    <div className="flex items-start">
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                      <p className="text-sm text-red-700">{fix.error}</p>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

const ActionButtons: React.FC<{ 
  job: FixJob; 
  onPauseResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRollback: () => void;
  onExport: () => void;
  onShare: () => void;
}> = ({ job, onPauseResume, onCancel, onRetry, onRollback, onExport, onShare }) => {
  return (
    <div className="flex flex-wrap gap-3">
      {/* Pause/Resume Button */}
      {['applying', 'analyzing'].includes(job.status) && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onPauseResume}
          className="px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center shadow-md"
        >
          <Pause className="w-5 h-5 mr-2" />
          Pause Job
        </motion.button>
      )}
      
      {job.status === 'paused' && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onPauseResume}
          className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center shadow-md"
        >
          <Play className="w-5 h-5 mr-2" />
          Resume Job
        </motion.button>
      )}

      {/* Cancel Button */}
      {!['completed', 'failed', 'cancelled'].includes(job.status) && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onCancel}
          className="px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center shadow-md"
        >
          <XCircle className="w-5 h-5 mr-2" />
          Cancel Job
        </motion.button>
      )}

      {/* Retry Failed Button */}
      {job.failedFixes > 0 && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRetry}
          className="px-4 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center shadow-md"
        >
          <RefreshCw className="w-5 h-5 mr-2" />
          Retry Failed ({job.failedFixes})
        </motion.button>
      )}

      {/* Rollback Button */}
      {job.rollbackEnabled && job.status === 'completed' && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRollback}
          className="px-4 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center shadow-md"
        >
          <RotateCcw className="w-5 h-5 mr-2" />
          Rollback Changes
        </motion.button>
      )}

      {/* Export Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onExport}
        className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center shadow-md"
      >
        <Download className="w-5 h-5 mr-2" />
        Export Report
      </motion.button>

      {/* Share Button */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onShare}
        className="px-4 py-2.5 bg-teal-600 text-white rounded-lg hover:bg-teal-700 flex items-center shadow-md"
      >
        <Share2 className="w-5 h-5 mr-2" />
        Share Results
      </motion.button>
    </div>
  );
};

const AnalyticsDashboard: React.FC<{ job: FixJob; metrics: any }> = ({ job, metrics }) => {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Analytics Dashboard</h3>
        <div className="flex space-x-2">
          {['7d', '30d', '90d'].map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range as any)}
              className={`px-3 py-1.5 text-sm rounded-lg ${
                timeRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SEO Analytics Chart */}
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-900">SEO Score Trend</h4>
            <BarChart3 className="w-5 h-5 text-gray-500" />
          </div>
          <SEOAnalyticsChart timeRange={timeRange} />
        </div>
        
        {/* Cost Breakdown */}
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-900">Cost Breakdown</h4>
            <DollarIcon className="w-5 h-5 text-gray-500" />
          </div>
          <CostBreakdownChart />
        </div>
        
        {/* Performance Metrics */}
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-900">Performance Metrics</h4>
            <Activity className="w-5 h-5 text-gray-500" />
          </div>
          <PerformanceMetricsChart />
        </div>
        
        {/* Traffic Impact */}
        <div className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-900">Traffic Impact</h4>
            <Users className="w-5 h-5 text-gray-500" />
          </div>
          <TrafficImpactChart />
        </div>
      </div>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

interface FixProgressProps {
  jobId: string;
  className?: string;
  onComplete?: (results: any) => void;
  onError?: (error: Error) => void;
}

const FixProgress: React.FC<FixProgressProps> = ({ 
  jobId, 
  className = '',
  onComplete,
  onError 
}) => {
  const { toast } = useToast();
  const { job, loading, error, businessMetrics, actions } = useFixProgressBusinessLogic(jobId);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showRollbackModal, setShowRollbackModal] = useState(false);
  const [showFixDetails, setShowFixDetails] = useState<FixDetail | null>(null);
  
  // Handle job completion
  useEffect(() => {
    if (job?.status === 'completed' && onComplete) {
      onComplete(job.results);
    }
  }, [job, onComplete]);
  
  // Handle errors
  useEffect(() => {
    if (error && onError) {
      onError(new Error(error));
    }
  }, [error, onError]);
  
  // Loading state
  if (loading) {
    return (
      <div className={`flex items-center justify-center min-h-[400px] ${className}`}>
        <div className="text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"
          />
          <p className="mt-4 text-gray-600">Loading SEO fix progress...</p>
        </div>
      </div>
    );
  }
  
  // Error state
  if (error) {
    return (
      <div className={`bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-8 ${className}`}>
        <div className="flex items-start">
          <AlertCircle className="w-8 h-8 text-red-600 mr-4 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold text-red-800">Error Loading Fix Progress</h3>
            <p className="text-red-700 mt-2">{error}</p>
            <button
              onClick={actions.fetchJobData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Retry Loading
            </button>
          </div>
        </div>
      </div>
    );
  }
  
  // No job state
  if (!job) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <AlertCircle className="w-12 h-12 text-gray-400 mx-auto" />
        <h3 className="mt-4 text-lg font-medium text-gray-900">No Fix Job Found</h3>
        <p className="mt-2 text-gray-600">The requested SEO fix job could not be found.</p>
      </div>
    );
  }
  
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header Section */}
      <ProgressHeader job={job} />
      
      {/* Metrics Dashboard */}
      {businessMetrics && <ProgressMetrics job={job} metrics={businessMetrics} />}
      
      {/* Progress Bar */}
      <ProgressBar progress={job.progress} job={job} />
      
      {/* Action Buttons */}
      <ActionButtons
        job={job}
        onPauseResume={job.status === 'paused' ? actions.resume : actions.pause}
        onCancel={actions.cancel}
        onRetry={actions.retry}
        onRollback={() => setShowRollbackModal(true)}
        onExport={() => setShowExportModal(true)}
        onShare={() => setShowShareModal(true)}
      />
      
      {/* Fix List */}
      <FixList 
        fixes={job.fixes} 
        onSelect={(fix) => setShowFixDetails(fix)}
      />
      
      {/* Analytics Dashboard */}
      {businessMetrics && <AnalyticsDashboard job={job} metrics={businessMetrics} />}
      
      {/* Footer */}
      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-600">
              <Timer className="w-4 h-4 inline mr-1" />
              Started: {job.startedAt ? new Date(job.startedAt).toLocaleTimeString() : 'Not started'}
            </span>
            {job.estimatedCompletion && (
              <span className="text-sm text-gray-600">
                <Clock className="w-4 h-4 inline mr-1" />
                Est. completion: {new Date(job.estimatedCompletion).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-500">
              Updated: {new Date().toLocaleTimeString()}
            </span>
            <button
              onClick={actions.fetchJobData}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Modals */}
      <AnimatePresence>
        {showExportModal && (
          <ExportModal
            job={job}
            onExport={() => {
              toast.success('Report exported successfully');
              setShowExportModal(false);
            }}
            onClose={() => setShowExportModal(false)}
          />
        )}
        
        {showShareModal && (
          <ShareModal
            job={job}
            onShare={() => {
              toast.success('Results shared successfully');
              setShowShareModal(false);
            }}
            onClose={() => setShowShareModal(false)}
          />
        )}
        
        {showRollbackModal && (
          <RollbackModal
            job={job}
            onRollback={() => {
              toast.success('Rollback initiated successfully');
              setShowRollbackModal(false);
            }}
            onClose={() => setShowRollbackModal(false)}
          />
        )}
        
        {showFixDetails && (
          <FixDetailsModal
            fix={showFixDetails}
            onClose={() => setShowFixDetails(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// Add missing icon component
const Smartphone: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
  </svg>
);

const Type: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
  </svg>
);

export default FixProgress;