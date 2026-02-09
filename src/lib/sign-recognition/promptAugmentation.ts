import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { buildDisambiguationHint, buildContextRules } from './signDefinitions';

// ─── Public types ──────────────────────────────────────────────

export interface PromptCorrectionPattern {
  geminiMisrecognition: string;
  correctSign: string;
  occurrenceCount: number;
  addedToPrompt: boolean;
  promptVersion: number | null;
}

export interface SignAccuracyRecord {
  signText: string;
  totalPositive: number;
  totalNegative: number;
}

export interface PromptAugmentationResult {
  prompt: string;
  patternsUsed: PromptCorrectionPattern[];
}

// ─── Constants ─────────────────────────────────────────────────

const MIN_OCCURRENCES = 2;
const MAX_PATTERNS = 10;
const MAX_CORRECTIONS_PER_MISRECOGNITION = 4;
const CACHE_TTL_MS = 60_000;

/** Only inject corrections for signs whose accuracy is below this threshold. */
export const ACCURACY_THRESHOLD = 0.70;
/** Minimum total feedback (positive + negative) before accuracy is reliable. */
export const MIN_FEEDBACK_COUNT = 5;
/** Number of distinct corrections to classify a sign as context-dependent. */
export const CONTEXT_DEP_MIN_CORRECTIONS = 3;
/** If one correction accounts for >60% of negative feedback, treat as standard confusion pair. */
export const DOMINANT_CORRECTION_RATIO = 0.60;

// ─── Caches ────────────────────────────────────────────────────

let cachedAt = 0;
let cachedRows: PromptCorrectionPattern[] | null = null;
let cachedAccuracyAt = 0;
let cachedAccuracy: Map<string, SignAccuracyRecord> | null = null;

// ─── Helpers ───────────────────────────────────────────────────

export function sanitizePromptValue(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .slice(0, 120);
}

// ─── Sign accuracy fetching ────────────────────────────────────

