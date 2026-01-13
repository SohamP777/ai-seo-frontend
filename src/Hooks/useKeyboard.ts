// frontend/src/hooks/useKeyboard.ts
import { useEffect, useCallback, useRef } from 'react';

export type KeyHandler = (event: KeyboardEvent) => void;
export type KeyFilter = string | string[] | ((event: KeyboardEvent) => boolean);

export interface UseKeyboardOptions {
  enabled?: boolean;
  event?: 'keydown' | 'keyup' | 'keypress';
  target?: Window | Document | HTMLElement | null;
  preventDefault?: boolean;
  stopPropagation?: boolean;
  capture?: boolean;
}

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: KeyHandler;
  description?: string;
  group?: string;
}

/**
 * Hook for keyboard shortcuts - essential for power users and accessibility
 */
export function useKeyboard(
  key: KeyFilter,
  handler: KeyHandler,
  options: UseKeyboardOptions = {}
): void {
  const {
    enabled = true,
    event = 'keydown',
    target = typeof window !== 'undefined' ? window : null,
    preventDefault = false,
    stopPropagation = false,
    capture = false,
  } = options;

  const handlerRef = useRef(handler);
  const keyFilterRef = useRef<KeyFilter>(key);

  // Update refs
  useEffect(() => {
    handlerRef.current = handler;
    keyFilterRef.current = key;
  }, [handler, key]);

  useEffect(() => {
    if (!enabled || !target) return;

    const handleKeyEvent = (event: KeyboardEvent) => {
      // Check if key matches filter
      const filter = keyFilterRef.current;
      let shouldHandle = false;

      if (typeof filter === 'function') {
        shouldHandle = filter(event);
      } else if (Array.isArray(filter)) {
        shouldHandle = filter.includes(event.key);
      } else {
        shouldHandle = event.key === filter;
      }

      if (!shouldHandle) return;

      // Apply event modifiers
      if (preventDefault) {
        event.preventDefault();
      }
      if (stopPropagation) {
        event.stopPropagation();
      }

      // Call handler
      handlerRef.current(event);
    };

    target.addEventListener(event, handleKeyEvent as EventListener, capture);

    return () => {
      target.removeEventListener(event, handleKeyEvent as EventListener, capture);
    };
  }, [enabled, event, target, preventDefault, stopPropagation, capture]);
}

// Hook for multiple shortcuts
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options?: Omit<UseKeyboardOptions, 'key' | 'handler'>
): void {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const { key, ctrl, shift, alt, meta, handler } = shortcut;
        
        // Check key
        if (event.key !== key) continue;
        
        // Check modifiers
        if (ctrl !== undefined && event.ctrlKey !== ctrl) continue;
        if (shift !== undefined && event.shiftKey !== shift) continue;
        if (alt !== undefined && event.altKey !== alt) continue;
        if (meta !== undefined && event.metaKey !== meta) continue;
        
        // Execute handler
        handler(event);
        break; // Only execute first matching shortcut
      }
    };

    const target = options?.target || window;
    target.addEventListener('keydown', handleKey);

    return () => target.removeEventListener('keydown', handleKey);
  }, [shortcuts, options]);
}

// Pre-configured SEO tool shortcuts
export function useSEOKeyboardShortcuts(): void {
  useKeyboardShortcuts([
    {
      key: 's',
      ctrl: true,
      description: 'Start new scan',
      handler: () => {
        // Focus scan input or start scan
        const scanInput = document.querySelector<HTMLInputElement>('[data-scan-input]');
        scanInput?.focus();
      },
    },
    {
      key: 'f',
      ctrl: true,
      description: 'Apply fixes',
      handler: () => {
        const fixButton = document.querySelector<HTMLButtonElement>('[data-fix-button]');
        fixButton?.click();
      },
    },
    {
      key: 'r',
      ctrl: true,
      description: 'Generate report',
      handler: () => {
        const reportButton = document.querySelector<HTMLButtonElement>('[data-report-button]');
        reportButton?.click();
      },
    },
    {
      key: 'd',
      ctrl: true,
      description: 'Go to dashboard',
      handler: () => {
        window.location.href = '/dashboard';
      },
    },
    {
      key: 'Escape',
      description: 'Close modal/dropdown',
      handler: () => {
        const closeButtons = document.querySelectorAll<HTMLButtonElement>('[data-close-modal]');
        closeButtons.forEach(btn => btn.click());
      },
    },
    {
      key: '?',
      ctrl: true,
      description: 'Show keyboard shortcuts',
      handler: () => {
        const helpModal = document.querySelector<HTMLDivElement>('[data-help-modal]');
        if (helpModal) {
          helpModal.style.display = 'block';
        }
      },
    },
  ]);
}

