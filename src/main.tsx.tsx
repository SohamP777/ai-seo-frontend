import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Type definitions for Vite environment variables
interface ImportMetaEnv {
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  readonly VITE_APP_ENV: 'development' | 'production' | 'staging';
  readonly VITE_API_BASE_URL: string;
  readonly VITE_RAZORPAY_KEY: string;
  readonly VITE_ENABLE_PAYMENTS: string;
  readonly VITE_ENABLE_AUTH: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: {
    accept: () => void;
  };
}

// ============================================
// APPLICATION INITIALIZATION
// ============================================

/**
 * Remove the loading screen when app is ready
 * This improves perceived performance
 */
const removeLoadingScreen = (): void => {
  const loadingScreen = document.getElementById('loading-state');
  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => loadingScreen.remove(), 300);
  }
};

/**
 * Initialize Razorpay SDK for payments
 * This loads the Razorpay script dynamically
 */
const initializeRazorpay = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!import.meta.env.VITE_RAZORPAY_KEY || import.meta.env.VITE_ENABLE_PAYMENTS !== 'true') {
      console.log('Payments disabled or Razorpay key not configured');
      resolve(false);
      return;
    }

    // Check if Razorpay is already loaded
    if (window.Razorpay) {
      console.log('Razorpay already loaded');
      resolve(true);
      return;
    }

    // Load Razorpay script
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    
    script.onload = () => {
      console.log('Razorpay SDK loaded successfully');
      resolve(true);
    };
    
    script.onerror = () => {
      console.error('Failed to load Razorpay SDK');
      resolve(false);
    };
    
    document.head.appendChild(script);
  });
};

/**
 * Initialize analytics if enabled
 */
const initializeAnalytics = (): void => {
  if (import.meta.env.VITE_ENABLE_ANALYTICS === 'true') {
    // Initialize your analytics service here
    console.log('Analytics initialized');
  }
};

/**
 * Global error handler for uncaught errors
 */
const setupGlobalErrorHandling = (): void => {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Log to error monitoring service
    event.preventDefault();
  });

  // Handle uncaught errors
  window.addEventListener('error', (event: ErrorEvent) => {
    console.error('Global error caught:', event.error);
    
    // Show user-friendly error message in production
    if (import.meta.env.PROD) {
      showUserFriendlyError('Something went wrong. Please refresh the page.');
    }
    
    event.preventDefault();
  });
};

/**
 * Show user-friendly error notification
 */
const showUserFriendlyError = (message: string): void => {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'fixed top-4 right-4 bg-red-500 text-white p-4 rounded-lg shadow-lg z-50 max-w-md animate-slide-down';
  errorDiv.innerHTML = `
    <div class="flex items-start">
      <svg class="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
      </svg>
      <div class="ml-3 flex-1">
        <p class="text-sm font-medium">Oops! Something went wrong</p>
        <p class="mt-1 text-sm opacity-90">${message}</p>
      </div>
      <button onclick="this.parentElement.parentElement.remove()" class="ml-2 -mt-1 -mr-1 text-white hover:text-gray-200 p-1 rounded">
        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </button>
    </div>
  `;
  
  document.body.appendChild(errorDiv);

  // Auto-remove after 8 seconds
  setTimeout(() => {
    if (errorDiv.parentNode) {
      errorDiv.classList.add('opacity-0', 'transition-opacity', 'duration-300');
      setTimeout(() => errorDiv.remove(), 300);
    }
  }, 8000);
};

/**
 * Log app initialization details
 */
const logAppInitialization = (): void => {
  console.log(`
    %c🚀 ${import.meta.env.VITE_APP_NAME || 'SEO Automation Tool'} 
    %cVersion: ${import.meta.env.VITE_APP_VERSION || '1.0.0'}
    %cEnvironment: ${import.meta.env.VITE_APP_ENV || 'development'}
    %cPayments: ${import.meta.env.VITE_ENABLE_PAYMENTS === 'true' ? '✅ Enabled' : '❌ Disabled'}
  `,
  'color: #3b82f6; font-size: 16px; font-weight: bold;',
  'color: #6b7280; font-size: 12px;',
  'color: #6b7280; font-size: 12px;',
  'color: #6b7280; font-size: 12px;'
  );
};

/**
 * Main initialization function
 */
const initializeApp = async (): Promise<void> => {
  try {
    // 1. Log initialization
    logAppInitialization();
    
    // 2. Setup global error handling
    setupGlobalErrorHandling();
    
    // 3. Initialize Razorpay (if enabled)
    if (import.meta.env.VITE_ENABLE_PAYMENTS === 'true') {
      await initializeRazorpay();
    }
    
    // 4. Initialize analytics
    initializeAnalytics();
    
    // 5. Create React root and render app
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element (#root) not found in DOM');
    }
    
    const root = ReactDOM.createRoot(rootElement);
    
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    
    // 6. Remove loading screen after render
    setTimeout(removeLoadingScreen, 500);
    
    // 7. Initialize theme
    initializeTheme();
    
  } catch (error) {
    console.error('Failed to initialize application:', error);
    showUserFriendlyError('Failed to load application. Please refresh the page.');
  }
};

/**
 * Initialize theme based on user preference
 */
const initializeTheme = (): void => {
  const savedTheme = localStorage.getItem('seo-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

// ============================================
// START APPLICATION
// ============================================

// Check if DOM is ready and initialize app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
  });
} else {
  initializeApp();
}

// Handle Hot Module Replacement for development
if (import.meta.hot) {
  import.meta.hot.accept();
}

// Type declaration for Razorpay
declare global {
  interface Window {
    Razorpay: any;
  }
}