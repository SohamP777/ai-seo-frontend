// src/components/Header/Header.tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { useHeader } from './Header.hooks';
import { Navigation } from './Navigation/Navigation';
import { UserMenu } from './UserMenu/UserMenu';
import { NotificationCenter } from './Notifications/NotificationCenter';
import { ThemeToggle } from './ThemeToggle/ThemeToggle';
import { useWebSocket } from '../../hooks/useWebSocket';
import { 
  selectHeaderState, 
  setNotifications, 
  incrementUnreadCount,
  markAllAsRead 
} from '../../store/slices/headerSlice';
import { Notification } from './Header.types';

export const Header: React.FC = () => {
  const dispatch = useDispatch();
  const {
    isNavigationOpen,
    isUserMenuOpen,
    isNotificationsOpen,
    userProfile,
    currentTheme,
    unreadNotificationCount
  } = useSelector(selectHeaderState);

  const {
    toggleNavigation,
    toggleUserMenu,
    toggleNotifications,
    handleSignOut,
    handleThemeToggle,
  } = useHeader();

  // WebSocket integration for real-time updates
  const handleWebSocketMessage = React.useCallback((message: unknown) => {
    const wsMessage = message as { type: string; payload: unknown };
    
    switch (wsMessage.type) {
      case 'new_notification':
        dispatch(setNotifications([wsMessage.payload as Notification]));
        dispatch(incrementUnreadCount());
        break;
      case 'user_profile_update':
        // Handle user profile updates
        break;
      case 'system_alert':
        // Handle system alerts
        break;
      default:
        console.warn('Unknown WebSocket message type:', wsMessage.type);
    }
  }, [dispatch]);

  useWebSocket('/ws/header', {
    onMessage: handleWebSocketMessage,
    onError: (error) => console.error('WebSocket error:', error),
    onReconnect: () => console.log('WebSocket reconnected'),
  });

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50 shadow-sm"
      role="banner"
      aria-label="Main navigation"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Navigation */}
          <div className="flex items-center space-x-8">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <a
                href="/dashboard"
                className="flex items-center space-x-2"
                aria-label="SEO Automation Tool - Go to dashboard"
              >
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">SEO</span>
                </div>
                <span className="text-xl font-bold text-gray-900 dark:text-white hidden sm:block">
                  SEO Automation
                </span>
              </a>
            </motion.div>

            <Navigation 
              isOpen={isNavigationOpen}
              onToggle={toggleNavigation}
            />
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            {/* Theme Toggle */}
            <ThemeToggle
              theme={currentTheme}
              onToggle={handleThemeToggle}
            />

            {/* Notifications */}
            <NotificationCenter
              isOpen={isNotificationsOpen}
              onToggle={toggleNotifications}
              unreadCount={unreadNotificationCount}
            />

            {/* User Menu */}
            <UserMenu
              isOpen={isUserMenuOpen}
              onToggle={toggleUserMenu}
              user={userProfile}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      <AnimatePresence>
        {(isNavigationOpen || isUserMenuOpen || isNotificationsOpen) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
            onClick={() => {
              if (isNavigationOpen) toggleNavigation();
              if (isUserMenuOpen) toggleUserMenu();
              if (isNotificationsOpen) toggleNotifications();
            }}
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
    </motion.header>
  );
};