async function fetchSignAccuracy(now: number): Promise<Map<string, SignAccuracyRecord>> {
  if (!isSupabaseConfigured || !supabase) return new Map();

  const { data, error } = await supabase
    .from('sign_accuracy')
    .select('sign_text, total_positive, total_negative')
    .order('last_updated_at', { ascending: false })
    .limit(200);

  if (error) {
    console.warn('[PromptAug] Failed to fetch sign_accuracy:', error.message);
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
  cachedAccuracy = map;
  return map;
}

async function getSignAccuracy(now: number): Promise<Map<string, SignAccuracyRecord>> {
  if (cachedAccuracy && now - cachedAccuracyAt < CACHE_TTL_MS) return cachedAccuracy;
  return fetchSignAccuracy(now);
}

/**
 * Compute accuracy ratio for a sign. Returns null if insufficient data.
 */
export function computeAccuracy(record: SignAccuracyRecord | undefined): number | null {
  if (!record) return null;
  const total = record.totalPositive + record.totalNegative;
  if (total < MIN_FEEDBACK_COUNT) return null;
  return record.totalPositive / total;
}

// ─── Augmentation section builder (confusion-pair format) ──────

interface CorrectionEntry {
  corr: string;
  count: number;
}

function buildAugmentationSection(
  patterns: PromptCorrectionPattern[],
  accuracyMap: Map<string, SignAccuracyRecord>,
): string {
  if (patterns.length === 0) return '';

  // Group patterns by misrecognized sign
  const grouped = new Map<string, PromptCorrectionPattern[]>();

  for (const pattern of patterns) {
    const mis = sanitizePromptValue(pattern.geminiMisrecognition);
    const corr = sanitizePromptValue(pattern.correctSign);
    if (!mis || !corr) continue;
    if (mis.toUpperCase() === corr.toUpperCase()) continue;

    const key = mis.toUpperCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.push(pattern);
    } else {
      grouped.set(key, [pattern]);
    }
  }

  if (grouped.size === 0) return '';

  // Chain suppression: detect A→B and B→C, suppress weaker links
  const correctionTargets = new Map<string, { from: string; count: number }>();
  for (const [misKey, groupPatterns] of grouped.entries()) {
    for (const p of groupPatterns) {
      const corrKey = sanitizePromptValue(p.correctSign).toUpperCase();
      const existing = correctionTargets.get(corrKey);
      if (!existing || p.occurrenceCount > existing.count) {
        correctionTargets.set(corrKey, { from: misKey, count: p.occurrenceCount });
      }
    }
  }

  // If sign B is both a correction target (A→B) and a misrecognition source (B→C),
  // suppress the weaker direction
  const suppressedKeys = new Set<string>();
  for (const [misKey] of grouped.entries()) {
    const asTarget = correctionTargets.get(misKey);
    if (asTarget) {
      // misKey appears as both source and target — it's in a chain
      // Suppress whichever direction has fewer occurrences
      const sourceMax = Math.max(
        ...(grouped.get(misKey) ?? []).map((p) => p.occurrenceCount)
      );
      if (asTarget.count > sourceMax) {
        suppressedKeys.add(misKey);
        console.log(`[PromptAug] Suppressed chain link: "${misKey}" (target count ${asTarget.count} > source count ${sourceMax})`);
      }
    }
  }

  const lines: string[] = [
    '',
    '## LEARNED CORRECTIONS FROM USER FEEDBACK',
    '',
    'The following confusion pairs are based on real user feedback. Use the distinguishing features to choose correctly:',
    '',
  ];

  let emittedCount = 0;

  // Sort groups by highest occurrence count
  const orderedGroups = [...grouped.entries()]
    .filter(([key]) => !suppressedKeys.has(key))
    .sort((a, b) => {
      const scoreA = Math.max(...a[1].map((p) => p.occurrenceCount));
      const scoreB = Math.max(...b[1].map((p) => p.occurrenceCount));
      return scoreB - scoreA;
    });

  for (const [misKey, groupPatterns] of orderedGroups) {
    if (emittedCount >= MAX_PATTERNS) break;

    // Accuracy gate: skip if sign accuracy is above threshold
    const accuracyRecord = accuracyMap.get(misKey);
    const accuracy = computeAccuracy(accuracyRecord);
    if (accuracy !== null && accuracy >= ACCURACY_THRESHOLD) {
      continue;
    }

    // Deduplicate corrections by sign name
    const byCorrect = new Map<string, CorrectionEntry>();
    for (const p of groupPatterns) {
      const corr = sanitizePromptValue(p.correctSign);
      if (!corr) continue;
      const corrKey = corr.toUpperCase();
      const existing = byCorrect.get(corrKey);
      if (!existing || p.occurrenceCount > existing.count) {
        byCorrect.set(corrKey, { corr, count: p.occurrenceCount });
      }
    }

    const corrections = [...byCorrect.values()]
      .filter((c) => c.corr.trim().length > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CORRECTIONS_PER_MISRECOGNITION);

    if (corrections.length === 0) continue;

    const mis = sanitizePromptValue(groupPatterns[0].geminiMisrecognition);
    if (!mis) continue;

    const accuracyStr = accuracy !== null
      ? ` (accuracy: ${Math.round(accuracy * 100)}%)`
      : '';
    const totalNegative = corrections.reduce((sum, c) => sum + c.count, 0);

    // Context-dependent: 3+ distinct corrections with no dominant one
    if (corrections.length >= CONTEXT_DEP_MIN_CORRECTIONS) {
      const topRatio = corrections[0].count / totalNegative;

      if (topRatio <= DOMINANT_CORRECTION_RATIO) {
        // No dominant correction — emit context-dependent format
        const corrSummary = corrections
          .map((c) => `${c.corr} (${Math.round((c.count / totalNegative) * 100)}%)`)
          .join(', ');

        lines.push(`- "${mis}" is context-dependent${accuracyStr}. Confused with: ${corrSummary}.`);

        const contextRules = buildContextRules(
          mis,
          corrections.map((c) => ({
            sign: c.corr,
            percentage: Math.round((c.count / totalNegative) * 100),
          }))
        );
        if (contextRules.length > 0) {
          lines.push('  Context rules:');
          for (const rule of contextRules) {
            lines.push(`  • ${rule}`);
          }
        }
        lines.push('  Decide based on motion direction and handshape, not just hand position.');

        emittedCount++;
        continue;
      }
      // Fall through to standard confusion pair if one correction is dominant
    }

    // Standard confusion pair (1-2 corrections, or 3+ with a dominant one)
    const topCorr = corrections[0];
    const hint = buildDisambiguationHint(mis, topCorr.corr);

    let line = `- "${mis}" and "${topCorr.corr}" are frequently confused${accuracyStr}.`;
    if (hint) {
      line += ` Distinguish by: ${hint}.`;
    }
    if (corrections.length > 1) {
      const others = corrections.slice(1).map((c) => `"${c.corr}"`).join(', ');
      line += ` Also confused with: ${others}.`;
    }

    lines.push(line);
    emittedCount++;
  }

  // If no corrections passed the accuracy gate, return empty
  if (emittedCount === 0) return '';

  lines.push('');
  return lines.join('\n');
}

