import React from 'react';

const ReportSkeleton: React.FC = () => {
  const skeletonCards = Array.from({ length: 3 });

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="bg-gradient-to-r from-gray-200 to-gray-300 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="h-8 bg-gray-300 rounded w-48 mb-2"></div>
            <div className="h-4 bg-gray-300 rounded w-32"></div>
          </div>
          <div className="flex gap-3">
            <div className="h-10 bg-gray-300 rounded-lg w-32"></div>
            <div className="h-10 bg-gray-300 rounded-lg w-32"></div>
          </div>
        </div>
      </div>
      
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 h-48 bg-gray-100 rounded-xl"></div>
          <div className="h-48 bg-gray-100 rounded-xl"></div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {skeletonCards.map((_, i) => (
            <div key={`skeleton-card-${i}`} className="h-32 bg-gray-100 rounded-xl"></div>
          ))}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="h-64 bg-gray-100 rounded-xl"></div>
          <div className="h-64 bg-gray-100 rounded-xl"></div>
        </div>
      </div>
    </div>
  );
};

export default ReportSkeleton;
