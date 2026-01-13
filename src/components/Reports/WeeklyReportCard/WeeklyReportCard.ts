import React, { useState, useEffect, useCallback, memo } from 'react';
import { format, subDays, startOfWeek, endOfWeek } from 'date-fns';
import { 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Download, 
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  Clock,
  BarChart3,
  Sparkles,
  Target,
  Shield,
  Zap
} from 'lucide-react';
import { useReports } from '@/hooks/useReports';
import { generateReportPDF, exportReportCSV } from '@/services/reports';
import { SEOIssue, PerformanceMetrics, ReportAnalytics } from '@/types/reports';
import { calculateScoreImpact, formatPercentage } from '@/utils/calculations';
import { toast } from 'react-hot-toast';
import ReportSkeleton from './ReportSkeleton';

export interface WeeklyReportData {
  id: string;
  reportId: string;
  weekNumber: number;
  year: number;
  startDate: Date;
  endDate: Date;
  overallScore: number;
  previousScore: number;
  scoreDelta: number;
  status: 'generated' | 'processing' | 'failed';
  insights: {
    topImprovements: string[];
    majorRegressions: string[];
    recommendations: string[];
    nextWeekFocus: string[];
  };
  metrics: {
    issues: {
      total: number;
      resolved: number;
      new: number;
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    performance: {
      pageSpeed: number;
      accessibility: number;
      bestPractices: number;
      seo: number;
      pwa: number;
    };
    businessImpact: {
      estimatedTrafficChange: number;
      estimatedConversionChange: number;
      revenueImpact: number;
      roi: number;
    };
  };
  topIssues: SEOIssue[];
  comparison: {
    vsPreviousWeek: ReportComparison;
    vsIndustryAverage: ReportComparison;
  };
  generatedAt: Date;
  expiresAt: Date;
}

interface ReportComparison {
  score: number;
  delta: number;
  percentile: number;
}

interface WeeklyReportCardProps {
  report: WeeklyReportData;
  onViewDetails: (reportId: string) => void;
  onRegenerate?: (reportId: string) => Promise<void>;
  onShare?: (reportId: string, email: string) => Promise<void>;
  isShared?: boolean;
}

const WeeklyReportCard: React.FC<WeeklyReportCardProps> = memo(({
  report,
  onViewDetails,
  onRegenerate,
  onShare,
  isShared = false,
}) => {
  const { fetchReportAnalytics, generateComparativeAnalysis } = useReports();
  const [isExporting, setIsExporting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analytics, setAnalytics] = useState<ReportAnalytics | null>(null);
  const [comparativeData, setComparativeData] = useState<any>(null);
  const [emailInput, setEmailInput] = useState('');
  const [showShareForm, setShowShareForm] = useState(false);

  // Fetch real analytics data on mount
  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const analyticsData = await fetchReportAnalytics(report.id);
        setAnalytics(analyticsData);
        
        // Get comparative analysis for industry benchmarks
        const comparative = await generateComparativeAnalysis(
          report.id,
          report.startDate,
          report.endDate
        );
        setComparativeData(comparative);
      } catch (error) {
        console.error('Failed to load report analytics:', error);
        toast.error('Failed to load additional report data');
      }
    };
    
