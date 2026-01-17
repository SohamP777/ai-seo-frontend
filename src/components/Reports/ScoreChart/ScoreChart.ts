import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Scatter,
  ReferenceLine,
  ReferenceArea,
  Brush,
  Cell,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  Filter,
  Calendar,
  BarChart3,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  Target,
  AlertTriangle,
  Zap,
  Shield,
  Clock,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  RefreshCw,
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay, differenceInDays, parseISO } from 'date-fns';
import { useReports } from '@/hooks/useReports';
import { generateChartExport, getBenchmarkData } from '@/services/reports';
import { calculateTrend, detectAnomalies, forecastTrend } from '@/utils/analytics';
import { toast } from 'react-hot-toast';
import ScoreChartSkeleton from './ScoreChartSkeleton';
import ChartTooltip from './ChartTooltip';
import BenchmarkIndicator from './BenchmarkIndicator';

export interface ScoreDataPoint {
  timestamp: Date;
  overallScore: number;
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  issuesFixed: number;
  newIssues: number;
  pageViews?: number;
  conversionRate?: number;
  responseTime?: number;
  anomaly?: boolean;
}

export interface ScoreTrend {
  period: '7d' | '30d' | '90d' | '1y';
  trend: number;
  direction: 'up' | 'down' | 'stable';
  confidence: number;
  volatility: number;
  forecast?: number[];
}

export interface ChartConfig {
  type: 'line' | 'area' | 'bar' | 'composed';
  showGrid: boolean;
  showLegend: boolean;
  smoothLines: boolean;
  showBrush: boolean;
  showReferenceLines: boolean;
  showAnomalies: boolean;
  showForecast: boolean;
  yAxisDomain: [number, number];
  animationDuration: number;
}

interface ScoreChartProps {
  initialData?: ScoreDataPoint[];
  period?: '7d' | '30d' | '90d' | '1y' | 'custom';
  customRange?: { start: Date; end: Date };
  showControls?: boolean;
  showExport?: boolean;
  showBenchmarks?: boolean;
  onDataPointClick?: (point: ScoreDataPoint) => void;
  onPeriodChange?: (period: string) => void;
  refreshInterval?: number;
  projectId?: string;
}

