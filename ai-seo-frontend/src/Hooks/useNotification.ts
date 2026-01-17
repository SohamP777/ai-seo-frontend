// frontend/src/hooks/useNotification.ts
import { useState, useCallback, useRef, useEffect } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  duration?: number; // milliseconds, undefined for persistent
  dismissible: boolean;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary' | 'ghost';
  };
  onClose?: () => void;
  progress?: number; // For loading notifications
}

export interface UseNotificationReturn {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => string;
  removeNotification: (id: string) => void;
  updateNotification: (id: string, updates: Partial<Notification>) => void;
  clearNotifications: () => void;
  showSuccess: (title: string, message: string, options?: Partial<Notification>) => string;
  showError: (title: string, message: string, options?: Partial<Notification>) => string;
  showWarning: (title: string, message: string, options?: Partial<Notification>) => string;
  showInfo: (title: string, message: string, options?: Partial<Notification>) => string;
  showLoading: (title: string, message: string, options?: Partial<Notification>) => string;
}

export const useNotification = (): UseNotificationReturn => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Generate unique ID
  const generateId = useCallback(() => {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Add notification
  const addNotification = useCallback((
    notification: Omit<Notification, 'id' | 'timestamp'>
  ): string => {
    const id = generateId();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
      duration: notification.duration ?? (notification.type === 'loading' ? undefined : 5000),
      dismissible: notification.dismissible ?? true,
    };

    setNotifications(prev => [newNotification, ...prev]);

    // Auto-dismiss if duration is set
    if (newNotification.duration && newNotification.duration > 0) {
      const timeout = setTimeout(() => {
        removeNotification(id);
        if (newNotification.onClose) {
          newNotification.onClose();
        }
      }, newNotification.duration);

      timeouts.current.set(id, timeout);
    }

    return id;
  }, [generateId]);

  // Remove notification
  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(notif => notif.id !== id));
    
    // Clear timeout if exists
    const timeout = timeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeouts.current.delete(id);
    }
  }, []);

  // Update notification
  const updateNotification = useCallback((id: string, updates: Partial<Notification>) => {
    setNotifications(prev =>
      prev.map(notif =>
        notif.id === id ? { ...notif, ...updates } : notif
      )
    );
  }, []);

  // Clear all notifications
  const clearNotifications = useCallback(() => {
    setNotifications([]);
    
    // Clear all timeouts
    timeouts.current.forEach(timeout => clearTimeout(timeout));
    timeouts.current.clear();
  }, []);

  // Helper methods for specific notification types
  const showSuccess = useCallback((
    title: string,
    message: string,
    options: Partial<Notification> = {}
  ): string => {
    return addNotification({
      type: 'success',
      title,
      message,
      duration: 3000,
      ...options,
    });
  }, [addNotification]);

  const showError = useCallback((
    title: string,
    message: string,
    options: Partial<Notification> = {}
  ): string => {
    return addNotification({
      type: 'error',
      title,
      message,
      duration: 7000, // Longer duration for errors
      dismissible: true,
      ...options,
    });
  }, [addNotification]);

  const showWarning = useCallback((
    title: string,
    message: string,
    options: Partial<Notification> = {}
  ): string => {
    return addNotification({
      type: 'warning',
      title,
      message,
      duration: 5000,
      ...options,
    });
  }, [addNotification]);

  const showInfo = useCallback((
    title: string,
    message: string,
    options: Partial<Notification> = {}
  ): string => {
    return addNotification({
      type: 'info',
      title,
      message,
      duration: 4000,
      ...options,
    });
  }, [addNotification]);

  const showLoading = useCallback((
    title: string,
    message: string,
    options: Partial<Notification> = {}
  ): string => {
    return addNotification({
      type: 'loading',
      title,
      message,
      duration: undefined, // Persistent until manually dismissed
      dismissible: false,
      ...options,
    });
  }, [addNotification]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timeouts.current.forEach(timeout => clearTimeout(timeout));
      timeouts.current.clear();
    };
  }, []);

  return {
    notifications,
    addNotification,
    removeNotification,
    updateNotification,
    clearNotifications,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
  };
};

// Custom hook for notification bell/badge
export const useNotificationBell = () => {
  const { notifications, removeNotification, markAsRead } = useSEOState();
  
  const unreadCount = notifications.filter(n => !n.read).length;
  const hasCritical = notifications.some(n => n.type === 'error' && !n.read);
  
  const markAllAsRead = useCallback(() => {
    notifications.forEach(notif => {
      if (!notif.read) {
        markAsRead(notif.id);
      }
    });
  }, [notifications, markAsRead]);
  
  const dismissAll = useCallback(() => {
    notifications.forEach(notif => {
      removeNotification(notif.id);
    });
  }, [notifications, removeNotification]);
  
  return {
    unreadCount,
    hasCritical,
    markAllAsRead,
    dismissAll,
    notifications: notifications.slice(0, 10), // Show latest 10
  };
};