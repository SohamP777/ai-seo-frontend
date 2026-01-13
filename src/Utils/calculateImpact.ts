/**
 * SEO Impact Calculation Utilities
 * Calculates business impact, ROI, and prioritization for SEO issues and fixes
 */

import { 
  SEVERITY_LEVELS, 
  ISSUE_CATEGORIES,
  type SeverityLevel,
  type IssueCategory 
} from './constants';

/**
 * SEO Issue Interface
 */
export interface SeoIssue {
  id: string;
  title: string;
  description: string;
  severity: SeverityLevel;
  category: IssueCategory;
  impactScore: number;
  occurrences: number;
  fixDifficulty: 'easy' | 'medium' | 'hard' | 'very-hard';
  estimatedTime: number; // in minutes
  affectedUrls: string[];
  diagnosticData: Record<string, any>;
  lastDetected: Date;
}

/**
 * Fix Impact Calculation Interface
 */
export interface FixImpact {
  seoImpact: number;
  trafficImpact: number;
  conversionImpact: number;
  revenueImpact: number;
  timeToFix: number;
  priorityScore: number;
  roi: number;
  confidence: 'low' | 'medium' | 'high' | 'very-high';
}

/**
 * Business Metrics Interface
 */
export interface BusinessMetrics {
  monthlyTraffic: number;
  conversionRate: number;
  averageOrderValue: number;
  profitMargin: number;
  industryMultiplier: number;
}

/**
 * Default business metrics for calculation
 */
export const DEFAULT_BUSINESS_METRICS: BusinessMetrics = {
  monthlyTraffic: 10000,
  conversionRate: 2.5,
  averageOrderValue: 100,
  profitMargin: 0.3,
  industryMultiplier: 1.0,
};

/**
 * Calculate priority score for SEO issues
 */
export const calculatePriorityScore = (issue: SeoIssue): number => {
  const severityWeight = SEVERITY_LEVELS[issue.severity].impact;
  const difficultyWeights = {
    'easy': 1.0,
    'medium': 0.8,
    'hard': 0.6,
    'very-hard': 0.4,
  };
  const categoryWeights = {
    'performance': 1.2,
    'seo': 1.5,
    'accessibility': 0.8,
    'security': 1.0,
    'best_practices': 0.7,
  };

  const baseScore = severityWeight * 10;
  const difficultyMultiplier = difficultyWeights[issue.fixDifficulty];
  const categoryMultiplier = categoryWeights[issue.category];
  const occurrenceMultiplier = Math.min(issue.occurrences / 10, 2) + 1;

  return Math.round(baseScore * difficultyMultiplier * categoryMultiplier * occurrenceMultiplier);
};

/**
 * Calculate SEO impact score
 */
export const calculateSeoImpact = (issue: SeoIssue): number => {
  const baseImpact = SEVERITY_LEVELS[issue.severity].impact;
  const categoryMultipliers = {
    'performance': 1.3,
    'seo': 1.5,
    'accessibility': 0.9,
    'security': 1.1,
    'best_practices': 0.8,
  };

  const categoryMultiplier = categoryMultipliers[issue.category];
  const timeDecay = calculateTimeDecay(issue.lastDetected);
  
  return Math.round(baseImpact * categoryMultiplier * timeDecay * (issue.occurrences / 10));
};

/**
 * Calculate traffic impact from SEO improvements
 */
export const calculateTrafficImpact = (
  seoImpact: number,
  currentTraffic: number,
  industryMultiplier: number = 1.0
): number => {
  // Base conversion of SEO impact to traffic percentage
  const trafficIncreasePercentage = seoImpact * 0.1;
  
  // Apply industry multiplier
  const adjustedPercentage = trafficIncreasePercentage * industryMultiplier;
  
  // Calculate actual traffic increase
  return Math.round(currentTraffic * (adjustedPercentage / 100));
};

/**
 * Calculate conversion impact
 */
