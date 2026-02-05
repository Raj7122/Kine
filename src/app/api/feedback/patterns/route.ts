/**
 * Feedback Patterns API Route
 *
 * Returns common misrecognition patterns from user corrections.
 * Used to identify areas for prompt improvement.
 */

import { NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

interface MisrecognitionPattern {
  geminiOutput: string;
  userCorrection: string;
  occurrenceCount: number;
  addedToPrompt: boolean;
  lastSeen: string;
}

export async function GET() {
  try {
    if (isSupabaseConfigured && supabase) {
      // Try to get from learned_corrections table first
      const { data: learnedData, error: learnedError } = await supabase
        .from('learned_corrections')
        .select('*')
        .order('occurrence_count', { ascending: false })
        .limit(20);

      if (!learnedError && learnedData && learnedData.length > 0) {
        const patterns: MisrecognitionPattern[] = learnedData.map(row => ({
          geminiOutput: row.gemini_misrecognition,
          userCorrection: row.correct_sign,
          occurrenceCount: row.occurrence_count,
          addedToPrompt: row.added_to_prompt,
          lastSeen: row.last_seen_at,
        }));

        return NextResponse.json({
          success: true,
          patterns,
          source: 'learned_corrections',
        });
      }

      // Fallback: aggregate from translation_feedback directly
      const { data: feedbackData, error: feedbackError } = await supabase
        .from('translation_feedback')
        .select('gemini_output, user_correction')
        .eq('rating', 'negative')
        .not('user_correction', 'is', null);

      if (feedbackError) {
        // Table doesn't exist - return empty patterns (mock mode)
        console.warn('[Feedback Patterns API] Supabase error, returning empty patterns:', feedbackError.message);
        return NextResponse.json({
          success: true,
          patterns: [],
          mode: 'mock',
          note: 'Run migration to enable database storage',
        });
      }

      // Aggregate patterns manually
      const patternMap = new Map<string, { count: number; lastSeen: string }>();
      
      for (const row of feedbackData || []) {
        const key = `${row.gemini_output}|${row.user_correction}`;
        const existing = patternMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          patternMap.set(key, { count: 1, lastSeen: new Date().toISOString() });
        }
      }

      const patterns: MisrecognitionPattern[] = Array.from(patternMap.entries())
        .map(([key, value]) => {
          const [geminiOutput, userCorrection] = key.split('|');
          return {
            geminiOutput,
            userCorrection,
            occurrenceCount: value.count,
            addedToPrompt: false,
            lastSeen: value.lastSeen,
          };
        })
        .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
        .slice(0, 20);

      return NextResponse.json({
        success: true,
        patterns,
        source: 'translation_feedback',
      });
    }

    // Mock mode - return sample patterns
    const mockPatterns: MisrecognitionPattern[] = [
      {
        geminiOutput: 'HELLO',
        userCorrection: 'HI',
        occurrenceCount: 5,
        addedToPrompt: false,
        lastSeen: new Date().toISOString(),
      },
      {
        geminiOutput: 'THANK',
        userCorrection: 'THANK-YOU',
        occurrenceCount: 3,
        addedToPrompt: false,
        lastSeen: new Date().toISOString(),
      },
    ];

    return NextResponse.json({
      success: true,
      patterns: mockPatterns,
      mode: 'mock',
    });

  } catch (error) {
    console.error('[Feedback Patterns API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
