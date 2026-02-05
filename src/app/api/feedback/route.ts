/**
 * Feedback API Route
 *
 * Handles submission of translation feedback (ratings and corrections).
 * Stores data in Supabase for analysis and prompt improvement.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

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

export async function POST(request: NextRequest) {
  try {
    const body: FeedbackRequest = await request.json();

    const geminiOutputToStore =
      body.rating === 'negative'
        ? body.originalText || body.geminiOutput
        : body.correctedText || body.geminiOutput;

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
          const { sample_id: _sampleId, ...fallbackPayload } = insertPayload;
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('translation_feedback')
            .insert(fallbackPayload)
            .select()
            .single();

          if (!fallbackError && fallbackData) {
            console.log('[Feedback API] Stored feedback (without sample_id):', fallbackData.id);
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
      return NextResponse.json({
        success: true,
        feedbackId: data.id,
        message: 'Feedback recorded successfully',
      });
    }

    // Mock mode - store in memory
    mockFeedbackStore.push(body);
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

export async function GET() {
  try {
    if (isSupabaseConfigured && supabase) {
      // Get recent feedback for debugging/admin purposes
      const { data, error } = await supabase
        .from('translation_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[Feedback API] Supabase error:', error);
        return NextResponse.json(
          { success: false, error: 'Failed to fetch feedback' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        count: data.length,
        feedback: data,
      });
    }

    // Mock mode
    return NextResponse.json({
      success: true,
      count: mockFeedbackStore.length,
      feedback: mockFeedbackStore.slice(-50),
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