export const calculateConversionImpact = (
  issue: SeoIssue,
  currentConversionRate: number
): {
  absoluteChange: number;
  percentageChange: number;
} => {
  const impactFactors = {
    'performance': 0.15,
    'seo': 0.1,
    'accessibility': 0.08,
    'security': 0.05,
    'best_practices': 0.03,
  };

  const severityMultipliers = {
    'CRITICAL': 0.2,
    'HIGH': 0.15,
    'MEDIUM': 0.1,
    'LOW': 0.05,
    'INFO': 0.01,
  };

  const impactFactor = impactFactors[issue.category];
  const severityMultiplier = severityMultipliers[issue.severity];
  const occurrenceFactor = Math.min(issue.occurrences / 5, 1);

  const conversionImprovement = impactFactor * severityMultiplier * occurrenceFactor;
  const newConversionRate = currentConversionRate * (1 + conversionImprovement);

  return {
    absoluteChange: newConversionRate - currentConversionRate,
    percentageChange: conversionImprovement * 100,
  };
};

/**
 * Calculate revenue impact
 */
export const calculateRevenueImpact = (
  trafficImpact: number,
  conversionImpact: number,
  averageOrderValue: number,
  profitMargin: number
): {
  monthlyRevenue: number;
  annualRevenue: number;
  monthlyProfit: number;
  annualProfit: number;
} => {
  const monthlyConversions = trafficImpact * (conversionImpact / 100);
  const monthlyRevenue = monthlyConversions * averageOrderValue;
  const monthlyProfit = monthlyRevenue * profitMargin;

  return {
    monthlyRevenue: Math.round(monthlyRevenue),
    annualRevenue: Math.round(monthlyRevenue * 12),
    monthlyProfit: Math.round(monthlyProfit),
    annualProfit: Math.round(monthlyProfit * 12),
  };
};

/**
 * Calculate ROI for fix implementation
 */
export const calculateROI = (
  fixCost: number,
  monthlyProfit: number,
  timeToRecover: number = 1 // months to recover investment
): {
  roi: number;
  paybackPeriod: number;
  netBenefit: number;
} => {
  if (fixCost <= 0) {
    return {
      roi: Infinity,
      paybackPeriod: 0,
      netBenefit: monthlyProfit * 12,
    };
  }

  const annualProfit = monthlyProfit * 12;
  const roi = ((annualProfit - fixCost) / fixCost) * 100;
  const paybackPeriod = fixCost / monthlyProfit;
  const netBenefit = annualProfit - fixCost;

  return {
    roi: Math.round(roi),
    paybackPeriod: Math.round(paybackPeriod * 10) / 10,
    netBenefit: Math.round(netBenefit),
  };
};

/**
 * Calculate comprehensive fix impact
 */
export const calculateComprehensiveFixImpact = (
  issue: SeoIssue,
  businessMetrics: BusinessMetrics = DEFAULT_BUSINESS_METRICS
): FixImpact => {
  const priorityScore = calculatePriorityScore(issue);
  const seoImpact = calculateSeoImpact(issue);
  const trafficImpact = calculateTrafficImpact(
    seoImpact,
    businessMetrics.monthlyTraffic,
    businessMetrics.industryMultiplier
  );
  
  const conversionImpact = calculateConversionImpact(issue, businessMetrics.conversionRate);
  const revenueImpact = calculateRevenueImpact(
    trafficImpact,
    conversionImpact.percentageChange,
    businessMetrics.averageOrderValue,
    businessMetrics.profitMargin
  );

  const fixCost = estimateFixCost(issue);
  const roi = calculateROI(fixCost, revenueImpact.monthlyProfit);

  // Calculate confidence based on data quality
  const confidence = calculateConfidenceScore(issue);

  return {
    seoImpact,
    trafficImpact,
    conversionImpact: conversionImpact.percentageChange,
    revenueImpact: revenueImpact.monthlyProfit,
    timeToFix: issue.estimatedTime,
    priorityScore,
    roi: roi.roi,
    confidence,
  };
};

/**
 * Estimate fix cost based on issue complexity
 */
export const estimateFixCost = (issue: SeoIssue): number => {
  const hourlyRates = {
    'easy': 50,
    'medium': 75,
    'hard': 100,
    'very-hard': 150,
  };

  const hours = issue.estimatedTime / 60;
  const hourlyRate = hourlyRates[issue.fixDifficulty];
  
  return Math.round(hours * hourlyRate);
};

