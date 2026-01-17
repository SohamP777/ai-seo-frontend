import React from 'react';

const ScoreChartSkeleton: React.FC = () => {
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="p-6 border-b border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <div className="h-8 bg-gray-200 rounded w-64 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-96 max-w-full"></div>
          </div>
          <div className="flex gap-3">
            <div className="h-10 bg-gray-200 rounded-lg w-32"></div>
            <div className="h-10 bg-gray-200 rounded-lg w-32"></div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-xl"></div>
          ))}
        </div>
        
        <div className="flex flex-wrap gap-4 mb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-200 rounded-lg w-24"></div>
          ))}
        </div>
      </div>
      
      <div className="h-[500px] p-6">
        <div className="h-full bg-gray-100 rounded-xl"></div>
      </div>
    </div>
  );
};

export default ScoreChartSkeleton;
