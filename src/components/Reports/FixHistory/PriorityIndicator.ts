import React from 'react';
import { AlertTriangle, AlertCircle, Info, Flag } from 'lucide-react';
import { FixPriority } from '@/types/fixer';

interface PriorityIndicatorProps {
  priority: FixPriority;
}

const PriorityIndicator: React.FC<PriorityIndicatorProps> = ({ priority }) => {
  const getPriorityConfig = () => {
    switch (priority) {
      case 'critical':
        return {
          icon: AlertTriangle,
          color: 'bg-red-100 text-red-800',
          border: 'border-red-200',
          label: 'Critical',
        };
      case 'high':
        return {
          icon: AlertCircle,
          color: 'bg-orange-100 text-orange-800',
          border: 'border-orange-200',
          label: 'High',
        };
      case 'medium':
        return {
          icon: Flag,
          color: 'bg-yellow-100 text-yellow-800',
          border: 'border-yellow-200',
          label: 'Medium',
        };
      case 'low':
        return {
          icon: Info,
          color: 'bg-blue-100 text-blue-800',
          border: 'border-blue-200',
          label: 'Low',
        };
    }
  };

  const config = getPriorityConfig();
  const Icon = config.icon;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border ${config.color} ${config.border}`}>
      <Icon className="w-4 h-4" />
      <span className="text-sm font-medium">{config.label}</span>
    </div>
  );
};

export default PriorityIndicator;