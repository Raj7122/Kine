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
