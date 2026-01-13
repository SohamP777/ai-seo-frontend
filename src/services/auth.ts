import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';

// Types for authentication
export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface SignupData {
  email: string;
  password: string;
  confirmPassword: string;
  name: string;
  company?: string;
  website?: string;
  acceptTerms: boolean;
  newsletter?: boolean;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
  requiresVerification?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'user' | 'admin';
  emailVerified: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  createdAt: string;
  lastLoginAt?: string;
  preferences?: UserPreferences;
  limits?: UserLimits;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  notifications: {
    email: boolean;
    push: boolean;
    weeklyReport: boolean;
    scanComplete: boolean;
    fixComplete: boolean;
  };
  language: string;
  timezone: string;
  autoScan: boolean;
  autoFix: boolean;
  defaultScanSettings?: Record<string, any>;
}

export interface UserLimits {
  maxScans: number;
  scansUsed: number;
  maxWebsites: number;
  websitesUsed: number;
  scansResetAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export interface ForgotPasswordData {
  email: string;
}

export interface ResetPasswordData {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface VerifyEmailData {
  token: string;
}

export interface ChangePasswordData {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface UpdateProfileData {
  name?: string;
  company?: string;
  website?: string;
  avatar?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  errors?: Record<string, string[]>;
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Authentication service for user management
 */
class AuthService {
  private api: AxiosInstance;
  private readonly BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.seo-automation.com/v1';
  private readonly TOKEN_KEY = 'auth_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly USER_KEY = 'user_data';

  constructor() {
    this.api = axios.create({
      baseURL: this.BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Setup request/response interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor for adding auth token
    this.api.interceptors.request.use(
      (config) => {
        const token = this.getAccessToken();
        if (token && !config.url?.includes('/auth/refresh')) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for token refresh
    this.api.interceptors.response.use(
      (response: AxiosResponse<ApiResponse<any>>) => {
        if (response.data && response.data.success === false) {
          throw new Error(response.data.message || 'Request failed');
        }
        return response;
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as any;
        
        // Handle 401 errors by trying to refresh token
        if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url?.includes('/auth/')) {
          originalRequest._retry = true;
          
          try {
            const tokens = await this.refreshToken();
            if (tokens) {
              originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
              return this.api(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, logout user
            this.logout();
            window.location.href = '/login';
            return Promise.reject(refreshError);
          }
        }
        
        return Promise.reject(this.handleAuthError(error));
      }
    );
  }

  /**
   * Handle authentication-specific errors
   */
  private handleAuthError(error: AxiosError): Error {
    if (error.response) {
      const apiError = error.response.data as { 
        message?: string; 
        code?: string;
        errors?: Record<string, string[]>;
      };
      
      // Map common auth errors to user-friendly messages
      const errorMessages: Record<string, string> = {
        'invalid_credentials': 'Invalid email or password',
        'email_not_verified': 'Please verify your email address',
        'account_locked': 'Account temporarily locked. Try again in 15 minutes',
        'weak_password': 'Password is too weak',
        'email_exists': 'Email already registered',
        'invalid_token': 'Invalid or expired token',
        'token_expired': 'Session expired. Please login again',
        'rate_limited': 'Too many attempts. Please try again later',
      };

      // If there are validation errors, format them
      if (apiError.errors) {
        const firstError = Object.values(apiError.errors)[0]?.[0];
        if (firstError) {
          return new Error(firstError);
        }
      }

      const errorCode = apiError.code || '';
      const message = errorMessages[errorCode] || apiError.message || 'Authentication failed';
      
      return new Error(message);
    } else if (error.request) {
      return new Error('No response from server. Please check your connection.');
    } else {
      return new Error(`Authentication error: ${error.message}`);
    }
  }

  /**
   * User login
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    try {
      const response = await this.api.post<ApiResponse<AuthResponse>>('/auth/login', credentials);
      const authData = response.data.data;
      
      // Store tokens and user data
      this.setTokens(authData.tokens);
      this.setUser(authData.user);
      
      // Set up token auto-refresh
      this.scheduleTokenRefresh(authData.tokens.expiresIn);
      
      return authData;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  /**
   * User registration
   */
  async signup(data: SignupData): Promise<{ 
    user: User; 
    requiresVerification: boolean;
    verificationSent: boolean;
  }> {
    try {
      // Basic validation
      if (data.password !== data.confirmPassword) {
        throw new Error('Passwords do not match');
      }

      if (!data.acceptTerms) {
        throw new Error('You must accept the terms and conditions');
      }

      const signupPayload = {
        email: data.email.trim().toLowerCase(),
        password: data.password,
        name: data.name.trim(),
        company: data.company?.trim(),
        website: data.website?.trim(),
        newsletter: data.newsletter,
      };

      const response = await this.api.post<ApiResponse<any>>('/auth/signup', signupPayload);
      return response.data.data;
    } catch (error) {
      console.error('Signup failed:', error);
      throw error;
    }
  }

  /**
   * Verify email address
   */
  async verifyEmail(token: string): Promise<{ 
    verified: boolean; 
    user?: User;
    tokens?: AuthTokens;
  }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/auth/verify-email', { token });
      const data = response.data.data;
      
      if (data.user && data.tokens) {
        this.setTokens(data.tokens);
        this.setUser(data.user);
      }
      
      return data;
    } catch (error) {
      console.error('Email verification failed:', error);
      throw error;
    }
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string): Promise<{ sent: boolean }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/auth/resend-verification', { email });
      return response.data.data;
    } catch (error) {
      console.error('Failed to resend verification:', error);
      throw error;
    }
  }

  /**
   * Forgot password
   */
  async forgotPassword(email: string): Promise<{ sent: boolean }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/auth/forgot-password', { email });
      return response.data.data;
    } catch (error) {
      console.error('Forgot password failed:', error);
      throw error;
    }
  }

