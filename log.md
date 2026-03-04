# Kine — Development Log

> Chronological record of bugs, features, architectural decisions, and fixes for the Kine ASL Translation PWA.
> Branch: `val-test-branch`

---

## 2026-01-30 — Feedback System: Database Schema & Plan (Phase 1)

- **Goal**: Design and deploy a feedback-driven improvement system for ASL translation accuracy.
- **Deliverables**:
  - Created `plan.md` with 6-phase implementation plan (Schema → API → UI → Metrics → Docs → Integration).
  - Authored Supabase migration `supabase/migrations/004_translation_feedback_system.sql`:
    - `translation_feedback` table — stores per-translation ratings, corrections, landmark context, confidence scores.
    - `accuracy_metrics` table — stores aggregated accuracy data by period (daily/weekly/monthly).
    - `learned_corrections` table — tracks recurring misrecognition→correction pairs with occurrence counts and prompt integration status.
    - `calculate_period_accuracy()` and `get_top_misrecognitions()` helper functions.
    - `update_learned_corrections()` trigger — auto-upserts into `learned_corrections` on every negative feedback INSERT.
    - RLS policies: public INSERT + SELECT on `translation_feedback`; public SELECT on `learned_corrections` and `accuracy_metrics`.
  - Created documentation: `docs/FEEDBACK_SYSTEM.md`, `docs/FEEDBACK_BEST_PRACTICES.md`.
- **Files Created**: `plan.md`, `supabase/migrations/004_translation_feedback_system.sql`, `docs/FEEDBACK_SYSTEM.md`, `docs/FEEDBACK_BEST_PRACTICES.md`

---

## 2026-01-30 — Feedback System: Backend API (Phase 2)

- **Goal**: Build API endpoints for feedback submission and pattern retrieval.
- **Deliverables**:
  - `src/app/api/feedback/route.ts` — `POST` (submit feedback) + `GET` (list recent feedback). Includes mock-mode fallback when Supabase table doesn't exist.
  - `src/app/api/feedback/stats/route.ts` — accuracy statistics endpoint.
  - `src/app/api/feedback/patterns/route.ts` — common misrecognition patterns endpoint.
  - `src/lib/feedback/metricsService.ts` — accuracy calculation service.
  - `scripts/analyze-feedback.ts` — admin script for feedback pattern analysis.
  - `scripts/generate-prompt-update.ts` — generates prompt update suggestions from feedback data.
- **Files Created**: `src/app/api/feedback/route.ts`, `src/app/api/feedback/stats/route.ts`, `src/app/api/feedback/patterns/route.ts`, `src/lib/feedback/metricsService.ts`, `scripts/analyze-feedback.ts`, `scripts/generate-prompt-update.ts`

---

## 2026-01-30 — Feedback System: Frontend UI (Phase 3)

- **Goal**: Add thumbs-up/thumbs-down feedback UI to the translation flow.
- **Deliverables**:
  - `src/components/feedback/FeedbackButtons.tsx` — 👍/👎 buttons with correction input on negative feedback. Animated with Framer Motion.
  - `src/components/feedback/MetricsDashboard.tsx` — accuracy metrics visualization.
  - `src/components/feedback/index.ts` — barrel exports.
  - `src/app/feedback/page.tsx` — standalone feedback test page for manual testing.
  - Integrated `FeedbackButtons` into `TranscriptionBox` and main `page.tsx`.
- **Files Created**: `src/components/feedback/FeedbackButtons.tsx`, `src/components/feedback/MetricsDashboard.tsx`, `src/components/feedback/index.ts`, `src/app/feedback/page.tsx`
- **Files Modified**: `src/components/ui/TranscriptionBox.tsx`, `src/app/page.tsx`

---

## 2026-02-02 — Bug Fix: Feedback negative rating failing due to RLS on learned_corrections

- **Symptom**: Submitting negative feedback (👎 with a correction) returned success in the UI, but did not persist to Supabase.
- **Root Cause**: The trigger `trigger_update_learned_corrections` calls `update_learned_corrections()` which attempted to `INSERT` into `learned_corrections` while RLS was enabled and no INSERT policy existed. Because the trigger function was not `SECURITY DEFINER`, it ran as the inserting role and failed with:
  - `new row violates row-level security policy for table "learned_corrections"`
- **Fix**:
  - Updated `update_learned_corrections()` to be `SECURITY DEFINER` with `SET search_path = public` so it can upsert into `learned_corrections` while keeping the table protected from direct client writes.
  - Updated `/api/feedback` to only fall back to mock mode when the feedback table is missing; RLS/permission errors now surface as proper server errors.
- **Files Modified**: `supabase/migrations/004_translation_feedback_system.sql`, `src/app/api/feedback/route.ts`

---

## 2026-02-02 — Bug Fix: Feedback UI window too short due to repeated translation triggers

- **Symptom**: After a translation completes, the app quickly triggers another translation while the user is still in-frame, removing the time window to click 👍/👎 or type a correction.
- **Root Cause**:
  - `SigningView` calls `resetTranslation()` after a short delay.
  - If the user remains still after the reset, the motion/silence logic re-enters `pause_detected` and triggers a new translation immediately.
  - The feedback UI was hidden when translation state transitioned during new cycles.
- **Fix**:
  - Added `awaitingMotionResumeRef` gate in `useTranslation` to **block new translation triggers until motion resumes** after a completed translation.
  - Updated `TranscriptionBox` feedback visibility logic to keep feedback visible across resets and only hide when a new translation cycle is underway.
  - Added client-side debug logs (`[FeedbackUI]` / `[Translation]`) to trace show/hide events and submission timing.
- **Files Modified**: `src/hooks/useTranslation.ts`, `src/components/ui/TranscriptionBox.tsx`

---

## 2026-02-03 — Feature: /api/sign-recognize + Learned Corrections Runtime + Prompt Augmentation

- **Goal**: Implement the "Gemini Sandwich" server-side sign recognition with runtime learned corrections and analytics-driven prompt augmentation.
- **Architecture Decisions**:
  - **Option B** selected: Route all Gemini calls through Next.js API routes to keep `GEMINI_API_KEY` server-only.
  - **Dual approach**: Use `learned_corrections` for immediate runtime fixes (threshold: 3 occurrences) + analytics volume thresholds to evolve Gemini prompts over time.
  - **Correction scope**: Apply runtime corrections to signing→English recognition output only (before TTS + gloss translation).
- **Deliverables**:
  - `src/app/api/sign-recognize/route.ts` — Server-side sign recognition endpoint. Sends video frames + MediaPipe landmarks to Gemini 3.0 Flash. Includes payload validation, rate limiting (30 req/min sliding window), prompt augmentation, and runtime learned corrections.
  - `src/lib/sign-recognition/types.ts` — `SignRecognizeResult` interface (`text`, `originalText`, `corrected`, `confidence`, `source`, `sampleId`).
  - `src/lib/sign-recognition/validation.ts` — Request body validation with frame/size limits.
  - `src/lib/sign-recognition/rateLimit.ts` — Sliding-window rate limiter.
  - `src/lib/sign-recognition/learnedCorrections.ts` — Runtime correction cache. Fetches from `learned_corrections` table, builds normalized correction map, applies corrections only when exactly one unique correction exists (ambiguity-safe).
  - `src/lib/sign-recognition/promptAugmentation.ts` — Fetches learned correction patterns, sanitizes/deduplicates, builds prompt augmentation section for Gemini. Groups by misrecognition; emits ambiguity-aware lines when multiple corrections exist.
