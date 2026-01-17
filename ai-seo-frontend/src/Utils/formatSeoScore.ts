/**
 * SEO Score Formatting Utilities
 * Handles formatting, display, and calculations for SEO scores
 */

import { 
  HEALTH_SCORE_RANGES, 
  SEVERITY_LEVELS, 
  type SeverityLevel,
  type HealthScoreRange 
} from './constants';

/**
 * SEO Score Interface
 */
export interface SeoScore {
  overall: number;
  performance: number;
  seo: number;
  accessibility: number;
  security: number;
  bestPractices: number;
  issues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  lastUpdated: Date;
  url: string;
}

/**
 * Formatted Score Display Interface
 */
export interface FormattedScore {
  score: number;
  formatted: string;
  color: string;
  bgColor: string;
  label: string;
  icon: string;
  description: string;
}

/**
 * Get health score range and styling based on score
 */
export const getHealthScoreRange = (score: number): {
  range: HealthScoreRange;
  color: string;
  bgColor: string;
  label: string;
  icon: string;
} => {
  if (score >= HEALTH_SCORE_RANGES.EXCELLENT.min) {
    return {
      range: 'EXCELLENT',
      color: HEALTH_SCORE_RANGES.EXCELLENT.color,
      bgColor: HEALTH_SCORE_RANGES.EXCELLENT.bgColor,
      label: 'Excellent',
      icon: '🏆',
    };
  } else if (score >= HEALTH_SCORE_RANGES.GOOD.min) {
    return {
      range: 'GOOD',
      color: HEALTH_SCORE_RANGES.GOOD.color,
      bgColor: HEALTH_SCORE_RANGES.GOOD.bgColor,
      label: 'Good',
      icon: '👍',
    };
  } else if (score >= HEALTH_SCORE_RANGES.FAIR.min) {
    return {
      range: 'FAIR',
      color: HEALTH_SCORE_RANGES.FAIR.color,
      bgColor: HEALTH_SCORE_RANGES.FAIR.bgColor,
      label: 'Fair',
      icon: '⚠️',
    };
  } else {
    return {
      range: 'POOR',
      color: HEALTH_SCORE_RANGES.POOR.color,
      bgColor: HEALTH_SCORE_RANGES.POOR.bgColor,
      label: 'Poor',
      icon: '🚨',
    };
  }
};

/**
 * Format score with appropriate precision and symbols
 */
export const formatScore = (score: number, type: 'percentage' | 'number' | 'milliseconds' = 'percentage'): string => {
  switch (type) {
    case 'percentage':
      return `${Math.round(score)}%`;
    case 'number':
      return score.toLocaleString();
    case 'milliseconds':
      return `${Math.round(score)}ms`;
    default:
      return `${Math.round(score)}`;
  }
};

/**
 * Calculate overall SEO score from category scores
 */
export const calculateOverallScore = (scores: {
  performance: number;
  seo: number;
  accessibility: number;
  security: number;
  bestPractices: number;
}): number => {
  const weights = {
    performance: 0.3,
    seo: 0.3,
    accessibility: 0.2,
    security: 0.1,
    bestPractices: 0.1,
  };

  const weightedSum = 
    (scores.performance * weights.performance) +
    (scores.seo * weights.seo) +
    (scores.accessibility * weights.accessibility) +
    (scores.security * weights.security) +
    (scores.bestPractices * weights.bestPractices);

  return Math.round(weightedSum);
};

/**
 * Calculate score impact from issues
 */
export const calculateScoreImpact = (issues: {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}): number => {
  const impactScores = {
    critical: SEVERITY_LEVELS.CRITICAL.impact,
    high: SEVERITY_LEVELS.HIGH.impact,
    medium: SEVERITY_LEVELS.MEDIUM.impact,
    low: SEVERITY_LEVELS.LOW.impact,
    info: SEVERITY_LEVELS.INFO.impact,
  };

  const totalImpact = 
    (issues.critical * impactScores.critical) +
    (issues.high * impactScores.high) +
    (issues.medium * impactScores.medium) +
    (issues.low * impactScores.low) +
    (issues.info * impactScores.info);

  // Cap impact at 100
  return Math.min(totalImpact, 100);
};

