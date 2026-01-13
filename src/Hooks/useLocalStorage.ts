// frontend/src/hooks/useLocalStorage.ts
import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseLocalStorageOptions<T> {
  serializer?: (value: T) => string;
  deserializer?: (value: string) => T;
  syncAcrossTabs?: boolean; // Sync changes across browser tabs
  initializeWithValue?: boolean; // Initialize with stored value on mount
  compression?: boolean; // Compress large data
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T | (() => T),
  options?: UseLocalStorageOptions<T>
): [T, (value: T | ((prevValue: T) => T)) => void, () => void] {
  const {
    serializer = JSON.stringify,
    deserializer = JSON.parse,
    syncAcrossTabs = true,
    initializeWithValue = true,
    compression = false,
  } = options || {};

  // Get initial value
  const getInitialValue = useCallback((): T => {
    if (!initializeWithValue) {
      return typeof initialValue === 'function' 
        ? (initialValue as () => T)() 
        : initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        // Handle compression
        let data = item;
        if (compression) {
          try {
            data = decompressData(item);
          } catch {
            // If decompression fails, use original
          }
        }
        
        return deserializer(data);
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
    }
    
    return typeof initialValue === 'function' 
      ? (initialValue as () => T)() 
      : initialValue;
  }, [key, initialValue, deserializer, compression, initializeWithValue]);

  const [storedValue, setStoredValue] = useState<T>(getInitialValue);
  const prevKeyRef = useRef(key);

  // Set value function
  const setValue = useCallback(
    (value: T | ((prevValue: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(storedValue) : value;
        setStoredValue(valueToStore);
        
        // Prepare data for storage
        let data = serializer(valueToStore);
        if (compression && data.length > 1024) { // Compress if > 1KB
          data = compressData(data);
        }
        
        window.localStorage.setItem(key, data);
        
        // Dispatch custom event for cross-tab sync
        if (syncAcrossTabs) {
          window.dispatchEvent(
            new StorageEvent('storage', {
              key,
              newValue: data,
              storageArea: window.localStorage,
            })
          );
        }
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue, serializer, compression, syncAcrossTabs]
  );

  // Remove value function
  const removeValue = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
      setStoredValue(
        typeof initialValue === 'function' 
          ? (initialValue as () => T)() 
          : initialValue
      );
      
      // Dispatch custom event for cross-tab sync
      if (syncAcrossTabs) {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            newValue: null,
            storageArea: window.localStorage,
          })
        );
      }
    } catch (error) {
      console.error(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, initialValue, syncAcrossTabs]);

  // Listen for changes in other tabs
  useEffect(() => {
    if (!syncAcrossTabs) return;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.storageArea === window.localStorage) {
        try {
          if (event.newValue === null) {
            // Item was removed
            setStoredValue(
              typeof initialValue === 'function' 
                ? (initialValue as () => T)() 
                : initialValue
            );
          } else {
            // Item was updated
            let data = event.newValue;
            if (compression) {
              try {
                data = decompressData(data);
              } catch {
                // If decompression fails, use original
              }
            }
            setStoredValue(deserializer(data));
          }
        } catch (error) {
          console.error(`Error syncing localStorage key "${key}":`, error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, initialValue, deserializer, compression, syncAcrossTabs]);

  // Handle key changes
  useEffect(() => {
    if (prevKeyRef.current !== key) {
      prevKeyRef.current = key;
      setStoredValue(getInitialValue());
    }
  }, [key, getInitialValue]);

  // Clear localStorage on app version change
  useEffect(() => {
    const appVersion = process.env.REACT_APP_VERSION || '1.0.0';
    const storedVersion = localStorage.getItem('app_version');
    
    if (storedVersion !== appVersion) {
      // Clear relevant keys or all localStorage
      const keysToClear = [
        'reportCache',
        'scanHistory',
        'dashboardLayout',
      ];
      
      keysToClear.forEach(k => localStorage.removeItem(k));
      localStorage.setItem('app_version', appVersion);
    }
  }, []);

  return [storedValue, setValue, removeValue];
}

// Advanced with expiration (TTL)
export function useLocalStorageWithTTL<T>(
  key: string,
  initialValue: T,
  ttl: number // Time to live in milliseconds
): [T | null, (value: T) => void, () => void] {
  const [value, setValue, removeValue] = useLocalStorage<{
    data: T;
    expiresAt: number;
  } | null>(key, null);

  const setValueWithTTL = useCallback(
    (newValue: T) => {
      const item = {
        data: newValue,
        expiresAt: Date.now() + ttl,
      };
      setValue(item);
    },
    [ttl, setValue]
  );

  const getValidValue = useCallback((): T | null => {
    if (!value) return null;
    
    if (Date.now() > value.expiresAt) {
      removeValue();
      return null;
    }
    
    return value.data;
  }, [value, removeValue]);

  const validValue = getValidValue();

  return [
    validValue !== null ? validValue : initialValue,
    setValueWithTTL,
    removeValue,
  ];
}

// Compression utilities (simple base64 for example)
function compressData(data: string): string {
  // In production, you might use lz-string or similar
  return btoa(data);
}

function decompressData(compressed: string): string {
  return atob(compressed);
}