- **Feedback Semantics (Option 2)**:
  - Positive feedback stores `gemini_output = correctedText` (user-visible text).
  - Negative feedback stores `gemini_output = originalText` (raw Gemini output) with `user_correction`.
  - Recognition metadata embedded in `landmark_data` JSONB: `{ recognition: { originalText, correctedText, corrected, source } }`.
- **Security Hardening**:
  - Removed `NEXT_PUBLIC_GEMINI_API_KEY` support from Gemini services.
  - All client flows now route Gemini calls through Next.js API routes.
- **Client Updates**:
  - `useTranslation` hook calls `POST /api/sign-recognize` and propagates full `SignRecognizeResult`.
  - Zustand `useAppStore.lastTranslation` updated to store `SignRecognizeResult | null`.
  - UI components (`page.tsx`, `TranscriptionBox`) render `lastTranslation.text`.
  - `FeedbackButtons` passes `translationId` and `sampleId` in feedback submissions.
- **Tests**:
  - `src/lib/sign-recognition/validation.test.ts` — 14 tests for payload validation.
  - `src/lib/sign-recognition/rateLimit.test.ts` — 3 tests for sliding-window rate limiter.
  - `src/lib/sign-recognition/learnedCorrections.test.ts` — 6 tests for correction map building, normalization, ambiguity handling.
  - `src/lib/sign-recognition/promptAugmentation.test.ts` — 7 tests for prompt building, deduplication, ambiguity-aware grouping.
  - All 113 tests passing.
- **Files Created**: `src/app/api/sign-recognize/route.ts`, `src/lib/sign-recognition/types.ts`, `src/lib/sign-recognition/validation.ts`, `src/lib/sign-recognition/rateLimit.ts`, `src/lib/sign-recognition/learnedCorrections.ts`, `src/lib/sign-recognition/promptAugmentation.ts`, plus all `.test.ts` files.
- **Files Modified**: `src/hooks/useTranslation.ts`, `src/store/useAppStore.ts`, `src/app/page.tsx`, `src/components/ui/TranscriptionBox.tsx`, `src/components/feedback/FeedbackButtons.tsx`, `src/app/api/feedback/route.ts`, `src/lib/gemini/signRecognitionService.ts`

---

## 2026-02-04 — Feature: Ambiguity-Safe Learned Corrections + UI Disambiguation

- **Goal**: Handle ambiguous signs (e.g., "V" could mean V/SEE/TWICE) safely in both auto-correction and prompt augmentation.
- **Problem**: Multiple users correcting the same Gemini output to different values (e.g., "V" → "SEE" and "V" → "TWICE") could cause conflicting auto-corrections.
- **Solution — Runtime Corrections** (`learnedCorrections.ts`):
  - `buildRuntimeCorrectionMap()` now groups corrections by misrecognition key.
  - Only applies auto-correction if **exactly one unique correction** exists for a given misrecognition.
  - If multiple competing corrections exist, the entry is **skipped** (fail-open) — no auto-correction applied.
  - No-op corrections (where misrecognition equals correction) are filtered out.
- **Solution — Prompt Augmentation** (`promptAugmentation.ts`):
  - `buildAugmentationSection()` now groups correction patterns by misrecognition.
  - Single correction → standard prompt line: `When you would output "X", strongly consider "Y" instead`.
  - Multiple corrections → ambiguity-aware prompt line: `The output "X" can be ambiguous and has been corrected by users to: "Y", "Z". Use motion/context to choose the correct meaning.`
  - Groups sorted by highest occurrence count; limited to `MAX_CORRECTIONS_PER_MISRECOGNITION`.
- **Solution — UI Disambiguation** (`FeedbackButtons.tsx`):
  - Added `AMBIGUOUS_CORRECTION_SUGGESTIONS` map for known ambiguous outputs.
  - When Gemini outputs "V", the correction UI shows quick-select buttons for "See" and "Twice" alongside the freeform input.
  - Passed `translationId` prop through `TranscriptionBox` for consistent feedback row referencing.
- **Tests Updated**: `learnedCorrections.test.ts`, `promptAugmentation.test.ts` — verified ambiguity-safe logic.
- **Files Modified**: `src/lib/sign-recognition/learnedCorrections.ts`, `src/lib/sign-recognition/promptAugmentation.ts`, `src/components/feedback/FeedbackButtons.tsx`, `src/components/ui/TranscriptionBox.tsx`, `src/lib/sign-recognition/learnedCorrections.test.ts`, `src/lib/sign-recognition/promptAugmentation.test.ts`

---

## 2026-02-04 — Feature: Evaluation Set (sign_recognition_samples) + Storage Bucket

- **Goal**: Persist raw recognition input data (landmarks + video frames) so samples can be replayed for model evaluation and debugging.
- **Deliverables**:
  - Supabase migration `supabase/migrations/005_sign_recognition_samples.sql`:
    - `sign_recognition_samples` table — stores `session_id`, `frames_json` (JSONB), `video_frames_ref` (Storage path), `created_at`.
    - Added `sample_id` FK column to `translation_feedback` table.
    - Created `sign-recognition-samples` Supabase Storage bucket (private).
    - RLS policies: public INSERT + SELECT on `sign_recognition_samples`; public INSERT + SELECT on storage objects for the bucket.
    - Indexes on `session_id` and `created_at`.
  - Updated `src/app/api/sign-recognize/route.ts` — `persistSignRecognitionSample()` function inserts sample row + uploads video frames to Storage, returns `sampleId`.
  - Updated `src/app/api/feedback/route.ts` — accepts optional `sampleId` and stores it in `translation_feedback.sample_id`. Includes fallback logic if `sample_id` column doesn't exist yet (backward compatibility).
  - Updated `src/lib/sign-recognition/types.ts` — added optional `sampleId` to `SignRecognizeResult`.
  - Updated `src/hooks/useTranslation.ts` — captures `sampleId` from API response.
  - Updated `FeedbackButtons` — includes `sampleId` in both positive and negative feedback submissions.
- **Migration Status**: Verified applied via RLS policy check and storage bucket existence. Noted missing UPDATE policy for `video_frames_ref` updates (non-critical — logged as warning in API).
- **Files Created**: `supabase/migrations/005_sign_recognition_samples.sql`
- **Files Modified**: `src/app/api/sign-recognize/route.ts`, `src/app/api/feedback/route.ts`, `src/lib/sign-recognition/types.ts`, `src/hooks/useTranslation.ts`, `src/components/feedback/FeedbackButtons.tsx`