/**
 * Get score trend (improving, declining, stable)
 */
export const getScoreTrend = (
  currentScore: number, 
  previousScore: number
): {
  trend: 'improving' | 'declining' | 'stable';
  change: number;
  icon: string;
  color: string;
} => {
  const change = currentScore - previousScore;
  const threshold = 1; // Minimum change to be considered meaningful

  if (change > threshold) {
    return {
      trend: 'improving',
      change,
      icon: '📈',
      color: 'text-green-600',
    };
  } else if (change < -threshold) {
    return {
      trend: 'declining',
      change: Math.abs(change),
      icon: '📉',
      color: 'text-red-600',
    };
  } else {
    return {
      trend: 'stable',
      change: 0,
      icon: '➡️',
      color: 'text-gray-600',
    };
  }
};

/**
 * Format score for display with all details
 */
export const formatScoreForDisplay = (score: number): FormattedScore => {
  const range = getHealthScoreRange(score);
  
  return {
    score,
    formatted: formatScore(score),
    color: range.color,
    bgColor: range.bgColor,
    label: range.label,
    icon: range.icon,
    description: getScoreDescription(score),
  };
};

/**
 * Get descriptive text for score
 */
export const getScoreDescription = (score: number): string => {
  if (score >= 90) {
    return 'Your site is performing exceptionally well. Keep up the good work!';
  } else if (score >= 70) {
    return 'Good performance with some minor improvements possible.';
  } else if (score >= 50) {
    return 'Fair performance. Several areas need attention for improvement.';
  } else {
    return 'Poor performance. Significant improvements needed for better SEO results.';
  }
};

/**
 * Calculate progress percentage for circular progress indicators
 */
export const calculateProgressPercentage = (score: number): number => {
  return (score / 100) * 100;
};

/**
 * Get gradient colors for score visualization
 */
export const getScoreGradient = (score: number): string => {
  if (score >= 90) {
    return 'from-green-400 to-emerald-500';
  } else if (score >= 70) {
    return 'from-blue-400 to-cyan-500';
  } else if (score >= 50) {
    return 'from-yellow-400 to-amber-500';
  } else {
    return 'from-red-400 to-rose-500';
  }
};

/**
 * Calculate estimated time to fix based on issues
 */
export const estimateFixTime = (issues: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}): {
  hours: number;
  formatted: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'very-complex';
} => {
  const timeEstimates = {
    critical: 4, // hours per issue
    high: 2,
    medium: 1,
    low: 0.5,
  };

  const totalHours = 
    (issues.critical * timeEstimates.critical) +
    (issues.high * timeEstimates.high) +
    (issues.medium * timeEstimates.medium) +
    (issues.low * timeEstimates.low);

  let complexity: 'simple' | 'moderate' | 'complex' | 'very-complex';
  if (totalHours <= 2) {
    complexity = 'simple';
  } else if (totalHours <= 8) {
    complexity = 'moderate';
  } else if (totalHours <= 24) {
    complexity = 'complex';
  } else {
    complexity = 'very-complex';
  }

  const formatted = totalHours < 1 
    ? '< 1 hour' 
    : totalHours < 24 
      ? `${Math.round(totalHours)} hours`
      : `${Math.round(totalHours / 24)} days`;

  return {
    hours: totalHours,
    formatted,
    complexity,
  };
};

/**
 * Format category scores for display
 */
