// frontend/src/hooks/usePayments.ts
import { useState, useCallback, useEffect, useRef } from 'react';
import axios, { AxiosError } from 'axios';
import { useAuth, User } from './useAuth';
import { useNotification } from './useNotification';

// ================ TYPE DEFINITIONS ================

export type SubscriptionPlan = 'free' | 'basic' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type PaymentMethodType = 'card' | 'paypal' | 'bank_transfer';
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';

export interface SubscriptionTier {
  id: string;
  name: string;
  description: string;
  price: {
    monthly: number;
    annual: number;
    currency: string;
  };
  features: string[];
  limits: {
    maxWebsites: number;
    maxScansPerMonth: number;
    maxPagesPerScan: number;
    maxTeamMembers: number;
    retentionDays: number;
  };
  popular?: boolean;
  recommended?: boolean;
}

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  last4?: string;
  brand?: string;
  expMonth?: number;
  expYear?: number;
  name?: string;
  isDefault: boolean;
  created: Date;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  dueDate: Date;
  paidDate?: Date;
  pdfUrl?: string;
  items: InvoiceItem[];
  metadata?: Record<string, any>;
}

export interface InvoiceItem {
  id: string;
  description: string;
  amount: number;
  quantity: number;
  period?: {
    start: Date;
    end: Date;
  };
}

export interface Subscription {
  id: string;
  plan: SubscriptionPlan;
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  trialEnd?: Date;
  quantity: number;
  price: {
    amount: number;
    currency: string;
    interval: 'month' | 'year';
  };
  nextInvoice?: Invoice;
  paymentMethod?: PaymentMethod;
}

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  clientSecret?: string;
  nextAction?: {
    type: string;
    redirectUrl?: string;
  };
  metadata?: Record<string, any>;
}

export interface Coupon {
  id: string;
  code: string;
  name: string;
  percentOff?: number;
  amountOff?: number;
  duration: 'once' | 'repeating' | 'forever';
  durationInMonths?: number;
  valid: boolean;
  maxRedemptions?: number;
  timesRedeemed: number;
  redeemBy?: Date;
}

export interface BillingAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface TaxInfo {
  taxId?: string;
  vatNumber?: string;
  companyName?: string;
  companyAddress?: BillingAddress;
}

export interface UsageMetrics {
  scansThisMonth: number;
  websitesCount: number;
  pagesScanned: number;
  dataProcessed: number; // in MB
  nextBillingDate: Date;
  usagePercentages: {
    scans: number;
    websites: number;
    storage: number;
  };
}

export interface UpgradeEstimate {
  currentPlan: SubscriptionPlan;
  targetPlan: SubscriptionPlan;
  priceDifference: number;
  featureGains: string[];
  featureLosses: string[];
  recommended: boolean;
}

// ================ HOOK INTERFACE ================

export interface UsePaymentsReturn {
  // State
  subscription: Subscription | null;
  invoices: Invoice[];
  paymentMethods: PaymentMethod[];
  coupons: Coupon[];
  usage: UsageMetrics | null;
  isLoading: boolean;
  error: string | null;
  
  // Plans & Pricing
  plans: SubscriptionTier[];
  getPlanFeatures: (plan: SubscriptionPlan) => SubscriptionTier;
  calculateSavings: (plan: SubscriptionPlan, cycle: BillingCycle) => number;
  getUpgradeEstimate: (targetPlan: SubscriptionPlan) => UpgradeEstimate;
  
  // Subscription Management
  subscribe: (plan: SubscriptionPlan, cycle: BillingCycle, couponCode?: string) => Promise<PaymentIntent>;
  cancelSubscription: (reason: string) => Promise<boolean>;
  reactivateSubscription: () => Promise<boolean>;
  updateSubscription: (plan: SubscriptionPlan, cycle: BillingCycle) => Promise<boolean>;
  changeQuantity: (quantity: number) => Promise<boolean>;
  
  // Payment Methods
  addPaymentMethod: (paymentMethodData: any) => Promise<PaymentMethod>;
  removePaymentMethod: (paymentMethodId: string) => Promise<boolean>;
  setDefaultPaymentMethod: (paymentMethodId: string) => Promise<boolean>;
  updateBillingAddress: (address: BillingAddress) => Promise<boolean>;
  
  // Invoices & Billing
  getInvoices: (limit?: number) => Promise<Invoice[]>;
  downloadInvoice: (invoiceId: string) => Promise<string>;
  retryPayment: (invoiceId: string) => Promise<PaymentIntent>;
  applyCoupon: (couponCode: string) => Promise<Coupon>;
  removeCoupon: () => Promise<boolean>;
  
