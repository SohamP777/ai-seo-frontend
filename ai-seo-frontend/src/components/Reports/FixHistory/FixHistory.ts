import React, { useState, useEffect } from 'react';
import FixStatusBadge from './FixStatusBadge';

interface FixItem {
  id: string;
  title: string;
  description: string;
  status: 'fixed' | 'pending' | 'failed' | 'in-progress';
  priority: 'high' | 'medium' | 'low';
  detectedAt: Date;
  fixedAt?: Date;
  progress?: number;
}

const FixHistory: React.FC = () => {
  const [fixes, setFixes] = useState<FixItem[]>([
    {
      id: '1',
      title: 'Missing Meta Tags',
      description: 'Added missing meta title and description tags',
      status: 'fixed',
      priority: 'high',
      detectedAt: new Date('2024-01-15'),
      fixedAt: new Date('2024-01-15'),
      progress: 100
    },
    {
      id: '2',
      title: 'Slow Page Load',
      description: 'Optimized images and reduced CSS file size',
      status: 'in-progress',
      priority: 'high',
      detectedAt: new Date('2024-01-14'),
      progress: 75
    },
    {
      id: '3',
      title: 'Broken Internal Links',
      description: 'Fixed 5 broken internal links',
      status: 'fixed',
      priority: 'medium',
      detectedAt: new Date('2024-01-13'),
      fixedAt: new Date('2024-01-14'),
      progress: 100
    },
    {
      id: '4',
      title: 'Mobile Responsiveness',
      description: 'Fixed layout issues on mobile devices',
      status: 'pending',
      priority: 'high',
      detectedAt: new Date('2024-01-12'),
      progress: 0
    }
  ]);

  const [filter, setFilter] = useState<string>('all');

  const filteredFixes = fixes.filter(fix => {
    if (filter === 'all') return true;
    return fix.status === filter;
  });

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Fix History</h2>
        
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded-lg ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            className={`px-4 py-2 rounded-lg ${filter === 'fixed' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setFilter('fixed')}
          >
            Fixed
          </button>
          <button
            className={`px-4 py-2 rounded-lg ${filter === 'in-progress' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setFilter('in-progress')}
          >
            In Progress
          </button>
          <button
            className={`px-4 py-2 rounded-lg ${filter === 'pending' ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-600'}`}
            onClick={() => setFilter('pending')}
          >
            Pending
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Issue
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Priority
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Detected
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Fixed
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredFixes.map((fix) => (
              <tr key={fix.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">{fix.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{fix.description}</p>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getPriorityColor(fix.priority)}`}>
                    {fix.priority.charAt(0).toUpperCase() + fix.priority.slice(1)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <FixStatusBadge status={fix.status} progress={fix.progress} />
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {formatDate(fix.detectedAt)}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {fix.fixedAt ? formatDate(fix.fixedAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredFixes.length === 0 && (
        <div className="text-center py-8">
          <p className="text-gray-500">No fixes found for the selected filter.</p>
        </div>
      )}

      <div className="mt-6 text-sm text-gray-500">
        <p>Showing {filteredFixes.length} of {fixes.length} fixes</p>
      </div>
    </div>
  );
};

export default FixHistory;
