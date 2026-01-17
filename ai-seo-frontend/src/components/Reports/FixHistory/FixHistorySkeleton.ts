import React from 'react';

const FixHistorySkeleton: React.FC = () => {
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden animate-pulse">
      <div className="p-6 border-b border-gray-200">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <div className="h-8 bg-gray-200 rounded w-64 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-96"></div>
          </div>
          <div className="flex gap-3">
            <div className="h-10 bg-gray-200 rounded-lg w-32"></div>
            <div className="h-10 bg-gray-200 rounded-lg w-32"></div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded-lg"></div>
          ))}
        </div>
      </div>
      
      <div className="p-6 overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr>
              {Array.from({ length: 7 }).map((_, i) => (
                <th key={i} className="py-4 px-6 text-left">
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, rowIndex) => (
              <tr key={rowIndex} className="border-t border-gray-200">
                {Array.from({ length: 7 }).map((_, cellIndex) => (
                  <td key={cellIndex} className="py-4 px-6">
                    <div className="h-4 bg-gray-100 rounded w-full"></div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FixHistorySkeleton;
