import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';

export interface PromptCorrectionPattern {
  geminiMisrecognition: string;
  correctSign: string;
  occurrenceCount: number;
  addedToPrompt: boolean;
  promptVersion: number | null;
}

export interface PromptAugmentationResult {
  prompt: string;
  patternsUsed: PromptCorrectionPattern[];
}

// Raised from 5 to 999 to effectively disable stale corrections.
// The learned_corrections table has poisoned data from mock/rate-limited sessions.
// Clear the table in Supabase dashboard, then set this back to 5.
const MIN_OCCURRENCES = 999;
const MAX_PATTERNS = 10;
const MAX_CORRECTIONS_PER_MISRECOGNITION = 4;
const CACHE_TTL_MS = 60_000;

let cachedAt = 0;
let cachedRows: PromptCorrectionPattern[] | null = null;

function sanitizePromptValue(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .slice(0, 120);
}

function buildAugmentationSection(patterns: PromptCorrectionPattern[]): string {
  if (patterns.length === 0) return '';

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

  const orderedGroups = [...grouped.values()].sort((a, b) => {
    const scoreA = Math.max(...a.map((p) => p.occurrenceCount));
    const scoreB = Math.max(...b.map((p) => p.occurrenceCount));
    return scoreB - scoreA;
  });

  const lines: string[] = [
    '',
    '## LEARNED CORRECTIONS FROM USER FEEDBACK',
    '',
    'The following corrections are based on real user feedback. Apply these learned patterns:',
    '',
  ];

  for (const groupPatterns of orderedGroups) {
    const top = [...groupPatterns].sort((a, b) => b.occurrenceCount - a.occurrenceCount)[0];
    if (!top) continue;
    const mis = sanitizePromptValue(top.geminiMisrecognition);
    if (!mis) continue;

    const byCorrect = new Map<string, { corr: string; count: number }>();
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

    if (corrections.length === 1) {
      lines.push(`- When you would output "${mis}", strongly consider "${corrections[0].corr}" instead`);
      continue;
    }

    const corrList = corrections.map((c) => `"${c.corr}"`).join(', ');
    lines.push(
      `- The output "${mis}" can be ambiguous and has been corrected by users to: ${corrList}. Use motion/context to choose the correct meaning.`
    );
  }

  lines.push('');
  return lines.join('\n');
}

async function fetchPromptPatterns(promptVersion: number, now: number): Promise<PromptCorrectionPattern[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  // Include:
  // - patterns already associated with this promptVersion
  // - new patterns not yet added to any prompt
  const { data, error } = await supabase
    .from('learned_corrections')
    .select('gemini_misrecognition, correct_sign, occurrence_count, added_to_prompt, prompt_version')
    .gte('occurrence_count', MIN_OCCURRENCES)
    .or(`and(added_to_prompt.eq.false),and(prompt_version.eq.${promptVersion})`)
    .order('occurrence_count', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[SignRecognize] Failed to fetch learned_corrections for prompt augmentation:', error.message);
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

  // Use SECURITY DEFINER RPC (preferred). If it doesn't exist, fail open.
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
      console.warn('[SignRecognize] mark_prompt_patterns_added RPC failed:', error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[SignRecognize] mark_prompt_patterns_added RPC threw:', message);
  }
}

export async function buildAugmentedPrompt(
  basePrompt: string,
  promptVersion: number,
  now: number = Date.now()
): Promise<PromptAugmentationResult> {
  const rows = await getPromptPatterns(promptVersion, now);

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

  const section = buildAugmentationSection(selectedPatterns);
  return {
    prompt: `${basePrompt}${section}`,
    patternsUsed: selectedPatterns,
  };
}

export function clearPromptAugmentationCacheForTests() {
  cachedAt = 0;
  cachedRows = null;
}
