import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';

// Types for payments
export interface PaymentIntentRequest {
  amount: number;
  currency: string;
  planId: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export interface PaymentIntentResponse {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'canceled';
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: 'month' | 'year';
  features: string[];
  popular: boolean;
  maxScans: number;
  maxWebsites: number;
  includesReports: boolean;
  includesAutoFix: boolean;
  includesPrioritySupport: boolean;
}

export interface Subscription {
  id: string;
  planId: string;
  planName: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  price: number;
  currency: string;
  paymentMethod?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

export interface Invoice {
  id: string;
  number: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: 'paid' | 'open' | 'void';
  pdfUrl: string;
  date: string;
  periodStart: string;
  periodEnd: string;
}

export interface BillingInfo {
  customerId: string;
  email: string;
  name?: string;
  phone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Payments service for handling billing, subscriptions, and payments
 */
class PaymentsService {
  private api: AxiosInstance;
  private readonly BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://api.seo-automation.com/v1';

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
        const token = localStorage.getItem('auth_token');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.api.interceptors.response.use(
      (response: AxiosResponse<ApiResponse<any>>) => {
        if (response.data && response.data.success === false) {
          throw new Error(response.data.message || 'Payment request failed');
        }
        return response;
      },
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
          window.location.href = '/login';
        }
        return Promise.reject(this.handlePaymentError(error));
      }
    );
  }

  /**
   * Handle payment-specific errors
   */
  private handlePaymentError(error: AxiosError): Error {
    if (error.response) {
      const apiError = error.response.data as { message?: string; code?: string };
      
      // Map common payment errors to user-friendly messages
      const errorMessages: Record<string, string> = {
        'card_declined': 'Your card was declined. Please try a different card.',
        'expired_card': 'Your card has expired. Please update your card information.',
        'insufficient_funds': 'Insufficient funds. Please try a different card or contact your bank.',
        'invalid_number': 'Invalid card number. Please check your card details.',
        'invalid_expiry_month': 'Invalid expiration month.',
        'invalid_expiry_year': 'Invalid expiration year.',
        'invalid_cvc': 'Invalid security code.',
        'processing_error': 'An error occurred while processing your payment. Please try again.',
        'authentication_required': 'Additional authentication is required. Please try again.',
      };

      const errorCode = apiError.code || '';
      const message = errorMessages[errorCode] || apiError.message || 'Payment processing failed';
      
      return new Error(message);
    } else if (error.request) {
      return new Error('No response from payment server. Please check your connection.');
    } else {
      return new Error(`Payment setup error: ${error.message}`);
    }
  }

