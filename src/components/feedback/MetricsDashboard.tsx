'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertCircle } from 'lucide-react';

interface AccuracyStats {
  period: string;
  totalTranslations: number;
  positiveRatings: number;
  negativeRatings: number;
  accuracyRate: number;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
}

interface MisrecognitionPattern {
  geminiOutput: string;
  userCorrection: string;
  occurrenceCount: number;
  addedToPrompt: boolean;
}

interface MetricsDashboardProps {
  className?: string;
}

export function MetricsDashboard({ className = '' }: MetricsDashboardProps) {
  const [stats, setStats] = useState<AccuracyStats | null>(null);
  const [patterns, setPatterns] = useState<MisrecognitionPattern[]>([]);
  const [period, setPeriod] = useState<'7d' | '30d' | 'all'>('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsRes, patternsRes] = await Promise.all([
        fetch(`/api/feedback/stats?period=${period}`),
        fetch('/api/feedback/patterns'),
      ]);

      if (!statsRes.ok || !patternsRes.ok) {
        throw new Error('Failed to fetch metrics');
      }

      const statsData = await statsRes.json();
      const patternsData = await patternsRes.json();

      setStats(statsData.stats);
      setPatterns(patternsData.patterns || []);
    } catch (err) {
      console.error('[MetricsDashboard] Error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getTrendIcon = (trend: AccuracyStats['trend']) => {
    switch (trend) {
      case 'improving':
        return <TrendingUp className="h-5 w-5 text-green-400" />;
      case 'declining':
        return <TrendingDown className="h-5 w-5 text-red-400" />;
      case 'stable':
        return <Minus className="h-5 w-5 text-yellow-400" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getTrendLabel = (trend: AccuracyStats['trend']) => {
    switch (trend) {
      case 'improving':
        return 'Improving';
      case 'declining':
        return 'Declining';
      case 'stable':
        return 'Stable';
      default:
        return 'Need more data';
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <RefreshCw className="h-6 w-6 animate-spin text-yellow-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg bg-red-500/10 p-4 text-center ${className}`}>
        <AlertCircle className="mx-auto mb-2 h-6 w-6 text-red-400" />
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={fetchData}
          className="mt-2 text-xs text-red-300 underline hover:text-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Accuracy Metrics</h3>
        <div className="flex gap-1 rounded-lg bg-gray-800 p-1">
          {(['7d', '30d', 'all'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-yellow-400 text-black'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {p === 'all' ? 'All Time' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          {/* Accuracy Rate */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-gray-800 p-4"
          >
            <p className="text-xs text-gray-400">Accuracy Rate</p>
            <p className="mt-1 text-3xl font-bold text-yellow-400">
              {stats.accuracyRate.toFixed(1)}%
            </p>
            <div className="mt-2 flex items-center gap-1">
              {getTrendIcon(stats.trend)}
              <span className="text-xs text-gray-400">{getTrendLabel(stats.trend)}</span>
            </div>
          </motion.div>

          {/* Total Translations */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-lg bg-gray-800 p-4"
          >
            <p className="text-xs text-gray-400">Total Feedback</p>
            <p className="mt-1 text-3xl font-bold text-white">
              {stats.totalTranslations}
            </p>
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-green-400">👍 {stats.positiveRatings}</span>
              <span className="text-red-400">👎 {stats.negativeRatings}</span>
            </div>
          </motion.div>
        </div>
      )}

      {/* Common Misrecognitions */}
      {patterns.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-lg bg-gray-800 p-4"
        >
          <h4 className="mb-3 text-sm font-medium text-white">
            Common Misrecognitions
          </h4>
          <div className="space-y-2">
            {patterns.slice(0, 5).map((pattern, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md bg-gray-700/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-400 line-through">
                    {pattern.geminiOutput}
                  </span>
                  <span className="text-gray-500">→</span>
                  <span className="text-sm text-green-400">
                    {pattern.userCorrection}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    ×{pattern.occurrenceCount}
                  </span>
                  {pattern.addedToPrompt && (
                    <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                      Fixed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          {patterns.length > 5 && (
            <p className="mt-2 text-center text-xs text-gray-500">
              +{patterns.length - 5} more patterns
            </p>
          )}
        </motion.div>
      )}

      {/* Empty State */}
      {stats?.totalTranslations === 0 && (
        <div className="rounded-lg bg-gray-800/50 p-6 text-center">
          <p className="text-sm text-gray-400">
            No feedback collected yet. Use the app and rate translations to see metrics here.
          </p>
        </div>
      )}

      {/* Refresh Button */}
      <button
        onClick={fetchData}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-800 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </button>
    </div>
  );
}
