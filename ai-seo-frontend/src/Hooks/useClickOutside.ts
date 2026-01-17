// frontend/src/hooks/useClickOutside.ts
import { useEffect, useRef, RefObject } from 'react';

export type ClickOutsideHandler = (event: MouseEvent | TouchEvent) => void;

export interface UseClickOutsideOptions {
  enabled?: boolean;
  eventType?: 'mousedown' | 'mouseup' | 'click';
  ignoreElements?: (string | RefObject<HTMLElement>)[];
  excludeScrollbar?: boolean;
}

/**
 * Hook to detect clicks outside of a referenced element
 * Essential for modals, dropdowns, popovers, and tooltips
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: ClickOutsideHandler,
  options: UseClickOutsideOptions = {}
): RefObject<T> {
  const {
    enabled = true,
    eventType = 'mousedown',
    ignoreElements = [],
    excludeScrollbar = true,
  } = options;

  const ref = useRef<T>(null);
  const handlerRef = useRef(handler);
  const ignoreRefs = useRef<RefObject<HTMLElement>[]>([]);
  const ignoreSelectors = useRef<string[]>([]);

  // Update handler ref
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  // Process ignore elements
  useEffect(() => {
    ignoreRefs.current = [];
    ignoreSelectors.current = [];

    ignoreElements.forEach(element => {
      if (typeof element === 'string') {
        ignoreSelectors.current.push(element);
      } else if (element && 'current' in element) {
        ignoreRefs.current.push(element as RefObject<HTMLElement>);
      }
    });
  }, [ignoreElements]);

  useEffect(() => {
    if (!enabled) return;

    const handleEvent = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;

      // Check if click is on scrollbar (if excludeScrollbar is true)
      if (excludeScrollbar && event instanceof MouseEvent) {
        const isScrollbarClick = window.innerWidth - event.clientX < 20;
        if (isScrollbarClick) return;
      }

      // Return if clicking ref's element or descendent elements
      if (ref.current?.contains(target)) return;

      // Check ignored refs
      const isIgnoredRef = ignoreRefs.current.some(
        ignoreRef => ignoreRef.current?.contains(target)
      );
      if (isIgnoredRef) return;

      // Check ignored selectors
      const isIgnoredSelector = ignoreSelectors.current.some(selector => {
        if (!(target instanceof Element)) return false;
        return target.closest(selector);
      });
      if (isIgnoredSelector) return;

      handlerRef.current(event);
    };

    // Add event listeners
    document.addEventListener(eventType, handleEvent as EventListener);
    document.addEventListener('touchstart', handleEvent as EventListener);

    // For iOS Safari to handle touch events properly
    document.addEventListener('touchend', handleEvent as EventListener);

    return () => {
      document.removeEventListener(eventType, handleEvent as EventListener);
      document.removeEventListener('touchstart', handleEvent as EventListener);
      document.removeEventListener('touchend', handleEvent as EventListener);
    };
  }, [enabled, eventType, excludeScrollbar]);

  return ref;
}

// Extended version with escape key support
export function useClickOutsideWithEscape<T extends HTMLElement = HTMLElement>(
  handler: ClickOutsideHandler,
  options: UseClickOutsideOptions & {
    escapeKey?: boolean;
    onEscape?: () => void;
  } = {}
): RefObject<T> {
  const ref = useClickOutside<T>(handler, options);
  const { escapeKey = true, onEscape } = options;

  useEffect(() => {
    if (!escapeKey) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (onEscape) {
          onEscape();
        } else {
          handler(event);
        }
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [escapeKey, handler, onEscape]);

  return ref;
}

// Hook specifically for dropdowns
export function useDropdown<T extends HTMLElement = HTMLElement>(
  onClose: () => void,
  options: UseClickOutsideOptions & {
    toggleRef?: RefObject<HTMLElement>;
    closeOnScroll?: boolean;
    closeOnResize?: boolean;
  } = {}
): {
  ref: RefObject<T>;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const { toggleRef, closeOnScroll = false, closeOnResize = false, ...clickOutsideOptions } = options;

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    onClose();
  }, [onClose]);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  // Combine toggleRef with main ref for click outside detection
  const ref = useClickOutsideWithEscape<T>(
    (event) => {
      // Check if click was on the toggle button
      if (toggleRef?.current?.contains(event.target as Node)) {
        return;
      }
      close();
    },
    {
      ...clickOutsideOptions,
      ignoreElements: toggleRef ? [...(clickOutsideOptions.ignoreElements || []), toggleRef] : clickOutsideOptions.ignoreElements,
      escapeKey: true,
      onEscape: close,
    }
  );

  // Close on scroll if enabled
  useEffect(() => {
    if (!isOpen || !closeOnScroll) return;

    const handleScroll = () => close();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isOpen, closeOnScroll, close]);

  // Close on resize if enabled
  useEffect(() => {
    if (!isOpen || !closeOnResize) return;

    const handleResize = () => close();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen, closeOnResize, close]);

  return { ref, isOpen, open, close, toggle };
}