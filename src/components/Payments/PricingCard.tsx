import React, { useState } from 'react';
import { Check, X, Star, Zap, Shield, Globe, BarChart, Users, Clock, FileText } from 'lucide-react';
import { PricingPlan } from '../../types/payment.types';
import { PRICING_PLANS } from '../../utils/paymentConstants';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { usePayments } from '../../hooks/usePayments';

interface PricingCardProps {
  plan: PricingPlan;
  currentPlan?: string;
  onSelectPlan?: (planId: string, billingCycle: 'monthly' | 'annual') => void;
}

const PricingCard: React.FC<PricingCardProps> = ({ 
  plan, 
  currentPlan,
  onSelectPlan 
}) => {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { initiateCheckout } = usePayments();

  const price = billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice;
  const savings = billingCycle === 'annual' ? 
    ((plan.monthlyPrice * 12) - (plan.annualPrice * 12)) : 0;

  const getFeatureIcon = (featureId: string) => {
    switch (featureId) {
      case 'website':
        return <Globe className="w-4 h-4" />;
      case 'scan':
        return <Zap className="w-4 h-4" />;
      case 'fix':
        return <Shield className="w-4 h-4" />;
      case 'automation':
        return <BarChart className="w-4 h-4" />;
      case 'team':
        return <Users className="w-4 h-4" />;
      case 'retention':
        return <Clock className="w-4 h-4" />;
      case 'reports':
        return <FileText className="w-4 h-4" />;
      default:
        return <Check className="w-4 h-4" />;
    }
  };

  const handlePlanSelect = async () => {
    if (!isAuthenticated) {
      navigate('/auth/login', { state: { returnTo: '/pricing' } });
      return;
    }

    if (currentPlan === plan.id) {
      navigate('/dashboard');
      return;
    }

    setIsLoading(true);
    try {
      if (onSelectPlan) {
        onSelectPlan(plan.id, billingCycle);
      } else {
        await initiateCheckout({
          planId: plan.id,
          billingCycle,
          successUrl: `${window.location.origin}/dashboard?payment=success`,
          cancelUrl: `${window.location.origin}/pricing`
        });
      }
    } catch (error) {
      console.error('Failed to initiate checkout:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const isCurrentPlan = currentPlan === plan.id;

  return (
    <div className={`
      relative rounded-2xl p-8 shadow-xl transition-all duration-300
      hover:shadow-2xl hover:-translate-y-1
      ${plan.colorScheme.primary}
      ${plan.popular ? 'ring-2 ring-purple-300' : ''}
      ${isCurrentPlan ? 'ring-2 ring-green-500' : ''}
    `}>
      {/* Popular Badge */}
      {plan.popular && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-1 rounded-full flex items-center gap-1 shadow-lg">
            <Star className="w-4 h-4 fill-yellow-300" />
            <span className="text-sm font-semibold">Most Popular</span>
          </div>
        </div>
      )}

      {/* Current Plan Badge */}
      {isCurrentPlan && (
        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
          <div className="bg-green-600 text-white px-4 py-1 rounded-full flex items-center gap-1 shadow-lg">
            <Check className="w-4 h-4" />
            <span className="text-sm font-semibold">Current Plan</span>
          </div>
        </div>
      )}

      <div className="text-center mb-8">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h3>
        <p className="text-gray-600 mb-6">{plan.description}</p>
        
        {/* Price Display */}
        <div className="mb-4">
          <div className="flex items-center justify-center gap-2">
            <span className="text-5xl font-bold text-gray-900">
              ${price.toFixed(2)}
            </span>
            <span className="text-gray-600">/month</span>
          </div>
          {billingCycle === 'annual' && (
            <div className="text-sm text-green-600 font-semibold mt-2">
              Save ${savings.toFixed(2)} annually (20% off)
            </div>
          )}
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              billingCycle === 'monthly'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle('annual')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              billingCycle === 'annual'
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Annual (Save 20%)
          </button>
        </div>
      </div>

      {/* Features List */}
      <div className="space-y-4 mb-8">
        {plan.features.map((feature) => (
          <div key={feature.id} className="flex items-start gap-3">
            <div className={`
              flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center
              ${feature.included ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}
            `}>
              {feature.included ? (
                <Check className="w-4 h-4" />
              ) : (
                <X className="w-4 h-4" />
              )}
            </div>
            <span className={`text-sm ${feature.included ? 'text-gray-700' : 'text-gray-400'}`}>
              {feature.text}
            </span>
          </div>
        ))}
      </div>

      {/* CTA Button */}
      <button
        onClick={handlePlanSelect}
        disabled={isLoading || isCurrentPlan}
        className={`
          w-full py-3 px-6 rounded-lg font-semibold text-white
          transition-all duration-300 transform hover:scale-[1.02]
          disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
          ${plan.colorScheme.secondary}
          ${isCurrentPlan ? 'bg-gray-600 hover:bg-gray-700' : ''}
        `}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Processing...
          </div>
        ) : isCurrentPlan ? (
          'Current Plan'
        ) : isAuthenticated ? (
          plan.ctaText
        ) : (
          'Sign Up to Get Started'
        )}
      </button>

      {/* Additional Info */}
      <div className="mt-6 text-center text-sm text-gray-500">
        {billingCycle === 'annual' ? (
          <p>Billed annually at ${(plan.annualPrice * 12).toFixed(2)}</p>
        ) : (
          <p>Billed monthly, cancel anytime</p>
        )}
        {plan.websiteCount === 1 ? (
          <p>Includes {plan.websiteCount} website</p>
        ) : (
          <p>Includes {plan.websiteCount} websites</p>
        )}
      </div>
    </div>
  );
};

export default PricingCard;