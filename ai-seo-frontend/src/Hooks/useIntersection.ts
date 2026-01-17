// frontend/src/hooks/useIntersection.ts
import { useEffect, useRef, useState, RefObject } from 'react';

export interface UseIntersectionOptions {
  root?: Element | Document | null;
  rootMargin?: string;
  threshold?: number | number[];
  once?: boolean;
  enabled?: boolean;
  triggerOnce?: boolean;
}

export interface UseIntersectionReturn<T extends HTMLElement> {
  ref: RefObject<T>;
  isIntersecting: boolean;
  entry?: IntersectionObserverEntry;
  isVisible: boolean;
  hasBeenVisible: boolean;
}

/**
 * Hook for intersection observer (lazy loading, infinite scroll, animations)
 * Critical for performance - lazy loads charts, images, and heavy components
 */
export function useIntersection<T extends HTMLElement = HTMLElement>(
  options: UseIntersectionOptions = {}
): UseIntersectionReturn<T> {
  const {
    root = null,
    rootMargin = '0px',
    threshold = 0,
    once = false,
    enabled = true,
    triggerOnce = false,
  } = options;

  const ref = useRef<T>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const [entry, setEntry] = useState<IntersectionObserverEntry>();

  useEffect(() => {
    if (!enabled || !ref.current || typeof IntersectionObserver === 'undefined') {
      return;
    }

    let observer: IntersectionObserver;
    const currentRef = ref.current;

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      
      setEntry(entry);
      setIsIntersecting(entry.isIntersecting);
      
      if (entry.isIntersecting) {
        setHasBeenVisible(true);
        
        // Disconnect if triggerOnce is true
        if (triggerOnce || once) {
          observer.disconnect();
        }
      }
    };

    observer = new IntersectionObserver(handleIntersect, {
      root,
      rootMargin,
      threshold,
    });

    observer.observe(currentRef);

    return () => {
      if (observer && currentRef) {
        observer.unobserve(currentRef);
        observer.disconnect();
      }
    };
  }, [root, rootMargin, threshold, once, enabled, triggerOnce]);

  return {
    ref,
    isIntersecting,
    entry,
    isVisible: isIntersecting || hasBeenVisible,
    hasBeenVisible,
  };
}

// Pre-configured hooks for common use cases
export function useLazyLoad<T extends HTMLElement = HTMLElement>(
  options?: Omit<UseIntersectionOptions, 'threshold' | 'rootMargin'>
): UseIntersectionReturn<T> {
  return useIntersection<T>({
    threshold: 0.1,
    rootMargin: '50px',
    triggerOnce: true,
    ...options,
  });
}

export function useInfiniteScroll<T extends HTMLElement = HTMLElement>(
  onLoadMore: () => void,
  options?: Omit<UseIntersectionOptions, 'threshold'>
): RefObject<T> {
  const { ref, isIntersecting } = useIntersection<T>({
    threshold: 0.5,
    rootMargin: '100px',
    ...options,
  });

  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (isIntersecting && !hasLoadedRef.current) {
      hasLoadedRef.current = true;
      onLoadMore();
    } else if (!isIntersecting) {
      hasLoadedRef.current = false;
    }
  }, [isIntersecting, onLoadMore]);

  return ref;
}

export function useVisibilityTrigger<T extends HTMLElement = HTMLElement>(
  onVisible: () => void,
  onHidden?: () => void,
  options?: UseIntersectionOptions
): RefObject<T> {
  const { ref, isIntersecting } = useIntersection<T>(options);

  useEffect(() => {
    if (isIntersecting) {
      onVisible();
    } else if (onHidden) {
      onHidden();
    }
  }, [isIntersecting, onVisible, onHidden]);

  return ref;
}

// Hook for tracking element visibility percentage
export function useVisibilityPercentage<T extends HTMLElement = HTMLElement>(
  options?: Omit<UseIntersectionOptions, 'threshold'>
): {
  ref: RefObject<T>;
  percentage: number;
  isFullyVisible: boolean;
  isPartiallyVisible: boolean;
} {
  const thresholds = Array.from({ length: 101 }, (_, i) => i / 100);
  const { ref, entry } = useIntersection<T>({
    threshold: thresholds,
    ...options,
  });

  const percentage = entry?.intersectionRatio
    ? Math.round(entry.intersectionRatio * 100)
    : 0;

  return {
    ref,
    percentage,
    isFullyVisible: percentage >= 95,
    isPartiallyVisible: percentage > 0,
  };
}

// Hook for scroll-based animations
export function useScrollAnimation<T extends HTMLElement = HTMLElement>(): {
  ref: RefObject<T>;
  progress: number; // 0 to 1
  isInView: boolean;
} {
  const [progress, setProgress] = useState(0);
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const calculateProgress = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const elementTop = rect.top;
      const elementHeight = rect.height;

      // Calculate how much of the element is visible
      const visibleHeight = Math.min(
        viewportHeight - Math.max(0, elementTop),
        elementHeight - Math.max(0, -elementTop)
      );

      const calculatedProgress = Math.max(
        0,
        Math.min(1, visibleHeight / elementHeight)
      );

      setProgress(calculatedProgress);
    };

    calculateProgress();
    window.addEventListener('scroll', calculateProgress, { passive: true });
    window.addEventListener('resize', calculateProgress, { passive: true });

    return () => {
      window.removeEventListener('scroll', calculateProgress);
      window.removeEventListener('resize', calculateProgress);
    };
  }, []);

  return {
    ref,
    progress,
    isInView: progress > 0,
  };
}