  /**
   * Get available subscription plans
   */
  async getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
    try {
      const response = await this.api.get<ApiResponse<SubscriptionPlan[]>>('/payments/plans');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get subscription plans:', error);
      return this.getDefaultPlans();
    }
  }

  /**
   * Create a payment intent
   */
  async createPaymentIntent(data: PaymentIntentRequest): Promise<PaymentIntentResponse> {
    try {
      const response = await this.api.post<ApiResponse<PaymentIntentResponse>>(
        '/payments/create-intent',
        data
      );
      return response.data.data;
    } catch (error) {
      console.error('Failed to create payment intent:', error);
      throw error;
    }
  }

  /**
   * Confirm a payment intent
   */
  async confirmPayment(paymentIntentId: string): Promise<{ success: boolean; subscriptionId?: string }> {
    try {
      const response = await this.api.post<ApiResponse<any>>(
        `/payments/${paymentIntentId}/confirm`
      );
      return response.data.data;
    } catch (error) {
      console.error('Failed to confirm payment:', error);
      throw error;
    }
  }

  /**
   * Get current subscription
   */
  async getCurrentSubscription(): Promise<Subscription | null> {
    try {
      const response = await this.api.get<ApiResponse<Subscription>>('/payments/subscription');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get subscription:', error);
      return null;
    }
  }

  /**
   * Subscribe to a plan
   */
  async subscribeToPlan(planId: string, paymentMethodId?: string): Promise<Subscription> {
    try {
      const response = await this.api.post<ApiResponse<Subscription>>('/payments/subscribe', {
        planId,
        paymentMethodId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to subscribe to plan:', error);
      throw error;
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(cancelImmediately: boolean = false): Promise<{ canceled: boolean; endsAt: string }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/payments/cancel-subscription', {
        cancelImmediately,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
      throw error;
    }
  }

  /**
   * Update subscription plan
   */
  async updateSubscription(planId: string): Promise<Subscription> {
    try {
      const response = await this.api.put<ApiResponse<Subscription>>('/payments/subscription', {
        planId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to update subscription:', error);
      throw error;
    }
  }

  /**
   * Get billing information
   */
  async getBillingInfo(): Promise<BillingInfo> {
    try {
      const response = await this.api.get<ApiResponse<BillingInfo>>('/payments/billing-info');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get billing info:', error);
      throw error;
    }
  }

  /**
   * Update billing information
   */
  async updateBillingInfo(info: Partial<BillingInfo>): Promise<BillingInfo> {
    try {
      const response = await this.api.put<ApiResponse<BillingInfo>>('/payments/billing-info', info);
      return response.data.data;
    } catch (error) {
      console.error('Failed to update billing info:', error);
      throw error;
    }
  }

  /**
   * Get payment history/invoices
   */
  async getPaymentHistory(limit: number = 20, offset: number = 0): Promise<Invoice[]> {
    try {
      const response = await this.api.get<ApiResponse<Invoice[]>>('/payments/invoices', {
        params: { limit, offset },
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to get payment history:', error);
      return [];
    }
  }

  /**
   * Download invoice PDF
   */
  async downloadInvoice(invoiceId: string): Promise<Blob> {
    try {
      const response = await this.api.get(`/payments/invoices/${invoiceId}/download`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      console.error(`Failed to download invoice ${invoiceId}:`, error);
      throw error;
    }
  }

  /**
   * Add payment method
   */
  async addPaymentMethod(paymentMethodId: string): Promise<{ success: boolean; isDefault: boolean }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/payments/payment-methods', {
        paymentMethodId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to add payment method:', error);
      throw error;
    }
  }

  /**
   * Get payment methods
   */
  async getPaymentMethods(): Promise<Array<{
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    isDefault: boolean;
  }>> {
    try {
      const response = await this.api.get<ApiResponse<any[]>>('/payments/payment-methods');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get payment methods:', error);
      return [];
    }
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(paymentMethodId: string): Promise<{ success: boolean }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/payments/set-default-payment', {
        paymentMethodId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to set default payment method:', error);
      throw error;
    }
  }

  /**
   * Remove payment method
   */
  async removePaymentMethod(paymentMethodId: string): Promise<{ success: boolean }> {
    try {
      const response = await this.api.delete<ApiResponse<any>>(`/payments/payment-methods/${paymentMethodId}`);
      return response.data.data;
    } catch (error) {
      console.error('Failed to remove payment method:', error);
      throw error;
    }
  }

  /**
   * Apply coupon code
   */
  async applyCoupon(couponCode: string): Promise<{ 
    success: boolean; 
    discountAmount?: number;
    couponName?: string;
    expiresAt?: string;
  }> {
    try {
      const response = await this.api.post<ApiResponse<any>>('/payments/apply-coupon', {
        couponCode,
      });
      return response.data.data;
    } catch (error) {
      console.error('Failed to apply coupon:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics for current billing period
   */
  async getUsageStats(): Promise<{
    scansUsed: number;
    scansLimit: number;
    websitesUsed: number;
    websitesLimit: number;
    periodStart: string;
    periodEnd: string;
  }> {
    try {
      const response = await this.api.get<ApiResponse<any>>('/payments/usage');
      return response.data.data;
    } catch (error) {
      console.error('Failed to get usage stats:', error);
      return {
        scansUsed: 0,
        scansLimit: 10,
        websitesUsed: 1,
        websitesLimit: 1,
        periodStart: new Date().toISOString(),
        periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
  }

  /**
   * Check if feature is available in current plan
   */
  checkFeatureAccess(feature: keyof SubscriptionPlan): boolean {
    // This would typically check against current subscription
    // For now, return true for basic features
    const basicFeatures = ['maxScans', 'maxWebsites', 'includesReports'];
    return basicFeatures.includes(feature);
  }

  /**
   * Get default plans (fallback)
   */
  private getDefaultPlans(): SubscriptionPlan[] {
    return [
      {
        id: 'free',
        name: 'Free',
        description: 'Basic SEO scanning for small websites',
        price: 0,
        currency: 'USD',
        interval: 'month',
        features: [
          '10 scans per month',
          '1 website',
          'Basic SEO reports',
          'Community support',
        ],
        popular: false,
        maxScans: 10,
        maxWebsites: 1,
        includesReports: true,
        includesAutoFix: false,
        includesPrioritySupport: false,
      },
      {
        id: 'pro',
        name: 'Professional',
        description: 'Advanced SEO automation for growing businesses',
        price: 49,
        currency: 'USD',
        interval: 'month',
        features: [
          'Unlimited scans',
          '5 websites',
          'Advanced reports',
          'Auto-fix capabilities',
          'Priority support',
          'Weekly automated scans',
        ],
        popular: true,
        maxScans: 9999,
        maxWebsites: 5,
        includesReports: true,
        includesAutoFix: true,
        includesPrioritySupport: true,
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        description: 'Full-featured SEO suite for large organizations',
        price: 199,
        currency: 'USD',
        interval: 'month',
        features: [
          'Unlimited everything',
          '50 websites',
          'Enterprise reports',
          'Advanced auto-fix',
          '24/7 priority support',
          'Custom integrations',
          'Dedicated account manager',
        ],
        popular: false,
        maxScans: 99999,
        maxWebsites: 50,
        includesReports: true,
        includesAutoFix: true,
        includesPrioritySupport: true,
      },
    ];
  }

  /**
   * Format currency for display
   */
  formatCurrency(amount: number, currency: string = 'USD'): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Calculate price with tax
   */
  calculatePriceWithTax(amount: number, taxRate: number = 0.0): number {
    return amount * (1 + taxRate);
  }

  /**
   * Check if subscription is active
   */
  isSubscriptionActive(subscription: Subscription | null): boolean {
    if (!subscription) return false;
    return subscription.status === 'active' || subscription.status === 'trialing';
  }
}

// Export singleton instance
export const paymentsService = new PaymentsService();
export default paymentsService;