const ScoreChart: React.FC<ScoreChartProps> = memo(({
  initialData = [],
  period = '30d',
  customRange,
  showControls = true,
  showExport = true,
  showBenchmarks = true,
  onDataPointClick,
  onPeriodChange,
  refreshInterval = 30000,
  projectId,
}) => {
  const { fetchScoreHistory, getTrendAnalysis, loading } = useReports();
  const [chartData, setChartData] = useState<ScoreDataPoint[]>(initialData);
  const [trends, setTrends] = useState<ScoreTrend | null>(null);
  const [config, setConfig] = useState<ChartConfig>({
    type: 'composed',
    showGrid: true,
    showLegend: true,
    smoothLines: true,
    showBrush: true,
    showReferenceLines: true,
    showAnomalies: true,
    showForecast: false,
    yAxisDomain: [0, 100],
    animationDuration: 1000,
  });
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(new Set([
    'overallScore',
    'performanceScore',
    'seoScore',
    'issuesFixed',
  ]));
  const [benchmarkData, setBenchmarkData] = useState<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [forecastData, setForecastData] = useState<ScoreDataPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<ScoreDataPoint | null>(null);
  const [brushRange, setBrushRange] = useState<[number, number]>([0, 1]);
  const chartRef = useRef<HTMLDivElement>(null);

  // Calculate date range based on period
  const getDateRange = useCallback((period: string) => {
    const end = new Date();
    let start = new Date();
    let endDate = new Date();
    
    switch (period) {
      case '7d':
        start = subDays(end, 7);
        break;
      case '30d':
        start = subDays(end, 30);
        break;
      case '90d':
        start = subDays(end, 90);
        break;
      case '1y':
        start = subDays(end, 365);
        break;
      default:
        if (customRange) {
          start = customRange.start;
          endDate = customRange.end;
        }
    }
    
    return { start: startOfDay(start), end: endOfDay(endDate) };
  }, [customRange]);

  // Fetch chart data
  useEffect(() => {
    const loadChartData = async () => {
      try {
        const dateRange = getDateRange(period);
        const data = await fetchScoreHistory({
          projectId,
          startDate: dateRange.start,
          endDate: dateRange.end,
          interval: period === '7d' ? 'hourly' : 'daily',
        });
        
        // Add anomaly detection
        const withAnomalies = detectAnomalies(data);
        setChartData(withAnomalies);
        
        // Calculate trends
        const trendAnalysis = await getTrendAnalysis({
          data: withAnomalies,
          period,
          confidenceLevel: 0.95,
        });
        setTrends(trendAnalysis);
        
        // Load benchmark data
        if (showBenchmarks) {
          const benchmarks = await getBenchmarkData({
            industry: 'technology',
            companySize: 'medium',
            period,
          });
          setBenchmarkData(benchmarks);
        }
        
        // Generate forecast if enabled
        if (config.showForecast) {
          const forecast = forecastTrend(withAnomalies, 7);
          setForecastData(forecast);
        }
      } catch (error) {
        console.error('Failed to load chart data:', error);
        toast.error('Failed to load score history');
      }
    };
    
    loadChartData();
    
    // Auto-refresh if interval is set
    let intervalId: NodeJS.Timeout | null = null;
    if (refreshInterval > 0) {
      intervalId = setInterval(loadChartData, refreshInterval);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [period, projectId, refreshInterval, showBenchmarks, config.showForecast, getDateRange, fetchScoreHistory, getTrendAnalysis]);

  // Handle fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!chartRef.current) return;
    
    try {
      if (!document.fullscreenElement) {
        await chartRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, []);

  const handleExport = useCallback(async (format: 'png' | 'svg' | 'csv' | 'json') => {
    setIsExporting(true);
    try {
      const exportResult = await generateChartExport({
        data: chartData,
        format,
        config: {
          width: 1200,
          height: 600,
          backgroundColor: '#ffffff',
          includeMetadata: true,
          watermark: true,
        },
      });
      
      if (format === 'png' || format === 'svg') {
        const link = document.createElement('a');
        link.href = exportResult.url;
        link.download = `score-chart-${format}-${new Date().toISOString()}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        // For data formats, create blob download
        const blob = new Blob([exportResult.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `score-chart-${format}-${new Date().toISOString()}.${format}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
      
      toast.success(`Chart exported as ${format.toUpperCase()}`);
    } catch (error) {
      console.error('Export failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Export failed: ${errorMessage}`);
    } finally {
      setIsExporting(false);
    }
  }, [chartData]);

  const toggleMetric = useCallback((metric: string) => {
    setVisibleMetrics(prev => {
      const next = new Set(prev);
      if (next.has(metric)) {
        next.delete(metric);
      } else {
        next.add(metric);
      }
      return next;
    });
  }, []);

  const handleDataPointClick = useCallback((data: any) => {
    if (!data || !data.activePayload || !onDataPointClick) return;
    
    const point = data.activePayload[0]?.payload;
    if (point) {
      setSelectedPoint(point);
      onDataPointClick(point);
    }
  }, [onDataPointClick]);

  const getChartColor = useCallback((metric: string) => {
    const colors: Record<string, string> = {
      overallScore: '#3b82f6',
      performanceScore: '#10b981',
      accessibilityScore: '#8b5cf6',
      bestPracticesScore: '#f59e0b',
      seoScore: '#ef4444',
      issuesFixed: '#06b6d4',
      newIssues: '#f97316',
      pageViews: '#8b5cf6',
      conversionRate: '#10b981',
      responseTime: '#6366f1',
    };
    
    return colors[metric] || '#6b7280';
  }, []);

  const getMetricIcon = useCallback((metric: string) => {
    const icons: Record<string, React.ComponentType<any>> = {
      overallScore: Target,
      performanceScore: Zap,
      accessibilityScore: Shield,
      bestPracticesScore: Shield,
      seoScore: BarChart3,
      issuesFixed: TrendingUp,
      newIssues: AlertTriangle,
      pageViews: Eye,
      conversionRate: TrendingUp,
      responseTime: Clock,
    };
    
    return icons[metric] || BarChart3;
  }, []);

  const renderChart = useMemo(() => {
    const combinedData = config.showForecast 
      ? [...chartData, ...forecastData]
      : chartData;
    
    const ChartComponent = config.type === 'composed' ? ComposedChart :
                          config.type === 'area' ? AreaChart :
                          config.type === 'bar' ? BarChart : LineChart;
    
    return (
      <ResponsiveContainer width="100%" height={isFullscreen ? "90%" : "100%"}>
        <ChartComponent
          data={combinedData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          onClick={handleDataPointClick}
        >
          {config.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />}
          
          <XAxis
            dataKey="timestamp"
            tickFormatter={(value) => format(new Date(value), period === '7d' ? 'MM/dd HH:mm' : 'MM/dd')}
            stroke="#6b7280"
            fontSize={12}
          />
          
          <YAxis
            domain={config.yAxisDomain}
            stroke="#6b7280"
            fontSize={12}
            label={{ 
              value: 'Score', 
              angle: -90, 
              position: 'insideLeft',
              offset: -10,
              style: { textAnchor: 'middle' }
            }}
          />
          
          <Tooltip
            content={<ChartTooltip period={period} />}
            cursor={{ stroke: '#d1d5db', strokeWidth: 1 }}
          />
          
          {config.showLegend && (
            <Legend 
              verticalAlign="top" 
              height={36}
              iconSize={12}
              iconType="circle"
            />
          )}
          
          {/* Overall Score Line */}
          {visibleMetrics.has('overallScore') && (
            <Line
              type={config.smoothLines ? "monotone" : "linear"}
              dataKey="overallScore"
              stroke={getChartColor('overallScore')}
              strokeWidth={3}
              dot={{ r: 4, strokeWidth: 2 }}
              activeDot={{ r: 6, strokeWidth: 2 }}
              name="Overall Score"
              animationDuration={config.animationDuration}
            />
          )}
          
          {/* Performance Score Area */}
          {visibleMetrics.has('performanceScore') && (
            <Area
              type={config.smoothLines ? "monotone" : "linear"}
              dataKey="performanceScore"
              stroke={getChartColor('performanceScore')}
              fill={getChartColor('performanceScore')}
              fillOpacity={0.3}
              strokeWidth={2}
              name="Performance"
              animationDuration={config.animationDuration}
            />
          )}
          
          {/* SEO Score Line */}
          {visibleMetrics.has('seoScore') && (
            <Line
              type={config.smoothLines ? "monotone" : "linear"}
              dataKey="seoScore"
              stroke={getChartColor('seoScore')}
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={false}
              name="SEO Score"
              animationDuration={config.animationDuration}
            />
          )}
          
          {/* Issues Fixed Bars */}
          {visibleMetrics.has('issuesFixed') && config.type === 'composed' && (
            <Bar
              dataKey="issuesFixed"
              fill={getChartColor('issuesFixed')}
              fillOpacity={0.6}
              barSize={20}
              name="Issues Fixed"
              animationDuration={config.animationDuration}
            >
              {combinedData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.anomaly ? '#ef4444' : getChartColor('issuesFixed')}
                />
              ))}
            </Bar>
          )}
          
          {/* New Issues Scatter */}
          {visibleMetrics.has('newIssues') && (
            <Scatter
              dataKey="newIssues"
              fill={getChartColor('newIssues')}
              name="New Issues"
            />
          )}
          
          {/* Reference Lines */}
          {config.showReferenceLines && benchmarkData && (
            <>
              <ReferenceLine
                y={benchmarkData.industryAverage}
                stroke="#6b7280"
                strokeDasharray="3 3"
                label={{ 
                  value: 'Industry Avg', 
                  position: 'right',
                  fill: '#6b7280',
                  fontSize: 12,
                }}
              />
              <ReferenceLine
                y={benchmarkData.topPerformer}
                stroke="#10b981"
                strokeDasharray="3 3"
                label={{ 
                  value: 'Top Performer', 
                  position: 'right',
                  fill: '#10b981',
                  fontSize: 12,
                }}
              />
            </>
          )}
          
          {/* Forecast Area */}
          {config.showForecast && forecastData.length > 0 && (
            <ReferenceArea
              x1={chartData[chartData.length - 1]?.timestamp}
              x2={forecastData[forecastData.length - 1]?.timestamp}
              fill="#fbbf24"
              fillOpacity={0.1}
              stroke="none"
            />
          )}
          
          {/* Anomaly Indicators */}
          {config.showAnomalies && chartData.map((point, index) => 
            point.anomaly ? (
              <ReferenceLine
                key={`anomaly-${index}`}
                x={point.timestamp}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            ) : null
          )}
          
          {/* Brush for zooming */}
          {config.showBrush && chartData.length > 30 && (
            <Brush
              dataKey="timestamp"
              height={30}
              stroke="#8884d8"
              travellerWidth={10}
              startIndex={brushRange[0]}
              endIndex={brushRange[1]}
              onChange={({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
                setBrushRange([startIndex, endIndex]);
              }}
            />
          )}
        </ChartComponent>
      </ResponsiveContainer>
    );
  }, [
    chartData,
    forecastData,
    config,
    visibleMetrics,
    period,
    benchmarkData,
    isFullscreen,
    getChartColor,
    handleDataPointClick,
    brushRange,
  ]);

  // Render loading state
  if (loading && chartData.length === 0) {
    return <ScoreChartSkeleton />;
  }

  // Calculate summary statistics
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    
    const scores = chartData.map(d => d.overallScore);
    const latestScore = scores[scores.length - 1];
    const previousScore = scores.length > 1 ? scores[scores.length - 2] : latestScore;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const change = latestScore - previousScore;
    
    return {
      latestScore,
      change,
      maxScore,
      minScore,
      avgScore,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
      volatility: Math.sqrt(
        scores.reduce((acc, score) => acc + Math.pow(score - avgScore, 2), 0) / scores.length
      ),
    };
  }, [chartData]);

  return (
    <div 
      ref={chartRef}
      className={`bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden transition-all duration-300 ${
        isFullscreen ? 'fixed inset-0 z-50 p-6 bg-white' : 'relative'
      }`}
    >
      {/* Header */}
      <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Target className="w-6 h-6 text-blue-600" />
              <h2 className="text-2xl font-bold text-gray-900">SEO Score Trends</h2>
              {trends && (
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                  trends.direction === 'up' 
                    ? 'bg-green-100 text-green-800' 
                    : trends.direction === 'down' 
                    ? 'bg-red-100 text-red-800' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  {trends.direction === 'up' ? '📈 Improving' : 
                   trends.direction === 'down' ? '📉 Declining' : '➡️ Stable'}
                </span>
              )}
            </div>
            <p className="text-gray-600">
              Track your SEO performance over time with detailed analytics and benchmarks
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            {showExport && (
              <div className="relative group">
                <button
                  onClick={() => handleExport('png')}
                  disabled={isExporting}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  {isExporting ? 'Exporting...' : 'Export'}
                </button>
                
                <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 hidden group-hover:block z-10">
                  <button
                    onClick={() => handleExport('png')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                  >
                    Export as PNG
                  </button>
                  <button
                    onClick={() => handleExport('svg')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                  >
                    Export as SVG
                  </button>
                  <button
                    onClick={() => handleExport('csv')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                  >
                    Export Data as CSV
                  </button>
                  <button
                    onClick={() => handleExport('json')}
                    className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                  >
                    Export Data as JSON
                  </button>
                </div>
              </div>
            )}
            
            <button
              onClick={toggleFullscreen}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-4 h-4" />
                  Exit Fullscreen
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4" />
                  Fullscreen
                </>
              )}
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4">
              <div className="text-sm text-gray-600 mb-1">Current Score</div>
              <div className="text-3xl font-bold text-gray-900">
                {stats.latestScore.toFixed(1)}
              </div>
              <div className="flex items-center gap-1 mt-1">
                {stats.change > 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : stats.change < 0 ? (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                ) : (
                  <Minus className="w-4 h-4 text-gray-500" />
                )}
                <span className={`text-sm font-medium ${
                  stats.change > 0 ? 'text-green-600' : 
                  stats.change < 0 ? 'text-red-600' : 'text-gray-600'
                }`}>
                  {stats.change > 0 ? '+' : ''}{stats.change.toFixed(1)}
                </span>
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4">
              <div className="text-sm text-gray-600 mb-1">Average</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats.avgScore.toFixed(1)}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Over {chartData.length} data points
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4">
              <div className="text-sm text-gray-600 mb-1">High</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats.maxScore.toFixed(1)}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Peak performance
              </div>
            </div>
            
            <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl p-4">
              <div className="text-sm text-gray-600 mb-1">Low</div>
              <div className="text-2xl font-bold text-gray-900">
                {stats.minScore.toFixed(1)}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Lowest point
              </div>
            </div>
            
            {trends && (
              <>
                <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4">
                  <div className="text-sm text-gray-600 mb-1">Volatility</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {trends.volatility.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {trends.volatility < 2 ? 'Stable' : 
                     trends.volatility < 5 ? 'Moderate' : 'Volatile'}
                  </div>
                </div>
                
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-4">
                  <div className="text-sm text-gray-600 mb-1">Confidence</div>
                  <div className="text-2xl font-bold text-gray-900">
                    {(trends.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Trend reliability
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Controls */}
        {showControls && (
          <div className="flex flex-wrap gap-4 mb-4">
            {/* Period Selector */}
            <div className="flex gap-2">
              {(['7d', '30d', '90d', '1y'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => onPeriodChange?.(p)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                    period === p
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            
            {/* Chart Type */}
            <div className="flex gap-2">
              <button
                onClick={() => setConfig(c => ({ ...c, type: 'line' }))}
                className={`p-2 rounded-lg ${config.type === 'line' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}`}
                title="Line Chart"
              >
                <LineChartIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setConfig(c => ({ ...c, type: 'area' }))}
                className={`p-2 rounded-lg ${config.type === 'area' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}`}
                title="Area Chart"
              >
                <AreaChartIcon className="w-4 h-4" />
              </button>
              <button
                onClick={() => setConfig(c => ({ ...c, type: 'composed' }))}
                className={`p-2 rounded-lg ${config.type === 'composed' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}`}
                title="Composed Chart"
              >
                <BarChart3 className="w-4 h-4" />
              </button>
            </div>
            
            {/* Toggle Options */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setConfig(c => ({ ...c, showGrid: !c.showGrid }))}
                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  config.showGrid 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                Grid
              </button>
              <button
                onClick={() => setConfig(c => ({ ...c, showLegend: !c.showLegend }))}
                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  config.showLegend 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                Legend
              </button>
              <button
                onClick={() => setConfig(c => ({ ...c, smoothLines: !c.smoothLines }))}
                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  config.smoothLines 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                Smooth
              </button>
              <button
                onClick={() => setConfig(c => ({ ...c, showAnomalies: !c.showAnomalies }))}
                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  config.showAnomalies 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                Anomalies
              </button>
              <button
                onClick={() => setConfig(c => ({ ...c, showForecast: !c.showForecast }))}
                className={`px-3 py-1 rounded-lg text-sm font-medium ${
                  config.showForecast 
                    ? 'bg-blue-100 text-blue-600' 
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                Forecast
              </button>
            </div>
          </div>
        )}

        {/* Metrics Selector */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            'overallScore',
            'performanceScore',
            'accessibilityScore',
            'bestPracticesScore',
            'seoScore',
            'issuesFixed',
            'newIssues',
            'pageViews',
            'conversionRate',
            'responseTime',
          ].map((metric) => {
            const Icon = getMetricIcon(metric);
            const isVisible = visibleMetrics.has(metric);
            
            return (
              <button
                key={metric}
                onClick={() => toggleMetric(metric)}
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                  isVisible
                    ? 'bg-blue-100 text-blue-600 border border-blue-200'
                    : 'bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>
                  {metric.replace(/([A-Z])/g, ' $1').trim()}
                </span>
                {isVisible ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart Container */}
      <div className={`p-6 ${isFullscreen ? 'h-[calc(100vh-200px)]' : 'h-[500px]'}`}>
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Data Available</h3>
              <p className="text-gray-600 max-w-md mx-auto">
                No score data found for the selected period. 
                Run a scan to start tracking your SEO performance.
              </p>
            </div>
          </div>
        ) : (
          <>
            {renderChart}
            
            {/* Benchmarks */}
            {showBenchmarks && benchmarkData && (
              <div className="mt-6">
                <BenchmarkIndicator
                  currentScore={stats?.latestScore || 0}
                  benchmarks={benchmarkData}
                  period={period}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="text-sm text-gray-600">
            {chartData.length > 0 && (
              <>
                Data from {format(new Date(chartData[0].timestamp), 'MMM dd, yyyy')} to{' '}
                {format(new Date(chartData[chartData.length - 1].timestamp), 'MMM dd, yyyy')}
                {refreshInterval > 0 && ' • Auto-refresh enabled'}
              </>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {selectedPoint && (
              <div className="text-sm">
                <span className="font-medium text-gray-900">Selected: </span>
                <span className="text-gray-600">
                  {format(new Date(selectedPoint.timestamp), 'MMM dd, HH:mm')} -{' '}
                  Score: {selectedPoint.overallScore}
                </span>
              </div>
            )}
            
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span>Overall</span>
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span>Performance</span>
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span>SEO</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

ScoreChart.displayName = 'ScoreChart';

export default ScoreChart;