---

## 2026-02-05 — Bug Fix: Gemini falling back to mock data silently

- **Symptom**: Console logs showed `source: mock` and `confidence: 0.5` for most recognitions. Feedback corrections were being stored but not improving recognition because the mock system returns random canned phrases regardless of input.
- **Root Cause**: Multiple silent mock fallback paths in `/api/sign-recognize`:
  1. `USE_MOCK_DATA` flag check (legitimate dev toggle — was `false` but remained).
  2. Missing/invalid `GEMINI_API_KEY` → returned mock instead of error.
  3. Gemini HTTP errors (4xx/5xx) → returned mock instead of error.
  4. Gemini request timeout → returned mock instead of error.
  5. Client-side fallback in `useTranslation.ts` → when landmark buffer had <5 frames, returned random mock phrase.
- **Fix**:
  - **Missing API key** → now returns HTTP **503** with message: `"Gemini API key is not configured."`.
  - **Gemini HTTP error** → now returns HTTP **502** with message: `"Gemini API error ({status}). Please try again."`.
  - **Gemini timeout** → now returns HTTP **504** with message: `"Sign recognition timed out. Please try a clearer sign."`.
  - **Gemini exception** → now returns HTTP **500** with generic error.
  - `USE_MOCK_DATA` guard kept for explicit dev testing only; added `console.warn` when active.
  - **Client-side**: Removed mock fallback for small buffers. Lowered minimum threshold from 5 to 3 landmarks. Throws descriptive error if too few landmarks captured.
- **Unit Test**: Created `src/lib/sign-recognition/noMockFallback.test.ts` — static analysis of route source code to verify:
  - `USE_MOCK_DATA` is `false` in constants.
  - Only 1 `getMockResult()` invocation exists (inside `USE_MOCK_DATA` guard).
  - All error responses contain `success: false`.
  - No `source: 'mock'` leaks in non-mock code paths.
- **Files Modified**: `src/app/api/sign-recognize/route.ts`, `src/hooks/useTranslation.ts`
- **Files Created**: `src/lib/sign-recognition/noMockFallback.test.ts`

---

## 2026-02-05 — Feature: Primary Correction Selector (Multi-Alternative Feedback)

- **Symptom**: When a sign could mean multiple things (e.g., user wanted to submit both "MAD" and "GRUMPY" as corrections), the system either:
  - Stored "MAD OR GRUMPY" as a single string (pollutes `learned_corrections` with compound entries), or
  - Stored one row per correction (all corrections equally weighted — auto-correction gets confused by ambiguity).
- **Solution — Primary Correction Model**:
  - **UI** (`FeedbackButtons.tsx`):
    - Users can add multiple corrections via Enter/Add button or quick-select toggles.
    - Corrections appear as chips. The first one added automatically becomes the **primary** (★ star indicator, yellow highlight with ring).
    - Click any chip to change the primary. Click ✕ to remove; if removing the primary, the next correction is auto-promoted.
    - Ambiguous suggestion buttons (e.g., SEE/TWICE for "V") are toggleable.
  - **API** (`/api/feedback`):
    - Accepts `userCorrection` (primary) + `alternateCorrections` (string array).
    - Stores **one row** in `translation_feedback` with `user_correction = primaryCorrection`.
    - Alternates embedded in `landmark_data` JSONB as `{ alternateCorrections: [...] }`.
    - The `update_learned_corrections` trigger fires only on the primary correction → `learned_corrections` counts are clean.
  - **Auto-Correction Impact**:
    - Only the primary correction increments `learned_corrections.occurrence_count`.
    - When the threshold (3) is reached for a single unambiguous primary, runtime auto-correction kicks in.
    - Alternates are preserved for analytics/prompt augmentation but don't interfere with auto-correction logic.
- **Files Modified**: `src/components/feedback/FeedbackButtons.tsx`, `src/app/api/feedback/route.ts`

---

## 2026-02-05 — Feature: Increased Motion Capture for Dynamic Signs

- **Symptom**: Motion-based ASL signs (e.g., signs involving arm movement, wrist rotation, or multi-step gestures) were being clipped or misrecognized because the capture window was too short and too few frames were sent to Gemini.
- **Changes**:

  | Setting | Before | After | Rationale |
  |---------|--------|-------|-----------|
  | `SILENCE_TRIGGER_THRESHOLD` | 1200ms | **1800ms** | Longer pause window captures full motion signs before triggering |
  | `MAX_BUFFER_SIZE` | 120 frames | **180 frames** | 6 seconds at 30 FPS (was 4 sec) |
  | `SIGN_RECOGNITION_FRAME_COUNT` | 5 | **10** | More video frames sent to Gemini for motion context |
  | `SIGN_RECOGNITION_MAX_LANDMARKS` | 40 | **60** | More landmark frames for detailed trajectory data |
  | `VIDEO_CAPTURE_INTERVAL` | Every 4th frame | **Every 3rd frame** | ~10 FPS video capture (was ~7.5 FPS) |
  | Video buffer max | 20 frames | **30 frames** | Matches increased frame count |
  | `createLandmarkBuffer` limit | 40 | **60** | Matches new `SIGN_RECOGNITION_MAX_LANDMARKS` |

- **Rate Limit Safety**: Still within the 30 req/min sliding window. Each request sends at most 10 video frames (base64 JPEG). Gemini 3.0 Flash handles multimodal payloads of this size within the 9-second timeout.
- **Files Modified**: `src/config/constants.ts`, `src/hooks/useTranslation.ts`

---

## 2026-02-05 — Bug Fix: Gemini 429 Rate Limit Handling + Retry Countdown

- **Symptom**: Sign recognition stuck in processing; console logs showed repeated `[Translation] Error: {}` or rapid `Gemini API rate limit reached` errors. UI silently looped without giving the user a clear retry path.
- **Root Causes**:
  1. Gemini 429 errors were returned without a user-friendly explanation.
  2. Client cooldown was overwritten in the `catch` block, negating `Retry-After` handling.
  3. `processLandmarks` could still trigger translation every frame once silence threshold was hit.
- **Fixes**:
  - **API** (`/api/sign-recognize`): Added explicit 429 handling with `Retry-After` passthrough and clear user message. Other HTTP errors continue to return 502.
  - **Rate Limiter** (`rateLimit.ts`): Reduced default sliding window from **30 → 15 req/min** to stay under Gemini free-tier limits.
  - **Client** (`useTranslation.ts`):
    - Added `translationRetryAfterUntil` state and respected `Retry-After` header on 429s.
    - Prevented cooldown overwrite in `catch` when a longer retry window is already set.
    - Added cooldown guard in `processLandmarks` to stop re-triggering while in cooldown.
  - **UI** (`TranscriptionBox.tsx`): Display errors in red and show a countdown (“Retry available in Xs”) when rate-limited.
  - **Wiring** (`page.tsx`): Passed retry countdown prop into `TranscriptionBox`.
