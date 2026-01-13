import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useScanner } from '../../../hooks/useScanner';
import { IssueCard } from '../ui/IssueCard';
import { Button } from '../ui/Button';
import { ProgressRing } from '../ui/ProgressRing';
import { calculateImpact } from '../../../utils/calculateImpact';
import { formatSeoScore } from '../../../utils/formatSeoScore';
import type { SEOIssue, ScanResults as ScanResultsType, ScanStatus } from '../../../types/seo';

interface ScanResultsProps {
  scanId: string | null;
  onScanComplete?: (results: ScanResultsType) => void;
  onFixIssue?: (issueId: string) => void;
  className?: string;
}

type IssueFilter = 'all' | 'critical' | 'warning' | 'info';
type SortField = 'severity' | 'impact' | 'name' | 'fix_time';

export const ScanResults: React.FC<ScanResultsProps> = ({
  scanId,
  onScanComplete,
  onFixIssue,
  className = ''
}) => {
  const [activeFilter, setActiveFilter] = useState<IssueFilter>('all');
  const [sortField, setSortField] = useState<SortField>('severity');
  const [sortAscending, setSortAscending] = useState(false);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());

  const {
    scanResults,
    scanStatus,
    scanProgress,
    fetchScanResults,
    exportResults,
    retryScan,
    isLoading,
    error
  } = useScanner(scanId || '');

  useEffect(() => {
    if (scanId) {
      fetchScanResults();
    }
  }, [scanId, fetchScanResults]);

  useEffect(() => {
    if (scanStatus === 'completed' && scanResults && onScanComplete) {
      onScanComplete(scanResults);
    }
  }, [scanStatus, scanResults, onScanComplete]);

  const filteredAndSortedIssues = useMemo(() => {
    if (!scanResults?.issues) return [];

    let filtered = [...scanResults.issues];

    if (activeFilter !== 'all') {
      filtered = filtered.filter(issue => issue.severity === activeFilter);
    }

    filtered.sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortField) {
        case 'severity':
          const severityOrder = { critical: 3, warning: 2, info: 1 };
          aValue = severityOrder[a.severity] || 0;
          bValue = severityOrder[b.severity] || 0;
          break;
        case 'impact':
          aValue = calculateImpact(a);
          bValue = calculateImpact(b);
          break;
        case 'fix_time':
          aValue = a.estimatedFixTime || 0;
          bValue = b.estimatedFixTime || 0;
          break;
        case 'name':
        default:
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
      }

      if (aValue < bValue) return sortAscending ? -1 : 1;
      if (aValue > bValue) return sortAscending ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [scanResults?.issues, activeFilter, sortField, sortAscending]);

  const statistics = useMemo(() => {
    if (!scanResults) return null;

    const issues = scanResults.issues || [];
    const critical = issues.filter(i => i.severity === 'critical').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const info = issues.filter(i => i.severity === 'info').length;
    
    const totalFixTime = issues.reduce((sum, issue) => sum + (issue.estimatedFixTime || 0), 0);
    const averageImpact = issues.length > 0 
      ? issues.reduce((sum, issue) => sum + calculateImpact(issue), 0) / issues.length 
      : 0;

    return {
      total: issues.length,
      critical,
      warnings,
      info,
      totalFixTime,
      averageImpact
    };
  }, [scanResults]);

  const toggleIssueSelection = useCallback((issueId: string) => {
    setSelectedIssues(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!scanResults?.issues) return;
    
    if (selectedIssues.size === scanResults.issues.length) {
      setSelectedIssues(new Set());
    } else {
      setSelectedIssues(new Set(scanResults.issues.map(issue => issue.id)));
    }
  }, [scanResults?.issues, selectedIssues.size]);

  const handleBulkFix = useCallback(async () => {
    if (selectedIssues.size === 0 || !onFixIssue) return;
    
    for (const issueId of selectedIssues) {
      onFixIssue(issueId);
    }
    
    alert(`Initiating fix for ${selectedIssues.size} selected issues`);
  }, [selectedIssues, onFixIssue]);

  const handleExport = useCallback(async (format: 'json' | 'csv' | 'pdf') => {
    try {
      await exportResults(format);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export results. Please try again.');
    }
  }, [exportResults]);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortAscending(prev => !prev);
    } else {
      setSortField(field);
      setSortAscending(false);
    }
  }, [sortField]);

  if (isLoading && !scanResults) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Loading scan results...</p>
        {scanProgress > 0 && (
          <div className="w-full max-w-md mt-4">
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${scanProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-gray-500 mt-2 text-center">
              {scanProgress}% complete
            </p>
          </div>
        )}
      </div>
    );
  }

  if (error && !scanResults) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <div className="text-red-500 text-4xl mb-4">⚠️</div>
        <h3 className="text-xl font-semibold text-gray-800 mb-2">
          Failed to load scan results
        </h3>
        <p className="text-gray-600 mb-6 text-center">{error.message}</p>
        <Button
          onClick={retryScan}
          variant="primary"
          className="px-6 py-3"
        >
          Retry Scan
        </Button>
      </div>
    );
  }

  if (!scanResults && !isLoading) {
    return (
      <div className={`flex flex-col items-center justify-center p-8 ${className}`}>
        <div className="text-gray-400 text-4xl mb-4">🔍</div>
        <h3 className="text-xl font-semibold text-gray-800 mb-2">
          No Scan Results Available
        </h3>
        <p className="text-gray-600 text-center">
          Run a scan to see SEO issues and recommendations
        </p>
      </div>
    );
  }

  if (scanStatus === 'scanning' && scanResults) {
    return (
      <div className={`p-6 ${className}`}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800">Scan in Progress</h2>
          <ProgressRing 
            progress={scanProgress}
            size={60}
            strokeWidth={6}
            showPercentage
          />
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-3"></div>
            <div>
              <p className="font-medium text-blue-800">
                Currently scanning: {scanResults.url}
              </p>
              <p className="text-sm text-blue-600">
                {scanProgress}% complete • {scanResults.pagesScanned || 0} pages analyzed
              </p>
            </div>
          </div>
        </div>

        {scanResults.issues && scanResults.issues.length > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-gray-700 mb-4">
              Issues Found So Far ({scanResults.issues.length})
            </h3>
            <div className="space-y-4">
              {scanResults.issues.slice(0, 3).map(issue => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  isExpanded={expandedIssue === issue.id}
                  onExpand={() => setExpandedIssue(
                    expandedIssue === issue.id ? null : issue.id
                  )}
                />
              ))}
            </div>
            {scanResults.issues.length > 3 && (
              <p className="text-gray-500 text-sm mt-4">
                + {scanResults.issues.length - 3} more issues being analyzed...
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl shadow-lg overflow-hidden ${className}`}>
      <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">
              SEO Scan Results
            </h2>
            <div className="flex items-center mt-2 space-x-4">
              <div className="flex items-center">
                <span className="text-sm text-gray-600">URL:</span>
                <a 
                  href={scanResults.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-blue-600 hover:text-blue-800 truncate max-w-xs"
                  title={scanResults.url}
                >
                  {scanResults.url}
                </a>
              </div>
              <div className="flex items-center">
                <span className="text-sm text-gray-600">Scanned:</span>
                <span className="ml-2 text-gray-800">
                  {new Date(scanResults.scanDate).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-800">
                {formatSeoScore(scanResults.seoScore)}
              </div>
              <div className="text-sm text-gray-600">SEO Score</div>
            </div>
            <div className="h-12 w-px bg-gray-300"></div>
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-800">
                {scanResults.pagesScanned}
              </div>
              <div className="text-sm text-gray-600">Pages</div>
            </div>
          </div>
        </div>
      </div>

      {statistics && (
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="text-center">
              <div className={`text-xl font-bold ${
                statistics.total > 0 ? 'text-red-600' : 'text-green-600'
              }`}>
                {statistics.total}
              </div>
              <div className="text-sm text-gray-600">Total Issues</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-red-600">
                {statistics.critical}
              </div>
              <div className="text-sm text-gray-600">Critical</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-amber-600">
                {statistics.warnings}
              </div>
              <div className="text-sm text-gray-600">Warnings</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-blue-600">
                {statistics.info}
              </div>
              <div className="text-sm text-gray-600">Info</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-800">
                {Math.round(statistics.totalFixTime)}m
              </div>
              <div className="text-sm text-gray-600">Fix Time</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-800">
                {Math.round(statistics.averageImpact)}%
              </div>
              <div className="text-sm text-gray-600">Avg Impact</div>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">Filter:</span>
              {(['all', 'critical', 'warning', 'info'] as IssueFilter[]).map(filter => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                    activeFilter === filter
                      ? filter === 'critical'
                        ? 'bg-red-100 text-red-800'
                        : filter === 'warning'
                        ? 'bg-amber-100 text-amber-800'
                        : filter === 'info'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {filter.charAt(0).toUpperCase() + filter.slice(1)}
                  {statistics && (
                    <span className="ml-1.5 bg-white/50 px-1.5 py-0.5 rounded-full text-xs">
                      {filter === 'all' ? statistics.total :
                       filter === 'critical' ? statistics.critical :
                       filter === 'warning' ? statistics.warnings :
                       statistics.info}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">Sort by:</span>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="severity">Severity</option>
                <option value="impact">Impact</option>
                <option value="name">Name</option>
                <option value="fix_time">Fix Time</option>
              </select>
              <button
                onClick={() => setSortAscending(!sortAscending)}
                className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors"
                title={sortAscending ? 'Ascending' : 'Descending'}
              >
                {sortAscending ? '↑' : '↓'}
              </button>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {selectedIssues.size > 0 && (
              <Button
                onClick={handleBulkFix}
                variant="primary"
                className="px-4 py-2"
              >
                Fix Selected ({selectedIssues.size})
              </Button>
            )}
            
            <div className="relative group">
              <Button
                variant="outline"
                className="px-4 py-2"
              >
                Export
              </Button>
              <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                <button
                  onClick={() => handleExport('json')}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export as JSON
                </button>
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export as CSV
                </button>
                <button
                  onClick={() => handleExport('pdf')}
                  className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  Export as PDF
                </button>
              </div>
            </div>

            <Button
              onClick={toggleSelectAll}
              variant="ghost"
              className="px-4 py-2"
            >
              {selectedIssues.size === scanResults.issues.length ? 'Deselect All' : 'Select All'}
            </Button>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-200">
        {filteredAndSortedIssues.length > 0 ? (
          filteredAndSortedIssues.map(issue => (
            <div 
              key={issue.id} 
              className={`transition-colors ${
                selectedIssues.has(issue.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="p-4">
                <div className="flex items-start space-x-4">
                  <input
                    type="checkbox"
                    checked={selectedIssues.has(issue.id)}
                    onChange={() => toggleIssueSelection(issue.id)}
                    className="mt-1 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  
                  <div className="flex-1">
                    <IssueCard
                      issue={issue}
                      isExpanded={expandedIssue === issue.id}
                      onExpand={() => setExpandedIssue(
                        expandedIssue === issue.id ? null : issue.id
                      )}
                      onFix={onFixIssue}
                      showActions
                    />
                  </div>
                  
                  <div className="text-center min-w-[80px]">
                    <div className="text-2xl font-bold text-gray-800">
                      {calculateImpact(issue)}%
                    </div>
                    <div className="text-sm text-gray-600">Impact</div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="p-8 text-center">
            <div className="text-gray-400 text-4xl mb-4">✅</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No {activeFilter !== 'all' ? activeFilter : ''} Issues Found
            </h3>
            <p className="text-gray-600">
              {activeFilter === 'all' 
                ? 'Great! No SEO issues were detected in this scan.'
                : `No ${activeFilter} severity issues found. Try changing the filter.`}
            </p>
          </div>
        )}
      </div>

      {filteredAndSortedIssues.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="text-sm text-gray-600">
              Showing {filteredAndSortedIssues.length} of {scanResults.issues.length} issues
              {activeFilter !== 'all' && ` (filtered by ${activeFilter})`}
            </div>
            
            <div className="flex items-center space-x-4">
              {selectedIssues.size > 0 && (
                <div className="text-sm font-medium text-gray-800">
                  {selectedIssues.size} issues selected
                </div>
              )}
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={retryScan}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Rescan
                </button>
                <Button
                  onClick={() => onScanComplete?.(scanResults)}
                  variant="outline"
                  className="px-4 py-2"
                >
                  View Full Report
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {scanResults.summary && (
        <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-t border-blue-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Scan Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-medium text-gray-700 mb-2">Key Findings</h4>
              <ul className="space-y-1">
                {scanResults.summary.keyFindings?.slice(0, 3).map((finding, index) => (
                  <li key={index} className="text-sm text-gray-600 flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-medium text-gray-700 mb-2">Recommendations</h4>
              <ul className="space-y-1">
                {scanResults.summary.recommendations?.slice(0, 3).map((rec, index) => (
                  <li key={index} className="text-sm text-gray-600 flex items-start">
                    <span className="text-green-500 mr-2">✓</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
            
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <h4 className="font-medium text-gray-700 mb-2">Estimated Impact</h4>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">SEO Score Improvement:</span>
                    <span className="font-medium text-green-600">
                      +{scanResults.summary.estimatedScoreImprovement || 0} points
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mt-1">
                    <div 
                      className="h-full bg-green-500"
                      style={{ width: `${Math.min(100, scanResults.summary.estimatedScoreImprovement || 0)}%` }}
                    ></div>
                  </div>
                </div>
                <div className="pt-2 border-t border-gray-200">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Priority Issues:</span>
                    <span className="font-medium text-red-600">
                      {scanResults.summary.priorityIssues || 0} to fix
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center">
            <div className="text-red-500 mr-3">⚠️</div>
            <div>
              <p className="font-medium text-red-800">Error Loading Results</p>
              <p className="text-sm text-red-600 mt-1">{error.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScanResults;