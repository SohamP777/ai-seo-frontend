import React from 'react';
import { TrendingUp, TrendingDown, Minus, Zap, Shield } from 'lucide-react';

interface ImpactAnalysisProps {
  impact: 'high' | 'medium' | 'low';
  scoreChange: number;
}

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ impact, scoreChange }) => {
  const getImpactConfig = () => {
    switch (impact) {
      case 'high':
        return {
          color: 'bg-red-100 text-red-800',
          icon: Zap,
          iconColor: 'text-red-600',
        };
      case 'medium':
        return {
          color: 'bg-yellow-100 text-yellow-800',
          icon: Shield,
          iconColor: 'text-yellow-600',
        };
      case 'low':
        return {
          color: 'bg-blue-100 text-blue-800',
          icon: Shield,
          iconColor: 'text-blue-600',
        };
    }
  };

  const config = getImpactConfig();
  const Icon = config.icon;

  return (
    <div className="flex items-center gap-3">
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${config.color}`}>
        <Icon className={`w-4 h-4 ${config.iconColor}`} />
        <span className="text-sm font-medium">{impact}</span>
      </div>
      
      <div className="flex items-center gap-1">
        {scoreChange > 0 ? (
          <TrendingUp className="w-4 h-4 text-green-500" />
        ) : scoreChange < 0 ? (
          <TrendingDown className="w-4 h-4 text-red-500" />
        ) : (
          <Minus className="w-4 h-4 text-gray-500" />
        )}
        <span className={`text-sm font-medium ${
          scoreChange > 0 ? 'text-green-600' : scoreChange < 0 ? 'text-red-600' : 'text-gray-600'
        }`}>
          {scoreChange > 0 ? '+' : ''}{scoreChange.toFixed(1)}
        </span>
      </div>
    </div>
  );
};

export default ImpactAnalysis;