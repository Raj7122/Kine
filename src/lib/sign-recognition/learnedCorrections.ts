import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

export interface LearnedCorrection {
  geminiMisrecognition: string;
  correctSign: string;
  occurrenceCount: number;
}

export interface RuntimeCorrectionResult {
  text: string;
  originalText: string;
  corrected: boolean;
  applied?: LearnedCorrection;
}

// Raised from 3 to 999 to effectively disable stale corrections.
// The learned_corrections table has poisoned data from mock/rate-limited sessions.
// Clear the table in Supabase dashboard, then set this back to 3.
const RUNTIME_MIN_OCCURRENCES = 999;
const CACHE_TTL_MS = 10_000;

let cachedAt = 0;
let cachedMap: Map<string, LearnedCorrection> | null = null;

export function normalizeLearnedCorrectionKey(text: string): string {
  return text
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function buildRuntimeCorrectionMap(rows: LearnedCorrection[]): Map<string, LearnedCorrection> {
  const grouped = new Map<string, LearnedCorrection[]>();

  for (const row of rows) {
    const key = normalizeLearnedCorrectionKey(row.geminiMisrecognition);
    const normalizedCorrect = normalizeLearnedCorrectionKey(row.correctSign);

    if (!key || !normalizedCorrect || normalizedCorrect === key) {
      continue;
    }

    const existing = grouped.get(key);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  const map = new Map<string, LearnedCorrection>();
  for (const [key, candidates] of grouped.entries()) {
    const byCorrect = new Map<string, LearnedCorrection>();

    for (const candidate of candidates) {
      const corrKey = normalizeLearnedCorrectionKey(candidate.correctSign);
      if (!corrKey || corrKey === key) continue;

      const existing = byCorrect.get(corrKey);
      if (!existing || candidate.occurrenceCount > existing.occurrenceCount) {
        byCorrect.set(corrKey, candidate);
      }
    }

    if (byCorrect.size !== 1) {
      continue;
    }

    const only = byCorrect.values().next().value as LearnedCorrection | undefined;
    if (only) {
      map.set(key, only);
    }
  }

  // Remove circular corrections: if A→B and B→A both exist, keep only
  // the one with the higher occurrence count (more recent user consensus).
  // If counts are equal, remove both (contested — let Gemini decide).
  const toRemove: string[] = [];
  for (const [key, correction] of map.entries()) {
    const reverseKey = normalizeLearnedCorrectionKey(correction.correctSign);
    const reverse = map.get(reverseKey);
    if (!reverse) continue;

    const reverseTargetKey = normalizeLearnedCorrectionKey(reverse.correctSign);
    if (reverseTargetKey !== key) continue;

    // Circular: A→B and B→A both exist
    if (correction.occurrenceCount < reverse.occurrenceCount) {
      toRemove.push(key);
    } else if (correction.occurrenceCount === reverse.occurrenceCount) {
      toRemove.push(key);
      toRemove.push(reverseKey);
    }
    // If correction.occurrenceCount > reverse.occurrenceCount, keep this one
    // (the reverse will be removed when we encounter it in the loop)
  }

  for (const key of toRemove) {
    const removed = map.get(key);
    if (removed) {
      console.log(`[SignRecognize] Suppressed circular correction: "${key}" -> "${removed.correctSign}" (count: ${removed.occurrenceCount})`);
      map.delete(key);
    }
  }

  return map;
}

async function fetchRuntimeCorrectionsMap(now: number): Promise<Map<string, LearnedCorrection>> {
  if (!isSupabaseConfigured || !supabase) return new Map();

  const { data, error } = await supabase
    .from('learned_corrections')
    .select('gemini_misrecognition, correct_sign, occurrence_count')
    .gte('occurrence_count', RUNTIME_MIN_OCCURRENCES)
    .order('occurrence_count', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[SignRecognize] Failed to fetch learned_corrections for runtime apply:', error.message);
    return new Map();
  }

  const rows: LearnedCorrection[] = (data ?? []).map((r) => ({
    geminiMisrecognition: r.gemini_misrecognition,
    correctSign: r.correct_sign,
    occurrenceCount: r.occurrence_count,
  }));

  console.log(`[SignRecognize] Fetched ${rows.length} learned corrections from DB (threshold: ${RUNTIME_MIN_OCCURRENCES})`);
  if (rows.length > 0) {
    for (const r of rows.slice(0, 5)) {
      console.log(`[SignRecognize]   "${r.geminiMisrecognition}" -> "${r.correctSign}" (count: ${r.occurrenceCount})`);
    }
  }

  cachedAt = now;
  cachedMap = buildRuntimeCorrectionMap(rows);
  return cachedMap;
}

export async function getRuntimeCorrectionsMap(now: number = Date.now()): Promise<Map<string, LearnedCorrection>> {
  if (cachedMap && now - cachedAt < CACHE_TTL_MS) return cachedMap;
  return fetchRuntimeCorrectionsMap(now);
}

export function applyRuntimeCorrectionFromMap(
  originalText: string,
  map: Map<string, LearnedCorrection>
): RuntimeCorrectionResult {
  const key = normalizeLearnedCorrectionKey(originalText);
  const match = map.get(key);

  if (!match) {
    return { text: originalText, originalText, corrected: false };
  }

  const correctedText = match.correctSign.trim();
  const corrected = correctedText.length > 0 && correctedText !== originalText;

  return {
    text: corrected ? correctedText : originalText,
    originalText,
    corrected,
    applied: corrected ? match : undefined,
  };
}

export async function applyRuntimeLearnedCorrections(originalText: string): Promise<RuntimeCorrectionResult> {
  const map = await getRuntimeCorrectionsMap();
  return applyRuntimeCorrectionFromMap(originalText, map);
}

export function clearRuntimeCorrectionsCacheForTests() {
  cachedAt = 0;
  cachedMap = null;
}