    loadAnalytics();
  }, [report.id, report.startDate, report.endDate]);

  const handleExport = useCallback(async (format: 'pdf' | 'csv' | 'json') => {
    setIsExporting(true);
    try {
      switch (format) {
        case 'pdf':
          await generateReportPDF(report.id, {
            includeCharts: true,
            includeIssues: true,
            includeRecommendations: true,
            watermark: !isShared,
          });
          toast.success('PDF report generated successfully');
          break;
        case 'csv':
          await exportReportCSV(report.id);
          toast.success('CSV data exported successfully');
          break;
        case 'json':
          // Create downloadable JSON
          const dataStr = JSON.stringify(report, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `seo-report-${report.reportId}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          toast.success('JSON data exported successfully');
          break;
      }
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(`Failed to export report: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  }, [report, isShared]);

  const handleRegenerate = useCallback(async () => {
    if (!onRegenerate) return;
    
    setIsAnalyzing(true);
    try {
      await onRegenerate(report.id);
      toast.success('Report regeneration started');
    } catch (error) {
      console.error('Regeneration failed:', error);
      toast.error('Failed to regenerate report');
    } finally {
      setIsAnalyzing(false);
    }
  }, [report.id, onRegenerate]);

  const handleShare = useCallback(async () => {
    if (!onShare || !emailInput) return;
    
    try {
      await onShare(report.id, emailInput);
      toast.success(`Report shared with ${emailInput}`);
      setShowShareForm(false);
      setEmailInput('');
    } catch (error) {
      console.error('Share failed:', error);
      toast.error('Failed to share report');
    }
  }, [report.id, emailInput, onShare]);

  const getScoreTrendIcon = () => {
    if (report.scoreDelta > 2) {
      return <TrendingUp className="w-5 h-5 text-green-500 animate-pulse" />;
    } else if (report.scoreDelta < -2) {
      return <TrendingDown className="w-5 h-5 text-red-500" />;
    }
    return <Minus className="w-5 h-5 text-gray-500" />;
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'from-green-500 to-emerald-600';
    if (score >= 75) return 'from-blue-500 to-cyan-600';
    if (score >= 60) return 'from-yellow-500 to-amber-600';
    return 'from-red-500 to-pink-600';
  };

  const getSeverityBadge = (severity: SEOIssue['severity']) => {
    const config = {
      critical: { bg: 'bg-red-100', text: 'text-red-800', icon: AlertTriangle },
      high: { bg: 'bg-orange-100', text: 'text-orange-800', icon: AlertTriangle },
      medium: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: Clock },
      low: { bg: 'bg-blue-100', text: 'text-blue-800', icon: CheckCircle },
    };
    
    const { bg, text, icon: Icon } = config[severity];
    return (
      <span className={`px-3 py-1 ${bg} ${text} text-xs font-semibold rounded-full inline-flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {severity}
      </span>
    );
  };

  const calculateROIColor = (roi: number) => {
    if (roi > 300) return 'text-green-600';
    if (roi > 100) return 'text-blue-600';
    if (roi > 0) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusBadge = () => {
    const config = {
      generated: { bg: 'bg-green-100', text: 'text-green-800', label: 'Ready' },
      processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
      failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
    };
    
    const { bg, text, label } = config[report.status];
    return (
      <span className={`px-3 py-1 ${bg} ${text} text-sm font-semibold rounded-full`}>
        {label}
      </span>
    );
  };

  const renderPerformanceMetric = (label: string, score: number, icon: React.ReactNode) => {
    const getBarColor = () => {
      if (score >= 90) return 'bg-green-500';
      if (score >= 75) return 'bg-blue-500';
      if (score >= 60) return 'bg-yellow-500';
      return 'bg-red-500';
    };

    return (
      <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-4 border border-gray-200 hover:border-blue-300 transition-all">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-semibold text-gray-900">{label}</span>
          </div>
          <span className={`text-lg font-bold ${score >= 90 ? 'text-green-600' : score >= 75 ? 'text-blue-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
            {score}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${getBarColor()}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-2">
          <span>Poor</span>
          <span>Good</span>
          <span>Excellent</span>
        </div>
      </div>
    );
  };

  if (report.status === 'processing') {
    return <ReportSkeleton />;
  }

  return (
    <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-xl border border-gray-200 overflow-hidden hover:shadow-2xl transition-all duration-300">
      {/* Header with gradient */}
      <div className={`bg-gradient-to-r ${getScoreColor(report.overallScore)} p-6`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-white">
                Week {report.weekNumber}, {report.year}
              </h2>
              {getStatusBadge()}
            </div>
            <p className="text-blue-100">
              {format(report.startDate, 'MMM dd')} - {format(report.endDate, 'MMM dd')}
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => handleExport('pdf')}
              disabled={isExporting}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white font-medium rounded-lg backdrop-blur-sm transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Exporting...' : 'Export PDF'}
            </button>
            
            <button
              onClick={() => onViewDetails(report.id)}
              className="px-4 py-2 bg-white text-blue-700 hover:bg-blue-50 font-semibold rounded-lg transition-all flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              View Full Report
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Score Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl p-6 border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">SEO Health Score</h3>
                <div className="flex items-center gap-2">
                  {getScoreTrendIcon()}
                  <span className={`text-lg font-bold ${report.scoreDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {report.scoreDelta >= 0 ? '+' : ''}{report.scoreDelta.toFixed(1)}
                  </span>
                </div>
              </div>
              
              <div className="flex items-end gap-4">
                <div className="relative">
                  <div className="text-5xl font-bold text-gray-900">
                    {report.overallScore.toFixed(0)}
                  </div>
                  <div className="text-gray-500">/100</div>
                </div>
                
                <div className="flex-1">
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>Previous: {report.previousScore.toFixed(0)}</span>
                    <span>Industry Avg: {report.comparison.vsIndustryAverage.score}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div
                      className={`h-4 rounded-full bg-gradient-to-r ${getScoreColor(report.overallScore)}`}
                      style={{ width: `${report.overallScore}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Business Impact */}
          <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-6 border border-purple-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              Business Impact
            </h3>
            
            <div className="space-y-4">
              <div>
                <div className="text-sm text-gray-600 mb-1">Estimated Traffic Change</div>
                <div className={`text-2xl font-bold ${report.metrics.businessImpact.estimatedTrafficChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {report.metrics.businessImpact.estimatedTrafficChange >= 0 ? '+' : ''}
                  {formatPercentage(report.metrics.businessImpact.estimatedTrafficChange)}
                </div>
              </div>
              
              <div>
                <div className="text-sm text-gray-600 mb-1">ROI Potential</div>
                <div className={`text-2xl font-bold ${calculateROIColor(report.metrics.businessImpact.roi)}`}>
                  {formatPercentage(report.metrics.businessImpact.roi)}
                </div>
              </div>
              
              {report.metrics.businessImpact.revenueImpact > 0 && (
                <div className="pt-4 border-t border-purple-200">
                  <div className="text-sm text-gray-600 mb-1">Revenue Impact</div>
                  <div className="text-lg font-semibold text-gray-900">
                    ${(report.metrics.businessImpact.revenueImpact / 1000).toFixed(1)}K
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Performance Metrics Grid */}
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Performance Metrics
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {renderPerformanceMetric('Page Speed', report.metrics.performance.pageSpeed, 
              <Zap className="w-4 h-4 text-yellow-600" />)}
            {renderPerformanceMetric('Accessibility', report.metrics.performance.accessibility,
              <Shield className="w-4 h-4 text-green-600" />)}
            {renderPerformanceMetric('Best Practices', report.metrics.performance.bestPractices,
              <Sparkles className="w-4 h-4 text-purple-600" />)}
          </div>
        </div>

        {/* Issues Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Issues Summary</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-3xl font-bold text-red-600">{report.metrics.issues.critical}</div>
                <div className="text-sm text-gray-600">Critical</div>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-3xl font-bold text-orange-600">{report.metrics.issues.high}</div>
                <div className="text-sm text-gray-600">High</div>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-3xl font-bold text-yellow-600">{report.metrics.issues.medium}</div>
                <div className="text-sm text-gray-600">Medium</div>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-3xl font-bold text-blue-600">{report.metrics.issues.low}</div>
                <div className="text-sm text-gray-600">Low</div>
              </div>
            </div>
            
            <div className="mt-6 pt-6 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Resolved Issues</span>
                <span className="text-lg font-bold text-green-600">
                  {report.metrics.issues.resolved} / {report.metrics.issues.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all duration-500"
                  style={{ width: `${(report.metrics.issues.resolved / report.metrics.issues.total) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Top Issues */}
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Top Issues This Week</h3>
            
            <div className="space-y-3">
              {report.topIssues.slice(0, 3).map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {getSeverityBadge(issue.severity)}
                      <span className="text-xs text-gray-500">
                        Impact: {formatPercentage(calculateScoreImpact(issue))}
                      </span>
                    </div>
                    <p className="font-medium text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                      {issue.title}
                    </p>
                    <p className="text-sm text-gray-600 truncate">{issue.description}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {issue.fixed ? (
                      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
                        Fixed
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {report.topIssues.length > 3 && (
              <button
                onClick={() => onViewDetails(report.id)}
                className="w-full mt-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
              >
                View all {report.topIssues.length} issues →
              </button>
            )}
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap gap-3 justify-between items-center pt-6 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Generated: {format(report.generatedAt, 'MMM dd, yyyy HH:mm')}
            {report.expiresAt && (
              <span className="ml-4">
                Expires: {format(report.expiresAt, 'MMM dd, yyyy')}
              </span>
            )}
          </div>
          
          <div className="flex flex-wrap gap-3">
            {onRegenerate && (
              <button
                onClick={handleRegenerate}
                disabled={isAnalyzing}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isAnalyzing ? 'Regenerating...' : 'Regenerate Report'}
              </button>
            )}
            
            {onShare && (
              <div className="relative">
                <button
                  onClick={() => setShowShareForm(!showShareForm)}
                  className="px-4 py-2 text-blue-700 bg-blue-50 hover:bg-blue-100 font-medium rounded-lg transition-colors"
                >
                  Share Report
                </button>
                
                {showShareForm && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 p-4 z-10">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="Enter email address"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2"
                    />
                    <button
                      onClick={handleShare}
                      className="w-full px-3 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Send Report
                    </button>
                  </div>
                )}
              </div>
            )}
            
            <div className="flex gap-2">
              <button
                onClick={() => handleExport('csv')}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                CSV
              </button>
              <button
                onClick={() => handleExport('json')}
                className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                JSON
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

WeeklyReportCard.displayName = 'WeeklyReportCard';

export default WeeklyReportCard;