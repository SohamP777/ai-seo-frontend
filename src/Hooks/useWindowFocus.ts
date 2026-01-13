// frontend/src/hooks/useWindowFocus.ts
import { useState, useEffect, useRef } from 'react';

export interface UseWindowFocusOptions {
  onFocus?: () => void;
  onBlur?: () => void;
  pollInterval?: number; // For more accurate detection
  enabled?: boolean;
}

export interface UseWindowFocusReturn {
  isFocused: boolean;
  isVisible: boolean;
  focusTime: number; // Time in milliseconds since last focus
  idleTime: number; // Time in milliseconds since last interaction
  lastInteraction: Date | null;
  triggerFocus: () => void;
}

/**
 * Hook to detect window focus and visibility
 * Critical for pausing/resuming background scans, auto-save, and real-time updates
 */
export function useWindowFocus(
  options: UseWindowFocusOptions = {}
): UseWindowFocusReturn {
  const {
    onFocus,
    onBlur,
    pollInterval = 1000,
    enabled = true,
  } = options;

  const [isFocused, setIsFocused] = useState(
    typeof document !== 'undefined' ? document.hasFocus() : true
  );
  const [isVisible, setIsVisible] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'visible' : true
  );
  const [focusTime, setFocusTime] = useState(0);
  const [idleTime, setIdleTime] = useState(0);
  const [lastInteraction, setLastInteraction] = useState<Date | null>(null);
  
  const focusStartRef = useRef<Date | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerFocus = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.focus();
    }
  }, []);

  // Update interaction time
  const updateInteraction = useCallback(() => {
    setLastInteraction(new Date());
    setIdleTime(0);
  }, []);

  // Calculate focus time
  useEffect(() => {
    if (!isFocused) {
      focusStartRef.current = null;
      setFocusTime(0);
      return;
    }

    if (!focusStartRef.current) {
      focusStartRef.current = new Date();
    }

    const interval = setInterval(() => {
      if (focusStartRef.current) {
        const now = new Date();
        const elapsed = now.getTime() - focusStartRef.current.getTime();
        setFocusTime(elapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isFocused]);

  // Calculate idle time
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastInteraction) {
        const now = new Date();
        const elapsed = now.getTime() - lastInteraction.getTime();
        setIdleTime(elapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lastInteraction]);

  useEffect(() => {
    if (!enabled) return;

    const handleFocus = () => {
      setIsFocused(true);
      if (onFocus) onFocus();
    };

    const handleBlur = () => {
      setIsFocused(false);
      if (onBlur) onBlur();
    };

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setIsVisible(visible);
      
      if (visible && onFocus) {
        onFocus();
      } else if (!visible && onBlur) {
        onBlur();
      }
    };

    // Add event listeners
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Add interaction listeners
    const interactionEvents = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];
    interactionEvents.forEach(event => {
      document.addEventListener(event, updateInteraction, { passive: true });
    });

    // Poll for focus (more reliable in some browsers)
    if (pollInterval > 0) {
      pollTimerRef.current = setInterval(() => {
        setIsFocused(document.hasFocus());
      }, pollInterval);
    }

    // Initial update
    updateInteraction();

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      interactionEvents.forEach(event => {
        document.removeEventListener(event, updateInteraction);
      });

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [enabled, onFocus, onBlur, updateInteraction, pollInterval]);

  // Auto-pause background tasks when window loses focus
  useEffect(() => {
    if (!isFocused || !isVisible) {
      // Pause expensive operations
      console.log('Window lost focus - pausing background tasks');
    } else {
      // Resume operations
      console.log('Window gained focus - resuming background tasks');
    }
  }, [isFocused, isVisible]);

  return {
    isFocused,
    isVisible,
    focusTime,
    idleTime,
    lastInteraction,
    triggerFocus,
  };
}

// Hook for background task management
export function useBackgroundTask<T>(
  task: () => Promise<T> | T,
  options: {
    interval?: number;
    runOnFocus?: boolean;
    runOnVisible?: boolean;
    immediate?: boolean;
    enabled?: boolean;
    onComplete?: (result: T) => void;
    onError?: (error: Error) => void;
  } = {}
): {
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  result: T | null;
  error: Error | null;
  lastRun: Date | null;
} {
  const {
    interval = 0,
    runOnFocus = true,
    runOnVisible = true,
    immediate = false,
    enabled = true,
    onComplete,
    onError,
  } = options;

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  
  const taskRef = useRef(task);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update task ref
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const executeTask = useCallback(async () => {
    if (!enabled || isRunning) return;

    setIsRunning(true);
    setError(null);

    try {
      const taskResult = await taskRef.current();
      setResult(taskResult);
      setLastRun(new Date());
      if (onComplete) onComplete(taskResult);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      if (onError) onError(error);
    } finally {
      setIsRunning(false);
    }
  }, [enabled, isRunning, onComplete, onError]);

  const start = useCallback(() => {
    if (interval > 0) {
      intervalRef.current = setInterval(executeTask, interval);
    }
    if (immediate) {
      executeTask();
    }
  }, [interval, immediate, executeTask]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // Handle window focus/visibility
  const { isFocused, isVisible } = useWindowFocus({
    onFocus: () => {
      if (runOnFocus && enabled) {
        executeTask();
      }
    },
    onBlur: () => {
      if (!runOnFocus) {
        stop();
      }
    },
  });

  useEffect(() => {
    if (runOnVisible && isVisible && enabled) {
      executeTask();
    } else if (!runOnVisible && !isVisible) {
      stop();
    }
  }, [runOnVisible, isVisible, enabled, executeTask, stop]);

  // Start/stop based on enabled prop
  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }

    return stop;
  }, [enabled, start, stop]);

  return {
    isRunning,
    start,
    stop,
    result,
    error,
    lastRun,
  };
}