  /**
   * Reset password
   */
  async resetPassword(data: ResetPasswordData): Promise<{ 
    success: boolean; 
    user?: User;
    tokens?: AuthTokens;
  }> {
    try {
      if (data.password !== data.confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const response = await this.api.post<ApiResponse<any>>('/auth/reset-password', {
        token: data.token,
        password: data.password,
      });
      
      const responseData = response.data.data;
      
      if (responseData.user && responseData.tokens) {
        this.setTokens(responseData.tokens);
        this.setUser(responseData.user);
      }
      
      return responseData;
    } catch (error) {
      console.error('Reset password failed:', error);
      throw error;
    }
  }

  /**
   * Change password
   */
  async changePassword(data: ChangePasswordData): Promise<{ success: boolean }> {
    try {
      if (data.newPassword !== data.confirmPassword) {
        throw new Error('New passwords do not match');
      }

      const response = await this.api.post<ApiResponse<any>>('/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      
      return response.data.data;
    } catch (error) {
      console.error('Change password failed:', error);
      throw error;
    }
  }

  /**
   * Get current user profile
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      // First check localStorage
      const cachedUser = this.getUser();
      if (cachedUser) {
        // Validate token and get fresh data in background
        this.validateToken();
        return cachedUser;
      }

      // If no cached user, try to get from API
      const response = await this.api.get<ApiResponse<User>>('/auth/me');
      const user = response.data.data;
      this.setUser(user);
      return user;
    } catch (error) {
      console.error('Failed to get current user:', error);
      this.clearAuthData();
      return null;
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(data: UpdateProfileData): Promise<User> {
    try {
      const response = await this.api.put<ApiResponse<User>>('/auth/profile', data);
      const user = response.data.data;
      this.setUser(user);
      return user;
    } catch (error) {
      console.error('Failed to update profile:', error);
      throw error;
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(preferences: Partial<UserPreferences>): Promise<UserPreferences> {
    try {
      const response = await this.api.put<ApiResponse<UserPreferences>>('/auth/preferences', preferences);
      const updatedPreferences = response.data.data;
      
      // Update cached user
      const user = this.getUser();
      if (user) {
        user.preferences = updatedPreferences;
        this.setUser(user);
      }
      
      return updatedPreferences;
    } catch (error) {
      console.error('Failed to update preferences:', error);
      throw error;
    }
  }

  /**
   * Get user limits
   */
  async getUserLimits(): Promise<UserLimits> {
    try {
      const response = await this.api.get<ApiResponse<UserLimits>>('/auth/limits');
      const limits = response.data.data;
      
      // Update cached user
      const user = this.getUser();
      if (user) {
        user.limits = limits;
        this.setUser(user);
      }
      
      return limits;
    } catch (error) {
      console.error('Failed to get user limits:', error);
      return {
        maxScans: 10,
        scansUsed: 0,
        maxWebsites: 1,
        websitesUsed: 1,
        scansResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      await this.api.post('/auth/logout');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      this.clearAuthData();
    }
  }

  /**
   * Validate current token
   */
  async validateToken(): Promise<boolean> {
    try {
      const token = this.getAccessToken();
      if (!token) {
        return false;
      }

      await this.api.get('/auth/validate');
      return true;
    } catch (error) {
      console.error('Token validation failed:', error);
      this.clearAuthData();
      return false;
    }
  }

  /**
   * Refresh access token
   */
  private async refreshToken(): Promise<AuthTokens | null> {
    try {
      const refreshToken = this.getRefreshToken();
      if (!refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await this.api.post<ApiResponse<AuthTokens>>('/auth/refresh', {
        refreshToken,
      });
      
      const tokens = response.data.data;
      this.setTokens(tokens);
      
      // Schedule next refresh
      this.scheduleTokenRefresh(tokens.expiresIn);
      
      return tokens;
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.clearAuthData();
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getAccessToken();
    if (!token) return false;

    try {
      // Check if token is expired
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiration = payload.exp * 1000;
      return Date.now() < expiration;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get user role
   */
  getUserRole(): string | null {
    const user = this.getUser();
    return user?.role || null;
  }

  /**
   * Check if user has specific role
   */
  hasRole(role: string): boolean {
    const userRole = this.getUserRole();
    return userRole === role;
  }

  /**
   * Check if user is on specific plan
   */
  hasPlan(plan: string): boolean {
    const user = this.getUser();
    return user?.plan === plan;
  }

  /**
   * Get access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  /**
   * Get refresh token
   */
  private getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  /**
   * Get user from storage
   */
  getUser(): User | null {
    const userJson = localStorage.getItem(this.USER_KEY);
    return userJson ? JSON.parse(userJson) : null;
  }

  /**
   * Set tokens in storage
   */
  private setTokens(tokens: AuthTokens): void {
    localStorage.setItem(this.TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, tokens.refreshToken);
  }

  /**
   * Set user in storage
   */
  private setUser(user: User): void {
    localStorage.setItem(this.USER_KEY, JSON.stringify(user));
  }

  /**
   * Clear all auth data
   */
  private clearAuthData(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  }

  /**
   * Schedule token refresh
   */
  private scheduleTokenRefresh(expiresIn: number): void {
    // Refresh token 1 minute before expiry
    const refreshTime = (expiresIn - 60) * 1000;
    
    if (refreshTime > 0) {
      setTimeout(async () => {
        if (this.isAuthenticated()) {
          await this.refreshToken();
        }
      }, refreshTime);
    }
  }

  /**
   * Validate password strength
   */
  validatePassword(password: string): ValidationError[] {
    const errors: ValidationError[] = [];
    
    if (password.length < 8) {
      errors.push({ field: 'password', message: 'Password must be at least 8 characters' });
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push({ field: 'password', message: 'Password must contain at least one uppercase letter' });
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push({ field: 'password', message: 'Password must contain at least one lowercase letter' });
    }
    
    if (!/[0-9]/.test(password)) {
      errors.push({ field: 'password', message: 'Password must contain at least one number' });
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push({ field: 'password', message: 'Password must contain at least one special character' });
    }
    
    return errors;
  }

  /**
   * Validate email format
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Generate avatar URL
   */
  generateAvatar(name: string, size: number = 128): string {
    const encodedName = encodeURIComponent(name.trim());
    return `https://ui-avatars.com/api/?name=${encodedName}&background=random&color=fff&size=${size}&rounded=true`;
  }

  /**
   * Get default preferences
   */
  getDefaultPreferences(): UserPreferences {
    return {
      theme: 'auto',
      notifications: {
        email: true,
        push: false,
        weeklyReport: true,
        scanComplete: true,
        fixComplete: true,
      },
      language: 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      autoScan: false,
      autoFix: false,
      defaultScanSettings: {
        deepScan: false,
        includeMobile: true,
        maxPages: 50,
      },
    };
  }

  /**
   * Track user activity
   */
  trackActivity(activity: string): void {
    if (this.isAuthenticated()) {
      // Send activity to analytics (in production)
      console.log(`User activity: ${activity}`);
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
export default authService;