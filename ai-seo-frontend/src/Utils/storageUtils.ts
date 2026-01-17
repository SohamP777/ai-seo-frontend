/**
 * Storage Utilities
 * Local storage and cache management
 */

import { STORAGE_KEYS, CACHE_DURATIONS } from './constants';

export class StorageService {
  static get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return null;
    }
  }

  static set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error('Error writing to localStorage:', error);
    }
  }

  static remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('Error removing from localStorage:', error);
    }
  }

  static clear(): void {
    try {
      localStorage.clear();
    } catch (error) {
      console.error('Error clearing localStorage:', error);
    }
  }
}

export class CacheService {
  static get<T>(key: string): T | null {
    const cached = StorageService.get<{ data: T; timestamp: number }>(key);
    
    if (!cached) {
      return null;
    }

    const cacheDurations = {
      ...CACHE_DURATIONS,
      ...this.getCustomCacheDuration(key),
    };

    const cacheDuration = cacheDurations[key as keyof typeof cacheDurations] || CACHE_DURATIONS.SCAN_RESULTS;
    
    if (Date.now() - cached.timestamp > cacheDuration) {
      StorageService.remove(key);
      return null;
    }

    return cached.data;
  }

  static set<T>(key: string, data: T): void {
    const cacheItem = {
      data,
      timestamp: Date.now(),
    };
    StorageService.set(key, cacheItem);
  }

  static remove(key: string): void {
    StorageService.remove(key);
  }

  static clearAll(): void {
    Object.values(STORAGE_KEYS).forEach(key => {
      this.remove(key);
    });
  }

  private static getCustomCacheDuration(key: string): number | undefined {
    // Add custom cache durations for specific keys if needed
    return undefined;
  }
}

export const getAuthToken = (): string | null => {
  return StorageService.get<string>(STORAGE_KEYS.AUTH_TOKEN);
};

export const setAuthToken = (token: string): void => {
  StorageService.set(STORAGE_KEYS.AUTH_TOKEN, token);
};

export const removeAuthToken = (): void => {
  StorageService.remove(STORAGE_KEYS.AUTH_TOKEN);
};

export const getUserPreferences = (): Record<string, any> => {
  return StorageService.get(STORAGE_KEYS.USER_PREFERENCES) || {};
};

export const setUserPreferences = (preferences: Record<string, any>): void => {
  StorageService.set(STORAGE_KEYS.USER_PREFERENCES, preferences);
};

export const getRecentScans = (): string[] => {
  return StorageService.get<string[]>(STORAGE_KEYS.RECENT_SCANS) || [];
};

export const addRecentScan = (url: string): void => {
  const recentScans = getRecentScans();
  const filteredScans = recentScans.filter(scan => scan !== url);
  const updatedScans = [url, ...filteredScans].slice(0, 10); // Keep last 10 scans
  StorageService.set(STORAGE_KEYS.RECENT_SCANS, updatedScans);
};

export const getAutoFixEnabled = (): boolean => {
  return StorageService.get<boolean>(STORAGE_KEYS.AUTO_FIX_ENABLED) ?? true;
};

export const setAutoFixEnabled = (enabled: boolean): void => {
  StorageService.set(STORAGE_KEYS.AUTO_FIX_ENABLED, enabled);
};