- **Tests**: `npx vitest run` (113 passing) and `npx tsc --noEmit` (clean).
- **Files Modified**: `src/app/api/sign-recognize/route.ts`, `src/lib/sign-recognition/rateLimit.ts`, `src/hooks/useTranslation.ts`, `src/app/page.tsx`, `src/components/ui/TranscriptionBox.tsx`

---

## 2026-02-05 — Test Suite Status

- **Total Tests**: 114 passing (0 failing)
- **Test Files** (8):
  - `src/lib/detection/confidenceFusion.test.ts`
  - `src/lib/detection/hybridDetector.test.ts`
  - `src/lib/roboflow/roboflowService.test.ts`
  - `src/lib/sign-recognition/validation.test.ts`
  - `src/lib/sign-recognition/rateLimit.test.ts`
  - `src/lib/sign-recognition/learnedCorrections.test.ts`
  - `src/lib/sign-recognition/promptAugmentation.test.ts`
  - `src/lib/sign-recognition/noMockFallback.test.ts`
- **Runner**: Vitest with jsdom environment
- **Command**: `npx vitest run`

---

## Current Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Next.js + MediaPipe + Zustand)                     │
│                                                             │
│  Camera → MediaPipe Landmarks + Video Frames                │
│       → Buffer (180 frames / 30 video frames max)           │
│       → Silence detection (1800ms threshold)                │
│       → POST /api/sign-recognize                            │
│                                                             │
│  Recognition Result ← SignRecognizeResult                   │
│       → ElevenLabs TTS → Audio playback                     │
│       → POST /api/translate → Gloss sequence                │
│       → FeedbackButtons (👍/👎 + primary correction)        │
│            → POST /api/feedback                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Server (Next.js API Routes)                                │
│                                                             │
│  /api/sign-recognize:                                       │
│    1. Validate + Rate Limit                                 │
│    2. Persist sample (sign_recognition_samples + Storage)   │
│    3. Build augmented prompt (learned_corrections → prompt)  │
│    4. Call Gemini 3.0 Flash (video frames + landmarks)      │
│    5. Apply runtime learned corrections (if unambiguous)    │
│    6. Return SignRecognizeResult                            │
│                                                             │
│  /api/feedback:                                             │
│    1. Store primary correction → translation_feedback       │
│    2. Alternates stored in landmark_data JSONB              │
│    3. Trigger auto-upserts learned_corrections              │
│    4. At threshold (3), runtime corrections activate        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Supabase                                                   │
│                                                             │
│  Tables:                                                    │
│    - translation_feedback (ratings, corrections, samples)   │
│    - learned_corrections (misrecognition→correction map)    │
│    - accuracy_metrics (aggregated period stats)             │
│    - sign_recognition_samples (raw input for replay)        │
│                                                             │
│  Storage:                                                   │
│    - sign-recognition-samples bucket (video frame JSON)     │
│                                                             │
│  Functions:                                                 │
│    - update_learned_corrections() [SECURITY DEFINER]        │
│    - calculate_period_accuracy()                            │
│    - get_top_misrecognitions()                              │
│    - mark_prompt_patterns_added() [planned RPC]             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2026-02-07 — Bug Fix: SIGNING mode translation state/type mismatch + build/lint stabilization

- **Symptom**: Type/lint errors due to `TranslationState` mismatch between `useSigningModeTranslation` and UI consumers (`page.tsx`, `TranscriptionBox.tsx`). UI expected an `'error'` state plus `translationError` and `translationRetryAfterUntil`.
- **Fix**:
  - Updated `src/hooks/useSigningModeTranslation.ts`:
    - Added `'error'` to `TranslationState`.
    - Added `translationError` + `translationRetryAfterUntil` state and returned them from the hook.
    - Extended `TranslationResult` to include `recognition: SignRecognizeResult` so consumers can rely on `translation.recognition.*`.
    - Updated error handling to set `state: 'error'` and populate `translationError`.
  - Added MediaPipe gesture typing support:
    - Added `GestureResult` type and optional `gesture` field on `LandmarkResult` in `src/lib/mediapipe/types.ts`.
    - Added `src/lib/mediapipe/gestureRecognizer.ts` and exported it from `src/lib/mediapipe/index.ts` to satisfy gesture-recognition imports.
  - Fixed lint errors (`prefer-const`, React hook purity) in:
    - `src/app/api/openai/recognize/route.ts`
    - `src/components/camera/YOLOOverlay.tsx`
    - `src/components/feedback/FeedbackButtons.tsx`
    - `src/components/ui/TranscriptionBox.tsx`
    - `src/hooks/useTranslation.ts`
  - Fixed failing unit tests for LSTM temporal buffer by supporting both 63-feature (single-hand) and 126-feature (two-hand) modes based on `LSTM_FEATURE_COUNT` in `src/lib/lstm/temporalBuffer.ts`.

- **Verification**:
  - `npm install`
  - `npm run lint -- --quiet`
  - `npm run build`
  - `npm run test:run`

---

## 2026-02-07 — Feature: Switch Signing Recognition from OpenAI to Gemini

- **Goal**: Replace the OpenAI GPT-4o sign recognition pipeline with the existing Gemini 3.0 Flash `/api/sign-recognize` route, which includes prompt augmentation and runtime learned corrections.
- **Reason**: `OPENAI_API_KEY` was not configured, causing 500 errors. Gemini is the project's canonical recognition backend (per "Gemini Sandwich" architecture) and `GEMINI_API_KEY` is already set.
- **Deliverables**:
  - `src/lib/sign-recognition/geminiClient.ts` — Client-side function `recognizeSignWithGemini()` that calls `POST /api/sign-recognize` with `{ frames, videoFrames, sessionId }`. Returns `SignRecognizeResult`. Handles HTTP errors, rate-limit `Retry-After`, and network failures.
  - Updated `src/hooks/useSigningModeTranslation.ts`:
    - Replaced `recognizeSignWithOpenAI` import/call with `recognizeSignWithGemini`.
    - Removed `createLandmarkBuffer` import (no longer needed — Gemini client trims frames directly).
    - Kept `captureVideoFrame` import from `@/lib/openai` (DOM utility for video frame capture).
  - `src/lib/sign-recognition/geminiClient.test.ts` — 7 unit tests covering: correct payload, frame trimming, HTTP 429/503 errors, `success: false`, default field handling, network failure.
- **Tests**: 14 files, 267 tests passing (0 failing).
- **Files Created**: `src/lib/sign-recognition/geminiClient.ts`, `src/lib/sign-recognition/geminiClient.test.ts`
- **Files Modified**: `src/hooks/useSigningModeTranslation.ts`

---

## 2026-02-09 — Feature: Confusion-Pair Prompt Augmentation Overhaul

