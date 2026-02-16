import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  ACCURACY_THRESHOLD,
  MIN_FEEDBACK_COUNT,
  CONTEXT_DEP_MIN_CORRECTIONS,
  DOMINANT_CORRECTION_RATIO,
  type SignAccuracyRecord,
} from './promptAugmentation';

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
const CACHE_TTL_MS = 10_000;

let cachedAt = 0;
let cachedMap: Map<string, LearnedCorrection> | null = null;
let cachedAccuracyAt = 0;
let cachedAccuracyMap: Map<string, SignAccuracyRecord> | null = null;

export function normalizeLearnedCorrectionKey(text: string): string {
  return text
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

export function buildRuntimeCorrectionMap(
  rows: LearnedCorrection[],
  accuracyMap?: Map<string, SignAccuracyRecord>,
): Map<string, LearnedCorrection> {
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
    // Accuracy gate: skip if sign accuracy is above threshold
    if (accuracyMap) {
      const record = accuracyMap.get(key);
      if (record) {
        const total = record.totalPositive + record.totalNegative;
        if (total >= MIN_FEEDBACK_COUNT) {
          const accuracy = record.totalPositive / total;
          if (accuracy >= ACCURACY_THRESHOLD) {
            continue;
          }
        }
      }
    }

    const byCorrect = new Map<string, LearnedCorrection>();

    for (const candidate of candidates) {
      const corrKey = normalizeLearnedCorrectionKey(candidate.correctSign);
      if (!corrKey || corrKey === key) continue;

      const existing = byCorrect.get(corrKey);
      if (!existing || candidate.occurrenceCount > existing.occurrenceCount) {
        byCorrect.set(corrKey, candidate);
      }
    }

    if (byCorrect.size === 0) {
      continue;
    }

    // Context-dependency skip: if 3+ corrections with no dominant winner,
    // don't auto-correct — let Gemini handle it via the augmented prompt.
    if (byCorrect.size >= CONTEXT_DEP_MIN_CORRECTIONS) {
      const sorted = [...byCorrect.values()].sort(
        (a, b) => b.occurrenceCount - a.occurrenceCount
      );
      const totalCount = sorted.reduce((sum, c) => sum + c.occurrenceCount, 0);
      const topRatio = sorted[0].occurrenceCount / totalCount;
      if (topRatio <= DOMINANT_CORRECTION_RATIO) {
        console.log(`[SignRecognize] Skipped context-dependent sign: "${key}" (${byCorrect.size} corrections, no dominant)`);
        continue;
      }
    }

    // Pick the correction with the highest occurrence count.
    // If the top candidate has strictly more occurrences than the runner-up,
    // use it. If tied, skip (too ambiguous).
    const sorted = [...byCorrect.values()].sort(
      (a, b) => b.occurrenceCount - a.occurrenceCount
    );
    const top = sorted[0];
    const runnerUp = sorted[1];

    if (!top) continue;

    if (!runnerUp || top.occurrenceCount > runnerUp.occurrenceCount) {
      map.set(key, top);
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

async function fetchSignAccuracyForRuntime(now: number): Promise<Map<string, SignAccuracyRecord>> {
  if (!isSupabaseConfigured || !supabase) return new Map();

  const { data, error } = await supabase
    .from('sign_accuracy')
    .select('sign_text, total_positive, total_negative')
    .order('last_updated_at', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[SignRecognize] Failed to fetch sign_accuracy for runtime:', error.message);
    return new Map();
  }

  const map = new Map<string, SignAccuracyRecord>();
  for (const row of data ?? []) {
    map.set(row.sign_text.toUpperCase(), {
      signText: row.sign_text,
      totalPositive: row.total_positive,
      totalNegative: row.total_negative,
    });
  }

  cachedAccuracyAt = now;
  cachedAccuracyMap = map;
  return map;
}

async function getSignAccuracyForRuntime(now: number): Promise<Map<string, SignAccuracyRecord>> {
  if (cachedAccuracyMap && now - cachedAccuracyAt < CACHE_TTL_MS) return cachedAccuracyMap;
  return fetchSignAccuracyForRuntime(now);
}

async function fetchRuntimeCorrectionsMap(now: number): Promise<Map<string, LearnedCorrection>> {
  if (!isSupabaseConfigured || !supabase) return new Map();

  const [correctionsResult, accuracyMap] = await Promise.all([
    supabase
      .from('learned_corrections')
      .select('gemini_misrecognition, correct_sign, occurrence_count')
      .gte('occurrence_count', RUNTIME_MIN_OCCURRENCES)
      .order('occurrence_count', { ascending: false })
      .limit(200),
    getSignAccuracyForRuntime(now),
  ]);

  const { data, error } = correctionsResult;

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
  cachedMap = buildRuntimeCorrectionMap(rows, accuracyMap);
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
  cachedAccuracyAt = 0;
  cachedAccuracyMap = null;
}
