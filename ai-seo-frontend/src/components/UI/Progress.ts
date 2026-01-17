// src/components/ui/Progress/Progress.tsx
import React from 'react';
import { motion } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface ProgressProps {
  value: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'success' | 'warning' | 'error';
  showValue?: boolean;
  valuePosition?: 'inside' | 'outside';
  animated?: boolean;
  className?: string;
}

const Progress: React.FC<ProgressProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'primary',
  showValue = false,
  valuePosition = 'outside',
  animated = true,
  className,
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizeClasses = {
    sm: 'h-2',
    md: 'h-3',
    lg: 'h-4',
  };

  const variantClasses = {
    primary: 'bg-primary-600',
    success: 'bg-success-600',
    warning: 'bg-warning-600',
    error: 'bg-error-600',
  };

  const progressBarClasses = twMerge(
    clsx(
      'w-full bg-gray-200 rounded-full overflow-hidden dark:bg-gray-700',
      sizeClasses[size],
      className
    )
  );

  const progressFillClasses = clsx(
    'h-full rounded-full transition-all duration-500 ease-out',
    variantClasses[variant],
    {
      'animate-pulse': animated && percentage < 100,
    }
  );

  return (
    <div className="w-full">
      {(showValue && valuePosition === 'outside') && (
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
          <span>Progress</span>
          <span>{percentage.toFixed(1)}%</span>
        </div>
      )}
      
      <div className={progressBarClasses}>
        <motion.div
          className={progressFillClasses}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        >
          {(showValue && valuePosition === 'inside') && (
            <div className="flex items-center justify-center h-full text-xs text-white font-medium">
              {percentage.toFixed(1)}%
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default Progress;