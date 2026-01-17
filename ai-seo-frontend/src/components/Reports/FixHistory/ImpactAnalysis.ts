import React from 'react';
import { TrendingUp, TrendingDown, Minus, Zap, Shield } from 'lucide-react';

interface ImpactAnalysisProps {
  impact: 'high' | 'medium' | 'low';
  scoreChange: number;
}

const ImpactAnalysis: React.FC<ImpactAnalysisProps> = ({ impact, scoreChange = 0 }) => {
  const getImpactConfig = () => {
    const configs = {
      high: { color: 'bg-red-100 text-red-800', icon: Zap, iconColor: 'text-red-600' },
      medium: { color: 'bg-yellow-100 text-yellow-800', icon: Shield, iconColor: 'text-yellow-600' },
      low: { color: 'bg-blue-100 text-blue-800', icon: Shield, iconColor: 'text-blue-600' },
    };
    return configs[impact] || configs.medium;
  };

  const config = getImpactConfig();
  const Icon = config.icon;
  const isPositive = scoreChange > 0;
  const isNegative = scoreChange < 0;

  return (
    <div className="flex items-center gap-3">
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${config.color}`}>
        <Icon className={`w-4 h-4 ${config.iconColor}`} />
        <span className="text-sm font-medium capitalize">{impact}</span>
      </div>
      
      <div className="flex items-center gap-1">
        {isPositive && <TrendingUp className="w-4 h-4 text-green-500" />}
        {isNegative && <TrendingDown className="w-4 h-4 text-red-500" />}
        {!isPositive && !isNegative && <Minus className="w-4 h-4 text-gray-500" />}
        <span className={`text-sm font-medium ${
          isPositive ? 'text-green-600' : isNegative ? 'text-red-600' : 'text-gray-600'
        }`}>
          {isPositive ? '+' : ''}{scoreChange.toFixed(1)}
        </span>
      </div>
    </div>
  );
};

export default ImpactAnalysis;
