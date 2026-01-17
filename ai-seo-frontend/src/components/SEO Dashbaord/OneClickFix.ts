// frontend/src/components/seo-dashboard/OneClickFix.tsx
import React, { useState, useEffect, useCallback, memo, useRef, useMemo, useContext } from 'react';
import axios, { AxiosError, CancelTokenSource, AxiosResponse } from 'axios';
import { useForm, Controller } from 'react-hook-form';
import { 
  CheckCircleIcon, 
  ExclamationTriangleIcon, 
  ArrowPathIcon,
  WrenchIcon,
  XMarkIcon,
  InformationCircleIcon,
  ClockIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TrashIcon,
  ExclamationCircleIcon,
  DocumentArrowDownIcon,
  ServerIcon,
  CogIcon
} from '@heroicons/react/24/outline';
import { SEOIssue, FixResult, BatchFixResponse } from '../../types/seo.types';
import { useBatchFix } from '../../hooks/useBatchFix';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useLogger } from '../../hooks/useLogger';
import { formatSeoScore } from '../../utils/formatSeoScore';
import { SEO_ISSUE_TYPES, FIX_CATEGORIES, API_ENDPOINTS } from '../../utils/constants';
import { SkeletonLoader, ErrorFallback, RetryButton } from '../ui/LoadingStates';
import { Tooltip } from '../ui/Tooltip';
import { ConfirmationModal } from '../ui/Modals';

// TypeScript interfaces for component-specific types
interface OneClickFixFormData {
  backupConfirmation: boolean;
  scheduleTime?: string;
  notificationEmail: string;
  rollbackOnError: boolean;
  approvalRequired: boolean;
  priority: 'low' | 'medium' | 'high';
  dryRun: boolean;
  resourceLimits: {
    maxConcurrent: number;
    timeout: number;
    memory: number;
  };
}

interface OneClickFixState {
  selectedIssues: string[];
  isFixing: boolean;
  fixProgress: number;
  currentFixIndex: number;
  totalFixes: number;
  results: FixResult[];
  showConfirmModal: boolean;
  showResultsModal: boolean;
  fixCategory: keyof typeof FIX_CATEGORIES;
  batchId: string | null;
  estimatedCompletion: string | null;
  retryCount: number;
  lastError: string | null;
}

interface FilterState {
  severity: Array<'critical' | 'high' | 'medium' | 'low'>;
  fixMethod: Array<'automated' | 'semi-automated' | 'manual'>;
  category: Array<keyof typeof FIX_CATEGORIES>;
}

interface SortConfig {
  field: 'impact' | 'severity' | 'priority' | 'estimatedTime' | 'detectedAt';
  direction: 'asc' | 'desc';
}

// Constants with proper configuration
const POLLING_INTERVAL = process.env.NODE_ENV === 'development' ? 3000 : 5000;
const MAX_RETRIES = 3;
const DEBOUNCE_DELAY = 300;
const SKELETON_ITEMS = 5;

// Custom hook for polling with cleanup
const useSafeInterval = () => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const setSafeInterval = useCallback((callback: () => void, delay: number) => {
    clearSafeInterval();
    intervalRef.current = setInterval(callback, delay);
  }, []);

  const clearSafeInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearSafeInterval();
    };
  }, [clearSafeInterval]);

  return { setSafeInterval, clearSafeInterval };
};

// Debounce hook for search/filter operations
const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
};

