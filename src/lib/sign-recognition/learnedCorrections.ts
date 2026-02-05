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

const RUNTIME_MIN_OCCURRENCES = 3;
const CACHE_TTL_MS = 60_000;

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
