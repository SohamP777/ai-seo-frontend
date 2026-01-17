/**
 * API Helper Utilities
 * Common functions for API interactions
 */

import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { API_CONFIG } from './constants';

export interface ApiError {
  message: string;
  code: string;
  status: number;
  timestamp: string;
  details?: Record<string, any>;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
  timestamp: string;
}

export const createApiClient = (baseURL: string = API_CONFIG.BASE_URL) => {
  const client = axios.create({
    baseURL,
    timeout: API_CONFIG.TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = localStorage.getItem('auth_token');
      if (token && config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor
  client.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config;
      
      if (error.response?.status === 401 && originalRequest && !(originalRequest as any)._retry) {
        (originalRequest as any)._retry = true;
        
        try {
          // Try to refresh token
          const refreshToken = localStorage.getItem('refresh_token');
          if (refreshToken) {
            const response = await axios.post(`${baseURL}/auth/refresh`, {
              refresh_token: refreshToken,
            });
            
            localStorage.setItem('auth_token', response.data.access_token);
            client.defaults.headers.common['Authorization'] = `Bearer ${response.data.access_token}`;
            
            return client(originalRequest);
          }
        } catch (refreshError) {
          // Refresh failed, redirect to login
          localStorage.removeItem('auth_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }
      
      return Promise.reject(error);
    }
  );

  return client;
};

export const handleApiError = (error: unknown): ApiError => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiError>;
    
    if (axiosError.response) {
      return {
        message: axiosError.response.data?.message || 'An error occurred',
        code: axiosError.response.data?.code || 'UNKNOWN_ERROR',
        status: axiosError.response.status,
        timestamp: new Date().toISOString(),
        details: axiosError.response.data?.details,
      };
    } else if (axiosError.request) {
      return {
        message: 'No response received from server',
        code: 'NETWORK_ERROR',
        status: 0,
        timestamp: new Date().toISOString(),
      };
    }
  }

  return {
    message: error instanceof Error ? error.message : 'An unknown error occurred',
    code: 'UNKNOWN_ERROR',
    status: 500,
    timestamp: new Date().toISOString(),
  };
};

export const retryRequest = async <T>(
  request: () => Promise<T>,
  maxRetries: number = API_CONFIG.RETRY_ATTEMPTS,
  delay: number = API_CONFIG.RETRY_DELAY
): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await request();
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff
      const waitTime = delay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw new Error('Max retries exceeded');
};

export const validateResponse = <T>(response: ApiResponse<T>): boolean => {
  if (!response || typeof response !== 'object') return false;
  if (response.status < 200 || response.status >= 300) return false;
  if (!response.data) return false;
  return true;
};