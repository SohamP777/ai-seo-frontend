import React from 'react';
import { CheckCircle, XCircle, Clock, AlertCircle, RefreshCw, Pause } from 'lucide-react';
import { FixStatus } from '@/types/fixer';

interface FixStatusBadgeProps {
  status: FixStatus;
  progress?: number;
  retryCount?: number;
}

const FixStatusBadge: React.FC<FixStatusBadgeProps> = ({ status, progress, retryCount }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'completed':
        return {
          icon: CheckCircle,
          color: 'bg-green-100 text-green-800 border-green-200',
          iconColor: 'text-green-600',
          label: 'Completed',
        };
      case 'failed':
        return {
          icon: XCircle,
          color: 'bg-red-100 text-red-800 border-red-200',
          iconColor: 'text-red-600',
          label: `Failed${retryCount ? ` (${retryCount})` : ''}`,
        };
      case 'pending':
        return {
          icon: Clock,
          color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
          iconColor: 'text-yellow-600',
          label: 'Pending',
        };
      case 'in_progress':
        return {
          icon: RefreshCw,
          color: 'bg-blue-100 text-blue-800 border-blue-200',
          iconColor: 'text-blue-600',
          label: progress ? `In Progress (${progress}%)` : 'In Progress',
        };
      case 'cancelled':
        return {
          icon: Pause,
          color: 'bg-gray-100 text-gray-800 border-gray-200',
          iconColor: 'text-gray-600',
          label: 'Cancelled',
        };
      default:
        return {
          icon: AlertCircle,
          color: 'bg-gray-100 text-gray-800 border-gray-200',
          iconColor: 'text-gray-600',
          label: status,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${config.color}`}>
      <Icon className={`w-4 h-4 ${config.iconColor}`} />
      <span className="text-sm font-medium">{config.label}</span>
      {status === 'in_progress' && progress && (
        <div className="w-16 bg-gray-200 rounded-full h-1.5">
          <div
            className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default FixStatusBadge;