import React, { useState, useCallback } from 'react';
import { CreditCard, Shield, AlertCircle, CheckCircle } from 'lucide-react';
import { usePayments } from '../../hooks/usePayments';
import { CheckoutRequest } from '../../types/payment.types';

interface CheckoutButtonProps {
  planId: string;
  billingCycle: 'monthly' | 'annual';
  amount: number;
  className?: string;
  children?: React.ReactNode;
  onSuccess?: (paymentId: string) => void;
  onError?: (error: string) => void;
}

const CheckoutButton: React.FC<CheckoutButtonProps> = ({
  planId,
  billingCycle,
  amount,
  className = '',
  children,
  onSuccess,
  onError
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  
  const { initiateCheckout, isRazorpayLoaded } = usePayments();

  const handleCheckout = useCallback(async () => {
    if (!isRazorpayLoaded) {
      setError('Payment system is not ready. Please try again.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const checkoutRequest: CheckoutRequest = {
        planId,
        billingCycle,
        successUrl: `${window.location.origin}/dashboard?payment=success`,
        cancelUrl: `${window.location.origin}/pricing`
      };

      const paymentResult = await initiateCheckout(checkoutRequest);

      if (paymentResult.success) {
        setShowSuccess(true);
        onSuccess?.(paymentResult.paymentId);
        
        // Reset success state after 3 seconds
        setTimeout(() => setShowSuccess(false), 3000);
      } else {
        throw new Error(paymentResult.error || 'Payment failed');
      }
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to process payment';
      setError(errorMessage);
      onError?.(errorMessage);
      
      // Clear error after 5 seconds
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  }, [planId, billingCycle, initiateCheckout, isRazorpayLoaded, onSuccess, onError]);

  if (showSuccess) {
    return (
      <div className="flex items-center justify-center gap-2 text-green-600 bg-green-50 p-4 rounded-lg">
        <CheckCircle className="w-5 h-5" />
        <span className="font-semibold">Payment Successful!</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleCheckout}
        disabled={isLoading || !isRazorpayLoaded}
        className={`
          relative w-full py-4 px-6 rounded-xl font-semibold
          transition-all duration-300 transform hover:scale-[1.02]
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
          bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700
          text-white shadow-lg hover:shadow-xl
          ${className}
        `}
      >
        <div className="flex items-center justify-center gap-3">
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              {children || (
                <span>
                  Pay ${amount.toFixed(2)} Now
                </span>
              )}
              <Shield className="w-5 h-5" />
            </>
          )}
        </div>
        
        {/* Secure payment badge */}
        <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2">
          <div className="bg-gray-900 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1">
            <Shield className="w-3 h-3" />
            <span>100% Secure</span>
          </div>
        </div>
      </button>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Payment Methods */}
      <div className="text-center">
        <p className="text-xs text-gray-500 mb-2">We accept</p>
        <div className="flex items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-5 bg-blue-100 rounded flex items-center justify-center">
              <span className="text-xs font-bold text-blue-600">VISA</span>
            </div>
            <div className="w-8 h-5 bg-red-100 rounded flex items-center justify-center">
              <span className="text-xs font-bold text-red-600">MC</span>
            </div>
            <div className="w-8 h-5 bg-yellow-100 rounded flex items-center justify-center">
              <span className="text-xs font-bold text-yellow-600">PP</span>
            </div>
          </div>
          <span className="text-xs text-gray-400">and 100+ more</span>
        </div>
      </div>

      {/* Terms */}
      <p className="text-xs text-gray-500 text-center">
        By proceeding, you agree to our{' '}
        <a href="/terms" className="text-indigo-600 hover:underline">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="/privacy" className="text-indigo-600 hover:underline">
          Privacy Policy
        </a>
      </p>
    </div>
  );
};

export default CheckoutButton;