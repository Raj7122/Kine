/**
 * Feedback API Route
 *
 * Handles submission of translation feedback (ratings and corrections).
 * Stores data in Supabase for analysis and prompt improvement.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { recordFeedbackTrackingEvent } from '@/lib/sign-recognition/monitoring';

interface FeedbackRequest {
  sessionId: string;
  translationId?: string;
  sampleId?: string;
  geminiOutput: string;
  rating: 'positive' | 'negative';
  userCorrection?: string;
  alternateCorrections?: string[];
  landmarkData?: object;
  confidenceScore?: number;
  originalText?: string;
  corrected?: boolean;
  correctedText?: string;
  source?: string;
}

// In-memory storage for mock mode
const mockFeedbackStore: FeedbackRequest[] = [];

type FeedbackSummaryRow = Partial<FeedbackRequest> & {
  session_id?: string;
  gemini_output?: string;
  user_correction?: string | null;
};

function normalizeMetricText(value: string | null | undefined): string {
  return (value || '').trim().toUpperCase();
}

function buildFeedbackSummary(rows: FeedbackSummaryRow[]) {
  const positive = rows.filter((row) => row.rating === 'positive').length;
  const negative = rows.filter((row) => row.rating === 'negative').length;

  const correctionPairCounts = new Map<string, { from: string; to: string; count: number }>();
  for (const row of rows) {
    const from = normalizeMetricText(
      row.gemini_output || row.geminiOutput || row.originalText || row.correctedText || null
    );
    const to = normalizeMetricText(row.user_correction || row.userCorrection || null);
    if (!from || !to) continue;

    const key = `${from}=>${to}`;
    const existing = correctionPairCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      correctionPairCounts.set(key, { from, to, count: 1 });
    }
  }

  const topCorrections = [...correctionPairCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total: rows.length,
    positive,
    negative,
    positiveRate: rows.length > 0 ? Number((positive / rows.length).toFixed(4)) : 0,
    topCorrections,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: FeedbackRequest = await request.json();

    const geminiOutputToStore = body.correctedText || body.geminiOutput;

    const contextData = (() => {
      const base =
        body.landmarkData && typeof body.landmarkData === 'object' ? body.landmarkData : null;

      const recognitionMeta = {
        originalText: body.originalText ?? null,
        correctedText: body.correctedText ?? null,
        corrected: body.corrected ?? null,
        source: body.source ?? null,
      };

      if (!base) {
        return { recognition: recognitionMeta };
      }

      return {
        ...base,
        recognition: recognitionMeta,
      };
    })();

    const primaryCorrection = typeof body.userCorrection === 'string' ? body.userCorrection.trim() : '';
    const alternateCorrections = Array.isArray(body.alternateCorrections)
      ? body.alternateCorrections
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v.length > 0 && v !== primaryCorrection)
      : [];

    const trackFeedback = () => {
      recordFeedbackTrackingEvent({
        sessionId: body.sessionId,
        sampleId: body.sampleId,
        rating: body.rating,
        source: body.source,
        originalText: body.originalText,
        correctedText: body.correctedText,
        userCorrection: primaryCorrection || undefined,
      });
    };

    // Validate required fields
    if (!body.sessionId || !body.geminiOutput || !body.rating) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: sessionId, geminiOutput, rating' },
        { status: 400 }
      );
    }

    // Validate rating value
    if (!['positive', 'negative'].includes(body.rating)) {
      return NextResponse.json(
        { success: false, error: 'Rating must be "positive" or "negative"' },
        { status: 400 }
      );
    }

    // Require correction for negative ratings
    if (body.rating === 'negative' && !primaryCorrection) {
      return NextResponse.json(
        { success: false, error: 'Negative ratings require a userCorrection' },
        { status: 400 }
      );
    }

    // Embed alternate corrections in landmark_data metadata
    const enrichedContextData = alternateCorrections.length > 0
      ? { ...(contextData || {}), alternateCorrections }
      : contextData;

    // Store feedback
    if (isSupabaseConfigured && supabase) {
      const insertPayload = {
        session_id: body.sessionId,
        translation_id: body.translationId || crypto.randomUUID(),
        sample_id: body.sampleId || null,
        gemini_output: geminiOutputToStore,
        rating: body.rating,
        user_correction: primaryCorrection || null,
        landmark_data: enrichedContextData || null,
        confidence_score: body.confidenceScore || null,
      };

      const { data, error } = await supabase
        .from('translation_feedback')
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        const errorMessage = error.message || 'Unknown Supabase error';
        const errorCode = error.code;

        const isMissingSampleColumn =
          errorCode === '42703' ||
          errorMessage.includes('column "sample_id"') ||
          errorMessage.includes('sample_id');

        if (isMissingSampleColumn) {
          const fallbackPayload: Record<string, unknown> = { ...insertPayload };
          delete fallbackPayload.sample_id;
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('translation_feedback')
            .insert(fallbackPayload)
            .select()
            .single();

          if (!fallbackError && fallbackData) {
            console.log('[Feedback API] Stored feedback (without sample_id):', fallbackData.id);
            trackFeedback();
            return NextResponse.json({
              success: true,
              feedbackId: fallbackData.id,
              message: 'Feedback recorded successfully',
            });
          }
        }

        const isMissingTable =
          errorCode === '42P01' ||
          errorMessage.includes('relation "translation_feedback" does not exist') ||
          errorMessage.includes('relation "public.translation_feedback" does not exist');

        if (isMissingTable) {
          mockFeedbackStore.push(body);
          return NextResponse.json({
            success: true,
            feedbackId: `mock-${Date.now()}`,
            message: 'Feedback recorded (mock mode - run migration to enable database)',
            mode: 'mock',
          });
        }

        const isRlsViolation =
          errorCode === '42501' ||
          errorMessage.toLowerCase().includes('row-level security');

        console.error('[Feedback API] Supabase error:', error);
        return NextResponse.json(
          {
            success: false,
            error: isRlsViolation
              ? 'Database policy blocked feedback write. Ensure the learned_corrections trigger function is SECURITY DEFINER (see migration 004 fix).'
              : `Failed to store feedback: ${errorMessage}`,
          },
          { status: 500 }
        );
      }

      console.log('[Feedback API] Stored feedback:', data.id);
      trackFeedback();
      return NextResponse.json({
        success: true,
        feedbackId: data.id,
        message: 'Feedback recorded successfully',
      });
    }

    // Mock mode - store in memory
    mockFeedbackStore.push(body);
    trackFeedback();
    console.log('[Feedback API] Mock mode - stored feedback, total:', mockFeedbackStore.length);

    return NextResponse.json({
      success: true,
      feedbackId: `mock-${Date.now()}`,
      message: 'Feedback recorded (mock mode)',
    });

  } catch (error) {
    console.error('[Feedback API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId')?.trim() || null;
    const summaryOnly = ['1', 'true', 'yes'].includes((url.searchParams.get('summary') || '').toLowerCase());
    const parsedLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, Math.floor(parsedLimit))) : 50;

    if (isSupabaseConfigured && supabase) {
      // Get recent feedback for debugging/admin purposes
      let query = supabase
        .from('translation_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (sessionId) {
        query = query.eq('session_id', sessionId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[Feedback API] Supabase error:', error);
        return NextResponse.json(
          { success: false, error: 'Failed to fetch feedback' },
          { status: 500 }
        );
      }

      const summary = buildFeedbackSummary(data as FeedbackSummaryRow[]);

      return NextResponse.json({
        success: true,
        count: data.length,
        feedback: summaryOnly ? [] : data,
        summary,
        sessionId,
      });
    }

    // Mock mode
    const filtered = sessionId
      ? mockFeedbackStore.filter((item) => item.sessionId === sessionId)
      : mockFeedbackStore;

    const limitedFeedback = filtered.slice(-limit).reverse();
    const summary = buildFeedbackSummary(limitedFeedback);

    return NextResponse.json({
      success: true,
      count: limitedFeedback.length,
      feedback: summaryOnly ? [] : limitedFeedback,
      summary,
      sessionId,
      mode: 'mock',
    });

  } catch (error) {
    console.error('[Feedback API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
