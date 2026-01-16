console.log('BACKEND URL:', import.meta.env.VITE_API_URL);
import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// Layout
import MainLayout from './components/layout/MainLayout';

// Loading component
import LoadingSpinner from './components/ui/LoadingSpinner';

// Types
interface ProtectedRouteProps {
  children: React.ReactNode;
  requirePayment?: boolean;
}

// Lazy-loaded pages
const Landing = lazy(() => import('./pages/Landing'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Billing = lazy(() => import('./pages/Billing'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/auth/Login'));
const Signup = lazy(() => import('./pages/auth/Signup'));

// ============================================
// ROUTE COMPONENTS
// ============================================

/**
 * Public Route - Redirects authenticated users to dashboard
 */
const PublicRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = localStorage.getItem('seo_auth_token') !== null;
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  
  return <>{children}</>;
};

/**
 * Protected Route - Requires authentication
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requirePayment = false }) => {
  const [authStatus, setAuthStatus] = React.useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [paymentStatus, setPaymentStatus] = React.useState<'loading' | 'active' | 'inactive'>('loading');
  
  React.useEffect(() => {
    // Check authentication
    const token = localStorage.getItem('seo_auth_token');
    setAuthStatus(token ? 'authenticated' : 'unauthenticated');
    
    // Check payment status if required
    if (requirePayment && token) {
      const hasActiveSubscription = localStorage.getItem('seo_subscription_status') === 'active';
      setPaymentStatus(hasActiveSubscription ? 'active' : 'inactive');
    } else {
      setPaymentStatus('active'); // No payment required
    }
  }, [requirePayment]);
  
  // Show loading spinner
  if (authStatus === 'loading' || (requirePayment && paymentStatus === 'loading')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (authStatus === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  
  // Redirect to pricing if payment required but not active
  if (requirePayment && paymentStatus === 'inactive') {
    return <Navigate to="/pricing" replace />;
  }
  
  return <>{children}</>;
};

/**
 * Payment Required Route - Only for paid features
 */
const PaymentRequiredRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <ProtectedRoute requirePayment={true}>
      {children}
    </ProtectedRoute>
  );
};

// ============================================
// UTILITY COMPONENTS
// ============================================

/**
 * Offline Indicator - Shows when user loses connection
 */
const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = React.useState<boolean>(navigator.onLine);
  
  React.useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);
  
  if (isOnline) return null;
  
  return (
    <div className="fixed bottom-4 right-4 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-pulse">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-medium">You are offline</span>
      </div>
    </div>
  );
};

/**
 * Development Tools - Only shown in development
 */
const DevelopmentTools: React.FC = () => {
  const [showTools, setShowTools] = React.useState(false);
  
  if (!import.meta.env.DEV) return null;
  
  const simulateAuth = (type: 'free' | 'premium' | 'logout') => {
    switch (type) {
      case 'free':
        localStorage.setItem('seo_auth_token', 'dev_token_free');
        localStorage.setItem('seo_subscription_status', 'inactive');
        break;
      case 'premium':
        localStorage.setItem('seo_auth_token', 'dev_token_premium');
        localStorage.setItem('seo_subscription_status', 'active');
        localStorage.setItem('seo_subscription_plan', 'premium');
        break;
      case 'logout':
        localStorage.removeItem('seo_auth_token');
        localStorage.removeItem('seo_subscription_status');
        localStorage.removeItem('seo_subscription_plan');
        break;
    }
    window.location.reload();
  };
  
  return (
    <>
      <button
        onClick={() => setShowTools(!showTools)}
        className="fixed bottom-4 left-4 bg-gray-800 text-white p-2 rounded-full text-xs z-40 hover:bg-gray-700 transition-colors shadow-lg"
        title="Development Tools"
      >
        DEV
      </button>
      
      {showTools && (
        <div className="fixed bottom-16 left-4 bg-gray-900 text-white p-4 rounded-lg shadow-xl z-40 w-80">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-bold text-sm">Dev Tools</h3>
            <button
              onClick={() => setShowTools(false)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          
          <div className="space-y-3 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Auth:</span>
                <span className="font-medium">
                  {localStorage.getItem('seo_auth_token') ? '✅' : '❌'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Subscription:</span>
                <span className="font-medium">
                  {localStorage.getItem('seo_subscription_status') === 'active' ? '✅ Premium' : '❌ Free'}
                </span>
              </div>
            </div>
            
            <div className="pt-2 border-t border-gray-700">
              <h4 className="font-medium mb-2">Simulate Auth</h4>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => simulateAuth('free')}
                  className="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-xs"
                >
                  Free User
                </button>
                <button
                  onClick={() => simulateAuth('premium')}
                  className="px-2 py-1.5 bg-green-600 hover:bg-green-700 rounded text-xs"
                >
                  Premium User
                </button>
                <button
                  onClick={() => simulateAuth('logout')}
                  className="px-2 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs"
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ============================================
// MAIN APP COMPONENT
// ============================================

const App: React.FC = () => {
  return (
    <Router>
      <div className="app min-h-screen bg-gray-50 dark:bg-gray-900">
        {/* Global Toast Notifications */}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#1f2937',
              color: '#fff',
              borderRadius: '8px',
            },
            success: {
              style: {
                background: '#10b981',
              },
            },
            error: {
              style: {
                background: '#ef4444',
              },
            },
          }}
        />
        
        {/* Suspense Boundary for Lazy Loading */}
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center">
              <LoadingSpinner size="xl" text="Loading..." />
            </div>
          }
        >
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Landing />} />
            <Route path="/pricing" element={<Pricing />} />
            
            {/* Auth Routes */}
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <Login />
                </PublicRoute>
              }
            />
            
            <Route
              path="/signup"
              element={
                <PublicRoute>
                  <Signup />
                </PublicRoute>
              }
            />
            
            {/* Protected Dashboard Routes with MainLayout */}
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="settings" element={<Settings />} />
              
              {/* Payment Required Routes */}
              <Route
                path="billing"
                element={
                  <PaymentRequiredRoute>
                    <Billing />
                  </PaymentRequiredRoute>
                }
              />
            </Route>
            
            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        
        {/* Offline Indicator */}
        <OfflineIndicator />
        
        {/* Development Tools */}
        <DevelopmentTools />
      </div>
    </Router>
  );
};

export default App;