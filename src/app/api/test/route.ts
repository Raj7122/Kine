import { NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { translateToGloss, isGeminiConfigured } from '@/lib/gemini';

interface TestResults {
  timestamp: string;
  supabase: {
    configured: boolean;
    status?: string;
    error?: string;
    avatarCount?: number;
    avatars?: Array<{ gloss_label: string; category: string }>;
  };
  gemini: {
    configured: boolean;
    status?: string;
    error?: string;
    testTranslation?: {
      input: string;
      gloss: string[];
      source: string;
    };
  };
}

export async function GET() {
  const results: TestResults = {
    timestamp: new Date().toISOString(),
    supabase: {
      configured: isSupabaseConfigured,
    },
    gemini: {
      configured: isGeminiConfigured,
    },
  };

  // Test Supabase connection
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase
        .from('avatar_library')
        .select('gloss_label, category')
        .limit(5);

      if (error) {
        results.supabase.status = 'error';
        results.supabase.error = error.message;
      } else {
        results.supabase.status = 'connected';
        results.supabase.avatarCount = data?.length || 0;
        results.supabase.avatars = data;
      }
    } catch (err) {
      results.supabase.status = 'error';
      results.supabase.error = err instanceof Error ? err.message : 'Unknown error';
    }
  }

  // Test Gemini API
  if (isGeminiConfigured) {
    try {
      const translation = await translateToGloss('Hello, how are you?');
      results.gemini.status = translation.source === 'gemini' ? 'connected' : 'fallback';
      results.gemini.testTranslation = translation;
    } catch (err) {
      results.gemini.status = 'error';
      results.gemini.error = err instanceof Error ? err.message : 'Unknown error';
    }
  }

  return NextResponse.json(results, { status: 200 });
}
