/**
 * Metrics Service
 *
 * Handles accuracy calculations, trend analysis, and metrics aggregation
 * for the feedback system.
 */

export interface PeriodMetrics {
  startDate: Date;
  endDate: Date;
  totalFeedback: number;
  positiveCount: number;
  negativeCount: number;
  accuracyRate: number;
}

export interface TrendAnalysis {
  currentPeriod: PeriodMetrics;
  previousPeriod: PeriodMetrics | null;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
  changePercent: number;
}

export interface CorrectionPattern {
  geminiOutput: string;
  userCorrection: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  isRecurring: boolean; // Still happening after being noted
}

/**
 * Calculate accuracy rate from counts
 */
export function calculateAccuracyRate(positive: number, negative: number): number {
  const total = positive + negative;
  if (total === 0) return 0;
  return (positive / total) * 100;
}

/**
 * Determine trend based on two periods
 */
export function determineTrend(
  currentAccuracy: number,
  previousAccuracy: number,
  threshold: number = 5
): TrendAnalysis['trend'] {
  if (currentAccuracy > previousAccuracy + threshold) {
    return 'improving';
  } else if (currentAccuracy < previousAccuracy - threshold) {
    return 'declining';
  }
  return 'stable';
}

/**
 * Calculate improvement velocity (% change per period)
 */
export function calculateImprovementVelocity(
  periods: PeriodMetrics[]
): number {
  if (periods.length < 2) return 0;

  // Calculate average change between consecutive periods
  let totalChange = 0;
  for (let i = 1; i < periods.length; i++) {
    totalChange += periods[i].accuracyRate - periods[i - 1].accuracyRate;
  }

  return totalChange / (periods.length - 1);
}

/**
 * Identify patterns that need attention (high frequency, not yet fixed)
 */
export function getPriorityPatterns(
  patterns: CorrectionPattern[],
  minOccurrences: number = 3
): CorrectionPattern[] {
  return patterns
    .filter(p => p.count >= minOccurrences && p.isRecurring)
    .sort((a, b) => b.count - a.count);
}

/**
 * Generate prompt improvement suggestions based on patterns
 */
export function generatePromptSuggestions(
  patterns: CorrectionPattern[]
): string[] {
  const suggestions: string[] = [];

  for (const pattern of patterns.slice(0, 10)) {
    suggestions.push(
      `When you interpret "${pattern.geminiOutput}", consider if "${pattern.userCorrection}" is more appropriate (${pattern.count} user corrections)`
    );
  }

  return suggestions;
}

/**
 * Format metrics for display
 */
export function formatMetricsForDisplay(metrics: PeriodMetrics): {
  accuracyDisplay: string;
  totalDisplay: string;
  ratioDisplay: string;
} {
  return {
    accuracyDisplay: `${metrics.accuracyRate.toFixed(1)}%`,
    totalDisplay: `${metrics.totalFeedback} translations rated`,
    ratioDisplay: `${metrics.positiveCount} ✓ / ${metrics.negativeCount} ✗`,
  };
}

/**
 * Calculate period dates for different time ranges
 */
export function getPeriodDates(
  periodType: '7d' | '30d' | 'all'
): { start: Date; end: Date } {
  const end = new Date();
  let start: Date;

  switch (periodType) {
    case '7d':
      start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'all':
    default:
      start = new Date('2020-01-01');
      break;
  }

  return { start, end };
}

/**
 * Estimate data quality based on feedback volume
 */
export function assessDataQuality(totalFeedback: number): {
  level: 'low' | 'medium' | 'high';
  message: string;
  minForReliable: number;
} {
  if (totalFeedback < 20) {
    return {
      level: 'low',
      message: 'Need more feedback for reliable metrics',
      minForReliable: 20,
    };
  } else if (totalFeedback < 100) {
    return {
      level: 'medium',
      message: 'Metrics are becoming reliable',
      minForReliable: 100,
    };
  }
  return {
    level: 'high',
    message: 'Sufficient data for reliable analysis',
    minForReliable: 100,
  };
}
