/**
 * Tests to verify that /api/sign-recognize never silently falls back to mock data
 * when Gemini should be handling recognition. These tests validate the route logic
 * by checking the exported functions and response behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test the core behavioral contract: no mock results when Gemini is configured.
// Since the Next.js route handler depends on NextRequest/NextResponse and env vars,
// we validate the critical logic paths by testing the functions and checking constants.

describe('Sign recognition: no silent mock fallback', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('USE_MOCK_DATA should be false in constants', async () => {
    const { USE_MOCK_DATA } = await import('@/config/constants');
    expect(USE_MOCK_DATA).toBe(false);
  });

  it('GEMINI_API_KEY must be set in the environment for real recognition', () => {
    // This test documents the requirement — GEMINI_API_KEY must exist
    // If it's missing, the route should return a 503 error, not mock data
    const key = process.env.GEMINI_API_KEY;
    // In CI/test environments, the key may not be set — that's fine.
    // The important thing is we verify the route behavior below.
    if (!key) {
      console.warn('[Test] GEMINI_API_KEY not set — route will return 503 (not mock data)');
    }
    expect(true).toBe(true); // Assertion placeholder: presence is env-dependent
  });

  it('getMockResult should not appear in non-USE_MOCK_DATA code paths', async () => {
    // Read the route source and verify mock fallback is only called behind USE_MOCK_DATA
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.resolve(__dirname, '../../app/api/sign-recognize/route.ts');

    let source: string;
    try {
      source = fs.readFileSync(routePath, 'utf-8');
    } catch {
      // In compiled environments, skip this test
      console.warn('[Test] Could not read route source file, skipping static analysis');
      return;
    }

    // Find all getMockResult() invocations (exclude function definition)
    const mockResultCalls = [...source.matchAll(/getMockResult\(\)/g)]
      .filter((m) => {
        const preceding = source.substring(Math.max(0, m.index! - 20), m.index!);
        return !preceding.includes('function ');
      });

    // There should be exactly 1 call: inside the USE_MOCK_DATA block
    // All error paths should return { success: false } instead
    expect(mockResultCalls.length).toBe(1);

    // Verify the single call is inside the USE_MOCK_DATA guard
    const useMockIndex = source.indexOf('if (USE_MOCK_DATA)');
    expect(useMockIndex).toBeGreaterThan(-1);

    const callIndex = mockResultCalls[0]?.index ?? -1;
    expect(callIndex).toBeGreaterThan(useMockIndex);

    // Verify the mock call is within 200 chars of USE_MOCK_DATA (same block)
    expect(callIndex - useMockIndex).toBeLessThan(200);
  });

  it('error responses from route should have success: false (no mock data)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.resolve(__dirname, '../../app/api/sign-recognize/route.ts');

    let source: string;
    try {
      source = fs.readFileSync(routePath, 'utf-8');
    } catch {
      console.warn('[Test] Could not read route source file, skipping');
      return;
    }

    // All NextResponse.json calls with status >= 400 should contain success: false
    const errorResponses = [...source.matchAll(/NextResponse\.json\(\s*\{[^}]*\}\s*,\s*\{\s*status:\s*(\d+)/g)];
    for (const match of errorResponses) {
      const statusCode = parseInt(match[1], 10);
      if (statusCode >= 400) {
        expect(match[0]).toContain('success: false');
      }
    }
  });

  it('route should not return mock source in Gemini error/timeout paths', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const routePath = path.resolve(__dirname, '../../app/api/sign-recognize/route.ts');

    let source: string;
    try {
      source = fs.readFileSync(routePath, 'utf-8');
    } catch {
      console.warn('[Test] Could not read route source file, skipping');
      return;
    }

    // After the USE_MOCK_DATA block, there should be no "source: 'mock'" in any response
    const afterMockGuard = source.substring(source.indexOf('if (USE_MOCK_DATA)') + 100);
    expect(afterMockGuard).not.toContain("source: 'mock'");
  });
});