// Main component with error boundary wrapper
export const OneClickFixComponent: React.FC = () => {
  const { user, isAuthenticated, refreshToken } = useAuth();
  const { showSuccess, showError, showWarning, showInfo } = useNotification();
  const { logInfo, logError, logWarning, logDebug } = useLogger('OneClickFix');
  
  const cancelTokenSourceRef = useRef<CancelTokenSource | null>(null);
  const { setSafeInterval, clearSafeInterval } = useSafeInterval();
  
  const [issues, setIssues] = useState<SEOIssue[]>([]);
  const [filteredIssues, setFilteredIssues] = useState<SEOIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState<boolean>(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const debouncedSearchQuery = useDebounce(searchQuery, DEBOUNCE_DELAY);
  
  const [filters, setFilters] = useState<FilterState>({
    severity: [],
    fixMethod: [],
    category: []
  });
  
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'impact',
    direction: 'desc'
  });
  
  const [state, setState] = useState<OneClickFixState>({
    selectedIssues: [],
    isFixing: false,
    fixProgress: 0,
    currentFixIndex: 0,
    totalFixes: 0,
    results: [],
    showConfirmModal: false,
    showResultsModal: false,
    fixCategory: 'technical',
    batchId: null,
    estimatedCompletion: null,
    retryCount: 0,
    lastError: null
  });

  const batchFix = useBatchFix();

  // React Hook Form with validation schema
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isValid, isSubmitting, isDirty },
    watch,
    reset,
    setValue,
    trigger,
    getValues
  } = useForm<OneClickFixFormData>({
    mode: 'onChange',
    defaultValues: {
      backupConfirmation: true,
      notificationEmail: user?.email || '',
      rollbackOnError: true,
      approvalRequired: false,
      priority: 'medium',
      dryRun: false,
      resourceLimits: {
        maxConcurrent: 5,
        timeout: 30000,
        memory: 512
      }
    },
    resolver: async (values) => {
      const errors: Record<string, { type: string; message: string }> = {};
      
      // Custom validation logic
      if (!values.notificationEmail) {
        errors.notificationEmail = {
          type: 'required',
          message: 'Email is required for notifications'
        };
      } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.notificationEmail)) {
        errors.notificationEmail = {
          type: 'pattern',
          message: 'Please enter a valid email address'
        };
      }
      
      if (values.scheduleTime) {
        const scheduledDate = new Date(values.scheduleTime);
        const now = new Date();
        if (scheduledDate <= now) {
          errors.scheduleTime = {
            type: 'minDate',
            message: 'Schedule time must be in the future'
          };
        }
      }
      
      if (values.resourceLimits.maxConcurrent < 1 || values.resourceLimits.maxConcurrent > 20) {
        errors.resourceLimits = {
          type: 'range',
          message: 'Concurrent fixes must be between 1 and 20'
        };
      }
      
      return {
        values,
        errors
      };
    }
  });

  const backupConfirmation = watch('backupConfirmation');
  const dryRun = watch('dryRun');
  const priority = watch('priority');
  const notificationEmail = watch('notificationEmail');

  // Fetch issues with proper error handling
  const fetchIssues = useCallback(async (forceRefresh: boolean = false) => {
    if (!isAuthenticated) {
      setLoadingError('Authentication required. Please login.');
      setLoadingIssues(false);
      return;
    }

    setLoadingIssues(true);
    setLoadingError(null);

    try {
      cancelTokenSourceRef.current = axios.CancelToken.source();
      
      const response = await axios.get<SEOIssue[]>(API_ENDPOINTS.SEO_ISSUES, {
        params: { 
          fixable: true, 
          limit: 100,
          forceRefresh,
          sortBy: 'impact',
          sortOrder: 'desc'
        },
        headers: {
          'Authorization': `Bearer ${user?.token}`,
          'X-Request-ID': `fetch-issues-${Date.now()}`
        },
        cancelToken: cancelTokenSourceRef.current.token,
        timeout: 30000
      });

      setIssues(response.data);
      setFilteredIssues(response.data);
      
      logInfo('Issues fetched successfully', { count: response.data.length });
      showInfo(`Loaded ${response.data.length} fixable issues`);
    } catch (error) {
      if (axios.isCancel(error)) {
        logDebug('Fetch issues request cancelled');
        return;
      }

      const axiosError = error as AxiosError;
      let errorMessage = 'Failed to load SEO issues';
      
      if (axiosError.response?.status === 401) {
        errorMessage = 'Session expired. Please login again.';
        await refreshToken();
      } else if (axiosError.response?.status === 403) {
        errorMessage = 'You do not have permission to view SEO issues';
      } else if (axiosError.response?.status === 429) {
        errorMessage = 'Too many requests. Please wait a moment.';
      } else if (axiosError.response?.status === 500) {
        errorMessage = 'Server error. Please try again later.';
      } else if (!navigator.onLine) {
        errorMessage = 'Network connection lost. Please check your internet.';
      }

      setLoadingError(errorMessage);
      showError(errorMessage);
      logError('Failed to fetch issues', { error: axiosError });
    } finally {
      setLoadingIssues(false);
    }
  }, [isAuthenticated, user?.token, refreshToken, showError, showInfo, logInfo, logError, logDebug]);

  // Initial fetch and periodic refresh
  useEffect(() => {
    fetchIssues();

    // Refresh issues every 5 minutes
    const refreshInterval = setInterval(() => {
      if (isAuthenticated && !state.isFixing) {
        fetchIssues(true);
      }
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(refreshInterval);
      if (cancelTokenSourceRef.current) {
        cancelTokenSourceRef.current.cancel('Component unmounted');
      }
    };
  }, [fetchIssues, isAuthenticated, state.isFixing]);

  // Filter and sort issues
  useEffect(() => {
    let result = [...issues];

    // Apply search filter
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      result = result.filter(issue => 
        issue.title.toLowerCase().includes(query) ||
        issue.description.toLowerCase().includes(query) ||
        issue.type.toLowerCase().includes(query) ||
        issue.affectedUrls.some(url => url.toLowerCase().includes(query))
      );
    }

    // Apply severity filters
    if (filters.severity.length > 0) {
      result = result.filter(issue => filters.severity.includes(issue.severity));
    }

    // Apply fix method filters
    if (filters.fixMethod.length > 0) {
      result = result.filter(issue => 
        issue.fixDetails && filters.fixMethod.includes(issue.fixDetails.method)
      );
    }

    // Apply category filters
    if (filters.category.length > 0) {
      result = result.filter(issue => filters.category.includes(issue.category));
    }

    // Apply sorting
    result.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortConfig.field) {
        case 'impact':
          aValue = a.impact;
          bValue = b.impact;
          break;
        case 'severity':
          const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
          aValue = severityOrder[a.severity];
          bValue = severityOrder[b.severity];
          break;
        case 'priority':
          aValue = a.priority;
          bValue = b.priority;
          break;
        case 'estimatedTime':
          aValue = a.fixDetails?.estimatedTime || 0;
          bValue = b.fixDetails?.estimatedTime || 0;
          break;
        case 'detectedAt':
          aValue = new Date(a.detectedAt).getTime();
          bValue = new Date(b.detectedAt).getTime();
          break;
        default:
          aValue = a.impact;
          bValue = b.impact;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortConfig.direction === 'desc' 
          ? bValue.localeCompare(aValue)
          : aValue.localeCompare(bValue);
      }

      return sortConfig.direction === 'desc' 
        ? (bValue as number) - (aValue as number)
        : (aValue as number) - (bValue as number);
    });

    setFilteredIssues(result);
  }, [issues, filters, sortConfig, debouncedSearchQuery]);

  // Handle issue selection with optimistic updates
  const handleIssueSelect = useCallback((issueId: string) => {
    setState(prev => {
      const isSelected = prev.selectedIssues.includes(issueId);
      const newSelectedIssues = isSelected
        ? prev.selectedIssues.filter(id => id !== issueId)
        : [...prev.selectedIssues, issueId];
      
      const selectedIssuesData = issues.filter(issue => newSelectedIssues.includes(issue.id));
      
      if (selectedIssuesData.length === 0) {
        return {
          ...prev,
          selectedIssues: newSelectedIssues,
          fixCategory: 'technical'
        };
      }
      
      // Determine main category
      const categories = selectedIssuesData.reduce((acc, issue) => {
        acc[issue.category] = (acc[issue.category] || 0) + 1;
        return acc;
      }, {} as Record<keyof typeof FIX_CATEGORIES, number>);

      const mainCategory = Object.entries(categories)
        .sort(([, a], [, b]) => b - a)[0]?.[0] as keyof typeof FIX_CATEGORIES || 'technical';

      return {
        ...prev,
        selectedIssues: newSelectedIssues,
        fixCategory: mainCategory
      };
    });

    logDebug('Issue selection toggled', { issueId });
  }, [issues, logDebug]);

  // Select all visible issues
  const handleSelectAll = useCallback(() => {
    const visibleIssueIds = filteredIssues
      .filter(issue => issue.fixable)
      .map(issue => issue.id);

    if (state.selectedIssues.length === visibleIssueIds.length) {
      // Deselect all
      setState(prev => ({ ...prev, selectedIssues: [] }));
      showInfo('All issues deselected');
    } else {
      // Select all visible fixable issues
      const newSelection = Array.from(new Set([...state.selectedIssues, ...visibleIssueIds]));
      setState(prev => ({ 
        ...prev, 
        selectedIssues: newSelection
      }));
      showInfo(`${newSelection.length} issues selected`);
    }

    logInfo('Select all toggled', { 
      before: state.selectedIssues.length,
      after: state.selectedIssues.length === visibleIssueIds.length ? 0 : visibleIssueIds.length 
    });
  }, [filteredIssues, state.selectedIssues, showInfo, logInfo]);

  // Handle filter changes
  const handleFilterChange = useCallback((filterType: keyof FilterState, value: any) => {
    setFilters(prev => {
      const currentValues = prev[filterType];
      const newValues = currentValues.includes(value)
        ? currentValues.filter(v => v !== value)
        : [...currentValues, value];
      
      const updated = {
        ...prev,
        [filterType]: newValues
      };
      
      logDebug('Filter changed', { filterType, value, active: !currentValues.includes(value) });
      return updated;
    });
  }, [logDebug]);

  // Handle sort changes
  const handleSortChange = useCallback((field: SortConfig['field']) => {
    setSortConfig(prev => {
      if (prev.field === field) {
        const newDirection = prev.direction === 'desc' ? 'asc' : 'desc';
        logDebug('Sort direction changed', { field, direction: newDirection });
        return { ...prev, direction: newDirection };
      } else {
        logDebug('Sort field changed', { field, direction: 'desc' });
        return { field, direction: 'desc' };
      }
    });
  }, [logDebug]);

  // Start batch fix with polling
  const startBatchFixWithPolling = useCallback(async (batchId: string, formData: OneClickFixFormData) => {
    let pollAttempts = 0;
    const maxPollAttempts = 100; // ~8 minutes max

    const pollStatus = async () => {
      if (pollAttempts >= maxPollAttempts) {
        clearSafeInterval();
        setState(prev => ({
          ...prev,
          isFixing: false,
          lastError: 'Polling timeout. Please check batch status manually.'
        }));
        showError('Fix operation timed out. Please check batch status.');
        return;
      }

      pollAttempts++;
      
      try {
        const status = await batchFix.pollBatchStatus(batchId);
        
        setState(prev => ({
          ...prev,
          fixProgress: status.progress,
          currentFixIndex: status.completed,
          totalFixes: status.total,
          estimatedCompletion: status.estimatedTimeRemaining 
            ? new Date(Date.now() + status.estimatedTimeRemaining * 1000).toISOString()
            : null
        }));

        if (status.results) {
          setState(prev => ({
            ...prev,
            results: status.results || []
          }));
        }

        // Handle completion
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'partial') {
          clearSafeInterval();

          setState(prev => ({
            ...prev,
            isFixing: false,
            fixProgress: 100,
            showResultsModal: true,
            lastError: status.status === 'failed' ? 'Batch fix failed' : null
          }));

          // Update issues list
          if (status.results) {
            setIssues(prev => prev.map(issue => {
              const result = status.results?.find(r => r.issueId === issue.id);
              return result?.success ? { ...issue, fixable: false } : issue;
            }));
          }

          // Show notification
          const successCount = status.results?.filter(r => r.success).length || 0;
          const totalCount = status.results?.length || 0;
          
          if (status.status === 'completed') {
            showSuccess(`Successfully fixed ${successCount} of ${totalCount} issues`);
            logInfo('Batch fix completed', { successCount, totalCount });
          } else if (status.status === 'partial') {
            showWarning(`Partially completed: ${successCount} of ${totalCount} issues fixed`);
            logWarning('Batch fix partially completed', { successCount, totalCount });
          } else {
            showError('Batch fix failed. Check results for details.');
            logError('Batch fix failed', { results: status.results });
          }
        }
      } catch (error) {
        if (pollAttempts % 5 === 0) { // Log every 5th failed attempt
          logWarning('Polling attempt failed', { attempt: pollAttempts, error });
        }
      }
    };

    // Start polling
    setSafeInterval(pollStatus, POLLING_INTERVAL);

    // Immediate first poll
    pollStatus();
  }, [batchFix.pollBatchStatus, clearSafeInterval, setSafeInterval, showSuccess, showWarning, showError, logInfo, logWarning, logError]);

  // Execute batch fix with proper error handling
  const executeBatchFix = useCallback(async (formData: OneClickFixFormData) => {
    if (!isAuthenticated) {
      showError('Please login to perform fixes');
      return;
    }

    if (state.selectedIssues.length === 0) {
      showError('Please select at least one issue to fix');
      return;
    }

    // Cancel any existing operations
    if (cancelTokenSourceRef.current) {
      cancelTokenSourceRef.current.cancel('New batch fix started');
    }
    
    cancelTokenSourceRef.current = axios.CancelToken.source();
    
    setState(prev => ({ 
      ...prev, 
      isFixing: true, 
      showConfirmModal: false,
      fixProgress: 5,
      retryCount: 0,
      lastError: null
    }));

    logInfo('Starting batch fix', {
      issueCount: state.selectedIssues.length,
      dryRun: formData.dryRun,
      priority: formData.priority
    });

    try {
      // Execute batch fix
      const result = await batchFix.executeBatchFix(
        state.selectedIssues, 
        formData,
        cancelTokenSourceRef.current
      );

      if (result) {
        setState(prev => ({
          ...prev,
          batchId: result.batchId,
          results: result.results,
          totalFixes: result.results.length
        }));

        // Start polling for real-time updates (if not dry run)
        if (!formData.dryRun && result.batchId) {
          await startBatchFixWithPolling(result.batchId, formData);
        } else {
          // For dry runs, complete immediately
          setState(prev => ({
            ...prev,
            isFixing: false,
            fixProgress: 100,
            showResultsModal: true
          }));
          
          showSuccess(`Dry run completed. ${result.results.length} issues would be fixed.`);
          logInfo('Dry run completed', { results: result.results });
        }
      }
    } catch (error) {
      if (axios.isCancel(error)) {
        logDebug('Batch fix cancelled by user');
        return;
      }

      const err = error as Error;
      setState(prev => ({ 
        ...prev, 
        isFixing: false,
        lastError: err.message
      }));
      
      logError('Batch fix execution failed', { error: err });

      if (err.message.includes('Authentication')) {
        showError('Session expired. Please login again.');
      } else if (err.message.includes('permission')) {
        showError('You do not have permission to perform this action.');
      } else if (err.message.includes('Too many requests')) {
        showError('Too many requests. Please wait and try again.');
      } else if (err.message.includes('timeout')) {
        showError('Request timeout. Please try again.');
      } else {
        showError(`Failed to execute batch fix: ${err.message}`);
      }
    }
  }, [state.selectedIssues, batchFix.executeBatchFix, startBatchFixWithPolling, isAuthenticated, showError, showSuccess, logInfo, logError, logDebug]);

  // Cancel ongoing fix
  const handleCancelFix = useCallback(async () => {
    if (state.batchId && batchFix.cancelBatchFix) {
      try {
        const cancelled = await batchFix.cancelBatchFix(state.batchId);
        if (cancelled) {
          showSuccess('Batch fix cancelled successfully');
          logInfo('Batch fix cancelled', { batchId: state.batchId });
        } else {
          showError('Failed to cancel batch fix');
          logWarning('Failed to cancel batch fix', { batchId: state.batchId });
        }
      } catch (error) {
        showError('Error cancelling batch fix');
        logError('Error cancelling batch fix', { error, batchId: state.batchId });
      }
    }
    
    if (cancelTokenSourceRef.current) {
      cancelTokenSourceRef.current.cancel('User cancelled');
    }
    
    clearSafeInterval();
    
    setState(prev => ({ 
      ...prev, 
      isFixing: false,
      showConfirmModal: false,
      lastError: 'Cancelled by user'
    }));
  }, [state.batchId, batchFix.cancelBatchFix, clearSafeInterval, showSuccess, showError, logInfo, logWarning, logError]);

  // Retry failed issues
  const handleRetryFailed = useCallback(async () => {
    const failedIssues = state.results
      .filter(r => !r.success)
      .map(r => r.issueId);

    if (failedIssues.length === 0) {
      showWarning('No failed issues to retry');
      return;
    }

    if (!state.batchId) {
      showError('No batch ID found for retry');
      return;
    }

    try {
      const currentFormData = getValues();
      const retryFormData = {
        ...currentFormData,
        dryRun: false,
        priority: 'high' as const,
        resourceLimits: {
          ...currentFormData.resourceLimits,
          maxConcurrent: Math.min(3, currentFormData.resourceLimits.maxConcurrent)
        }
      };

      setState(prev => ({ 
        ...prev, 
        selectedIssues: failedIssues,
        showResultsModal: false,
        retryCount: prev.retryCount + 1
      }));

      logInfo('Retrying failed issues', { 
        count: failedIssues.length,
        retryCount: state.retryCount + 1
      });

      // Execute retry
      await executeBatchFix(retryFormData);
    } catch (error) {
      showError('Failed to retry issues');
      logError('Retry failed', { error });
    }
  }, [state.results, state.batchId, state.retryCount, getValues, executeBatchFix, showWarning, showError, logInfo, logError]);

  // Handle form submission with validation
  const onSubmit = async (data: OneClickFixFormData) => {
    // Validate form
    const isValid = await trigger();
    if (!isValid) {
      showError('Please fix form errors before submitting');
      return;
    }

    // Additional validation
    if (state.selectedIssues.length === 0) {
      showError('Please select at least one issue to fix');
      return;
    }

    if (!data.backupConfirmation && !data.dryRun) {
      const confirmed = await ConfirmationModal.show({
        title: '⚠️ CRITICAL WARNING',
        message: 'You have disabled backup creation. Without backups, errors cannot be automatically rolled back and data loss may be permanent. Are you absolutely sure?',
        confirmText: 'Continue Without Backup',
        cancelText: 'Enable Backup',
        variant: 'danger'
      });
      
      if (!confirmed) {
        setValue('backupConfirmation', true, { shouldValidate: true });
        return;
      }
    }

    if (data.scheduleTime) {
      const scheduledDate = new Date(data.scheduleTime);
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
      
      if (scheduledDate < oneHourFromNow) {
        showWarning('Scheduled time should be at least 1 hour in the future for safe execution');
        return;
      }
    }

    setState(prev => ({ ...prev, showConfirmModal: true }));
    logInfo('Form submitted for confirmation', { 
      issueCount: state.selectedIssues.length,
      dryRun: data.dryRun,
      scheduled: !!data.scheduleTime
    });
  };

  // Calculate statistics with memoization
  const statistics = useMemo(() => {
    const selectedIssuesData = issues.filter(issue => 
      state.selectedIssues.includes(issue.id)
    );

    if (selectedIssuesData.length === 0) {
      return {
        totalImpact: 0,
        estimatedTime: 0,
        automatedCount: 0,
        manualCount: 0,
        riskLevels: {},
        averageConfidence: 0,
        totalIssues: 0,
        requiresApproval: false,
        totalUrls: 0,
        averageSeverity: 0
      };
    }

    const totalImpact = selectedIssuesData.reduce((sum, issue) => sum + issue.impact, 0);
    const estimatedTime = selectedIssuesData.reduce((sum, issue) => 
      sum + (issue.fixDetails?.estimatedTime || 0), 0
    );
    
    const automatedCount = selectedIssuesData.filter(issue => 
      issue.fixDetails?.method === 'automated'
    ).length;
    
    const manualCount = selectedIssuesData.filter(issue => 
      issue.fixDetails?.method === 'manual'
    ).length;

    const riskLevels = selectedIssuesData.reduce((acc, issue) => {
      const risk = issue.fixDetails?.risk || 'medium';
      acc[risk] = (acc[risk] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const totalConfidence = selectedIssuesData.reduce((sum, issue) => 
      sum + (issue.fixDetails?.confidence || 0), 0
    );
    const averageConfidence = Math.round(totalConfidence / selectedIssuesData.length);

    const totalUrls = selectedIssuesData.reduce((sum, issue) => 
      sum + issue.affectedUrls.length, 0
    );

    const severityValues = { critical: 4, high: 3, medium: 2, low: 1 };
    const totalSeverity = selectedIssuesData.reduce((sum, issue) => 
      sum + severityValues[issue.severity], 0
    );
    const averageSeverity = totalSeverity / selectedIssuesData.length;

    return {
      totalImpact,
      estimatedTime,
      automatedCount,
      manualCount,
      riskLevels,
      averageConfidence,
      totalIssues: selectedIssuesData.length,
      requiresApproval: selectedIssuesData.some(issue => issue.fixDetails?.requiresApproval),
      totalUrls,
      averageSeverity
    };
  }, [issues, state.selectedIssues]);

  const selectedIssuesCount = state.selectedIssues.length;
  const hasCriticalIssues = issues.some(issue => 
    state.selectedIssues.includes(issue.id) && issue.severity === 'critical'
  );

  // Reset form and selection
  const handleReset = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedIssues: [],
      results: [],
      fixProgress: 0,
      batchId: null,
      showResultsModal: false,
      lastError: null
    }));
    reset();
    setFilters({ severity: [], fixMethod: [], category: [] });
    setSearchQuery('');
    showInfo('Selection cleared');
    logInfo('Reset form and selection');
  }, [reset, showInfo, logInfo]);

  // Export results
  const exportResults = useCallback(() => {
    if (state.results.length === 0) {
      showWarning('No results to export');
      return;
    }

    try {
      const data = {
        exportDate: new Date().toISOString(),
        batchId: state.batchId,
        results: state.results,
        summary: {
          total: state.results.length,
          successful: state.results.filter(r => r.success).length,
          failed: state.results.filter(r => !r.success).length,
          totalScoreImprovement: state.results
            .filter(r => r.success && r.scoreImpact)
            .reduce((sum, r) => sum + (r.scoreImpact || 0), 0),
          totalDuration: state.results.reduce((sum, r) => sum + (r.duration || 0), 0)
        },
        metadata: {
          toolVersion: process.env.REACT_APP_VERSION || '1.0.0',
          exportFormat: 'JSON',
          generatedBy: user?.email || 'anonymous'
        }
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { 
        type: 'application/json;charset=utf-8' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seo-fix-results-${state.batchId || Date.now()}.json`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      showSuccess('Results exported successfully');
      logInfo('Results exported', { batchId: state.batchId, resultCount: state.results.length });
    } catch (error) {
      showError('Failed to export results');
      logError('Export failed', { error });
    }
  }, [state.results, state.batchId, user?.email, showWarning, showSuccess, showError, logInfo, logError]);

  // Toggle issue expansion
  const toggleIssueExpansion = useCallback((issueId: string) => {
    setExpandedIssue(prev => prev === issueId ? null : issueId);
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setFilters({ severity: [], fixMethod: [], category: [] });
    setSearchQuery('');
    showInfo('All filters cleared');
    logDebug('All filters cleared');
  }, [showInfo, logDebug]);

  // Handle refresh issues
  const handleRefreshIssues = useCallback(() => {
    fetchIssues(true);
  }, [fetchIssues]);

  // Render severity badge with tooltip
  const renderSeverityBadge = useCallback((severity: SEOIssue['severity']) => {
    const colors = {
      low: 'bg-green-100 text-green-800 border border-green-200',
      medium: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
      high: 'bg-orange-100 text-orange-800 border border-orange-200',
      critical: 'bg-red-100 text-red-800 border border-red-200'
    };

    const icons = {
      low: '✅',
      medium: '⚠️',
      high: '🔴',
      critical: '🚨'
    };

    return (
      <Tooltip content={`${severity} severity issue`}>
        <span 
          className={`px-2 py-1 rounded-full text-xs font-medium ${colors[severity]}`}
          role="status"
          aria-label={`${severity} severity`}
        >
          {icons[severity]} {severity.charAt(0).toUpperCase() + severity.slice(1)}
        </span>
      </Tooltip>
    );
  }, []);

  // Render fix method badge
  const renderFixMethodBadge = useCallback((method: SEOIssue['fixDetails']['method']) => {
    const colors = {
      automated: 'bg-blue-100 text-blue-800 border border-blue-200',
      'semi-automated': 'bg-purple-100 text-purple-800 border border-purple-200',
      manual: 'bg-gray-100 text-gray-800 border border-gray-200'
    };

    const icons = {
      automated: '🤖',
      'semi-automated': '🔧',
      manual: '👨‍💻'
    };

    return (
      <Tooltip content={`${method.replace('-', ' ')} fix method`}>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[method]}`}>
          {icons[method]} {method.replace('-', ' ')}
        </span>
      </Tooltip>
    );
  }, []);

  // Render loading skeleton
  const renderSkeleton = () => (
    <div className="space-y-3">
      {Array.from({ length: SKELETON_ITEMS }).map((_, index) => (
        <div key={index} className="border rounded-lg p-4">
          <div className="animate-pulse">
            <div className="flex items-start space-x-3">
              <div className="h-4 w-4 bg-gray-300 rounded mt-1" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-300 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
                <div className="flex space-x-2">
                  <div className="h-3 w-12 bg-gray-200 rounded" />
                  <div className="h-3 w-16 bg-gray-200 rounded" />
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  // Render error state
  const renderErrorState = () => (
    <div className="text-center py-12">
      <ExclamationCircleIcon className="h-12 w-12 text-red-400 mx-auto" />
      <h3 className="mt-4 text-lg font-medium text-gray-900">Failed to Load Issues</h3>
      <p className="mt-2 text-sm text-gray-600">{loadingError}</p>
      <div className="mt-6">
        <RetryButton 
          onClick={handleRefreshIssues}
          label="Retry Loading Issues"
          variant="primary"
        />
      </div>
    </div>
  );

  // Render empty state
  const renderEmptyState = () => (
    <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
      <InformationCircleIcon className="h-12 w-12 text-gray-400 mx-auto" />
      <h3 className="mt-4 text-lg font-medium text-gray-900">No Issues Found</h3>
      <p className="mt-2 text-sm text-gray-600">
        {filters.severity.length > 0 || filters.fixMethod.length > 0 || filters.category.length > 0 || searchQuery
          ? 'No issues match your current filters or search'
          : 'All SEO issues have been addressed or no issues were found'
        }
      </p>
      {(filters.severity.length > 0 || filters.fixMethod.length > 0 || filters.category.length > 0 || searchQuery) && (
        <button
          onClick={clearAllFilters}
          className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
          aria-label="Clear all filters"
        >
          Clear all filters
        </button>
      )}
    </div>
  );

  // Render issue list
  const renderIssueList = () => {
    if (loadingIssues) return renderSkeleton();
    if (loadingError) return renderErrorState();
    if (filteredIssues.length === 0) return renderEmptyState();

    return (
      <div className="space-y-3">
        {filteredIssues.map((issue) => (
          <div
            key={issue.id}
            role="article"
            aria-labelledby={`issue-title-${issue.id}`}
            className={`border rounded-lg transition-all duration-200 ${
              state.selectedIssues.includes(issue.id)
                ? 'border-green-500 bg-green-50 shadow-sm ring-1 ring-green-500'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            } ${!issue.fixable ? 'opacity-60' : ''}`}
          >
            <div className="p-4">
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  id={`issue-${issue.id}`}
                  checked={state.selectedIssues.includes(issue.id)}
                  onChange={() => handleIssueSelect(issue.id)}
                  disabled={!issue.fixable || state.isFixing}
                  className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label={`Select ${issue.title}`}
                  aria-describedby={`issue-desc-${issue.id}`}
                />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-2 flex-1 min-w-0">
                      <button
                        onClick={() => toggleIssueExpansion(issue.id)}
                        className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
                        aria-label={expandedIssue === issue.id ? 'Collapse details' : 'Expand details'}
                        aria-expanded={expandedIssue === issue.id}
                      >
                        {expandedIssue === issue.id ? (
                          <ChevronUpIcon className="h-4 w-4" />
                        ) : (
                          <ChevronDownIcon className="h-4 w-4" />
                        )}
                      </button>
                      
                      <div className="min-w-0 flex-1">
                        <h4 
                          id={`issue-title-${issue.id}`}
                          className="text-sm font-semibold text-gray-900 truncate"
                        >
                          {issue.title}
                        </h4>
                        <p 
                          id={`issue-desc-${issue.id}`}
                          className="mt-1 text-sm text-gray-600 line-clamp-2"
                        >
                          {issue.description}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end space-y-2 ml-4 flex-shrink-0">
                      <div className="flex items-center space-x-2">
                        {renderSeverityBadge(issue.severity)}
                        {issue.fixDetails && renderFixMethodBadge(issue.fixDetails.method)}
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold text-green-600">
                          +{issue.impact} pts
                        </span>
                        <div className="text-xs text-gray-500">
                          Priority: {issue.priority}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                      <ClockIcon className="h-3 w-3 flex-shrink-0" />
                      <span>
                        {issue.fixDetails?.estimatedTime || 'N/A'} min
                      </span>
                    </div>
                    
                    {issue.fixDetails?.risk && (
                      <div className="flex items-center space-x-1 text-xs text-gray-500">
                        <ShieldCheckIcon className="h-3 w-3 flex-shrink-0" />
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          issue.fixDetails.risk === 'high' 
                            ? 'bg-red-100 text-red-800'
                            : issue.fixDetails.risk === 'medium'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          Risk: {issue.fixDetails.risk}
                        </span>
                      </div>
                    )}
                    
                    <span className="text-xs text-gray-500">
                      {issue.affectedUrls.length} URL{issue.affectedUrls.length !== 1 ? 's' : ''}
                    </span>
                    
                    {issue.fixDetails?.confidence && (
                      <span className="text-xs text-gray-500">
                        Confidence: {issue.fixDetails.confidence}%
                      </span>
                    )}
                    
                    {issue.fixDetails?.requiresApproval && (
                      <Tooltip content="This fix requires manual approval">
                        <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-1 rounded-full">
                          Requires Approval
                        </span>
                      </Tooltip>
                    )}
                    
                    {!issue.fixable && (
                      <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                        Already Fixed
                      </span>
                    )}
                  </div>
                  
                  {/* Expanded details */}
                  {expandedIssue === issue.id && (
                    <div 
                      className="mt-4 pt-4 border-t border-gray-200 space-y-3"
                      role="region"
                      aria-labelledby={`issue-title-${issue.id}`}
                    >
                      <div>
                        <h5 className="text-xs font-medium text-gray-700 mb-2">
                          Affected URLs ({issue.affectedUrls.length}):
                        </h5>
                        <div className="space-y-1 max-h-32 overflow-y-auto pr-2">
                          {issue.affectedUrls.map((url, idx) => (
                            <div 
                              key={idx} 
                              className="text-xs text-gray-600 truncate p-1 hover:bg-gray-50 rounded"
                            >
                              <a 
                                href={url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {url}
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {issue.fixDetails?.requirements && issue.fixDetails.requirements.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-gray-700 mb-2">Requirements:</h5>
                          <ul className="text-xs text-gray-600 space-y-1">
                            {issue.fixDetails.requirements.map((req, idx) => (
                              <li key={idx} className="flex items-start">
                                <span className="mr-2">•</span>
                                <span>{req}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {issue.fixDetails?.dependencies && issue.fixDetails.dependencies.length > 0 && (
                        <div>
                          <h5 className="text-xs font-medium text-gray-700 mb-2">Dependencies:</h5>
                          <div className="text-xs text-gray-600 flex flex-wrap gap-1">
                            {issue.fixDetails.dependencies.map((dep, idx) => (
                              <span 
                                key={idx} 
                                className="bg-gray-100 px-2 py-1 rounded"
                              >
                                {dep}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      <div className="text-xs text-gray-500 flex items-center">
                        <ClockIcon className="h-3 w-3 mr-1" />
                        Detected: {new Date(issue.detectedAt).toLocaleDateString()}
                        {issue.lastScanned && (
                          <span className="ml-4">
                            Last scanned: {new Date(issue.lastScanned).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render statistics
  const renderStatistics = () => {
    if (selectedIssuesCount === 0) return null;

    return (
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Selection Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200">
            <div className="text-2xl font-bold text-gray-900">{selectedIssuesCount}</div>
            <div className="text-xs text-gray-600 font-medium">Total Issues</div>
            <div className="text-xs text-gray-500 mt-1">
              {statistics.automatedCount} automated, {statistics.manualCount} manual
            </div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
            <div className="text-2xl font-bold text-green-700">+{formatSeoScore(statistics.totalImpact)}</div>
            <div className="text-xs text-green-800 font-medium">Total Impact</div>
            <div className="text-xs text-green-700 mt-1">
              {selectedIssuesCount > 0 
                ? `${formatSeoScore(statistics.totalImpact / selectedIssuesCount)} avg per issue`
                : 'No issues selected'
              }
            </div>
          </div>
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
            <div className="text-2xl font-bold text-blue-700">{statistics.estimatedTime}</div>
            <div className="text-xs text-blue-800 font-medium">Est. Time (min)</div>
            <div className="text-xs text-blue-700 mt-1">
              {dryRun ? 'Dry run: instant' : 'Live: actual time'}
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
            <div className="text-2xl font-bold text-purple-700">{statistics.averageConfidence}%</div>
            <div className="text-xs text-purple-800 font-medium">Avg Confidence</div>
            <div className="text-xs text-purple-700 mt-1">
              {statistics.requiresApproval ? 'Approval required' : 'Auto-approved'}
            </div>
          </div>
        </div>
        
        {/* Risk breakdown */}
        {Object.keys(statistics.riskLevels).length > 0 && (
          <div className="mt-4">
            <h4 className="text-xs font-medium text-gray-700 mb-2">Risk Distribution</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(statistics.riskLevels).map(([risk, count]) => (
                <div 
                  key={risk} 
                  className="flex items-center justify-between bg-gray-50 rounded-lg p-3"
                >
                  <span className="text-sm font-medium text-gray-700 capitalize">{risk} Risk</span>
                  <div className="flex items-center space-x-2">
                    <span className={`text-sm font-bold ${
                      risk === 'high' ? 'text-red-600' :
                      risk === 'medium' ? 'text-yellow-600' : 'text-green-600'
                    }`}>
                      {count}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({Math.round((count / selectedIssuesCount) * 100)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render filters
  const renderFilters = () => (
    <div className="mb-6 bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Search */}
        <div className="flex-1">
          <label htmlFor="search-issues" className="sr-only">
            Search issues
          </label>
          <div className="relative">
            <input
              type="search"
              id="search-issues"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search issues by title, description, or URL..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              aria-label="Search issues"
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                aria-label="Clear search"
              >
                <XMarkIcon className="h-4 w-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {/* Severity filters */}
          {(['critical', 'high', 'medium', 'low'] as const).map(severity => (
            <button
              key={severity}
              onClick={() => handleFilterChange('severity', severity)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center space-x-1 ${
                filters.severity.includes(severity)
                  ? 'bg-red-100 text-red-800 border-red-200'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
              aria-pressed={filters.severity.includes(severity)}
            >
              <span>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>
              {filters.severity.includes(severity) && (
                <XMarkIcon className="h-3 w-3" />
              )}
            </button>
          ))}
          
          {/* Fix method filters */}
          {(['automated', 'semi-automated', 'manual'] as const).map(method => (
            <button
              key={method}
              onClick={() => handleFilterChange('fixMethod', method)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center space-x-1 ${
                filters.fixMethod.includes(method)
                  ? 'bg-blue-100 text-blue-800 border-blue-200'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
              aria-pressed={filters.fixMethod.includes(method)}
            >
              <span>{method.replace('-', ' ')}</span>
              {filters.fixMethod.includes(method) && (
                <XMarkIcon className="h-3 w-3" />
              )}
            </button>
          ))}
          
          {/* Category filters */}
          {Object.entries(FIX_CATEGORIES).slice(0, 3).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleFilterChange('category', key)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors flex items-center space-x-1 ${
                filters.category.includes(key)
                  ? 'bg-purple-100 text-purple-800 border-purple-200'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
              aria-pressed={filters.category.includes(key)}
            >
              <span>{label}</span>
              {filters.category.includes(key) && (
                <XMarkIcon className="h-3 w-3" />
              )}
            </button>
          ))}
          
          {/* More categories dropdown if needed */}
          {Object.entries(FIX_CATEGORIES).length > 3 && (
            <div className="relative">
              <button
                className="px-3 py-1.5 text-xs rounded-full border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                aria-label="More categories"
              >
                More +
              </button>
            </div>
          )}
        </div>
        
        {/* Sort */}
        <div className="lg:ml-auto">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-gray-700">Sort by:</span>
            <div className="flex flex-wrap gap-1">
              {([
                { key: 'impact', label: 'Impact', icon: '📈' },
                { key: 'severity', label: 'Severity', icon: '⚠️' },
                { key: 'priority', label: 'Priority', icon: '🎯' },
                { key: 'estimatedTime', label: 'Time', icon: '⏱️' },
                { key: 'detectedAt', label: 'Date', icon: '📅' }
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => handleSortChange(key)}
                  className={`px-2 py-1 text-xs rounded border flex items-center gap-1 ${
                    sortConfig.field === key
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                  aria-label={`Sort by ${label}`}
                  aria-pressed={sortConfig.field === key}
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                  {sortConfig.field === key && (
                    sortConfig.direction === 'desc' 
                      ? <ChevronDownIcon className="h-3 w-3" />
                      : <ChevronUpIcon className="h-3 w-3" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Active filters indicator */}
      {(filters.severity.length > 0 || filters.fixMethod.length > 0 || filters.category.length > 0 || searchQuery) && (
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-gray-600">
            Showing {filteredIssues.length} of {issues.length} issues
            {(filters.severity.length > 0 || filters.fixMethod.length > 0 || filters.category.length > 0) && (
              <span className="ml-2">
                with {filters.severity.length + filters.fixMethod.length + filters.category.length} active filters
              </span>
            )}
          </div>
          <button
            onClick={clearAllFilters}
            className="text-xs font-medium text-gray-600 hover:text-gray-800 flex items-center"
            aria-label="Clear all filters"
          >
            <TrashIcon className="h-3 w-3 mr-1" />
            Clear all
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" role="main">
      {/* Header */}
      <div className="border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg" aria-hidden="true">
                <WrenchIcon className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900" id="one-click-fix-heading">
                  One-Click Fix
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  Automatically fix multiple SEO issues with a single click
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <span className="text-xs font-medium px-3 py-1.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
              {FIX_CATEGORIES[state.fixCategory]}
            </span>
            {state.batchId && (
              <Tooltip content={`Batch ID: ${state.batchId}`}>
                <span className="text-xs font-medium px-3 py-1.5 rounded-full bg-gray-100 text-gray-800 border border-gray-200">
                  Batch: {state.batchId.slice(0, 8)}...
                </span>
              </Tooltip>
            )}
            <button
              onClick={handleRefreshIssues}
              className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
              aria-label="Refresh issues"
              disabled={loadingIssues}
            >
              <ArrowPathIcon className={`h-4 w-4 ${loadingIssues ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="p-6">
        {/* Progress bar */}
        {(state.isFixing || batchFix.loading) && (
          <div className="mb-8" role="status" aria-live="polite">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <div className="flex items-center space-x-2">
                <ArrowPathIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>{batchFix.currentStep || 'Processing fixes...'}</span>
              </div>
              <div className="flex items-center space-x-4">
                <span id="progress-percentage">{Math.round(state.fixProgress)}%</span>
                {state.isFixing && (
                  <button
                    onClick={handleCancelFix}
                    className="text-xs text-red-600 hover:text-red-700 font-medium flex items-center"
                    aria-label="Cancel batch fix"
                  >
                    <XMarkIcon className="h-3 w-3 mr-1" />
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <div 
              className="h-2.5 bg-gray-200 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={state.fixProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-labelledby="progress-percentage"
            >
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-300 ease-out"
                style={{ width: `${state.fixProgress}%` }}
              />
            </div>
            {state.estimatedCompletion && (
              <div className="text-xs text-gray-500 mt-2 flex items-center">
                <ClockIcon className="h-3 w-3 mr-1" aria-hidden="true" />
                Est. completion: {new Date(state.estimatedCompletion).toLocaleTimeString()}
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {state.lastError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
            <div className="flex">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Operation failed</h3>
                <p className="text-sm text-red-700 mt-1">{state.lastError}</p>
                {state.retryCount < MAX_RETRIES && (
                  <button
                    onClick={() => setState(prev => ({ 
                      ...prev, 
                      retryCount: prev.retryCount + 1,
                      lastError: null 
                    }))}
                    className="mt-2 text-sm font-medium text-red-600 hover:text-red-700"
                    aria-label={`Retry operation (attempt ${state.retryCount + 1} of ${MAX_RETRIES})`}
                  >
                    Retry (attempt {state.retryCount + 1}/{MAX_RETRIES})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column - Issue selection */}
          <div className="lg:col-span-2">
            {renderFilters()}
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Select Issues to Fix
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({selectedIssuesCount} selected of {filteredIssues.length})
                </span>
              </h2>
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
                  disabled={filteredIssues.length === 0 || state.isFixing}
                  aria-label={
                    state.selectedIssues.length === filteredIssues.filter(i => i.fixable).length
                      ? 'Deselect all visible issues'
                      : 'Select all visible issues'
                  }
                >
                  {state.selectedIssues.length === 
                   filteredIssues.filter(i => i.fixable).length
                    ? 'Deselect All'
                    : 'Select All Visible'}
                </button>
                {selectedIssuesCount > 0 && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="text-sm font-medium text-gray-600 hover:text-gray-700 flex items-center disabled:text-gray-400 disabled:cursor-not-allowed"
                    disabled={state.isFixing || batchFix.loading}
                    aria-label="Clear selection"
                  >
                    <TrashIcon className="h-4 w-4 mr-1" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[600px] overflow-y-auto pr-2">
              {renderIssueList()}
            </div>
            
            {renderStatistics()}
          </div>

          {/* Right column - Configuration form */}
          <div className="space-y-6">
            <div 
              className="bg-gray-50 rounded-xl p-5 border border-gray-200"
              role="form"
              aria-labelledby="configuration-heading"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 
                  id="configuration-heading"
                  className="text-lg font-semibold text-gray-900"
                >
                  Fix Configuration
                </h3>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gradient-to-r from-green-100 to-green-50 text-green-800 border border-green-200">
                  {dryRun ? 'TEST MODE' : 'LIVE MODE'}
                </span>
              </div>
              
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                {/* Mode selection */}
                <fieldset className="grid grid-cols-2 gap-3">
                  <legend className="sr-only">Execution mode</legend>
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="executionMode"
                      checked={!dryRun}
                      onChange={() => setValue('dryRun', false)}
                      className="sr-only"
                    />
                    <div className={`p-3 rounded-lg border transition-all ${
                      !dryRun
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}>
                      <div className="flex items-center justify-center space-x-2">
                        <WrenchIcon className="h-4 w-4" />
                        <span className="font-medium">Live Fix</span>
                      </div>
                    </div>
                  </label>
                  <label className="cursor-pointer">
                    <input
                      type="radio"
                      name="executionMode"
                      checked={dryRun}
                      onChange={() => setValue('dryRun', true)}
                      className="sr-only"
                    />
                    <div className={`p-3 rounded-lg border transition-all ${
                      dryRun
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    }`}>
                      <div className="flex items-center justify-center space-x-2">
                        <DocumentTextIcon className="h-4 w-4" />
                        <span className="font-medium">Dry Run</span>
                      </div>
                    </div>
                  </label>
                </fieldset>

                <div className="space-y-4">
                  {/* Priority */}
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      <div className="flex items-center">
                        <ClockIcon className="h-4 w-4 mr-2 text-gray-400" />
                        Priority Level
                      </div>
                    </label>
                    <Controller
                      name="priority"
                      control={control}
                      render={({ field }) => (
                        <div className="grid grid-cols-3 gap-2">
                          {(['low', 'medium', 'high'] as const).map(level => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => field.onChange(level)}
                              className={`p-2 text-sm rounded-md border transition-colors ${
                                field.value === level
                                  ? level === 'high'
                                    ? 'border-red-500 bg-red-50 text-red-700'
                                    : level === 'medium'
                                    ? 'border-yellow-500 bg-yellow-50 text-yellow-700'
                                    : 'border-green-500 bg-green-50 text-green-700'
                                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                              aria-pressed={field.value === level}
                            >
                              {level.charAt(0).toUpperCase() + level.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                    />
                  </div>

                  {/* Backup confirmation */}
                  <div className="flex items-start p-3 bg-white rounded-lg border border-gray-300">
                    <input
                      id="backupConfirmation"
                      type="checkbox"
                      {...register('backupConfirmation')}
                      className="h-4 w-4 text-green-600 mt-0.5 focus:ring-green-500"
                      aria-describedby="backupDescription"
                    />
                    <label htmlFor="backupConfirmation" className="ml-3">
                      <span className="block text-sm font-medium text-gray-900">
                        Create backup before fixing
                      </span>
                      <span id="backupDescription" className="block text-xs text-gray-600 mt-0.5">
                        Recommended for all automated fixes. Disable only for dry runs.
                      </span>
                    </label>
                  </div>

                  {/* Schedule time */}
                  <div>
                    <label htmlFor="scheduleTime" className="block text-sm font-medium text-gray-900 mb-2">
                      Schedule for later (optional)
                    </label>
                    <input
                      id="scheduleTime"
                      type="datetime-local"
                      {...register('scheduleTime', {
                        validate: (value) => {
                          if (!value) return true;
                          const scheduledDate = new Date(value);
                          const now = new Date();
                          return scheduledDate > now || 'Must be in the future';
                        }
                      })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-colors"
                      min={new Date(Date.now() + 3600000).toISOString().slice(0, 16)} // 1 hour from now
                      aria-describedby="scheduleTimeError"
                    />
                    {errors.scheduleTime && (
                      <p id="scheduleTimeError" className="mt-1.5 text-xs text-red-600">
                        {errors.scheduleTime.message}
                      </p>
                    )}
                  </div>

                  {/* Notification email */}
                  <div>
                    <label htmlFor="notificationEmail" className="block text-sm font-medium text-gray-900 mb-2">
                      Notification Email
                    </label>
                    <input
                      id="notificationEmail"
                      type="email"
                      {...register('notificationEmail', {
                        required: 'Email is required for notifications',
                        pattern: {
                          value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                          message: 'Please enter a valid email address'
                        }
                      })}
                      className={`w-full px-3 py-2.5 border rounded-lg text-sm transition-colors ${
                        errors.notificationEmail
                          ? 'border-red-300 focus:ring-2 focus:ring-red-500 focus:border-red-500'
                          : 'border-gray-300 focus:ring-2 focus:ring-green-500 focus:border-green-500'
                      }`}
                      placeholder="you@example.com"
                      aria-describedby="emailError"
                      aria-invalid={!!errors.notificationEmail}
                    />
                    {errors.notificationEmail && (
                      <p id="emailError" className="mt-1.5 text-xs text-red-600">
                        {errors.notificationEmail.message}
                      </p>
                    )}
                  </div>

                  {/* Rollback on error */}
                  <div className="flex items-start p-3 bg-white rounded-lg border border-gray-300">
                    <input
                      id="rollbackOnError"
                      type="checkbox"
                      {...register('rollbackOnError')}
                      className="h-4 w-4 text-green-600 mt-0.5 focus:ring-green-500"
                      aria-describedby="rollbackDescription"
                    />
                    <label htmlFor="rollbackOnError" className="ml-3">
                      <span className="block text-sm font-medium text-gray-900">
                        Automatic rollback on error
                      </span>
                      <span id="rollbackDescription" className="block text-xs text-gray-600 mt-0.5">
                        Automatically revert changes if any fix fails
                      </span>
                    </label>
                  </div>

                  {/* Resource limits */}
                  <div className="bg-gray-50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">
                      Resource Limits
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-medium text-gray-700 mb-1.5 block">
                          Max Concurrent Fixes: {watch('resourceLimits.maxConcurrent)}
                        </label>
                        <Controller
                          name="resourceLimits.maxConcurrent"
                          control={control}
                          render={({ field }) => (
                            <input
                              type="range"
                              min="1"
                              max="10"
                              value={field.value}
                              onChange={field.onChange}
                              className="w-full h-2 bg-gray-300 rounded-lg appearance-none cursor-pointer"
                              aria-label="Maximum concurrent fixes"
                            />
                          )}
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>1 (Slow)</span>
                          <span>10 (Fast)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="pt-4 border-t border-gray-200">
                  <div className="flex flex-col space-y-3">
                    <button
                      type="submit"
                      disabled={
                        selectedIssuesCount === 0 ||
                        state.isFixing ||
                        batchFix.loading ||
                        !isValid ||
                        isSubmitting
                      }
                      className="w-full py-3 px-4 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow flex items-center justify-center"
                      aria-label={
                        dryRun 
                          ? `Simulate fix for ${selectedIssuesCount} issues`
                          : `Execute fix for ${selectedIssuesCount} issues`
                      }
                    >
                      {state.isFixing || batchFix.loading ? (
                        <>
                          <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                          <span className="sr-only">Processing</span>
                          {dryRun ? 'Simulating...' : 'Processing...'}
                        </>
                      ) : (
                        <>
                          {dryRun ? (
                            <DocumentTextIcon className="h-4 w-4 mr-2" aria-hidden="true" />
                          ) : (
                            <WrenchIcon className="h-4 w-4 mr-2" aria-hidden="true" />
                          )}
                          {dryRun ? 'Simulate Fix' : 'Execute Fix'} ({selectedIssuesCount})
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleReset}
                      className="w-full py-3 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={state.isFixing || batchFix.loading || selectedIssuesCount === 0}
                      aria-label="Reset selection and form"
                    >
                      Reset Selection
                    </button>
                  </div>

                  <div className="text-xs text-gray-500 text-center mt-4 space-y-1" aria-live="polite">
                    <p>
                      ⏱️ Estimated time: {dryRun ? 'Instant' : `${statistics.estimatedTime} minutes`}
                    </p>
                    <p>
                      📈 Total impact: +{formatSeoScore(statistics.totalImpact)} SEO score
                    </p>
                    {dryRun && (
                      <p className="text-blue-600 font-medium">
                        💡 Dry run mode: No actual changes will be made
                      </p>
                    )}
                  </div>
                </div>
              </form>
            </div>

            {/* Quick tips */}
            <div 
              className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-200"
              role="complementary"
              aria-labelledby="tips-heading"
            >
              <h4 
                id="tips-heading"
                className="text-sm font-semibold text-blue-900 mb-3 flex items-center"
              >
                <InformationCircleIcon className="h-4 w-4 mr-2" aria-hidden="true" />
                Quick Tips
              </h4>
              <ul className="text-xs text-blue-800 space-y-2" role="list">
                <li className="flex items-start" role="listitem">
                  <div className="bg-blue-100 p-1 rounded mr-2 mt-0.5" aria-hidden="true">💡</div>
                  <span>Start with high-impact, automated fixes for quick wins</span>
                </li>
                <li className="flex items-start" role="listitem">
                  <div className="bg-blue-100 p-1 rounded mr-2 mt-0.5" aria-hidden="true">🔒</div>
                  <span>Always enable backups for live fixes to prevent data loss</span>
                </li>
                <li className="flex items-start" role="listitem">
                  <div className="bg-blue-100 p-1 rounded mr-2 mt-0.5" aria-hidden="true">🕐</div>
                  <span>Schedule fixes during low-traffic hours for minimal impact</span>
                </li>
                <li className="flex items-start" role="listitem">
                  <div className="bg-blue-100 p-1 rounded mr-2 mt-0.5" aria-hidden="true">🧪</div>
                  <span>Use dry run mode to preview changes before applying them</span>
                </li>
                <li className="flex items-start" role="listitem">
                  <div className="bg-blue-100 p-1 rounded mr-2 mt-0.5" aria-hidden="true">📊</div>
                  <span>Monitor results and verify changes after fixes complete</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Wrap with ErrorBoundary and memo
export const OneClickFix = memo(OneClickFixComponent);

OneClickFix.displayName = 'OneClickFix';

export default OneClickFix;