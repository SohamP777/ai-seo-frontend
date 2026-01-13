import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { format, differenceInDays, parseISO } from 'date-fns';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Download,
  RefreshCw,
  Filter,
  Search,
  ChevronDown,
  ChevronUp,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Zap,
  Shield,
  FileText,
  Globe,
  Layers,
  ExternalLink,
  Play,
  Pause,
  StopCircle,
  AlertTriangle,
  History,
} from 'lucide-react';
import { useFixer } from '@/hooks/useFixer';
import { useScanner } from '@/hooks/useScanner';
import { FixHistoryItem, FixStatus, FixPriority } from '@/types/fixer';
import { generateFixReport, exportFixHistory, retryFailedFix, cancelFix } from '@/services/fixer';
import { toast } from 'react-hot-toast';
import { useWebSocket } from '@/hooks/useWebSocket';
import FixHistorySkeleton from './FixHistorySkeleton';
import FixStatusBadge from './FixStatusBadge';
import PriorityIndicator from './PriorityIndicator';
import ImpactAnalysis from './ImpactAnalysis';

interface FixHistoryProps {
  projectId?: string;
  autoRefresh?: boolean;
  onFixSelect?: (fixId: string) => void;
  onBulkAction?: (fixIds: string[], action: 'retry' | 'cancel' | 'export') => Promise<void>;
  showAnalytics?: boolean;
  initialFilters?: {
    status?: FixStatus[];
    priority?: FixPriority[];
    dateRange?: { start: Date; end: Date };
    fixType?: string[];
  };
}

const FixHistory: React.FC<FixHistoryProps> = memo(({
  projectId,
  autoRefresh = true,
  onFixSelect,
  onBulkAction,
  showAnalytics = true,
  initialFilters,
}) => {
  const { 
    fixHistory, 
    loading, 
    error, 
    fetchFixHistory,
    refreshFixHistory,
    getFixAnalytics 
  } = useFixer();
  const { scanResults } = useScanner();
  const { subscribe, unsubscribe, isConnected } = useWebSocket();
  
  const [filters, setFilters] = useState({
    status: initialFilters?.status || [] as FixStatus[],
    priority: initialFilters?.priority || [] as FixPriority[],
    fixType: initialFilters?.fixType || [],
    searchQuery: '',
    dateRange: initialFilters?.dateRange || null as { start: Date; end: Date } | null,
  });
  
  const [selectedFixes, setSelectedFixes] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{
    key: keyof FixHistoryItem;
    direction: 'asc' | 'desc';
  }>({ key: 'appliedAt', direction: 'desc' });
  
  const [expandedFix, setExpandedFix] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [liveUpdates, setLiveUpdates] = useState<FixHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const itemsPerPage = 20;

  // Initialize WebSocket for real-time updates
  useEffect(() => {
    if (!isConnected || !autoRefresh) return;

    const handleFixUpdate = (data: any) => {
      if (data.type === 'fix_progress' || data.type === 'fix_completed' || data.type === 'fix_failed') {
        setLiveUpdates(prev => {
          const existingIndex = prev.findIndex(item => item.id === data.fixId);
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = { ...updated[existingIndex], ...data };
            return updated;
          }
          return [...prev, data];
        });
      }
    };

    subscribe('fix_updates', handleFixUpdate);
    
    return () => {
      unsubscribe('fix_updates');
    };
  }, [isConnected, autoRefresh, subscribe, unsubscribe]);

  // Fetch initial data
  useEffect(() => {
    const loadData = async () => {
      try {
        await fetchFixHistory({
          projectId,
          limit: 100,
          offset: 0,
        });
        
        if (showAnalytics) {
          const analyticsData = await getFixAnalytics(projectId);
          setAnalytics(analyticsData);
        }
      } catch (err) {
        console.error('Failed to load fix history:', err);
        toast.error('Failed to load fix history');
      }
    };
    
    loadData();
    
    // Auto-refresh every 30 seconds if enabled
    let intervalId: NodeJS.Timeout;
    if (autoRefresh) {
      intervalId = setInterval(() => {
        refreshFixHistory();
      }, 30000);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [projectId, autoRefresh]);

  // Merge live updates with fetched history
  const mergedHistory = useMemo(() => {
    const baseHistory = fixHistory || [];
    const liveItems = liveUpdates.filter(item => 
      !baseHistory.some(base => base.id === item.id)
    );
    
    return [...liveItems, ...baseHistory];
  }, [fixHistory, liveUpdates]);

  // Apply filters and sorting
  const filteredHistory = useMemo(() => {
    let filtered = mergedHistory;
    
    // Apply status filter
    if (filters.status.length > 0) {
      filtered = filtered.filter(item => filters.status.includes(item.status));
    }
    
    // Apply priority filter
    if (filters.priority.length > 0) {
      filtered = filtered.filter(item => filters.priority.includes(item.priority));
    }
    
    // Apply fix type filter
    if (filters.fixType.length > 0) {
      filtered = filtered.filter(item => filters.fixType.includes(item.fixType));
    }
    
    // Apply search query
    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.url.toLowerCase().includes(query) ||
        item.issueType.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query)
      );
    }
    
    // Apply date range filter
    if (filters.dateRange) {
      filtered = filtered.filter(item => {
        const itemDate = item.appliedAt instanceof Date ? item.appliedAt : new Date(item.appliedAt);
        return (
          itemDate >= filters.dateRange!.start &&
          itemDate <= filters.dateRange!.end
        );
      });
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];
      
      // Handle date comparisons
      if (sortConfig.key === 'appliedAt') {
        aValue = aValue instanceof Date ? aValue : new Date(aValue as string);
        bValue = bValue instanceof Date ? bValue : new Date(bValue as string);
      }
      
      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
    
    return filtered;
  }, [mergedHistory, filters, sortConfig]);

  // Pagination
  const paginatedHistory = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredHistory.slice(start, start + itemsPerPage);
  }, [filteredHistory, page]);

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);

  // Handlers
  const handleExport = useCallback(async (format: 'csv' | 'pdf' | 'json') => {
    setIsExporting(true);
    try {
      const selectedIds = Array.from(selectedFixes);
      const exportData = selectedFixes.size > 0 
        ? filteredHistory.filter(item => selectedFixes.has(item.id))
        : filteredHistory;
      
      switch (format) {
        case 'csv':
          await exportFixHistory(exportData, 'csv');
          toast.success('CSV export completed');
          break;
        case 'pdf':
          const report = await generateFixReport(exportData);
          window.open(report.url, '_blank');
          toast.success('PDF report generated');
          break;
        case 'json':
          const dataStr = JSON.stringify(exportData, null, 2);
          const dataBlob = new Blob([dataStr], { type: 'application/json' });
          const url = URL.createObjectURL(dataBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `fix-history-${new Date().toISOString()}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          toast.success('JSON exported');
          break;
      }
    } catch (err) {
      console.error('Export failed:', err);
      toast.error(`Export failed: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  }, [selectedFixes, filteredHistory]);

  const handleRetryFix = useCallback(async (fixId: string) => {
    try {
      const result = await retryFailedFix(fixId);
      toast.success('Fix retry initiated');
      
      // Update local state optimistically
      setLiveUpdates(prev => prev.map(item => 
        item.id === fixId 
          ? { ...item, status: 'pending', retryCount: (item.retryCount || 0) + 1 }
          : item
      ));
    } catch (err) {
      console.error('Retry failed:', err);
      toast.error('Failed to retry fix');
    }
  }, []);

  const handleCancelFix = useCallback(async (fixId: string) => {
    try {
      await cancelFix(fixId);
      toast.success('Fix cancelled');
      
      setLiveUpdates(prev => prev.map(item => 
        item.id === fixId 
          ? { ...item, status: 'cancelled' }
          : item
      ));
    } catch (err) {
      console.error('Cancel failed:', err);
      toast.error('Failed to cancel fix');
    }
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedFixes.size === filteredHistory.length) {
      setSelectedFixes(new Set());
    } else {
      setSelectedFixes(new Set(filteredHistory.map(item => item.id)));
    }
  }, [filteredHistory, selectedFixes]);

  const handleBulkRetry = useCallback(async () => {
    if (selectedFixes.size === 0 || !onBulkAction) return;
    
    try {
      await onBulkAction(Array.from(selectedFixes), 'retry');
      toast.success(`Retrying ${selectedFixes.size} fixes`);
      setSelectedFixes(new Set());
    } catch (err) {
      toast.error('Bulk retry failed');
    }
  }, [selectedFixes, onBulkAction]);

  const handleSort = useCallback((key: keyof FixHistoryItem) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  const getSortIcon = (key: keyof FixHistoryItem) => {
    if (sortConfig.key !== key) return <ChevronDown className="w-4 h-4 opacity-30" />;
    return sortConfig.direction === 'asc' 
      ? <ChevronUp className="w-4 h-4" />
      : <ChevronDown className="w-4 h-4" />;
  };

  // Render loading state
  if (loading && !mergedHistory.length) {
    return <FixHistorySkeleton />;
  }

  // Render error state
  if (error && !mergedHistory.length) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-xl font-bold text-gray-900 mb-2">Failed to Load Fix History</h3>
        <p className="text-gray-600 mb-4">{error.message}</p>
        <button
          onClick={() => fetchFixHistory({ projectId })}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <History className="w-6 h-6 text-blue-600" />
              <h2 className="text-2xl font-bold text-gray-900">Fix History</h2>
              {isConnected && autoRefresh && (
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                  Live Updates
                </span>
              )}
            </div>
            <p className="text-gray-600">
              Track and manage all applied fixes with detailed analytics
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => refreshFixHistory()}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            <div className="relative">
              <button
                onClick={() => handleExport('csv')}
                disabled={isExporting}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                {isExporting ? 'Exporting...' : 'Export'}
              </button>
              
              {/* Export dropdown */}
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-2 hidden group-hover:block z-10">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                >
                  Export as CSV
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                >
                  Generate PDF Report
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-100"
                >
                  Export as JSON
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search fixes..."
              value={filters.searchQuery}
              onChange={(e) => setFilters(prev => ({ ...prev, searchQuery: e.target.value }))}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          
          <select
            value={filters.status.join(',')}
            onChange={(e) => setFilters(prev => ({
              ...prev,
              status: e.target.value ? e.target.value.split(',') as FixStatus[] : []
            }))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="in_progress">In Progress</option>
          </select>
          
          <select
            value={filters.priority.join(',')}
            onChange={(e) => setFilters(prev => ({
              ...prev,
              priority: e.target.value ? e.target.value.split(',') as FixPriority[] : []
            }))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          
          <div className="flex gap-2">
            <button
              onClick={() => setFilters({
                status: [],
                priority: [],
                fixType: [],
                searchQuery: '',
                dateRange: null,
              })}
              className="px-3 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Clear Filters
            </button>
            <button
              onClick={() => setFilters(prev => ({ ...prev, dateRange: {
                start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                end: new Date()
              }}))}
              className="px-3 py-2 text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              Last 7 Days
            </button>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedFixes.size > 0 && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-800">
                {selectedFixes.size} fix{selectedFixes.size !== 1 ? 'es' : ''} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleBulkRetry}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Retry Selected
                </button>
                <button
                  onClick={() => setSelectedFixes(new Set())}
                  className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Analytics Summary */}
      {showAnalytics && analytics && (
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Fix Performance Analytics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Success Rate</div>
              <div className="text-2xl font-bold text-green-600">
                {analytics.successRate.toFixed(1)}%
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Avg Fix Time</div>
              <div className="text-2xl font-bold text-blue-600">
                {Math.round(analytics.averageFixTime / 60)}m
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Score Impact</div>
              <div className="text-2xl font-bold text-purple-600">
                +{analytics.totalScoreImpact.toFixed(1)}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Auto-fix Rate</div>
              <div className="text-2xl font-bold text-orange-600">
                {analytics.autoFixRate.toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="w-12 px-6 py-4">
                <input
                  type="checkbox"
                  checked={selectedFixes.size === filteredHistory.length && filteredHistory.length > 0}
                  onChange={handleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th
                className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('appliedAt')}
              >
                <div className="flex items-center gap-1">
                  Date & Time
                  {getSortIcon('appliedAt')}
                </div>
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                URL & Issue
              </th>
              <th
                className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('priority')}
              >
                <div className="flex items-center gap-1">
                  Priority
                  {getSortIcon('priority')}
                </div>
              </th>
              <th
                className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer"
                onClick={() => handleSort('impact')}
              >
                <div className="flex items-center gap-1">
                  Impact
                  {getSortIcon('impact')}
                </div>
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {paginatedHistory.map((item) => (
              <React.Fragment key={item.id}>
                <tr
                  className={`hover:bg-gray-50 transition-colors ${
                    selectedFixes.has(item.id) ? 'bg-blue-50' : ''
                  }`}
                >
                  <td className="px-6 py-4">
                    <input
                      type="checkbox"
                      checked={selectedFixes.has(item.id)}
                      onChange={(e) => {
                        const newSelected = new Set(selectedFixes);
                        if (e.target.checked) {
                          newSelected.add(item.id);
                        } else {
                          newSelected.delete(item.id);
                        }
                        setSelectedFixes(newSelected);
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900">
                      {format(item.appliedAt instanceof Date ? item.appliedAt : new Date(item.appliedAt), 'MMM dd, yyyy')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {format(item.appliedAt instanceof Date ? item.appliedAt : new Date(item.appliedAt), 'HH:mm:ss')}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="max-w-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Globe className="w-4 h-4 text-gray-400" />
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 truncate"
                          title={item.url}
                        >
                          {item.url.replace(/^https?:\/\//, '')}
                        </a>
                      </div>
                      <div className="text-sm text-gray-900 font-medium">
                        {item.issueType}
                      </div>
                      {item.description && (
                        <div className="text-xs text-gray-600 truncate" title={item.description}>
                          {item.description}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <PriorityIndicator priority={item.priority} />
                  </td>
                  <td className="px-6 py-4">
                    <ImpactAnalysis impact={item.impact} scoreChange={item.scoreChange} />
                  </td>
                  <td className="px-6 py-4">
                    <FixStatusBadge 
                      status={item.status} 
                      progress={item.progress}
                      retryCount={item.retryCount}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedFix(expandedFix === item.id ? null : item.id)}
                        className="p-1 text-gray-500 hover:text-blue-600 transition-colors"
                        title="View details"
                      >
                        {expandedFix === item.id ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      
                      {item.status === 'failed' && (
                        <button
                          onClick={() => handleRetryFix(item.id)}
                          className="p-1 text-gray-500 hover:text-green-600 transition-colors"
                          title="Retry fix"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      
                      {['pending', 'in_progress'].includes(item.status) && (
                        <button
                          onClick={() => handleCancelFix(item.id)}
                          className="p-1 text-gray-500 hover:text-red-600 transition-colors"
                          title="Cancel fix"
                        >
                          <StopCircle className="w-4 h-4" />
                        </button>
                      )}
                      
                      <button
                        onClick={() => onFixSelect?.(item.id)}
                        className="p-1 text-gray-500 hover:text-purple-600 transition-colors"
                        title="View details"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
                
                {/* Expanded Details */}
                {expandedFix === item.id && (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 bg-gray-50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">Fix Details</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Fix Type:</span>
                              <span className="text-sm font-medium">{item.fixType}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Applied By:</span>
                              <span className="text-sm font-medium">{item.appliedBy || 'System'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Duration:</span>
                              <span className="text-sm font-medium">
                                {item.duration ? `${Math.round(item.duration / 1000)}s` : 'N/A'}
                              </span>
                            </div>
                            {item.error && (
                              <div className="mt-2 p-3 bg-red-50 rounded border border-red-200">
                                <div className="flex items-center gap-2 mb-1">
                                  <AlertTriangle className="w-4 h-4 text-red-500" />
                                  <span className="text-sm font-medium text-red-800">Error:</span>
                                </div>
                                <code className="text-xs text-red-700">{item.error}</code>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900 mb-2">Technical Details</h4>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Fix ID:</span>
                              <code className="text-xs font-mono text-gray-700">{item.id}</code>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Method:</span>
                              <span className="text-sm font-medium">{item.method}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-gray-600">Resources Modified:</span>
                              <span className="text-sm font-medium">{item.resourcesModified || 0}</span>
                            </div>
                            {item.verificationStatus && (
                              <div className="flex justify-between">
                                <span className="text-sm text-gray-600">Verification:</span>
                                <span className={`text-sm font-medium ${
                                  item.verificationStatus === 'verified' 
                                    ? 'text-green-600' 
                                    : 'text-yellow-600'
                                }`}>
                                  {item.verificationStatus}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {/* Empty State */}
        {filteredHistory.length === 0 && (
          <div className="p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
              <Clock className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No Fix History Found
            </h3>
            <p className="text-gray-600 max-w-md mx-auto mb-6">
              {filters.searchQuery || filters.status.length > 0 || filters.dateRange
                ? 'No fixes match your current filters. Try adjusting your search criteria.'
                : 'No fixes have been applied yet. Run your first scan and fix to see history here.'}
            </p>
            {filters.searchQuery || filters.status.length > 0 || filters.dateRange ? (
              <button
                onClick={() => setFilters({
                  status: [],
                  priority: [],
                  fixType: [],
                  searchQuery: '',
                  dateRange: null,
                })}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Clear All Filters
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Pagination */}
      {filteredHistory.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Showing <span className="font-medium">{Math.min((page - 1) * itemsPerPage + 1, filteredHistory.length)}</span> to{' '}
              <span className="font-medium">
                {Math.min(page * itemsPerPage, filteredHistory.length)}
              </span>{' '}
              of <span className="font-medium">{filteredHistory.length}</span> fixes
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              
              <div className="flex gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                        page === pageNum
                          ? 'bg-blue-600 text-white'
                          : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

FixHistory.displayName = 'FixHistory';

export default FixHistory;