// Hook for command palette (like Spotlight/Cmd+K)
export function useCommandPalette<T extends { id: string; label: string; action: () => void }>(
  commands: T[],
  options?: {
    triggerKey?: string;
    enabled?: boolean;
  }
): {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  search: string;
  setSearch: (search: string) => void;
  filteredCommands: T[];
} {
  const { triggerKey = 'k', enabled = true } = options || {};
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredCommands = useMemo(() => {
    if (!search.trim()) return commands;
    const searchLower = search.toLowerCase();
    return commands.filter(cmd =>
      cmd.label.toLowerCase().includes(searchLower)
    );
  }, [commands, search]);

  const open = useCallback(() => {
    setIsOpen(true);
    setSearch('');
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setSearch('');
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
    if (!isOpen) setSearch('');
  }, [isOpen]);

  // Open command palette with Cmd+K or Ctrl+K
  useKeyboard(
    triggerKey,
    (event) => {
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        toggle();
      }
    },
    { enabled }
  );

  // Close with Escape
  useKeyboard('Escape', close, { enabled: isOpen });

  // Handle arrow keys navigation in command palette
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  useEffect(() => {
    if (!isOpen) {
      setSelectedIndex(0);
      return;
    }

    const handleArrowKeys = (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex(prev =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
      } else if (event.key === 'Enter' && filteredCommands[selectedIndex]) {
        event.preventDefault();
        filteredCommands[selectedIndex].action();
        close();
      }
    };

    window.addEventListener('keydown', handleArrowKeys);
    return () => window.removeEventListener('keydown', handleArrowKeys);
  }, [isOpen, filteredCommands, selectedIndex, close]);

  return {
    isOpen,
    open,
    close,
    toggle,
    search,
    setSearch,
    filteredCommands,
  };
}

// Hook for focus trapping in modals (accessibility)
export function useFocusTrap(
  enabled: boolean,
  options?: {
    initialFocus?: HTMLElement | null;
    returnFocus?: boolean;
  }
): {
  ref: (element: HTMLElement | null) => void;
  activate: () => void;
  deactivate: () => void;
} {
  const { initialFocus, returnFocus = true } = options || {};
  const containerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    
    return Array.from(
      containerRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        !el.hasAttribute('disabled') &&
        !el.getAttribute('aria-hidden') &&
        el.tabIndex >= 0
    );
  }, []);

  const focusFirstElement = useCallback(() => {
    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  }, [getFocusableElements]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!containerRef.current || event.key !== 'Tab') return;

      const focusable = getFocusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        // Shift + Tab
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        // Tab
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    },
    [getFocusableElements]
  );

  const activate = useCallback(() => {
    if (!enabled || !containerRef.current) return;

    // Save current focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Set initial focus
    if (initialFocus && initialFocus instanceof HTMLElement) {
      initialFocus.focus();
    } else {
      focusFirstElement();
    }

    // Add event listener for Tab key
    containerRef.current.addEventListener('keydown', handleKeyDown);

    // Watch for DOM changes to update focusable elements
    observerRef.current = new MutationObserver(() => {
      // Re-focus first element if focus is lost
      if (!containerRef.current?.contains(document.activeElement)) {
        focusFirstElement();
      }
    });

    if (containerRef.current) {
      observerRef.current.observe(containerRef.current, {
        childList: true,
        subtree: true,
      });
    }
  }, [enabled, initialFocus, focusFirstElement, handleKeyDown]);

  const deactivate = useCallback(() => {
    // Remove event listener
    if (containerRef.current) {
      containerRef.current.removeEventListener('keydown', handleKeyDown);
    }

    // Disconnect observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    // Return focus
    if (returnFocus && previousFocusRef.current) {
      previousFocusRef.current.focus();
    }
  }, [handleKeyDown, returnFocus]);

  const ref = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
  }, []);

  return { ref, activate, deactivate };
}