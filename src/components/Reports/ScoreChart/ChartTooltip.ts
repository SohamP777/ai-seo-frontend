import React from 'react';
import { format } from 'date-fns';
import {
  Target,
  Zap,
  Shield,
  TrendingUp,
  AlertTriangle,
  Eye,
  Clock,
} from 'lucide-react';

interface ChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  period: string;
}

const ChartTooltip: React.FC<ChartTooltipProps> = ({ active, payload, label, period }) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  const data = payload[0].payload;
  const date = new Date(label || data.timestamp);

  const getMetricIcon = (dataKey: string) => {
    const icons = {
      overallScore: Target,
      performanceScore: Zap,
      accessibilityScore: Shield,
      bestPracticesScore: Shield,
      seoScore: Target,
      issuesFixed: TrendingUp,
      newIssues: AlertTriangle,
      pageViews: Eye,
      conversionRate: TrendingUp,
      responseTime: Clock,
    };
    
    return icons[dataKey as keyof typeof icons] || Target;
  };

  const getMetricColor = (dataKey: string) => {
    const colors = {
      overallScore: '#3b82f6',
      performanceScore: '#10b981',
      accessibilityScore: '#8b5cf6',
      bestPracticesScore: '#f59e0b',
      seoScore: '#ef4444',
      issuesFixed: '#06b6d4',
      newIssues: '#f97316',
      pageViews: '#8b5cf6',
      conversionRate: '#10b981',
      responseTime: '#6366f1',
    };
    
    return colors[dataKey as keyof typeof colors] || '#6b7280';
  };

  return (
    <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-4 min-w-[300px]">
      <div className="mb-3 pb-3 border-b border-gray-200">
        <div className="font-semibold text-gray-900">
          {format(date, period === '7d' ? 'MMM dd, yyyy HH:mm' : 'MMM dd, yyyy')}
        </div>
        {data.anomaly && (
          <div className="inline-flex items-center gap-1 px-2 py-1 mt-1 bg-red-100 text-red-800 text-xs font-medium rounded">
            <AlertTriangle className="w-3 h-3" />
            Anomaly Detected
          </div>
        )}
      </div>
      
      <div className="space-y-2">
        {payload.map((entry, index) => {
          const Icon = getMetricIcon(entry.dataKey);
          const color = getMetricColor(entry.dataKey);
          
          return (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: color }}
                />
                <Icon className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">
                  {entry.dataKey.replace(/([A-Z])/g, ' $1').trim()}
                </span>
              </div>
              <div className="text-sm font-bold text-gray-900">
                {typeof entry.value === 'number' 
                  ? entry.dataKey.includes('Rate') || entry.dataKey.includes('Score')
                    ? entry.value.toFixed(1)
                    : Math.round(entry.value)
                  : entry.value}
                {entry.dataKey.includes('Score') && '%'}
                {entry.dataKey.includes('Rate') && '%'}
                {entry.dataKey === 'responseTime' && 'ms'}
              </div>
            </div>
          );
        })}
      </div>
      
      {data.notes && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="text-xs text-gray-600">{data.notes}</div>
        </div>
      )}
    </div>
  );
};

export default ChartTooltip;