export const formatCategoryScores = (seoScore: SeoScore): Array<{
  category: string;
  score: number;
  formatted: string;
  color: string;
  icon: string;
  weight: number;
}> => {
  return [
    {
      category: 'Performance',
      score: seoScore.performance,
      formatted: formatScore(seoScore.performance),
      color: 'text-purple-600',
      icon: '⚡',
      weight: 0.3,
    },
    {
      category: 'SEO',
      score: seoScore.seo,
      formatted: formatScore(seoScore.seo),
      color: 'text-cyan-600',
      icon: '🔍',
      weight: 0.3,
    },
    {
      category: 'Accessibility',
      score: seoScore.accessibility,
      formatted: formatScore(seoScore.accessibility),
      color: 'text-pink-600',
      icon: '♿',
      weight: 0.2,
    },
    {
      category: 'Security',
      score: seoScore.security,
      formatted: formatScore(seoScore.security),
      color: 'text-orange-600',
      icon: '🔒',
      weight: 0.1,
    },
    {
      category: 'Best Practices',
      score: seoScore.bestPractices,
      formatted: formatScore(seoScore.bestPractices),
      color: 'text-emerald-600',
      icon: '✅',
      weight: 0.1,
    },
  ];
};

/**
 * Generate score improvement suggestions
 */
export const generateImprovementSuggestions = (seoScore: SeoScore): Array<{
  priority: SeverityLevel;
  category: string;
  suggestion: string;
  impact: number;
}> => {
  const suggestions: Array<{
    priority: SeverityLevel;
    category: string;
    suggestion: string;
    impact: number;
  }> = [];

  // Performance suggestions
  if (seoScore.performance < 90) {
    suggestions.push({
      priority: seoScore.performance < 50 ? 'CRITICAL' : 'HIGH',
      category: 'performance',
      suggestion: 'Optimize images and implement lazy loading',
      impact: 15,
    });
  }

  // SEO suggestions
  if (seoScore.seo < 90) {
    suggestions.push({
      priority: seoScore.seo < 50 ? 'CRITICAL' : 'HIGH',
      category: 'seo',
      suggestion: 'Improve meta tags and structured data',
      impact: 20,
    });
  }

  // Accessibility suggestions
  if (seoScore.accessibility < 90) {
    suggestions.push({
      priority: 'MEDIUM',
      category: 'accessibility',
      suggestion: 'Add ARIA labels and improve keyboard navigation',
      impact: 10,
    });
  }

  // Sort by priority and impact
  return suggestions.sort((a, b) => {
    const priorityA = SEVERITY_LEVELS[a.priority].priority;
    const priorityB = SEVERITY_LEVELS[b.priority].priority;
    return priorityA - priorityB || b.impact - a.impact;
  });
};

/**
 * Validate SEO score data integrity
 */
export const validateSeoScore = (score: Partial<SeoScore>): boolean => {
  if (!score || typeof score !== 'object') return false;

  const requiredFields = ['overall', 'performance', 'seo', 'accessibility', 'security', 'bestPractices'];
  
  for (const field of requiredFields) {
    if (typeof (score as any)[field] !== 'number' || (score as any)[field] < 0 || (score as any)[field] > 100) {
      return false;
    }
  }

  if (score.issues) {
    const issueFields = ['critical', 'high', 'medium', 'low', 'info'];
    for (const field of issueFields) {
      if (typeof (score.issues as any)[field] !== 'number' || (score.issues as any)[field] < 0) {
        return false;
      }
    }
  }

  return true;
};

/**
 * Calculate score change percentage
 */
export const calculateScoreChangePercentage = (
  newScore: number,
  oldScore: number
): {
  percentage: number;
  isImprovement: boolean;
  formatted: string;
} => {
  if (oldScore === 0) {
    return {
      percentage: 100,
      isImprovement: newScore > 0,
      formatted: 'New',
    };
  }

  const percentage = ((newScore - oldScore) / oldScore) * 100;
  const isImprovement = percentage > 0;

  return {
    percentage: Math.abs(percentage),
    isImprovement,
    formatted: `${isImprovement ? '+' : '-'}${Math.abs(Math.round(percentage))}%`,
  };
};