- **Goal**: Replace the directive-style prompt augmentation ("strongly consider X instead") with an accuracy-weighted confusion-pair system that uses sign definitions and context dependency, eliminating three structural flaws: no positive signal, conflicting corrections, and chain poisoning.
- **Problem**: The old augmentation injected directives like `When you would output "YES", strongly consider "WANT" instead`, which caused Gemini to avoid "YES" entirely — even when correct 94% of the time. Conflicting corrections ("YES" → both "WANT" and "HELP-ME") and chain corrections ("A" → "GOODBYE" → "NEED") made the problem worse.
- **Solution — Accuracy-Gated Confusion Pairs**:
  - **New `sign_accuracy` table**: Tracks per-sign positive/negative feedback counts from user 👍/👎.
  - **Accuracy gate**: Only inject a correction when sign accuracy < 70% (with minimum 5 total ratings).
  - **Confusion-pair format**: Instead of "don't output X", describes pairs like: `"YES" and "WANT" are frequently confused (accuracy: 55%). Distinguish by: YES = S-hand nodding; WANT = Claw hands pull toward body.`
  - **Context-dependent signs**: If a sign has 3+ distinct corrections with no dominant one (>60%), emits a special format listing all possibilities with context rules extracted from sign definitions.
  - **Chain suppression**: Detects A→B + B→C chains and suppresses the weaker link.
  - **Sign definition parser**: Extracts handshape/motion descriptions from `ASL_INTERPRETATION_PROMPT` for disambiguation hints.
- **Schema Changes** (`supabase/migrations/006_accuracy_tracking.sql`):
  - Created `sign_accuracy` table (sign_text PK, total_positive, total_negative, last_updated_at).
  - Updated `update_learned_corrections()` trigger to track both positive and negative feedback in `sign_accuracy`.
  - Backfill query seeds `sign_accuracy` from existing `translation_feedback` data.
- **Runtime Corrections** (`learnedCorrections.ts`):
  - Added accuracy gate: skips auto-correction for signs with >= 70% accuracy.
  - Added context-dependency skip: if 3+ corrections with no dominant winner, defers to Gemini via augmented prompt.
  - Fetches `sign_accuracy` data alongside `learned_corrections` for both prompt augmentation and runtime corrections.
- **Constants** (configurable):
  - `ACCURACY_THRESHOLD`: 0.70
  - `MIN_FEEDBACK_COUNT`: 5
  - `CONTEXT_DEP_MIN_CORRECTIONS`: 3
  - `DOMINANT_CORRECTION_RATIO`: 0.60
- **Tests**: 25 tests passing across `promptAugmentation.test.ts` (10) and `learnedCorrections.test.ts` (15). TypeScript clean (`tsc --noEmit`).
- **Files Created**: `supabase/migrations/006_accuracy_tracking.sql`, `src/lib/sign-recognition/signDefinitions.ts`
- **Files Modified**: `src/lib/sign-recognition/promptAugmentation.ts`, `src/lib/sign-recognition/learnedCorrections.ts`, `src/lib/sign-recognition/promptAugmentation.test.ts`, `src/lib/sign-recognition/learnedCorrections.test.ts`

---

## 2026-02-15 — Bug Fix: Feedback Negative Loop + LSTM Browser/API Model Loading

- **Symptom**: Signs like HELLO were consistently misrecognized as FINISH. The `learned_corrections` table contained a `Hello → FINISH` entry that kept reinforcing itself. LSTM model failed to load in the browser (Keras 3 serialization issues) and the API fallback also returned 500 errors on every prediction attempt.
- **Root Cause — Feedback Negative Loop**:
  1. Runtime correction overrides Gemini's correct output ("Hello" → "FINISH").
  2. User sees "FINISH", clicks 👎, types "Hello" as correction.
  3. `FeedbackButtons` sent `geminiOutput = recognition.originalText` (raw Gemini output = "Hello") for negative feedback.
  4. Feedback route stored `gemini_output = "Hello"` with `rating = negative`.
  5. SQL trigger recorded `sign_accuracy` negative for "Hello" — penalizing Gemini's **correct** answer.
  6. Lower accuracy for "Hello" → bad correction passes accuracy gate → fires more → more negative feedback → **self-reinforcing loop**.
  7. User could never recover "Hello" because every rejection of the corrected output penalized the correct answer.
- **Root Cause — LSTM Loading**:
  - Browser model: Keras 3 exported `DTypePolicy` objects and `batch_shape` instead of TF.js-compatible `"float32"` strings and `batch_input_shape`.
  - API route (`/api/lstm/predict`): Still used `loadGraphModel`/`executeAsync` instead of `loadLayersModel`/`predict` after the model was re-exported as a layers model.
- **Fixes**:
  - **`FeedbackButtons.tsx`**: Changed negative feedback `geminiOutput` from `recognition.originalText` to `recognition.text` (displayed text). Now `sign_accuracy` correctly penalizes what the user actually saw and rejected.
  - **`feedback/route.ts`**: Simplified `geminiOutputToStore` to always use `body.correctedText || body.geminiOutput` regardless of rating. Both positive and negative feedback track accuracy of the displayed output.
  - **`learnedCorrections.ts`**: Made runtime auto-corrections conservative — require sufficient accuracy evidence (≥5 ratings AND accuracy <70%) before auto-correcting. Without data, corrections are skipped and Gemini decides via prompt augmentation instead.
  - **`model.json` files**: Patched 18 Keras 3 incompatibilities per file (`DTypePolicy` → `"float32"`, `batch_shape` → `batch_input_shape`).
  - **`/api/lstm/predict/route.ts`**: Switched from `tf.GraphModel`/`executeAsync` to `tf.LayersModel`/`predict`.
  - **Cleanup**: Created `/api/feedback/cleanup` endpoint. Removed 3 self-referencing corrections (W→W, WATER→WATER, Hello→HELLO). Reset `sign_accuracy` table to rebuild with fixed logic.
- **Tests**: 260 passing (1 new test for no-accuracy-record case).
- **Files Created**: `src/app/api/feedback/cleanup/route.ts`
- **Files Modified**: `src/components/feedback/FeedbackButtons.tsx`, `src/app/api/feedback/route.ts`, `src/lib/sign-recognition/learnedCorrections.ts`, `src/lib/sign-recognition/learnedCorrections.test.ts`, `src/app/api/lstm/predict/route.ts`, `src/app/api/lstm/predict/route.test.ts`, `public/models/asl_cnn_lstm_25/model.json`, `public/models/asl_cnn_lstm_25.json`

---

## 2026-03-03 — Branch Refactor & Cleanup

- **Goal**: Remove dead code, orphan artifacts, and fix lint errors across the codebase.
- **Refactoring**:
  - **Removed 26 orphan model shard files** (`group1-shard*of9.bin`, `group1-shard*of17.bin`) — ~96 MB of dead weight from previous TF.js exports. Only the referenced `of5` set remains.
  - **Removed `isUsingAPIFallback` export** from `lstmService.ts` — unused by any consumer.
  - **Removed `resetAttentionLayerRegistration` export** from `attentionLayer.ts` — unused.
  - **Removed browser debug utilities** from `lstmService.ts` (`window.testLSTMInference`, `getLSTMState`, `loadLSTMModel`, `disposeLSTMModel`, `getLSTMModelMetadata`).
  - **Removed window debug bindings** from `useSigningModeTranslation.ts` (`window.enableLSTM`, `window.disableLSTM`, `window.getLSTMState`).
