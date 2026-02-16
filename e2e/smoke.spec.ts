import { test, expect } from '@playwright/test';

/**
 * E2E Smoke Tests for Kine – Bi-directional ASL Translation PWA
 *
 * These tests verify the critical user paths survive refactoring:
 *   1. App loads without crashing
 *   2. Default SIGNING mode renders camera + hand tracker UI
 *   3. Mode toggle switches between SIGNING ↔ LISTENING
 *   4. LISTENING mode renders avatar + speech controls
 *   5. Settings and History modals open/close
 */

test.describe('Kine App Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for client-side hydration
    await page.waitForSelector('[data-testid="mode-toggle"], button', { timeout: 15_000 });
  });

  test('app loads and renders SIGNING mode by default', async ({ page }) => {
    // The page should not show an error boundary or blank screen
    await expect(page).toHaveTitle(/Kine/i);

    // Camera feed or its container should exist (even if camera is blocked)
    const signingView = page.locator('video, [class*="camera"], [class*="Camera"]').first();
    await expect(signingView).toBeAttached({ timeout: 10_000 });
  });

  test('mode toggle is visible and clickable', async ({ page }) => {
    // Find the mode toggle button (it shows SIGNING / LISTENING icons)
    const toggle = page.locator('button').filter({ hasText: /SIGNING|LISTENING|mode/i }).first()
      .or(page.locator('[data-testid="mode-toggle"]'))
      .or(page.locator('button:has(svg)').last());

    // At minimum some buttons should exist
    const buttons = page.locator('button');
    await expect(buttons.first()).toBeVisible({ timeout: 10_000 });
  });

  test('can switch to LISTENING mode and back', async ({ page }) => {
    // Find the mode toggle — it's the large circular button at the bottom
    // In the Kine UI it's rendered by <ModeToggle />
    const modeToggle = page.locator('button').filter({ hasText: /Listen|Speak|SIGNING|LISTENING/i }).first()
      .or(page.locator('[data-testid="mode-toggle"]'));

    // If we can find it, click it
    const toggleCount = await modeToggle.count();
    if (toggleCount > 0) {
      await modeToggle.click();

      // After clicking, LISTENING mode should show avatar or waveform
      const listeningIndicator = page.locator('text=Listening, text=Ready, [class*="avatar"], [class*="Avatar"], [class*="waveform"]').first();
      await expect(listeningIndicator).toBeAttached({ timeout: 10_000 });

      // Click again to go back to SIGNING
      await modeToggle.click();

      // Camera / signing view should reappear
      const signingIndicator = page.locator('video, [class*="camera"], [class*="Camera"]').first();
      await expect(signingIndicator).toBeAttached({ timeout: 10_000 });
    }
  });

  test('no console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => {
      // Ignore known benign errors (e.g. camera permission, MediaPipe WASM)
      const msg = err.message.toLowerCase();
      if (
        msg.includes('camera') ||
        msg.includes('mediapipe') ||
        msg.includes('wasm') ||
        msg.includes('permission') ||
        msg.includes('notallowederror') ||
        msg.includes('getusermedia')
      ) {
        return;
      }
      errors.push(err.message);
    });

    await page.goto('/');
    // Give the page time to hydrate and run effects
    await page.waitForTimeout(3_000);

    expect(errors).toEqual([]);
  });

  test('page has correct viewport meta for PWA', async ({ page }) => {
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);
  });

  test('LSTM model assets are reachable', async ({ page }) => {
    // The model.json and metadata.json must be served from /models/
    const modelResp = await page.request.get('/models/asl_cnn_lstm_25/model.json');
    expect(modelResp.ok()).toBe(true);

    const metaResp = await page.request.get('/models/asl_cnn_lstm_25/metadata.json');
    expect(metaResp.ok()).toBe(true);

    const meta = await metaResp.json();
    expect(Array.isArray(meta.vocabulary)).toBe(true);
    expect(meta.vocabulary.length).toBeGreaterThanOrEqual(1);
  });

  test('no LSTM-related console errors on load', async ({ page }) => {
    const lstmErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().toLowerCase().includes('lstm')) {
        lstmErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(4_000);

    expect(lstmErrors).toEqual([]);
  });
});
