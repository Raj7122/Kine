import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSupabase, builder, setQueryResponse } = vi.hoisted(() => {
  type SupabaseError = { message: string };
  type LearnedCorrectionsQueryRow = {
    gemini_misrecognition: string;
    correct_sign: string;
    occurrence_count: number;
  };
  type QueryResponse = { data: LearnedCorrectionsQueryRow[] | null; error: SupabaseError | null };

  let response: QueryResponse = { data: [], error: null };

  const builder = {
    select: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.gte.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockImplementation(async () => response);

  const mockSupabase = {
    from: vi.fn(() => builder),
  };

  const setQueryResponse = (next: QueryResponse) => {
    response = next;
  };

  return { mockSupabase, builder, setQueryResponse };
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
    setQueryResponse({ data: [], error: null });
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

  it('buildRuntimeCorrectionMap skips keys with multiple competing corrections', () => {
    const map = buildRuntimeCorrectionMap([
      { geminiMisrecognition: 'V', correctSign: 'SEE', occurrenceCount: 4 },
      { geminiMisrecognition: 'V', correctSign: 'TWICE', occurrenceCount: 3 },
    ]);

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

  it('getRuntimeCorrectionsMap caches results within TTL', async () => {
    setQueryResponse({
      data: [
        {
          gemini_misrecognition: 'HELLO',
          correct_sign: 'HI',
          occurrence_count: 3,
        },
      ],
      error: null,
    });

    const map1 = await getRuntimeCorrectionsMap(1000);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(builder.select).toHaveBeenCalled();
    expect(map1.get('HELLO')?.correctSign).toBe('HI');

    const map2 = await getRuntimeCorrectionsMap(2000);
    expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    expect(map2.get('HELLO')?.correctSign).toBe('HI');
  });
});