- **ESLint Fixes**:
  - `DebugOverlay.tsx`: Fixed conditional `useMemo` hook (moved early return after hook call).
  - `SubtitleOverlay.tsx`: Fixed `setState` in effect — added `useRef` guard to prevent duplicate entries.
  - `MetricsDashboard.tsx`: Wrapped `fetchData` in `useCallback` to fix missing dependency warning.
  - Removed unused imports: `ArrowRight`/`SessionRow` (HistoryModal), `genASLClient`/`GenASLTranslateRequest` (GenASLPlayer).
  - Prefixed unused vars with `_`: `_request` (corrections route), `_landmarkText` (OpenAI route), `_isFallback` (AvatarPlayer).
- **LSTM Model Loading Fix**:
  - **Weight name mismatch**: Keras 3 exports weight names that don't match TF.js internal variable names. Discovered all 12 mismatched names via debug script and applied comprehensive remapping:
    - `conv1d/*` → `td_conv1d/*` (TimeDistributed wrapper prefix)
    - `batch_normalization/*` → `td_batch_norm/*` (TimeDistributed wrapper prefix)
    - `forward_lstm/lstm_cell/*` → `bidirectional/forward_forward_lstm/*` (Bidirectional prefixes + LSTM cell flattening)
    - `backward_lstm/lstm_cell/*` → `bidirectional/backward_forward_lstm/*`
  - Fixed in both `model.json` files and added defensive remapping in API route `loadModelFromDisk()`.
  - **AttentionLayer rank error**: `tf.dot` only supports rank 1-2 tensors, but BiLSTM output is rank 3 `[batch, timesteps, features]`. Replaced with `tf.matMul` (batch-aware) and `tf.einsum('btd,d->bt')` for the context vector dot product.
  - **Model caching**: Changed `getModelState()` to cache failures permanently — retrying after partial load hits "variable already registered" errors due to TF.js global state.
- **Tests**: 259 unit tests + 7 E2E tests passing. TypeScript compiles clean (`tsc --noEmit`).
- **Files Modified**: `src/lib/lstm/lstmService.ts`, `src/lib/lstm/attentionLayer.ts`, `src/hooks/useSigningModeTranslation.ts`, `src/components/ui/DebugOverlay.tsx`, `src/components/ui/SubtitleOverlay.tsx`, `src/components/feedback/MetricsDashboard.tsx`, `src/components/avatar/GenASLPlayer.tsx`, `src/components/avatar/AvatarPlayer.tsx`, `src/components/modals/HistoryModal.tsx`, `src/app/api/feedback/corrections/route.ts`, `src/app/api/openai/recognize/route.ts`, `src/app/api/lstm/predict/route.ts`, `public/models/asl_cnn_lstm_25/model.json`, `public/models/asl_cnn_lstm_25.json`
- **Files Deleted**: 26 orphan `.bin` shard files in `public/models/asl_cnn_lstm_25/`

---

## 2026-03-04 — Destructive Testing & Resilience Sweep

- **Goal**: Systematically break the application with negative, boundary, fuzz, chaos, and load tests to identify weaknesses and verify graceful degradation.
- **Phase 1 — Negative & Boundary Tests**:
  - `src/lib/sign-recognition/validation.destructive.test.ts` (56 tests): Oversized payloads, type confusion (string/number/boolean/null/undefined in every field), unicode edge cases (zero-width joiners, RTL marks, surrogate pairs), array boundary conditions (max±1 frames), prototype pollution (`__proto__`, `constructor`, `prototype` via `JSON.parse`), malformed `dataUrl` strings, circular references.
  - `src/lib/sign-recognition/rateLimit.destructive.test.ts` (31 tests): Time manipulation (negative timestamps, `Number.MAX_SAFE_INTEGER`, clock going backwards), concurrent flood simulation (1000 rapid requests), key edge cases (empty string, unicode, 10KB keys, 1000 unique keys), limit boundaries (maxRequests=0/1, remaining count accuracy across expiry windows), `retryAfter` calculation precision, store cleanup behavior across time jumps.
- **Phase 2 — Fuzz Tests**:
  - `src/lib/sign-recognition/validation.fuzz.test.ts` (18 tests): Property-based testing with `fast-check`. Key properties: valid inputs always pass (1000 iterations), non-object inputs always fail (500 iterations), missing required fields always fail, oversized arrays always fail, invalid frame/videoFrame shapes always fail, sessionId/lstmHint edge cases. Crash-resistance property: 2000 arbitrary JSON-serializable inputs — **no crashes found**.
- **Phase 3 — Load Test Scripts**:
  - `load-tests/sign-recognize-load.js`: k6 script with 4 scenarios (load: 50 req/s × 2min, stress: ramp to 200 req/s, spike: 0→500 req/s burst, soak: 20 req/s × 10min). Targets both `/api/sign-recognize` and `/api/lstm/predict`. Thresholds: p95 < 5s, error rate < 10%.
- **Phase 4 — Chaos / Failure Injection**:
  - `src/app/api/lstm/predict/route.chaos.test.ts` (21 tests): File system failures (ENOENT, EACCES, missing shards), corrupted model files (invalid JSON, empty string, missing/empty `weightsManifest`), TF.js loading failures (`loadLayersModel` throws, "already registered" error, `predict` throws/returns null/empty), malformed request payloads (null/string/number landmarks, empty array, wrong feature count, `request.json()` throws, 10K frames, NaN/Infinity values). **All return proper HTTP error codes without crashing.**
- **Infrastructure Fix**:
  - `vitest.config.ts`: Added `fileParallelism: false` and fuzz test timeouts to prevent module singleton leakage between LSTM test files and fuzz test timeouts under full suite load.
- **Findings**:
  - Validation is solid — no crashes on 2000+ arbitrary inputs.
  - Rate limiter handles all edge cases (clock manipulation, concurrent floods, prototype pollution keys).
  - LSTM route degrades gracefully under all simulated failures.
  - No prototype pollution vulnerabilities — Map-based rate limit store is immune.
- **Tests**: 385 unit tests + 7 E2E tests passing.
- **Dependencies Added**: `fast-check` (dev)
- **Files Created**: `src/lib/sign-recognition/validation.destructive.test.ts`, `src/lib/sign-recognition/rateLimit.destructive.test.ts`, `src/lib/sign-recognition/validation.fuzz.test.ts`, `src/app/api/lstm/predict/route.chaos.test.ts`, `load-tests/sign-recognize-load.js`
- **Files Modified**: `vitest.config.ts`, `package.json`, `package-lock.json`

---

## 2026-03-04 — Latency Quick Wins: Sign-to-Response Speed Optimization

