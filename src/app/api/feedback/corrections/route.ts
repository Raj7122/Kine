import { NextRequest, NextResponse } from 'next/server';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

export const runtime = 'nodejs';

/**
 * GET /api/feedback/corrections — List all learned corrections
 * DELETE /api/feedback/corrections — Clear all learned corrections (reset)
 */

export async function GET() {
  if (!isSupabaseConfigured || !supabase) {
    return NextResponse.json({ corrections: [], message: 'Supabase not configured' });
  }

  const { data, error } = await supabase
    .from('learned_corrections')
    .select('gemini_misrecognition, correct_sign, occurrence_count, last_seen_at')
    .order('occurrence_count', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ corrections: data ?? [] });
}

export async function DELETE(_request: NextRequest) {
  if (!isSupabaseConfigured || !supabase) {
    return NextResponse.json({ message: 'Supabase not configured' }, { status: 503 });
  }

  // Delete all learned corrections to start fresh
  const { error } = await supabase
    .from('learned_corrections')
    .delete()
    .not('id', 'is', null); // match all rows

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: 'All learned corrections cleared' });
}
