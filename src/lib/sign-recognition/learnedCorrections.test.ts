import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SignAccuracyRecord } from './promptAugmentation';

const { mockSupabase, setCorrectionsResponse, setAccuracyResponse } = vi.hoisted(() => {
  type SupabaseError = { message: string };
  type LearnedCorrectionsQueryRow = {
    gemini_misrecognition: string;
    correct_sign: string;
    occurrence_count: number;
  };
  type AccuracyQueryRow = {
    sign_text: string;
    total_positive: number;
    total_negative: number;
  };
  type CorrResponse = { data: LearnedCorrectionsQueryRow[] | null; error: SupabaseError | null };
  type AccResponse = { data: AccuracyQueryRow[] | null; error: SupabaseError | null };

  let corrResponse: CorrResponse = { data: [], error: null };
  let accResponse: AccResponse = { data: [], error: null };

  const makeBuilder = (getResponse: () => { data: unknown; error: unknown }) => {
    const b: Record<string, ReturnType<typeof vi.fn>> = {};
    b.select = vi.fn(() => b);
    b.gte = vi.fn(() => b);
    b.or = vi.fn(() => b);
    b.order = vi.fn(() => b);
    b.limit = vi.fn(async () => getResponse());
    return b;
  };

  const corrBuilder = makeBuilder(() => corrResponse);
  const accBuilder = makeBuilder(() => accResponse);

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'sign_accuracy') return accBuilder;
      return corrBuilder;
    }),
  };

  const setCorrectionsResponse = (next: CorrResponse) => { corrResponse = next; };
  const setAccuracyResponse = (next: AccResponse) => { accResponse = next; };

  return { mockSupabase, setCorrectionsResponse, setAccuracyResponse };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

import {
  normalizeLearnedCorrectionKey,
  buildRuntimeCorrectionMap,
  applyRuntimeCorrectionFromMap,
  getRuntimeCorrectionsMap,
  clearRuntimeCorrectionsCacheForTests,
} from './learnedCorrections';

