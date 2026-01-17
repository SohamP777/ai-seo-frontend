import React from 'react';

interface FixStatusBadgeProps {
  status: string;
  progress?: number;
}

const FixStatusBadge: React.FC<FixStatusBadgeProps> = ({ status, progress }) => {
  const getStatusColor = () => {
    switch (status.toLowerCase()) {
      case 'fixed':
        return 'bg-green-500 text-white';
      case 'pending':
        return 'bg-yellow-500 text-gray-800';
      case 'failed':
        return 'bg-red-500 text-white';
      case 'in-progress':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getStatusText = () => {
    switch (status.toLowerCase()) {
      case 'fixed':
        return 'Fixed';
      case 'pending':
        return 'Pending';
      case 'failed':
        return 'Failed';
      case 'in-progress':
        return 'In Progress';
      default:
        return status;
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor()}`}>
        {getStatusText()}
      </span>
      
      {progress !== undefined && (
        <div className="w-full bg-gray-200 rounded-full h-1.5">
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
