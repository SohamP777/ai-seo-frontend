import React, { useState } from 'react';
import { 
  CreditCard, 
  Calendar, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle, 
  XCircle,
  Download,
  MoreVertical,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Subscription, BillingHistoryItem } from '../../types/payment.types';
import { format } from 'date-fns';
import { usePayments } from '../../hooks/usePayments';

interface BillingStatusProps {
  subscription?: Subscription;
  billingHistory?: BillingHistoryItem[];
  onUpdatePayment?: () => void;
  onCancelSubscription?: () => void;
  onDownloadInvoice?: (invoiceId: string) => void;
}

const BillingStatus: React.FC<BillingStatusProps> = ({
  subscription,
  billingHistory = [],
  onUpdatePayment,
  onCancelSubscription,
  onDownloadInvoice
}) => {
  const [showHistory, setShowHistory] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const { cancelSubscription } = usePayments();

  const getStatusColor = (status: Subscription['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'past_due':
        return 'bg-yellow-100 text-yellow-800';
      case 'canceled':
        return 'bg-gray-100 text-gray-800';
      case 'incomplete':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: Subscription['status']) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-5 h-5" />;
      case 'past_due':
        return <AlertCircle className="w-5 h-5" />;
      case 'canceled':
        return <XCircle className="w-5 h-5" />;
      case 'incomplete':
        return <AlertCircle className="w-5 h-5" />;
      default:
        return <AlertCircle className="w-5 h-5" />;
    }
  };

  const handleCancelSubscription = async () => {
    if (!subscription || !window.confirm('Are you sure you want to cancel your subscription? You will lose access to premium features at the end of your billing period.')) {
      return;
    }

    setIsCanceling(true);
    try {
      await cancelSubscription();
      onCancelSubscription?.();
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
    } finally {
      setIsCanceling(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (!subscription) {
    return (
      <div className="bg-gray-50 rounded-xl p-6 text-center">
        <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-700 mb-2">No Active Subscription</h3>
        <p className="text-gray-500 mb-6">Subscribe to unlock premium features</p>
        <a
          href="/pricing"
          className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
        >
          View Plans
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Subscription Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-bold text-gray-900">{subscription.planName} Plan</h3>
              <span className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${getStatusColor(subscription.status)}`}>
                {getStatusIcon(subscription.status)}
                {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
              </span>
            </div>
            <p className="text-gray-600">
              {subscription.billingCycle === 'monthly' ? 'Monthly' : 'Annual'} billing
              {subscription.cancelAtPeriodEnd && ' • Cancels at period end'}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onUpdatePayment}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Update Payment
            </button>
            <button className="p-2 hover:bg-gray-100 rounded-lg">
              <MoreVertical className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Subscription Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-500 mb-1">Billing Period</div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="font-semibold">
                {formatDate(subscription.currentPeriodStart)} - {formatDate(subscription.currentPeriodEnd)}
              </span>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-500 mb-1">Websites</div>
            <div className="font-semibold text-lg">
              {subscription.features.websiteCount} included
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-500 mb-1">Next Billing</div>
            <div className="font-semibold text-lg">
              {formatDate(subscription.currentPeriodEnd)}
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-500 mb-1">Team Seats</div>
            <div className="font-semibold text-lg">
              {subscription.features.teamSeats || 1} included
            </div>
          </div>
        </div>

        {/* Features Summary */}
        <div className="mb-6">
          <h4 className="font-semibold text-gray-700 mb-3">Plan Features</h4>
          <div className="flex flex-wrap gap-2">
            {subscription.features.pageScanLimit && (
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                {subscription.features.pageScanLimit.toLocaleString()} pages/month
              </span>
            )}
            {subscription.features.oneClickFixLimit && (
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                {subscription.features.oneClickFixLimit === -1 ? 'Unlimited' : subscription.features.oneClickFixLimit.toLocaleString()} fixes/month
              </span>
            )}
            {subscription.features.apiAccess && (
              <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm">
                API Access
              </span>
            )}
            {subscription.features.whiteLabel && (
              <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm">
                White Label
              </span>
            )}
          </div>
        </div>

        {/* Cancel Subscription Button */}
        {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && (
          <button
            onClick={handleCancelSubscription}
            disabled={isCanceling}
            className="w-full py-3 px-4 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCanceling ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                Canceling...
              </div>
            ) : (
              'Cancel Subscription'
            )}
          </button>
        )}
      </div>

      {/* Billing History */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors rounded-xl"
        >
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-gray-500" />
            <h3 className="text-lg font-semibold text-gray-900">Billing History</h3>
            <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-sm">
              {billingHistory.length} records
            </span>
          </div>
          {showHistory ? (
            <ChevronUp className="w-5 h-5 text-gray-500" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-500" />
          )}
        </button>

        {showHistory && (
          <div className="px-6 pb-6">
            {billingHistory.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No billing history available</p>
            ) : (
              <div className="space-y-3">
                {billingHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div>
                      <div className="font-medium text-gray-900">{item.description}</div>
                      <div className="text-sm text-gray-500">{formatDate(item.date)}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-semibold text-gray-900">
                          {formatCurrency(item.amount)}
                        </div>
                        <div className="text-sm">
                          <span className={`
                            px-2 py-1 rounded-full
                            ${item.status === 'paid' ? 'bg-green-100 text-green-800' : ''}
                            ${item.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : ''}
                            ${item.status === 'failed' ? 'bg-red-100 text-red-800' : ''}
                          `}>
                            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                          </span>
                        </div>
                      </div>
                      {item.invoiceUrl && (
                        <button
                          onClick={() => onDownloadInvoice?.(item.id)}
                          className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                          title="Download Invoice"
                        >
                          <Download className="w-4 h-4 text-gray-500" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BillingStatus;