describe('learnedCorrections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRuntimeCorrectionsCacheForTests();
    setCorrectionsResponse({ data: [], error: null });
    setAccuracyResponse({ data: [], error: null });
  });

  it('normalizes keys consistently', () => {
    expect(normalizeLearnedCorrectionKey('  "Hello   world"  ')).toBe('HELLO WORLD');
    expect(normalizeLearnedCorrectionKey("'hi'")).toBe('HI');
  });

  it('buildRuntimeCorrectionMap ignores no-op rows and keeps a single unambiguous correction', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'hello', correctSign: 'HI', occurrenceCount: 3 },
      { geminiMisrecognition: 'HELLO', correctSign: 'HELLO', occurrenceCount: 10 },
      { geminiMisrecognition: 'hello', correctSign: 'HELLO', occurrenceCount: 5 },
    ]);

    const row = map.get('HELLO');
    expect(row?.occurrenceCount).toBe(3);
    expect(row?.correctSign).toBe('HI');
  });

  it('buildRuntimeCorrectionMap picks dominant correction when 2 compete with different counts', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'V', correctSign: 'SEE', occurrenceCount: 4 },
      { geminiMisrecognition: 'V', correctSign: 'TWICE', occurrenceCount: 3 },
    ]);

    // SEE (4) > TWICE (3) → SEE wins
    expect(map.get('V')?.correctSign).toBe('SEE');
  });

  it('buildRuntimeCorrectionMap skips keys with tied competing corrections', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'V', correctSign: 'SEE', occurrenceCount: 4 },
      { geminiMisrecognition: 'V', correctSign: 'TWICE', occurrenceCount: 4 },
    ]);

    // Tied → too ambiguous → skip
    expect(map.has('V')).toBe(false);
  });

  it('applyRuntimeCorrectionFromMap returns unchanged text when no match', () => {
    const map = new Map();
    const result = applyRuntimeCorrectionFromMap('Hello', map);
    expect(result).toEqual({ text: 'Hello', originalText: 'Hello', corrected: false });
  });

  it('applyRuntimeCorrectionFromMap applies the learned correction when present', () => {
    const map = new Map([
      [
        'HELLO',
        {
          geminiMisrecognition: 'HELLO',
          correctSign: 'HI',
          occurrenceCount: 3,
        },
      ],
    ]);

    const result = applyRuntimeCorrectionFromMap('Hello', map);
    expect(result.text).toBe('HI');
    expect(result.originalText).toBe('Hello');
    expect(result.corrected).toBe(true);
    expect(result.applied?.correctSign).toBe('HI');
  });

  it('buildRuntimeCorrectionMap suppresses circular correction with lower count', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'HELLO', correctSign: 'ROCKET', occurrenceCount: 3 },
      { geminiMisrecognition: 'ROCKET', correctSign: 'HELLO', occurrenceCount: 6 },
    ]);

    expect(map.has('HELLO')).toBe(false);
    expect(map.get('ROCKET')?.correctSign).toBe('HELLO');
    expect(map.get('ROCKET')?.occurrenceCount).toBe(6);
  });

  it('buildRuntimeCorrectionMap removes both directions when counts are equal', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'A', correctSign: 'B', occurrenceCount: 5 },
      { geminiMisrecognition: 'B', correctSign: 'A', occurrenceCount: 5 },
    ]);

    expect(map.has('A')).toBe(false);
    expect(map.has('B')).toBe(false);
  });

  it('buildRuntimeCorrectionMap keeps non-circular corrections alongside circular ones', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'HELLO', correctSign: 'ROCKET', occurrenceCount: 3 },
      { geminiMisrecognition: 'ROCKET', correctSign: 'HELLO', occurrenceCount: 6 },
      { geminiMisrecognition: 'V', correctSign: 'SEE', occurrenceCount: 4 },
    ]);

    expect(map.has('HELLO')).toBe(false);
    expect(map.get('ROCKET')?.correctSign).toBe('HELLO');
    expect(map.get('V')?.correctSign).toBe('SEE');
  });

  // ─── Accuracy gate tests ──────────────────────────────────────

  it('accuracy gate: skips correction when sign accuracy >= 70%', () => {
    const accuracyMap = new Map<string, SignAccuracyRecord>([
      ['YES', { signText: 'YES', totalPositive: 8, totalNegative: 2 }],
    ]);

    const map = buildRuntimeCorrectionMap(
      [{ geminiMisrecognition: 'YES', correctSign: 'WANT', occurrenceCount: 5 }],
      accuracyMap,
    );

    // 8/10 = 80% accuracy → above 70% threshold → skip
    expect(map.has('YES')).toBe(false);
  });

  it('accuracy gate: applies correction when sign accuracy < 70%', () => {
    const accuracyMap = new Map<string, SignAccuracyRecord>([
      ['YES', { signText: 'YES', totalPositive: 3, totalNegative: 7 }],
    ]);

    const map = buildRuntimeCorrectionMap(
      [{ geminiMisrecognition: 'YES', correctSign: 'WANT', occurrenceCount: 5 }],
      accuracyMap,
    );

    // 3/10 = 30% accuracy → below 70% → correction applies
    expect(map.get('YES')?.correctSign).toBe('WANT');
  });

  it('accuracy gate: skips gate when total feedback < 5 (insufficient data)', () => {
    const accuracyMap = new Map<string, SignAccuracyRecord>([
      ['YES', { signText: 'YES', totalPositive: 3, totalNegative: 0 }],
    ]);

    const map = buildRuntimeCorrectionMap(
      [{ geminiMisrecognition: 'YES', correctSign: 'WANT', occurrenceCount: 5 }],
      accuracyMap,
    );

    // Only 3 total feedback → too few → gate is skipped → correction applies
    expect(map.get('YES')?.correctSign).toBe('WANT');
  });

  // ─── Context-dependency tests ─────────────────────────────────

  it('context-dep skip: 3+ corrections with no dominant → skips auto-correction', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'YES', correctSign: 'WANT', occurrenceCount: 4 },
      { geminiMisrecognition: 'YES', correctSign: 'HELP-ME', occurrenceCount: 3 },
      { geminiMisrecognition: 'YES', correctSign: 'GOOD', occurrenceCount: 3 },
    ]);

    // WANT has 4/10 = 40% of negatives → not dominant (< 60%)
    expect(map.has('YES')).toBe(false);
  });

  it('context-dep: 3+ corrections with dominant (>60%) → keeps auto-correction', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'YES', correctSign: 'WANT', occurrenceCount: 8 },
      { geminiMisrecognition: 'YES', correctSign: 'HELP-ME', occurrenceCount: 2 },
      { geminiMisrecognition: 'YES', correctSign: 'GOOD', occurrenceCount: 1 },
    ]);

    // WANT has 8/11 = 73% → dominant → correction applies
    expect(map.get('YES')?.correctSign).toBe('WANT');
  });

  // ─── Cache test ───────────────────────────────────────────────

  it('getRuntimeCorrectionsMap caches results within TTL', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'HELLO', correct_sign: 'HI', occurrence_count: 3 },
      ],
      error: null,
    });
    setAccuracyResponse({ data: [], error: null });

    const map1 = await getRuntimeCorrectionsMap(1000);
    // learned_corrections + sign_accuracy = 2 from() calls
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    expect(map1.get('HELLO')?.correctSign).toBe('HI');

    const map2 = await getRuntimeCorrectionsMap(2000);
    // Cached — no additional calls
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
    expect(map2.get('HELLO')?.correctSign).toBe('HI');
  });
});