// ─── Learned corrections fetching ──────────────────────────────

async function fetchPromptPatterns(promptVersion: number, now: number): Promise<PromptCorrectionPattern[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase
    .from('learned_corrections')
    .select('gemini_misrecognition, correct_sign, occurrence_count, added_to_prompt, prompt_version')
    .gte('occurrence_count', MIN_OCCURRENCES)
    .or(`and(added_to_prompt.eq.false),and(prompt_version.eq.${promptVersion})`)
    .order('occurrence_count', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[PromptAug] Failed to fetch learned_corrections:', error.message);
    return [];
  }

  const rows: PromptCorrectionPattern[] = (data ?? []).map((r) => ({
    geminiMisrecognition: r.gemini_misrecognition,
    correctSign: r.correct_sign,
    occurrenceCount: r.occurrence_count,
    addedToPrompt: r.added_to_prompt,
    promptVersion: r.prompt_version,
  }));

  cachedAt = now;
  cachedRows = rows;
  return rows;
}

async function getPromptPatterns(promptVersion: number, now: number): Promise<PromptCorrectionPattern[]> {
  if (cachedRows && now - cachedAt < CACHE_TTL_MS) return cachedRows;
  return fetchPromptPatterns(promptVersion, now);
}

async function markPatternsAdded(patterns: PromptCorrectionPattern[], promptVersion: number): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  if (patterns.length === 0) return;

  try {
    const payload = patterns.map((p) => ({
      gemini_misrecognition: p.geminiMisrecognition,
      correct_sign: p.correctSign,
    }));

    const { error } = await supabase.rpc('mark_prompt_patterns_added', {
      p_patterns: payload,
      p_prompt_version: promptVersion,
    });

    if (error) {
      console.warn('[PromptAug] mark_prompt_patterns_added RPC failed:', error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[PromptAug] mark_prompt_patterns_added RPC threw:', message);
  }
}

// ─── Main entry point ──────────────────────────────────────────

export async function buildAugmentedPrompt(
  basePrompt: string,
  promptVersion: number,
  now: number = Date.now()
): Promise<PromptAugmentationResult> {
  const [rows, accuracyMap] = await Promise.all([
    getPromptPatterns(promptVersion, now),
    getSignAccuracy(now),
  ]);

  // Deduplicate and group patterns
  const grouped = new Map<string, Map<string, PromptCorrectionPattern>>();

  for (const row of rows) {
    const mis = sanitizePromptValue(row.geminiMisrecognition);
    const corr = sanitizePromptValue(row.correctSign);
    if (!mis || !corr) continue;
    if (mis.toUpperCase() === corr.toUpperCase()) continue;

    const misKey = mis.toUpperCase();
    const corrKey = corr.toUpperCase();

    const existingGroup = grouped.get(misKey);
    const group = existingGroup ?? new Map<string, PromptCorrectionPattern>();
    const existingPattern = group.get(corrKey);

    if (!existingPattern || row.occurrenceCount > existingPattern.occurrenceCount) {
      group.set(corrKey, row);
    }

    if (!existingGroup) {
      grouped.set(misKey, group);
    }
  }

  const groups = [...grouped.values()]
    .map((byCorrect) => {
      const patterns = [...byCorrect.values()]
        .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
        .slice(0, MAX_CORRECTIONS_PER_MISRECOGNITION);
      const score = patterns[0]?.occurrenceCount ?? 0;
      return { patterns, score };
    })
    .filter((g) => g.patterns.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PATTERNS);

  const selectedPatterns = groups.flatMap((g) => g.patterns);

  const toMark = selectedPatterns.filter(
    (p) => !p.addedToPrompt || p.promptVersion !== promptVersion
  );
  await markPatternsAdded(toMark, promptVersion);

  const section = buildAugmentationSection(selectedPatterns, accuracyMap);
  return {
    prompt: `${basePrompt}${section}`,
    patternsUsed: selectedPatterns,
  };
}

export function clearPromptAugmentationCacheForTests() {
  cachedAt = 0;
  cachedRows = null;
  cachedAccuracyAt = 0;
  cachedAccuracy = null;
}
