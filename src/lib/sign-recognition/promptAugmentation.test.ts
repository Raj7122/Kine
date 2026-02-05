import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSupabase,
  builder,
  setQueryResponse,
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
  type QueryResponse = { data: LearnedCorrectionsQueryRow[] | null; error: SupabaseError | null };

  let response: QueryResponse = { data: [], error: null };

  const builder = {
    select: vi.fn(),
    gte: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockImplementation(async () => response);

  const mockRpc = vi.fn(async () => ({ error: null as SupabaseError | null }));

  const mockSupabase = {
    from: vi.fn(() => builder),
    rpc: mockRpc,
  };

  const setQueryResponse = (next: QueryResponse) => {
    response = next;
  };

  return { mockSupabase, builder, setQueryResponse, mockRpc };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

import { buildAugmentedPrompt, clearPromptAugmentationCacheForTests } from './promptAugmentation';

describe('promptAugmentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPromptAugmentationCacheForTests();
    setQueryResponse({ data: [], error: null });
    mockRpc.mockResolvedValue({ error: null });
  });

  it('returns the base prompt when no patterns are available', async () => {
    setQueryResponse({ data: [], error: null });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.prompt).toBe('BASE');
    expect(result.patternsUsed).toEqual([]);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sanitizes values, dedupes, and marks patterns as added', async () => {
    setQueryResponse({
      data: [
        {
          gemini_misrecognition: '"HELLO\nWORLD`"',
          correct_sign: "'HI\tTHERE'",
          occurrence_count: 12,
          added_to_prompt: false,
          prompt_version: null,
        },
        {
          gemini_misrecognition: 'HELLO   WORLD',
          correct_sign: 'HI THERE',
          occurrence_count: 9,
          added_to_prompt: false,
          prompt_version: null,
        },
        {
          gemini_misrecognition: '\n\t',
          correct_sign: 'VALID',
          occurrence_count: 7,
          added_to_prompt: false,
          prompt_version: null,
        },
      ],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 7, 1000);

    expect(result.patternsUsed).toHaveLength(1);
    expect(result.prompt).toContain('## LEARNED CORRECTIONS FROM USER FEEDBACK');
    expect(result.prompt).toContain('When you would output "HELLO WORLD"');
    expect(result.prompt).toContain('strongly consider "HI THERE"');
    expect(result.prompt).not.toContain('`');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('mark_prompt_patterns_added', {
      p_patterns: [
        {
          gemini_misrecognition: '"HELLO\nWORLD`"',
          correct_sign: "'HI\tTHERE'",
        },
      ],
      p_prompt_version: 7,
    });
  });

  it('groups multiple corrections for the same misrecognition and emits an ambiguity line', async () => {
    setQueryResponse({
      data: [
        {
          gemini_misrecognition: 'V',
          correct_sign: 'SEE',
          occurrence_count: 10,
          added_to_prompt: false,
          prompt_version: null,
        },
        {
          gemini_misrecognition: 'V',
          correct_sign: 'TWICE',
          occurrence_count: 8,
          added_to_prompt: false,
          prompt_version: null,
        },
      ],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.patternsUsed).toHaveLength(2);
    expect(result.prompt).toContain('The output "V" can be ambiguous');
    expect(result.prompt).toContain('"SEE"');
    expect(result.prompt).toContain('"TWICE"');
  });

  it('does not re-mark patterns already associated with the current prompt version', async () => {
    setQueryResponse({
      data: [
        {
          gemini_misrecognition: 'HELLO',
          correct_sign: 'HI',
          occurrence_count: 5,
          added_to_prompt: true,
          prompt_version: 2,
        },
      ],
      error: null,
    });

    const result = await buildAugmentedPrompt('BASE', 2, 1000);

    expect(result.patternsUsed).toHaveLength(1);
    expect(result.prompt).toContain('When you would output "HELLO"');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('caches patterns within TTL (does not re-query Supabase)', async () => {
    setQueryResponse({
      data: [
        {
          gemini_misrecognition: 'A',
          correct_sign: 'B',
          occurrence_count: 5,
          added_to_prompt: false,
          prompt_version: null,
        },
      ],
      error: null,
    });

    await buildAugmentedPrompt('BASE', 1, 1000);
    await buildAugmentedPrompt('BASE', 1, 2000);

    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
  });

  it('fails open when the mark_prompt_patterns_added RPC errors', async () => {
    setQueryResponse({
      data: [
        {
          gemini_misrecognition: 'HELLO',
          correct_sign: 'HI',
          occurrence_count: 5,
          added_to_prompt: false,
          prompt_version: null,
        },
      ],
      error: null,
    });

    mockRpc.mockResolvedValue({ error: { message: 'RPC failed' } });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.patternsUsed).toHaveLength(1);
    expect(result.prompt).toContain('When you would output "HELLO"');
  });

  it('fails open when Supabase query errors', async () => {
    setQueryResponse({ data: null, error: { message: 'bad query' } });

    const result = await buildAugmentedPrompt('BASE', 1, 1000);

    expect(result.prompt).toBe('BASE');
    expect(result.patternsUsed).toEqual([]);
  });
});