- **Goal**: Reduce sign recognition pipeline latency from ~4-8s to ~2-4s (Gemini path) and fix post-first-sign stalling caused by a double-lock mechanism.
- **Root Cause of Stalling**: `isProcessingRef` blocked input during the entire sequential chain (API + TTS + audio playback + gloss = 2-10s), then `completeCooldownRef` blocked for another 4s. Combined with a blob URL memory leak degrading performance over time, this created a 6-14 second dead zone between signs.

### Changes Made
1. **Fix 7 — Blob URL memory leak** (`src/lib/elevenlabs/clientService.ts`): Removed eager `URL.createObjectURL` in `synthesizeSpeech()` — callers (`playAudioBlob`) create and revoke their own URLs. Prevents progressive memory buildup.
2. **Fix 8 — Unlock input on hands return** (`src/hooks/useSigningModeTranslation.ts`): Added `completedAtRef` timestamp tracking. When hands are detected during cooldown and ≥500ms have elapsed since result display, immediately unlock input instead of waiting for full cooldown timer.
3. **Fix 1+2 — Parallelize TTS + gloss, background audio** (`src/hooks/useSigningModeTranslation.ts`): TTS synthesis runs as fire-and-forget (audio plays in background without blocking). Gloss translation runs concurrently. Saves 1-4s.
4. **Fix 4 — Reduce display cooldown** (`src/components/views/SigningView.tsx`): 4000ms → 2000ms. Combined with Fix 8, users can start signing the next word even sooner.
5. **Fix 3 — Reduce silence threshold** (`src/config/constants.ts`): `SILENCE_TRIGGER_THRESHOLD` 1500ms → 800ms. Dynamic mode threshold (1000ms) still applies when LSTM detects motion.
6. **Fix 5 — Fire-and-forget Supabase persistence** (`src/app/api/sign-recognize/route.ts`): Generate `sampleId` synchronously, kick off `persistSignRecognitionSample` in background with `.catch()` handler. Saves 50-300ms on critical path.
7. **Fix 6 — Reduce video frames** (`src/config/constants.ts`): `SIGN_RECOGNITION_FRAME_COUNT` 10 → 8 (conservative first step; landmark data still carries full motion).

### Projected Impact
| Path | Before | After |
|------|--------|-------|
| Gemini full pipeline | ~4-8s | ~2-4s |
| LSTM short-circuit | ~1.5-2s | ~0.8-1.2s |
| Between-sign gap | ~6-14s | ~2-3s |
| Memory stability | Degrades over time | Stable |

- **Tests**: 385 unit tests passing, 7 E2E tests passing.
- **Files Modified**: `src/lib/elevenlabs/clientService.ts`, `src/hooks/useSigningModeTranslation.ts`, `src/components/views/SigningView.tsx`, `src/config/constants.ts`, `src/app/api/sign-recognize/route.ts`

---

## 2026-03-04 — LSTM Misclassification Diagnosis & Threshold Fix

- **Problem**: LSTM model was short-circuiting Gemini with wrong sign predictions. Console logs showed confident but incorrect LSTM predictions bypassing the more accurate Gemini vision path.
- **Root Cause**: The CNN-LSTM model (trained Feb 15) is severely overfitting — train accuracy 90% vs val accuracy 72.9%. The validation loss *increased* from epoch 5 while training loss kept dropping. The dataset is also massively imbalanced (4–25 raw samples per sign) with only 67 successful WLASL video extractions supplementing 19 Kaggle signs. Per-class test accuracy: MEET 0%, UNDERSTAND 18%, NAME 33%, WHAT 33%.

### Changes Made
1. **Fix A — Raise LSTM thresholds** (`src/config/constants.ts`):
   - `LSTM_CONFIDENCE_THRESHOLD`: 0.70 → 0.80 (hint threshold)
   - `LSTM_SHORTCIRCUIT_THRESHOLD`: 0.85 → 0.95 (bypass-Gemini threshold)
   - Effect: Far fewer wrong short-circuits. More requests fall through to Gemini.
2. **Fix B — LSTM diagnostic logging** (`src/hooks/useSigningModeTranslation.ts`): Added top-3 prediction logging with confidences before the short-circuit decision. Console now shows: `LSTM top-3: [HELLO:92.3%, PLEASE:4.1%, YES:1.8%] (threshold: short-circuit≥95%, hint≥80%)`.
3. **Fix C — Confusion matrix evaluation script** (`scripts/lstm_training/evaluate.py`): New Python script that loads test data, runs inference, and generates per-class precision/recall/F1, confusion matrix, and most-confused pairs. Also saves `evaluation_report.json`.

### Evaluation Results (257 test samples, 29 signs)
- **Overall test accuracy**: 80.2%
- **Good signs (F1≥0.7)**: 20 of 29
- **Critical signs (F1<0.3)**: WHAT (F1=0.25), MEET (F1=0.00)
- **Weak signs (F1 0.3–0.5)**: UNDERSTAND (F1=0.31)
- **Top confused pairs**: UNDERSTAND→GOODBYE (63.6%), WHAT→HELP (66.7%), MEET→WHEN (50%)
- **Recommended**: Prune WHAT and MEET from LSTM vocabulary; gather more data for UNDERSTAND

### Next Steps (Phase 2 — Remediation)
1. Prune vocabulary to reliable signs only (remove F1<0.3)
2. Balance dataset with heavier augmentation for underrepresented signs
3. Fix train/val split (107 val samples is too small)
4. Verify handedness alignment between Kaggle data and browser MediaPipe
5. Retrain with stronger regularization (target: val accuracy ≥80%, per-class F1 ≥60%)

- **Tests**: 385 unit tests passing.
- **Files Modified**: `src/config/constants.ts`, `src/hooks/useSigningModeTranslation.ts`
- **Files Created**: `scripts/lstm_training/evaluate.py`

---

## 2026-03-04 — LSTM Pipeline Silencing & Gemini Payload Reduction

- **Goal**: Fully disable the broken LSTM pipeline to eliminate its negative impact on recognition, and reduce landmark/video payloads to prevent Gemini API timeouts.

### Problem Summary
1. **LSTM model is confidently wrong**: Predicts DRINK/FOOD at 98%+ confidence for every sign. Even with short-circuit disabled (threshold=2.0) and hints disabled (returns null), the model still loaded (~97MB download), ran TF.js inference every ~400ms, and influenced dynamic mode timing via `hasPendingDynamicSign()`.
2. **Gemini timeouts on large payloads**: Landmark buffers of 60+ frames produced ~30KB of prompt text, causing Gemini responses to exceed the 15s timeout. Diagnostic data showed: 16-30 landmarks → 3-4s (fast), 37-42 → 8-13s (slow), 70+ → always timed out.
3. **Learned corrections table poisoned**: The `learned_corrections` Supabase table contained mappings from the broken LSTM era (e.g., "Thank you" → "MY", "Hello" → "FINISH") that were overriding Gemini's correct outputs.

### Changes Made

