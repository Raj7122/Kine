import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock setup ────────────────────────────────────────────────
// Routes supabase.from('learned_corrections') and supabase.from('sign_accuracy')
// to separate mock builders.

const {
  mockSupabase,
  setCorrectionsResponse,
  setAccuracyResponse,
  mockRpc,
} = vi.hoisted(() => {
  type SupabaseError = { message: string };
  type LearnedCorrectionsQueryRow = {
    gemini_misrecognition: string;
    correct_sign: string;
    occurrence_count: number;
    added_to_prompt: boolean;
    prompt_version: number | null;
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

  const mockRpc = vi.fn(async () => ({ error: null as SupabaseError | null }));

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'sign_accuracy') return accBuilder;
      return corrBuilder;
    }),
    rpc: mockRpc,
  };

  const setCorrectionsResponse = (next: CorrResponse) => { corrResponse = next; };
  const setAccuracyResponse = (next: AccResponse) => { accResponse = next; };

  return { mockSupabase, setCorrectionsResponse, setAccuracyResponse, mockRpc };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

vi.mock('./signDefinitions', () => ({
  buildDisambiguationHint: vi.fn((a: string, b: string) => `${a.toUpperCase()} = desc-${a}; ${b.toUpperCase()} = desc-${b}`),
  buildContextRules: vi.fn((_orig: string, corrections: Array<{ sign: string; percentage: number }>) =>
    corrections.map((c) => `If motion-${c.sign.toLowerCase()} → likely ${c.sign.toUpperCase()} (${c.percentage}%)`)
  ),
}));

import { buildAugmentedPrompt, clearPromptAugmentationCacheForTests } from './promptAugmentation';

describe('promptAugmentation (confusion-pair)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPromptAugmentationCacheForTests();
    setCorrectionsResponse({ data: [], error: null });
    setAccuracyResponse({ data: [], error: null });
    mockRpc.mockResolvedValue({ error: null });
  });

  it('returns the base prompt when no patterns are available', async () => {
    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.prompt).toBe('BASE');
    expect(result.patternsUsed).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('emits a confusion-pair line with disambiguation hints', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'YES', correct_sign: 'WANT', occurrence_count: 10, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    // No accuracy data → accuracy is null → correction passes gate
    setAccuracyResponse({ data: [], error: null });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.patternsUsed).toHaveLength(1);
    expect(result.prompt).toContain('"YES" and "WANT" are frequently confused');
    expect(result.prompt).toContain('Distinguish by:');
    expect(result.prompt).toContain('YES = desc-YES');
    expect(result.prompt).not.toContain('strongly consider');
  });

  it('accuracy gate: skips corrections when sign accuracy >= 70%', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'YES', correct_sign: 'WANT', occurrence_count: 10, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    // YES has 80% accuracy (8 positive, 2 negative) → above threshold
    setAccuracyResponse({
      data: [{ sign_text: 'YES', total_positive: 8, total_negative: 2 }],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    // Patterns are still returned (for marking), but the section is empty
    expect(result.prompt).toBe('BASE');
  });

  it('accuracy gate: injects corrections when sign accuracy < 70%', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'YES', correct_sign: 'WANT', occurrence_count: 10, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    // YES has 50% accuracy → below threshold
    setAccuracyResponse({
      data: [{ sign_text: 'YES', total_positive: 5, total_negative: 5 }],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.prompt).toContain('"YES" and "WANT" are frequently confused');
    expect(result.prompt).toContain('(accuracy: 50%)');
  });

  it('min feedback: skips accuracy gate when total feedback < 5', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'YES', correct_sign: 'WANT', occurrence_count: 5, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    // Only 3 total feedback — too few to compute accuracy, so gate is skipped
    setAccuracyResponse({
      data: [{ sign_text: 'YES', total_positive: 3, total_negative: 0 }],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    // Should still inject because accuracy is unreliable
    expect(result.prompt).toContain('"YES" and "WANT" are frequently confused');
  });

  it('context-dependent: 3+ corrections with no dominant → context-dependent format', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'YES', correct_sign: 'WANT', occurrence_count: 4, added_to_prompt: false, prompt_version: null },
        { gemini_misrecognition: 'YES', correct_sign: 'HELP-ME', occurrence_count: 3, added_to_prompt: false, prompt_version: null },
        { gemini_misrecognition: 'YES', correct_sign: 'GOOD', occurrence_count: 3, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    setAccuracyResponse({ data: [], error: null });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.prompt).toContain('"YES" is context-dependent');
    expect(result.prompt).toContain('WANT');
    expect(result.prompt).toContain('HELP-ME');
    expect(result.prompt).toContain('GOOD');
    expect(result.prompt).toContain('Context rules:');
    expect(result.prompt).toContain('motion direction and handshape');
  });

  it('context-dependent: 3+ corrections with dominant (>60%) → standard confusion pair', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'YES', correct_sign: 'WANT', occurrence_count: 8, added_to_prompt: false, prompt_version: null },
        { gemini_misrecognition: 'YES', correct_sign: 'HELP-ME', occurrence_count: 2, added_to_prompt: false, prompt_version: null },
        { gemini_misrecognition: 'YES', correct_sign: 'GOOD', occurrence_count: 1, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    setAccuracyResponse({ data: [], error: null });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    // WANT has 8/11 = 73% of negatives → dominant
    expect(result.prompt).toContain('"YES" and "WANT" are frequently confused');
    expect(result.prompt).toContain('Also confused with:');
    expect(result.prompt).not.toContain('context-dependent');
  });

  it('chain suppression: A→B + B→C suppresses weaker link', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'A', correct_sign: 'GOODBYE', occurrence_count: 8, added_to_prompt: false, prompt_version: null },
        { gemini_misrecognition: 'GOODBYE', correct_sign: 'NEED', occurrence_count: 3, added_to_prompt: false, prompt_version: null },
      ],
      error: null,
    });
    setAccuracyResponse({ data: [], error: null });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    // A→GOODBYE (count 8) should survive
    expect(result.prompt).toContain('"A" and "GOODBYE"');
    // GOODBYE→NEED (count 3) should be suppressed because GOODBYE is a target of A→GOODBYE (count 8 > 3)
    expect(result.prompt).not.toContain('"GOODBYE" and "NEED"');
  });

  it('does not re-mark patterns already associated with the current prompt version', async () => {
    setCorrectionsResponse({
      data: [
        { gemini_misrecognition: 'HELLO', correct_sign: 'HI', occurrence_count: 5, added_to_prompt: true, prompt_version: 2 },
      ],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 2, 1000);

    expect(result.patternsUsed).toHaveLength(1);
    expect(result.prompt).toContain('"HELLO" and "HI"');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fails open when Supabase query errors', async () => {
    setCorrectionsResponse({ data: null, error: { message: 'bad query' } });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.prompt).toBe('BASE');
    expect(result.patternsUsed).toEqual([]);
  });
});
