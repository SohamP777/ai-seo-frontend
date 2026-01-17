import React from 'react';
import { TrendingUp, TrendingDown, Target, Award, Users } from 'lucide-react';

interface BenchmarkData {
  industryAverage: number;
  topPerformer: number;
  yourPercentile: number;
  competitiveGap: number;
  improvementOpportunity: number;
  benchmarks?: Array<{
    metric: string;
    yourValue: number;
    industryAvg: number;
    topValue: number;
    gap: number;
  }>;
}

interface BenchmarkIndicatorProps {
  currentScore: number;
  benchmarks: BenchmarkData;
  period: string;
}

const BenchmarkIndicator: React.FC<BenchmarkIndicatorProps> = ({
  currentScore,
  benchmarks,
  period,
}) => {
  const getPercentileColor = (percentile: number) => {
    if (percentile >= 90) return 'text-green-600';
    if (percentile >= 75) return 'text-blue-600';
    if (percentile >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPercentileLabel = (percentile: number) => {
    if (percentile >= 90) return 'Excellent';
    if (percentile >= 75) return 'Good';
    if (percentile >= 50) return 'Average';
    return 'Needs Improvement';
  };

  // Calculate safe widths for progress bars
  const yourScoreWidth = Math.min(100, Math.max(0, (currentScore / 100) * 100));
  const industryAverageWidth = Math.min(100, Math.max(0, (benchmarks.industryAverage / 100) * 100));
  const topPerformerWidth = Math.min(100, Math.max(0, (benchmarks.topPerformer / 100) * 100));

  return (
    <div className="bg-gradient-to-r from-gray-50 to-blue-50 rounded-xl border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Target className="w-5 h-5 text-blue-600" />
        Performance Benchmarks
        <span className="text-sm font-normal text-gray-600">
          ({period} comparison)
        </span>
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-gray-500" />
            <div className="text-sm text-gray-600">Industry Percentile</div>
          </div>
          <div className={`text-2xl font-bold ${getPercentileColor(benchmarks.yourPercentile)}`}>
            {benchmarks.yourPercentile.toFixed(0)}th
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {getPercentileLabel(benchmarks.yourPercentile)}
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <Award className="w-4 h-4 text-yellow-500" />
            <div className="text-sm text-gray-600">Competitive Gap</div>
          </div>
          <div className={`text-2xl font-bold ${
            benchmarks.competitiveGap >= 0 ? 'text-green-600' : 'text-red-600'
          }`}>
            {benchmarks.competitiveGap >= 0 ? '+' : ''}
            {benchmarks.competitiveGap.toFixed(1)}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            vs Industry Average
          </div>
        </div>
        
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <div className="text-sm text-gray-600">Improvement Opportunity</div>
          </div>
          <div className="text-2xl font-bold text-purple-600">
            +{benchmarks.improvementOpportunity.toFixed(1)}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            Potential gain vs Top
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Your Score</span>
          <span className="text-lg font-bold text-blue-600">{currentScore.toFixed(1)}</span>
        </div>
        
        <div className="relative pt-1">
          <div className="flex mb-2 items-center justify-between">
            <div>
              <span className="text-xs font-semibold inline-block text-gray-600">
                Industry Average
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold inline-block text-gray-600">
                {benchmarks.industryAverage.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-gray-200">
            <div
              style={{ width: `${yourScoreWidth}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500"
            />
            <div
              style={{ width: `${industryAverageWidth}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gray-400"
            />
          </div>
        </div>
        
        <div className="relative pt-1">
          <div className="flex mb-2 items-center justify-between">
            <div>
              <span className="text-xs font-semibold inline-block text-gray-600">
                Top Performer
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold inline-block text-gray-600">
                {benchmarks.topPerformer.toFixed(1)}
              </span>
            </div>
          </div>
          <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-gray-200">
            <div
              style={{ width: `${yourScoreWidth}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500"
            />
            <div
              style={{ width: `${topPerformerWidth}%` }}
              className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-green-500"
            />
          </div>
        </div>
      </div>
      
      {benchmarks.benchmarks && benchmarks.benchmarks.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Detailed Metrics</h4>
          <div className="space-y-3">
            {benchmarks.benchmarks.slice(0, 3).map((benchmark, index) => (
              <div key={index} className="flex items-center justify-between">
                <span className="text-sm text-gray-700">{benchmark.metric}</span>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-900">
                    {benchmark.yourValue.toFixed(1)}
                  </span>
                  <span className="text-xs text-gray-500">vs</span>
                  <span className="text-sm text-gray-600">
                    {benchmark.industryAvg.toFixed(1)}
                  </span>
                  <span className={`text-xs font-medium ${
                    benchmark.gap >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {benchmark.gap >= 0 ? '+' : ''}{benchmark.gap.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default BenchmarkIndicator;