/**
 * Calculate time decay factor for recent issues
 */
export const calculateTimeDecay = (lastDetected: Date): number => {
  const now = new Date();
  const daysSinceDetection = Math.floor(
    (now.getTime() - lastDetected.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSinceDetection <= 7) return 1.0;
  if (daysSinceDetection <= 30) return 0.8;
  if (daysSinceDetection <= 90) return 0.6;
  return 0.4;
};

/**
 * Calculate confidence score for impact calculations
 */
export const calculateConfidenceScore = (issue: SeoIssue): 'low' | 'medium' | 'high' | 'very-high' => {
  let score = 0;

  // Data completeness
  if (issue.diagnosticData && Object.keys(issue.diagnosticData).length > 3) score += 25;
  if (issue.affectedUrls && issue.affectedUrls.length > 0) score += 25;

  // Occurrence frequency
  if (issue.occurrences >= 10) score += 25;
  else if (issue.occurrences >= 5) score += 15;
  else if (issue.occurrences >= 2) score += 5;

  // Recency
  const daysSince = Math.floor(
    (new Date().getTime() - issue.lastDetected.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (daysSince <= 7) score += 25;
  else if (daysSince <= 30) score += 15;
  else if (daysSince <= 90) score += 5;

  if (score >= 90) return 'very-high';
  if (score >= 70) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
};

/**
 * Aggregate impact across multiple issues
 */
export const aggregateImpact = (
  issues: SeoIssue[],
  businessMetrics: BusinessMetrics = DEFAULT_BUSINESS_METRICS
): {
  totalSeoImpact: number;
  totalTrafficImpact: number;
  totalRevenueImpact: number;
  totalPriorityScore: number;
  averageROI: number;
  estimatedTotalTime: number;
  estimatedTotalCost: number;
  bySeverity: Record<SeverityLevel, number>;
  byCategory: Record<IssueCategory, number>;
} => {
  const aggregated = {
    totalSeoImpact: 0,
    totalTrafficImpact: 0,
    totalRevenueImpact: 0,
    totalPriorityScore: 0,
    totalROI: 0,
    estimatedTotalTime: 0,
    estimatedTotalCost: 0,
    bySeverity: {} as Record<SeverityLevel, number>,
    byCategory: {} as Record<IssueCategory, number>,
  };

  let validROIs = 0;

  issues.forEach(issue => {
    const impact = calculateComprehensiveFixImpact(issue, businessMetrics);
    
    aggregated.totalSeoImpact += impact.seoImpact;
    aggregated.totalTrafficImpact += impact.trafficImpact;
    aggregated.totalRevenueImpact += impact.revenueImpact;
    aggregated.totalPriorityScore += impact.priorityScore;
    aggregated.estimatedTotalTime += issue.estimatedTime;
    aggregated.estimatedTotalCost += estimateFixCost(issue);

    if (impact.roi !== Infinity) {
      aggregated.totalROI += impact.roi;
      validROIs++;
    }

    // Aggregate by severity
    aggregated.bySeverity[issue.severity] = 
      (aggregated.bySeverity[issue.severity] || 0) + impact.priorityScore;

    // Aggregate by category
    aggregated.byCategory[issue.category] = 
      (aggregated.byCategory[issue.category] || 0) + impact.priorityScore;
  });

  return {
    totalSeoImpact: Math.round(aggregated.totalSeoImpact),
    totalTrafficImpact: Math.round(aggregated.totalTrafficImpact),
    totalRevenueImpact: Math.round(aggregated.totalRevenueImpact),
    totalPriorityScore: Math.round(aggregated.totalPriorityScore),
    averageROI: validROIs > 0 ? Math.round(aggregated.totalROI / validROIs) : 0,
    estimatedTotalTime: Math.round(aggregated.estimatedTotalTime),
    estimatedTotalCost: Math.round(aggregated.estimatedTotalCost),
    bySeverity: aggregated.bySeverity,
    byCategory: aggregated.byCategory,
  };
};

/**
 * Generate fix prioritization recommendations
 */
export const generatePrioritization = (
  issues: SeoIssue[],
  businessMetrics: BusinessMetrics = DEFAULT_BUSINESS_METRICS,
  maxTime: number = 40 // hours per week
): Array<{
  issue: SeoIssue;
  impact: FixImpact;
  rank: number;
  recommendation: 'fix-now' | 'fix-soon' | 'schedule' | 'defer';
}> => {
  const prioritized = issues.map(issue => {
    const impact = calculateComprehensiveFixImpact(issue, businessMetrics);
    
    // Calculate rank using multiple factors
    const rank = 
      (impact.priorityScore * 0.4) +
      (impact.roi * 0.3) +
      (impact.confidence === 'very-high' ? 30 : 
       impact.confidence === 'high' ? 20 : 
       impact.confidence === 'medium' ? 10 : 0) +
      (issue.severity === 'CRITICAL' ? 50 : 
       issue.severity === 'HIGH' ? 30 : 
       issue.severity === 'MEDIUM' ? 10 : 0);

    return { issue, impact, rank };
  });

  // Sort by rank
  prioritized.sort((a, b) => b.rank - a.rank);

  // Add recommendations based on available time
  let availableTime = maxTime * 60; // convert to minutes
  return prioritized.map(item => {
    let recommendation: 'fix-now' | 'fix-soon' | 'schedule' | 'defer';
    
    if (availableTime >= item.issue.estimatedTime && item.impact.roi > 100) {
      recommendation = 'fix-now';
      availableTime -= item.issue.estimatedTime;
    } else if (item.impact.roi > 50) {
      recommendation = 'fix-soon';
    } else if (item.impact.roi > 0) {
      recommendation = 'schedule';
    } else {
      recommendation = 'defer';
    }

    return {
      ...item,
      recommendation,
    };
  });
};

/**
 * Validate impact calculation inputs
 */
export const validateImpactInputs = (
  issue: Partial<SeoIssue>,
  metrics: Partial<BusinessMetrics>
): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  // Validate issue
  if (!issue.severity || !SEVERITY_LEVELS[issue.severity as SeverityLevel]) {
    errors.push('Invalid or missing issue severity');
  }

  if (!issue.category || !ISSUE_CATEGORIES[issue.category as IssueCategory]) {
    errors.push('Invalid or missing issue category');
  }

  if (typeof issue.estimatedTime !== 'number' || issue.estimatedTime <= 0) {
    errors.push('Invalid estimated time');
  }

  if (typeof issue.occurrences !== 'number' || issue.occurrences < 0) {
    errors.push('Invalid occurrences count');
  }

  // Validate business metrics
  if (metrics.monthlyTraffic !== undefined && metrics.monthlyTraffic < 0) {
    errors.push('Monthly traffic cannot be negative');
  }

  if (metrics.conversionRate !== undefined && (metrics.conversionRate < 0 || metrics.conversionRate > 100)) {
    errors.push('Conversion rate must be between 0 and 100');
  }

  if (metrics.averageOrderValue !== undefined && metrics.averageOrderValue < 0) {
    errors.push('Average order value cannot be negative');
  }

  if (metrics.profitMargin !== undefined && (metrics.profitMargin < 0 || metrics.profitMargin > 1)) {
    errors.push('Profit margin must be between 0 and 1');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Format impact for display
 */
export const formatImpactForDisplay = (impact: FixImpact): Record<string, string> => {
  return {
    seoImpact: `${impact.seoImpact} points`,
    trafficImpact: `+${impact.trafficImpact.toLocaleString()} visitors/month`,
    conversionImpact: `+${impact.conversionImpact.toFixed(1)}%`,
    revenueImpact: `$${impact.revenueImpact.toLocaleString()}/month`,
    timeToFix: `${Math.round(impact.timeToFix / 60)} hours`,
    priorityScore: `${impact.priorityScore}/100`,
    roi: `${impact.roi}% ROI`,
    confidence: impact.confidence.replace('-', ' ').toUpperCase(),
  };
};