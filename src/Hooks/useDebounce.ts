// frontend/src/hooks/useDebounce.ts
import { useState, useEffect, useRef } from 'react';

export function useDebounce<T>(
  value: T, 
  delay: number,
  options?: {
    maxWait?: number; // Maximum wait time before forcing update
    leading?: boolean; // Call immediately on first change
    trailing?: boolean; // Call after delay
  }
): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const maxTimerRef = useRef<NodeJS.Timeout | null>(null);
  const firstRenderRef = useRef(true);
  const leadingCalledRef = useRef(false);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    // Clear existing timers
    if (timerRef.current) clearTimeout(timerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);

    const { maxWait, leading = false, trailing = true } = options || {};

    // Leading edge (call immediately)
    if (leading && !leadingCalledRef.current) {
      setDebouncedValue(value);
      leadingCalledRef.current = true;
    }

    // Max wait timer
    if (maxWait && maxWait > delay) {
      maxTimerRef.current = setTimeout(() => {
        setDebouncedValue(value);
        if (timerRef.current) clearTimeout(timerRef.current);
        leadingCalledRef.current = false;
      }, maxWait);
    }

    // Trailing edge (call after delay)
    if (trailing) {
      timerRef.current = setTimeout(() => {
        setDebouncedValue(value);
        leadingCalledRef.current = false;
      }, delay);
    }

    // Cleanup
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    };
  }, [value, delay, options]);

  return debouncedValue;
}

// Advanced version with callback
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
  options?: {
    maxWait?: number;
    leading?: boolean;
    trailing?: boolean;
  }
): (...args: Parameters<T>) => void {
  const callbackRef = useRef(callback);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const maxTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastArgsRef = useRef<Parameters<T>>();
  const leadingCalledRef = useRef(false);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const debouncedFunction = useCallback(
    (...args: Parameters<T>) => {
      lastArgsRef.current = args;
      const { maxWait, leading = false, trailing = true } = options || {};

      // Clear existing timers
      if (timerRef.current) clearTimeout(timerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);

      // Leading edge
      if (leading && !leadingCalledRef.current) {
        callbackRef.current(...args);
        leadingCalledRef.current = true;
      }

      // Max wait timer
      if (maxWait && maxWait > delay) {
        maxTimerRef.current = setTimeout(() => {
          callbackRef.current(...args);
          if (timerRef.current) clearTimeout(timerRef.current);
          leadingCalledRef.current = false;
        }, maxWait);
      }

      // Trailing edge
      if (trailing) {
        timerRef.current = setTimeout(() => {
          if (!leading || (leading && leadingCalledRef.current)) {
            callbackRef.current(...args);
          }
          leadingCalledRef.current = false;
        }, delay);
      }
    },
    [delay, options]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    };
  }, []);

  return debouncedFunction;
}