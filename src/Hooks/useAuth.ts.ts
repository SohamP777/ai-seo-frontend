// frontend/src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  subscription: {
    plan: 'free' | 'pro' | 'enterprise';
    expiresAt: Date | null;
    scansRemaining: number;
  };
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  token: string | null;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface SignupData {
  email: string;
  password: string;
  name: string;
  company?: string;
}

export interface UseAuthReturn extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  updateProfile: (data: Partial<User>) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  hasPermission: (permission: string) => boolean;
  isSubscriptionActive: () => boolean;
  canPerformScan: () => boolean;
  getRemainingScans: () => number;
}

export const useAuth = (): UseAuthReturn => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
    token: localStorage.getItem('token') || sessionStorage.getItem('token'),
  });

  const navigate = useNavigate();

  // Initialize auth state from storage
  const initializeAuth = useCallback(async () => {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    
    if (!token) {
      setState(prev => ({ ...prev, isLoading: false }));
      return;
    }

    try {
      // Set auth header
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      // Validate token and get user data
      const response = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      setState(prev => ({
        ...prev,
        user: response.data.user,
        isAuthenticated: true,
        isLoading: false,
        token,
      }));
    } catch (error) {
      // Token is invalid
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      
      setState(prev => ({
        ...prev,
        user: null,
        isAuthenticated: false,
        isLoading: false,
        token: null,
      }));
    }
  }, []);

  // Login function
  const login = useCallback(async (credentials: LoginCredentials) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await axios.post('/api/auth/login', credentials);
      const { token, user } = response.data;
      
      // Store token based on rememberMe
      if (credentials.rememberMe) {
        localStorage.setItem('token', token);
      } else {
        sessionStorage.setItem('token', token);
      }
      
      // Set auth header
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        token,
      });
      
      navigate('/dashboard');
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Login failed';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, [navigate]);

  // Signup function
  const signup = useCallback(async (data: SignupData) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const response = await axios.post('/api/auth/signup', data);
      const { token, user } = response.data;
      
      // Store token
      localStorage.setItem('token', token);
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        token,
      });
      
      navigate('/dashboard');
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || 'Signup failed';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      throw error;
    }
  }, [navigate]);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await axios.post('/api/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear storage and state
      localStorage.removeItem('token');
      sessionStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
      
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        token: null,
      });
      
      navigate('/login');
    }
  }, [navigate]);

  // Refresh token
  const refreshToken = useCallback(async () => {
    try {
      const response = await axios.post('/api/auth/refresh');
      const { token } = response.data;
      
      // Update stored token
      const storedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (storedToken) {
        if (localStorage.getItem('token')) {
          localStorage.setItem('token', token);
        } else {
          sessionStorage.setItem('token', token);
        }
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        
        setState(prev => ({ ...prev, token }));
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      await logout();
    }
  }, [logout]);

  // Update user profile
  const updateProfile = useCallback(async (data: Partial<User>) => {
    try {
      const response = await axios.put('/api/auth/profile', data);
      setState(prev => ({
        ...prev,
        user: response.data.user,
      }));
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Profile update failed');
    }
  }, []);

  // Change password
  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    try {
      await axios.put('/api/auth/password', { oldPassword, newPassword });
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Password change failed');
    }
  }, []);

  // Reset password
  const resetPassword = useCallback(async (email: string) => {
    try {
      await axios.post('/api/auth/reset-password', { email });
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Password reset failed');
    }
  }, []);

  // Verify email
  const verifyEmail = useCallback(async (token: string) => {
    try {
      await axios.post('/api/auth/verify-email', { token });
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Email verification failed');
    }
  }, []);

  // Check permissions
  const hasPermission = useCallback((permission: string): boolean => {
    if (!state.user) return false;
    
    // Simple permission check based on role
    const rolePermissions = {
      admin: ['scan', 'fix', 'reports', 'settings', 'users'],
      user: ['scan', 'fix', 'reports'],
    };
    
    return rolePermissions[state.user.role]?.includes(permission) || false;
  }, [state.user]);

  // Check subscription status
  const isSubscriptionActive = useCallback((): boolean => {
    if (!state.user?.subscription.expiresAt) return true; // Free tier
    
    const now = new Date();
    const expiresAt = new Date(state.user.subscription.expiresAt);
    return expiresAt > now;
  }, [state.user]);

  // Check if user can perform scan
  const canPerformScan = useCallback((): boolean => {
    if (!state.user) return false;
    
    const isActive = isSubscriptionActive();
    const hasScans = state.user.subscription.scansRemaining > 0 || 
                    state.user.subscription.plan === 'enterprise';
    
    return isActive && hasScans;
  }, [state.user, isSubscriptionActive]);

  // Get remaining scans
  const getRemainingScans = useCallback((): number => {
    if (!state.user) return 0;
    
    return state.user.subscription.scansRemaining;
  }, [state.user]);

  // Set up axios interceptors for token refresh
  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          
          try {
            await refreshToken();
            return axios(originalRequest);
          } catch (refreshError) {
            await logout();
            return Promise.reject(refreshError);
          }
        }
        
        return Promise.reject(error);
      }
    );

    // Initialize auth
    initializeAuth();

    // Set up auto-logout timer
    let logoutTimer: NodeJS.Timeout;
    if (state.token && !localStorage.getItem('token')) {
      // Session token (not remember me) - auto logout after 24 hours
      logoutTimer = setTimeout(() => {
        logout();
      }, 24 * 60 * 60 * 1000);
    }

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
      if (logoutTimer) clearTimeout(logoutTimer);
    };
  }, [state.token, refreshToken, logout, initializeAuth]);

  return {
    ...state,
    login,
    signup,
    logout,
    refreshToken,
    updateProfile,
    changePassword,
    resetPassword,
    verifyEmail,
    hasPermission,
    isSubscriptionActive,
    canPerformScan,
    getRemainingScans,
  };
};

// Custom hook for subscription management
export const useSubscription = () => {
  const { user, updateProfile } = useAuth();
  
  const upgradePlan = useCallback(async (plan: 'pro' | 'enterprise') => {
    try {
      const response = await axios.post('/api/subscription/upgrade', { plan });
      await updateProfile(response.data.user);
      return true;
    } catch (error) {
      console.error('Upgrade failed:', error);
      return false;
    }
  }, [updateProfile]);

  const cancelSubscription = useCallback(async () => {
    try {
      await axios.post('/api/subscription/cancel');
      await updateProfile({
        subscription: {
          plan: 'free',
          expiresAt: null,
          scansRemaining: 10,
        },
      } as any);
      return true;
    } catch (error) {
      console.error('Cancel failed:', error);
      return false;
    }
  }, [updateProfile]);

  return {
    currentPlan: user?.subscription.plan || 'free',
    upgradePlan,
    cancelSubscription,
  };
};