  // Usage & Limits
  getUsageMetrics: () => Promise<UsageMetrics>;
  checkLimitExceeded: (limitType: keyof UsageMetrics['usagePercentages']) => boolean;
  getRemainingScans: () => number;
  
  // Admin Functions
  applyCredit: (amount: number, reason: string) => Promise<boolean>;
  generateInvoice: (amount: number, description: string) => Promise<Invoice>;
  refundPayment: (paymentId: string, amount?: number) => Promise<boolean>;
  
  // UI Helpers
  formatPrice: (amount: number, currency: string) => string;
  getNextBillingDate: () => Date | null;
  isTrialActive: () => boolean;
  daysUntilRenewal: () => number;
}

// ================ CONSTANTS ================

const PLANS: Record<SubscriptionPlan, SubscriptionTier> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'For small projects and testing',
    price: { monthly: 0, annual: 0, currency: 'USD' },
    features: [
      '5 scans per month',
      '1 website',
      'Basic SEO analysis',
      'Email support',
      '7-day data retention',
    ],
    limits: {
      maxWebsites: 1,
      maxScansPerMonth: 5,
      maxPagesPerScan: 10,
      maxTeamMembers: 1,
      retentionDays: 7,
    },
  },
  basic: {
    id: 'basic',
    name: 'Basic',
    description: 'For growing websites',
    price: { monthly: 29, annual: 290, currency: 'USD' },
    features: [
      '100 scans per month',
      '5 websites',
      'Advanced SEO analysis',
      'Auto-fix for critical issues',
      'Priority email support',
      '30-day data retention',
      'Weekly reports',
    ],
    limits: {
      maxWebsites: 5,
      maxScansPerMonth: 100,
      maxPagesPerScan: 50,
      maxTeamMembers: 3,
      retentionDays: 30,
    },
  },
  pro: {
    id: 'pro',
    name: 'Professional',
    description: 'For serious SEO professionals',
    price: { monthly: 99, annual: 990, currency: 'USD' },
    features: [
      'Unlimited scans',
      '25 websites',
      'Comprehensive SEO analysis',
      'Auto-fix for all issues',
      'Phone & email support',
      '90-day data retention',
      'Daily reports',
      'Competitor analysis',
      'API access',
    ],
    limits: {
      maxWebsites: 25,
      maxScansPerMonth: -1, // Unlimited
      maxPagesPerScan: 200,
      maxTeamMembers: 10,
      retentionDays: 90,
    },
    popular: true,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large organizations',
    price: { monthly: 299, annual: 2990, currency: 'USD' },
    features: [
      'Unlimited everything',
      'White-label reports',
      'Custom integrations',
      'Dedicated account manager',
      '24/7 priority support',
      '1-year data retention',
      'Custom ML models',
      'SLA guarantee',
      'On-premise deployment',
    ],
    limits: {
      maxWebsites: -1, // Unlimited
      maxScansPerMonth: -1,
      maxPagesPerScan: -1,
      maxTeamMembers: -1,
      retentionDays: 365,
    },
    recommended: true,
  },
};

const ANNUAL_DISCOUNT_PERCENT = 16.67; // 2 months free

// ================ MAIN HOOK IMPLEMENTATION ================

