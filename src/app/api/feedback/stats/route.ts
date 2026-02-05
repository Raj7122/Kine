/**
 * Feedback Stats API Route
 *
 * Returns accuracy metrics and trends for the feedback system.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

interface AccuracyStats {
  period: string;
  totalTranslations: number;
  positiveRatings: number;
  negativeRatings: number;
  accuracyRate: number;
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '7d'; // 7d, 30d, all

    if (isSupabaseConfigured && supabase) {
      // Calculate date range
      const now = new Date();
      let startDate: Date;
      
      switch (period) {
        case '7d':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date('2020-01-01');
      }

      // Get feedback within period
      const { data: feedback, error } = await supabase
        .from('translation_feedback')
        .select('rating, created_at')
        .gte('created_at', startDate.toISOString());

      if (error) {
        // Table doesn't exist - return empty stats (mock mode)
        console.warn('[Feedback Stats API] Supabase error, returning empty stats:', error.message);
        const emptyStats: AccuracyStats = {
          period,
          totalTranslations: 0,
          positiveRatings: 0,
          negativeRatings: 0,
          accuracyRate: 0,
          trend: 'insufficient_data',
        };
        return NextResponse.json({
          success: true,
          stats: emptyStats,
          mode: 'mock',
          note: 'Run migration to enable database storage',
        });
      }

      const total = feedback.length;
      const positive = feedback.filter(f => f.rating === 'positive').length;
      const negative = feedback.filter(f => f.rating === 'negative').length;
      const accuracyRate = total > 0 ? positive / total : 0;

      // Calculate trend (compare to previous period)
      const previousStart = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()));
      const { data: previousFeedback } = await supabase
        .from('translation_feedback')
        .select('rating')
        .gte('created_at', previousStart.toISOString())
        .lt('created_at', startDate.toISOString());

      let trend: AccuracyStats['trend'] = 'insufficient_data';
      if (previousFeedback && previousFeedback.length >= 10 && total >= 10) {
        const prevPositive = previousFeedback.filter(f => f.rating === 'positive').length;
        const prevAccuracy = prevPositive / previousFeedback.length;
        
        if (accuracyRate > prevAccuracy + 0.05) {
          trend = 'improving';
        } else if (accuracyRate < prevAccuracy - 0.05) {
          trend = 'declining';
        } else {
          trend = 'stable';
        }
      }

      const stats: AccuracyStats = {
        period,
        totalTranslations: total,
        positiveRatings: positive,
        negativeRatings: negative,
        accuracyRate: Math.round(accuracyRate * 10000) / 100, // Convert to percentage
        trend,
      };

      console.log('[Feedback Stats API] Returning stats:', stats);
      return NextResponse.json({
        success: true,
        stats,
      });
    }

    // Mock mode - return sample data
    const mockStats: AccuracyStats = {
      period,
      totalTranslations: 0,
      positiveRatings: 0,
      negativeRatings: 0,
      accuracyRate: 0,
      trend: 'insufficient_data',
    };

    return NextResponse.json({
      success: true,
      stats: mockStats,
      mode: 'mock',
    });

  } catch (error) {
    console.error('[Feedback Stats API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