// Hook for auto-save functionality
export function useAutoSave<T>(
  saveFunction: (data: T) => Promise<void>,
  data: T,
  options: {
    interval?: number;
    saveOnBlur?: boolean;
    saveOnIdle?: number; // Save after X ms of idle time
    enabled?: boolean;
    debounce?: number;
  } = {}
): {
  isSaving: boolean;
  lastSaved: Date | null;
  error: Error | null;
  manualSave: () => Promise<void>;
} {
  const {
    interval = 30000, // 30 seconds
    saveOnBlur = true,
    saveOnIdle = 5000, // 5 seconds
    enabled = true,
    debounce = 1000,
  } = options;

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  const dataRef = useRef(data);
  const saveFunctionRef = useRef(saveFunction);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Update refs
  useEffect(() => {
    dataRef.current = data;
    saveFunctionRef.current = saveFunction;
  }, [data, saveFunction]);

  const save = useCallback(async () => {
    if (!enabled || isSaving) return;

    setIsSaving(true);
    setError(null);

    try {
      await saveFunctionRef.current(dataRef.current);
      setLastSaved(new Date());
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      console.error('Auto-save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [enabled, isSaving]);

  // Debounced save
  const debouncedSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      save();
    }, debounce);
  }, [save, debounce]);

  // Save on data change
  useEffect(() => {
    if (enabled) {
      debouncedSave();
    }
  }, [data, enabled, debouncedSave]);

  // Save on window blur
  const { isFocused } = useWindowFocus({
    onBlur: () => {
      if (saveOnBlur && enabled) {
        save();
      }
    },
  });

  // Save on idle
  const { idleTime } = useWindowFocus();
  useEffect(() => {
    if (saveOnIdle > 0 && idleTime >= saveOnIdle && enabled) {
      save();
    }
  }, [idleTime, saveOnIdle, enabled, save]);

  // Periodic save
  useEffect(() => {
    if (interval <= 0 || !enabled) return;

    const timer = setInterval(() => {
      if (isFocused) {
        save();
      }
    }, interval);

    return () => clearInterval(timer);
  }, [interval, enabled, isFocused, save]);

  const manualSave = useCallback(async () => {
    await save();
  }, [save]);

  return {
    isSaving,
    lastSaved,
    error,
    manualSave,
  };
}

// Hook for resource-efficient polling
export function useEfficientPolling<T>(
  fetchFunction: () => Promise<T>,
  options: {
    interval: number;
    enabled?: boolean;
    pauseOnBackground?: boolean;
    pauseOnIdle?: number;
    onUpdate?: (data: T) => void;
  }
): {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
} {
  const {
    interval,
    enabled = true,
    pauseOnBackground = true,
    pauseOnIdle = 30000, // 30 seconds
    onUpdate,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const fetchFunctionRef = useRef(fetchFunction);

  useEffect(() => {
    fetchFunctionRef.current = fetchFunction;
  }, [fetchFunction]);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchFunctionRef.current();
      setData(result);
      setLastUpdated(new Date());
      if (onUpdate) onUpdate(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, onUpdate]);

  // Use background task with window focus awareness
  const { isRunning, start, stop } = useBackgroundTask(fetchData, {
    interval,
    runOnFocus: !pauseOnBackground,
    runOnVisible: !pauseOnBackground,
    immediate: true,
    enabled,
  });

  // Handle idle time
  const { idleTime } = useWindowFocus();
  useEffect(() => {
    if (pauseOnIdle > 0 && idleTime >= pauseOnIdle) {
      stop();
    } else if (pauseOnIdle > 0 && idleTime < pauseOnIdle && enabled) {
      start();
    }
  }, [idleTime, pauseOnIdle, enabled, start, stop]);

  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading: isLoading || isRunning,
    error,
    lastUpdated,
    refresh,
  };
}