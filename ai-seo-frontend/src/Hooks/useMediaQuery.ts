// frontend/src/hooks/useMediaQuery.ts
import { useState, useEffect, useCallback } from 'react';

export function useMediaQuery(
  query: string,
  options?: {
    defaultValue?: boolean;
    initializeWithValue?: boolean;
    watch?: boolean;
  }
): boolean {
  const { 
    defaultValue = false, 
    initializeWithValue = true,
    watch = true,
  } = options || {};

  const getMatches = useCallback((): boolean => {
    if (typeof window === 'undefined') return defaultValue;
    return window.matchMedia(query).matches;
  }, [query, defaultValue]);

  const [matches, setMatches] = useState<boolean>(() => {
    if (initializeWithValue) {
      return getMatches();
    }
    return defaultValue;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);
    
    const updateMatches = () => {
      setMatches(mediaQuery.matches);
    };

    // Set initial value
    updateMatches();

    if (watch) {
      // Modern browsers
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', updateMatches);
        return () => mediaQuery.removeEventListener('change', updateMatches);
      } else {
        // Fallback for older browsers
        mediaQuery.addListener(updateMatches);
        return () => mediaQuery.removeListener(updateMatches);
      }
    }
  }, [query, watch, getMatches]);

  return matches;
}

// Predefined breakpoints for SEO tool
export function useBreakpoints() {
  const isXs = useMediaQuery('(max-width: 480px)');
  const isSm = useMediaQuery('(min-width: 481px) and (max-width: 768px)');
  const isMd = useMediaQuery('(min-width: 769px) and (max-width: 1024px)');
  const isLg = useMediaQuery('(min-width: 1025px) and (max-width: 1280px)');
  const isXl = useMediaQuery('(min-width: 1281px)');
  const isPortrait = useMediaQuery('(orientation: portrait)');
  const isRetina = useMediaQuery('(-webkit-min-device-pixel-ratio: 2), (min-resolution: 192dpi)');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

  return {
    isXs,
    isSm,
    isMd,
    isLg,
    isXl,
    isPortrait,
    isRetina,
    prefersReducedMotion,
    prefersDarkMode,
    currentBreakpoint: (() => {
      if (isXs) return 'xs';
      if (isSm) return 'sm';
      if (isMd) return 'md';
      if (isLg) return 'lg';
      return 'xl';
    })(),
    isMobile: isXs || isSm,
    isTablet: isMd,
    isDesktop: isLg || isXl,
  };
}

// Hook for responsive values
export function useResponsiveValue<T>(
  values: {
    xs?: T;
    sm?: T;
    md?: T;
    lg?: T;
    xl?: T;
    default: T;
  },
  options?: {
    watch?: boolean;
  }
): T {
  const breakpoints = useBreakpoints();
  
  if (breakpoints.isXs && values.xs !== undefined) return values.xs;
  if (breakpoints.isSm && values.sm !== undefined) return values.sm;
  if (breakpoints.isMd && values.md !== undefined) return values.md;
  if (breakpoints.isLg && values.lg !== undefined) return values.lg;
  if (breakpoints.isXl && values.xl !== undefined) return values.xl;
  
  return values.default;
}