#### Part 1: LSTM Pipeline Silenced via Feature Flag
- **`src/config/constants.ts`**: Added `LSTM_ENABLED = false` master kill-switch. When false: no model download, no TF.js import, no inference, no dynamic-mode influence. All LSTM code stays intact — set back to `true` after retraining.
- **`src/hooks/useSigningModeTranslation.ts`**:
  - `useLSTMDetection({ autoLoad: LSTM_ENABLED })` — model won't load when flag is false.
  - Auto-enable `useEffect` gates on `LSTM_ENABLED` — no auto-start.
  - `processLandmarks()` call gates on `LSTM_ENABLED` — no inference.
  - `getLSTMHint()` returns `null` immediately when `LSTM_ENABLED` is false. Restored original hint logic behind the flag for future reactivation.
- **Impact**: ~97MB model download eliminated, WebGL/CPU tensor inference eliminated, TF.js dynamic import skipped entirely. `hasPendingDynamicSign()` returns false → standard 800ms silence threshold used (down from 1000ms dynamic mode, acceptable since LSTM wasn't providing useful detection).
- **What still works**: DebugOverlay shows `lstmEnabled: false` (informative), DiagnosticPanel works (no LSTM events logged), `enableLSTM()`/`disableLSTM()` actions preserved, all 4 LSTM test files pass (they mock the module).

#### Why LSTM Is Not Being Used
The CNN-LSTM model (trained 2026-02-15) suffers from severe overfitting:
- **Train accuracy**: 90% vs **validation accuracy**: 72.9%
- Validation loss *increased* from epoch 5 while training loss kept dropping
- Dataset massively imbalanced: 4–25 raw samples per sign, only 67 WLASL video extractions supplementing 19 Kaggle signs
- **Per-class failures**: MEET 0% accuracy, UNDERSTAND 18%, NAME 33%, WHAT 33%
- **Top confused pairs**: UNDERSTAND→GOODBYE (63.6%), WHAT→HELP (66.7%), MEET→WHEN (50%)
- In production, the model predicted DRINK or FOOD at 98%+ confidence for virtually every input sign

The model cannot be fixed without retraining. Prerequisites for re-enablement:
1. Clean and balance the training dataset (minimum 50 samples per sign)
2. Fix train/val split (107 val samples is too small)
3. Verify handedness alignment between Kaggle data and browser MediaPipe
4. Retrain with stronger regularization (target: val accuracy ≥85%, per-class F1 ≥60%)
5. Set `LSTM_ENABLED = true` in `constants.ts`

#### Part 2: Landmark & Video Buffer Reduction

| Setting | Before | After | Rationale |
|---------|--------|-------|-----------|
| `MAX_BUFFER_SIZE` | 120 frames (~4s) | **60 frames (~2s)** | Reduced accumulation cap; 2s is ample for single signs |
| `SIGN_RECOGNITION_MAX_LANDMARKS` | 60 | **30** | Diagnostic data: 30 frames → 3-4s response (well under 15s timeout) |
| Video frame buffer cap | 60 | **24** | Only 8 frames sampled for Gemini; 3× headroom is sufficient |

- **`src/config/constants.ts`**: Reduced `MAX_BUFFER_SIZE` (120→60) and `SIGN_RECOGNITION_MAX_LANDMARKS` (60→30).
- **`src/hooks/useSigningModeTranslation.ts`**: Reduced both video buffer caps (independent capture interval and per-landmark capture) from 60→24.
- **Payload chain**: Raw buffer (up to 60 landmarks) → `geminiClient.ts` trims to 30 → server `formatLandmarksForPrompt` samples 30 → ~15KB prompt text. Video: 24 buffered → 16 sent to API → 8 sampled server-side → ~120KB images. Total: ~135KB (down from ~250KB+).

#### Part 3: Learned Corrections Bypass Formalized
- **`src/lib/sign-recognition/learnedCorrections.ts`**: Added `TODO` marker and re-enablement instructions to the bypassed `applyRuntimeLearnedCorrections()`. All 108 rows preserved in Supabase — no data deleted. Will re-enable after reviewing/cleaning the table.

#### Part 4: DiagnosticPanel Crash Prevention
- **`src/components/ui/DiagnosticPanel.tsx`**: Wrapped `JSON.stringify(entry.data)` in try-catch returning `'[unserializable]'` on failure, preventing panel crash on circular or non-serializable diagnostic data.

### Live Test Results (2026-03-04 17:13–17:15)

| Sign | Landmarks Sent | Gemini Time | Result |
|------|---------------|-------------|--------|
| Hello | 26 | 4575ms | ✅ "Hello" |
| Sorry | 16 | 4216ms | ✅ "SORRY" |
| Please | 55 (30 after trim) | 7347ms | ✅ "PLEASE" (retry after initial timeout) |
| W | 29 | 5162ms | ✅ "W" |
| Thank You | 33 (30 after trim) | 4770ms | ✅ "THANK-YOU" |
| Understand | 32 (30 after trim) | 4348ms | ✅ "UNDERSTAND" |

- Average response time: ~5.1s (down from 8-13s + frequent timeouts)
- One transient 503 and one timeout on first attempt — both succeeded on retry
- LSTM: zero events logged, zero model download, zero CPU overhead

### Updated Architecture

```
Client Pipeline (LSTM_ENABLED=false):
  Camera → MediaPipe Landmarks + Video Frames
       → Landmark buffer (max 60 frames, trimmed to 30 for API)
       → Video buffer (max 24 frames, 8 sampled for Gemini)
       → Silence detection (800ms standard threshold)
       → POST /api/sign-recognize
       → No LSTM model loaded, no inference, no dynamic mode

Server Pipeline:
  /api/sign-recognize:
    1. Validate + Rate Limit (15 req/min)
    2. Persist sample (fire-and-forget)
    3. Build augmented prompt (confusion-pair format)
    4. Format 30 landmark frames (~15KB text)
    5. Sample 8 video frames (~120KB images)
    6. Call Gemini 3.0 Flash (timeout: 15s)
    7. Runtime corrections: BYPASSED (learned_corrections poisoned)
    8. Return SignRecognizeResult
```

- **Tests**: 19 files, 385 tests passing. No regressions.
- **Files Modified**: `src/config/constants.ts`, `src/hooks/useSigningModeTranslation.ts`, `src/lib/sign-recognition/learnedCorrections.ts`, `src/components/ui/DiagnosticPanel.tsx`

---

## Future Work

- **Decay/recency weighting**: Older corrections should carry less weight than recent ones. Proposed approach: `effectiveCount = occurrenceCount * decayFactor` where `decayFactor = max(0.1, 1 - daysSinceLastSeen / 90)`. Deferred to a later date.
- **`sign_recognition_samples` as reference data**: Raw landmark/video samples linked to feedback (`sign_recognition_samples` + `translation_feedback`) could be analyzed offline to discover distinguishing motion/handshape patterns between confused signs, then encoded as text descriptions in the confusion-pair augmentation. This is a lightweight alternative to full CNN-LSTM retraining. Deferred to Phase 2 iteration.