export const usePayments = (): UsePaymentsReturn => {
  const { user, updateProfile } = useAuth();
  const { showSuccess, showError, showLoading } = useNotification();
  
  // State
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [usage, setUsage] = useState<UsageMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const loadingRef = useRef(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  
  // ================ INITIALIZATION ================
  
  const initialize = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Load all payment data in parallel
      const [subData, invData, pmData, couponData, usageData] = await Promise.all([
        fetchSubscription(),
        fetchInvoices(10),
        fetchPaymentMethods(),
        fetchCoupons(),
        fetchUsageMetrics(),
      ]);
      
      setSubscription(subData);
      setInvoices(invData);
      setPaymentMethods(pmData);
      setCoupons(couponData);
      setUsage(usageData);
      
      // Start polling for subscription updates if active
      if (subData?.status === 'active') {
        startPolling();
      }
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load payment data';
      setError(errorMessage);
      showError('Payment Error', errorMessage);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [showError]);
  
  // ================ SUBSCRIPTION POLLING ================
  
  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    
    pollingRef.current = setInterval(async () => {
      try {
        const updated = await fetchSubscription();
        setSubscription(updated);
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 60000); // Every minute
  }, []);
  
  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);
  
  // ================ PLANS & PRICING ================
  
  const getPlanFeatures = useCallback((plan: SubscriptionPlan): SubscriptionTier => {
    return PLANS[plan];
  }, []);
  
  const calculateSavings = useCallback((plan: SubscriptionPlan, cycle: BillingCycle): number => {
    if (plan === 'free' || cycle === 'monthly') return 0;
    
    const monthlyPrice = PLANS[plan].price.monthly;
    const annualPrice = PLANS[plan].price.annual;
    const monthlyTotal = monthlyPrice * 12;
    
    return monthlyTotal - annualPrice;
  }, []);
  
  const getUpgradeEstimate = useCallback((targetPlan: SubscriptionPlan): UpgradeEstimate => {
    const currentPlan = user?.subscription.plan || 'free';
    const currentFeatures = PLANS[currentPlan].features;
    const targetFeatures = PLANS[targetPlan].features;
    
    const featureGains = targetFeatures.filter(f => !currentFeatures.includes(f));
    const featureLosses = currentFeatures.filter(f => !targetFeatures.includes(f));
    
    const priceDifference = PLANS[targetPlan].price.monthly - PLANS[currentPlan].price.monthly;
    
    return {
      currentPlan,
      targetPlan,
      priceDifference,
      featureGains,
      featureLosses,
      recommended: targetPlan === 'pro',
    };
  }, [user]);
  
  // ================ SUBSCRIPTION MANAGEMENT ================
  
  const subscribe = useCallback(async (
    plan: SubscriptionPlan,
    cycle: BillingCycle,
    couponCode?: string
  ): Promise<PaymentIntent> => {
    setIsLoading(true);
    setError(null);
    
    const notificationId = showLoading(
      'Processing Subscription',
      `Setting up ${plan} plan...`
    );
    
    try {
      const amount = cycle === 'annual' 
        ? PLANS[plan].price.annual 
        : PLANS[plan].price.monthly;
      
      const response = await axios.post('/api/payments/subscribe', {
        plan,
        cycle,
        amount,
        couponCode,
        returnUrl: window.location.href,
      });
      
      const paymentIntent: PaymentIntent = response.data;
      
      // Handle 3D Secure if needed
      if (paymentIntent.nextAction?.type === 'redirect') {
        window.location.href = paymentIntent.nextAction.redirectUrl!;
      } else {
        // Update user subscription immediately
        await updateProfile({
          subscription: {
            plan,
            expiresAt: new Date(Date.now() + (cycle === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000),
            scansRemaining: PLANS[plan].limits.maxScansPerMonth,
          },
        } as Partial<User>);
        
        showSuccess('Subscription Activated', `You are now on the ${plan} plan!`);
        
        // Refresh payment data
        await initialize();
      }
      
      return paymentIntent;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Subscription failed';
      
      setError(errorMessage);
      showError('Subscription Failed', errorMessage);
      throw err;
      
    } finally {
      setIsLoading(false);
    }
  }, [showLoading, showSuccess, showError, updateProfile, initialize]);
  
  const cancelSubscription = useCallback(async (reason: string): Promise<boolean> => {
    if (!subscription) return false;
    
    setIsLoading(true);
    
    try {
      await axios.post('/api/payments/cancel', { reason });
      
      // Update local state
      setSubscription(prev => prev ? {
        ...prev,
        status: 'canceled',
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
      } : null);
      
      showSuccess('Subscription Cancelled', 'Your subscription will end at the current period');
      return true;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Cancellation failed';
      
      showError('Cancellation Failed', errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [subscription, showSuccess, showError]);
  
  const reactivateSubscription = useCallback(async (): Promise<boolean> => {
    if (!subscription || subscription.status !== 'canceled') return false;
    
    setIsLoading(true);
    
    try {
      await axios.post('/api/payments/reactivate');
      
      // Update local state
      setSubscription(prev => prev ? {
        ...prev,
        status: 'active',
        cancelAtPeriodEnd: false,
        canceledAt: undefined,
      } : null);
      
      showSuccess('Subscription Reactivated', 'Your subscription has been restored');
      return true;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Reactivation failed';
      
      showError('Reactivation Failed', errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [subscription, showSuccess, showError]);
  
  const updateSubscription = useCallback(async (
    plan: SubscriptionPlan,
    cycle: BillingCycle
  ): Promise<boolean> => {
    if (!subscription) return false;
    
    setIsLoading(true);
    
    try {
      await axios.put('/api/payments/subscription', { plan, cycle });
      
      // Update local state
      setSubscription(prev => prev ? {
        ...prev,
        plan,
        price: {
          ...prev.price,
          amount: cycle === 'annual' ? PLANS[plan].price.annual : PLANS[plan].price.monthly,
          interval: cycle === 'annual' ? 'year' : 'month',
        },
      } : null);
      
      showSuccess('Plan Updated', `You are now on the ${plan} plan`);
      return true;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Update failed';
      
      showError('Update Failed', errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [subscription, showSuccess, showError]);
  
  // ================ PAYMENT METHODS ================
  
  const addPaymentMethod = useCallback(async (paymentMethodData: any): Promise<PaymentMethod> => {
    setIsLoading(true);
    
    try {
      const response = await axios.post('/api/payments/methods', paymentMethodData);
      const newMethod: PaymentMethod = response.data;
      
      setPaymentMethods(prev => [...prev, newMethod]);
      
      showSuccess('Payment Method Added', 'Your payment method has been saved');
      return newMethod;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Failed to add payment method';
      
      showError('Add Failed', errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [showSuccess, showError]);
  
  const removePaymentMethod = useCallback(async (paymentMethodId: string): Promise<boolean> => {
    if (paymentMethods.find(pm => pm.id === paymentMethodId && pm.isDefault)) {
      showError('Cannot Remove', 'Cannot remove default payment method');
      return false;
    }
    
    setIsLoading(true);
    
    try {
      await axios.delete(`/api/payments/methods/${paymentMethodId}`);
      
      setPaymentMethods(prev => prev.filter(pm => pm.id !== paymentMethodId));
      
      showSuccess('Payment Method Removed', 'The payment method has been removed');
      return true;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Failed to remove payment method';
      
      showError('Remove Failed', errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [paymentMethods, showSuccess, showError]);
  
  // ================ INVOICES & BILLING ================
  
  const getInvoices = useCallback(async (limit: number = 10): Promise<Invoice[]> => {
    setIsLoading(true);
    
    try {
      const response = await axios.get('/api/payments/invoices', { params: { limit } });
      const invoices: Invoice[] = response.data;
      
      setInvoices(invoices);
      return invoices;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Failed to fetch invoices';
      
      showError('Fetch Failed', errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [showError]);
  
  const downloadInvoice = useCallback(async (invoiceId: string): Promise<string> => {
    setIsLoading(true);
    
    try {
      const response = await axios.get(`/api/payments/invoices/${invoiceId}/download`);
      
      showSuccess('Invoice Downloaded', 'The invoice has been downloaded');
      return response.data.url;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Failed to download invoice';
      
      showError('Download Failed', errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [showSuccess, showError]);
  
  // ================ USAGE & LIMITS ================
  
  const getUsageMetrics = useCallback(async (): Promise<UsageMetrics> => {
    try {
      const response = await axios.get('/api/payments/usage');
      const metrics: UsageMetrics = response.data;
      
      setUsage(metrics);
      return metrics;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Failed to fetch usage';
      
      showError('Usage Fetch Failed', errorMessage);
      throw err;
    }
  }, [showError]);
  
  const checkLimitExceeded = useCallback((limitType: keyof UsageMetrics['usagePercentages']): boolean => {
    if (!usage) return false;
    return usage.usagePercentages[limitType] >= 90;
  }, [usage]);
  
  const getRemainingScans = useCallback((): number => {
    if (!user || !usage) return 0;
    
    const planLimit = PLANS[user.subscription.plan].limits.maxScansPerMonth;
    if (planLimit === -1) return Infinity;
    
    return Math.max(0, planLimit - usage.scansThisMonth);
  }, [user, usage]);
  
  // ================ UI HELPERS ================
  
  const formatPrice = useCallback((amount: number, currency: string): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount / 100); // Convert from cents
  }, []);
  
  const getNextBillingDate = useCallback((): Date | null => {
    return subscription?.currentPeriodEnd || null;
  }, [subscription]);
  
  const isTrialActive = useCallback((): boolean => {
    if (!subscription?.trialEnd) return false;
    return new Date(subscription.trialEnd) > new Date();
  }, [subscription]);
  
  const daysUntilRenewal = useCallback((): number => {
    if (!subscription?.currentPeriodEnd) return 0;
    
    const now = new Date();
    const renewal = new Date(subscription.currentPeriodEnd);
    const diffTime = renewal.getTime() - now.getTime();
    
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }, [subscription]);
  
  // ================ ADMIN FUNCTIONS ================
  
  const applyCredit = useCallback(async (amount: number, reason: string): Promise<boolean> => {
    setIsLoading(true);
    
    try {
      await axios.post('/api/payments/credits', { amount, reason });
      
      showSuccess('Credit Applied', `${formatPrice(amount, 'USD')} credit has been applied`);
      return true;
      
    } catch (err) {
      const error = err as AxiosError;
      const errorMessage = error.response?.data?.message || 'Failed to apply credit';
      
      showError('Credit Failed', errorMessage);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [formatPrice, showSuccess, showError]);
  
  // ================ INITIAL LOAD & CLEANUP ================
  
  useEffect(() => {
    initialize();
    
    return () => {
      stopPolling();
    };
  }, [initialize, stopPolling]);
  
  // ================ RETURN OBJECT ================
  
  return {
    // State
    subscription,
    invoices,
    paymentMethods,
    coupons,
    usage,
    isLoading,
    error,
    
    // Plans
    plans: Object.values(PLANS),
    getPlanFeatures,
    calculateSavings,
    getUpgradeEstimate,
    
    // Subscription
    subscribe,
    cancelSubscription,
    reactivateSubscription,
    updateSubscription,
    changeQuantity: async () => true, // Implement as needed
    
    // Payment Methods
    addPaymentMethod,
    removePaymentMethod,
    setDefaultPaymentMethod: async () => true, // Implement as needed
    updateBillingAddress: async () => true, // Implement as needed
    
    // Invoices
    getInvoices,
    downloadInvoice,
    retryPayment: async () => ({ id: '', amount: 0, currency: 'USD', status: 'pending' }), // Implement
    applyCoupon: async () => ({ 
      id: '', code: '', name: '', duration: 'once', valid: true, timesRedeemed: 0 
    }), // Implement
    removeCoupon: async () => true, // Implement
    
    // Usage
    getUsageMetrics,
    checkLimitExceeded,
    getRemainingScans,
    
    // Admin
    applyCredit,
    generateInvoice: async () => ({ 
      id: '', number: '', status: 'draft', amount: 0, currency: 'USD', 
      dueDate: new Date(), items: [] 
    }), // Implement
    refundPayment: async () => true, // Implement
    
    // UI Helpers
    formatPrice,
    getNextBillingDate,
    isTrialActive,
    daysUntilRenewal,
  };
};

// ================ API MOCK FUNCTIONS ================

const fetchSubscription = async (): Promise<Subscription | null> => {
  // Mock implementation - replace with actual API call
  return {
    id: 'sub_123',
    plan: 'pro',
    status: 'active',
    currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
    quantity: 1,
    price: {
      amount: 9900, // in cents
      currency: 'USD',
      interval: 'month',
    },
  };
};

const fetchInvoices = async (limit: number): Promise<Invoice[]> => {
  // Mock implementation
  return Array.from({ length: limit }, (_, i) => ({
    id: `inv_${i}`,
    number: `INV-2023-${1000 + i}`,
    status: 'paid' as InvoiceStatus,
    amount: 9900,
    currency: 'USD',
    dueDate: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000),
    paidDate: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000),
    pdfUrl: `https://example.com/invoices/${i}`,
    items: [{
      id: `item_${i}`,
      description: 'SEO Pro Monthly Subscription',
      amount: 9900,
      quantity: 1,
    }],
  }));
};

const fetchPaymentMethods = async (): Promise<PaymentMethod[]> => {
  // Mock implementation
  return [{
    id: 'pm_123',
    type: 'card',
    last4: '4242',
    brand: 'visa',
    expMonth: 12,
    expYear: 2025,
    name: 'John Doe',
    isDefault: true,
    created: new Date(),
  }];
};

const fetchCoupons = async (): Promise<Coupon[]> => {
  // Mock implementation
  return [{
    id: 'coupon_123',
    code: 'WELCOME20',
    name: 'Welcome Discount',
    percentOff: 20,
    duration: 'once',
    valid: true,
    timesRedeemed: 0,
  }];
};

const fetchUsageMetrics = async (): Promise<UsageMetrics> => {
  // Mock implementation
  return {
    scansThisMonth: 42,
    websitesCount: 3,
    pagesScanned: 1250,
    dataProcessed: 245,
    nextBillingDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    usagePercentages: {
      scans: 42,
      websites: 60,
      storage: 12,
    },
  };
};

// ================ EXPORT ================

export default usePayments;