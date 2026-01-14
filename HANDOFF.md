# Kine - Developer Handoff Document

**Date:** January 13, 2026
**Project:** Kine - Real-Time ASL Translation PWA
**Status:** All 5 phases complete, ready for backend integration

---

## Project Overview

Kine is a bi-directional sign language translation Progressive Web App (PWA). It bridges communication between deaf/hard-of-hearing users and hearing users through real-time translation.

**Two Modes:**
- **SIGNING Mode:** Camera captures hand movements → AI translates → Spoken output
- **LISTENING Mode:** Speech input → AI translates → Avatar signs back

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16+ (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| State | Zustand |
| Vision AI | Google MediaPipe (HandLandmarker) |
| Translation AI | Google Gemini API (ready) |
| Database | Supabase (ready) |
| TTS | ElevenLabs (optional, not implemented) |

---

## What Has Been Implemented

### Phase 1: UI Layout ✅
- Mode toggle button (thumb zone, bottom of screen)
- SIGNING view with camera feed placeholder
- LISTENING view with avatar display area
- High-contrast UI (yellow text on black background)
- Framer Motion transitions between views

### Phase 2: MediaPipe Integration ✅
- Real camera feed via `getUserMedia`
- HandLandmarker for 21-point hand skeleton
- Red skeleton overlay drawn on canvas
- 100ms sampling rate for battery optimization
- FaceLandmarker setup (for future facial expression support)

### Phase 3: Avatar Playback Engine ✅
- Canvas-based mock avatar animations
- Gloss-to-video mapping system
- Sequential playback queue with gapless transitions
- Fallback display for unknown gloss words
- 8 mock signs: HELLO, WORLD, THANK_YOU, YES, NO, PLEASE, SORRY, HELP

### Phase 4: Translation Loop ✅
- Motion detection algorithm (tracks hand stillness)
- 1.5-second silence threshold triggers translation
- Visual progress indicator during pause detection
- Auto-switch to LISTENING mode after translation
- Auto-play avatar sequence on mode switch

### Phase 5: Backend Integration ✅ (Structure Ready)
- Supabase client setup with configuration detection
- Avatar repository with caching layer
- Message history storage service
- Gemini translation service with prompt engineering
- Automatic fallback to mock data when APIs not configured

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx          # Main app with SigningView & ListeningView
│   ├── layout.tsx        # Root layout
│   └── globals.css       # Tailwind + custom animations
│
├── components/
│   ├── camera/
│   │   ├── CameraFeed.tsx    # Video stream component
│   │   └── HandTracker.tsx   # MediaPipe canvas overlay
│   ├── avatar/
│   │   └── AvatarPlayer.tsx  # Mock avatar display
│   └── ui/
│       ├── ModeToggle.tsx    # Big bottom button
│       ├── TranscriptionBox.tsx  # Status/translation display
│       ├── TopBar.tsx        # History/Settings icons
│       └── Waveform.tsx      # Audio visualization
│
├── hooks/
│   ├── useCamera.ts          # Camera stream management
│   ├── useTranslation.ts     # Translation orchestrator
│   └── useAvatarPlayer.ts    # Playback queue manager
│
├── lib/
│   ├── mediapipe/
│   │   ├── handTracker.ts    # HandLandmarker wrapper
│   │   ├── faceTracker.ts    # FaceLandmarker wrapper
│   │   ├── motionDetector.ts # Stillness detection
│   │   └── drawingUtils.ts   # Canvas drawing helpers
│   ├── avatar/
│   │   ├── avatarService.ts  # Gloss lookup (sync + async)
│   │   └── types.ts          # Avatar type definitions
│   ├── translation/
│   │   └── mockTranslation.ts # Mock translation fallback
│   ├── supabase/
│   │   ├── client.ts         # Supabase initialization
│   │   ├── avatarRepo.ts     # Avatar DB queries
│   │   ├── messagesRepo.ts   # Message history
│   │   └── types.ts          # Database types
│   ├── gemini/
│   │   ├── translationService.ts # Gemini API calls
│   │   └── prompts.ts        # ASL gloss prompts
│   └── mock-data/
│       ├── avatars.json      # Mock avatar library
│       └── translations.json # Mock translations
│
├── store/
│   └── useAppStore.ts        # Global state (mode, processing, etc.)
│
└── config/
    └── constants.ts          # App configuration
```

---

## How to Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Open http://localhost:3000

---

## Current State

The app currently runs in **mock mode** because API credentials are not configured. This means:

- Translation uses random mock responses from `translations.json`
- Avatar lookup uses local `avatars.json` data
- No database writes occur
- Everything still works end-to-end

**To test the current flow:**
1. Open app in browser
2. Grant camera permission
3. Hold hand in front of camera (see red skeleton)
4. Move hand, then hold still for 1.5 seconds
5. Watch: Processing → Mode switch → Avatar plays

---

## What Needs To Be Done

### Priority 1: Backend Setup

#### 1. Create Supabase Project
1. Go to https://supabase.com → Create new project
2. Get **Project URL** and **Anon Key** from Settings → API
3. Run this SQL in the SQL Editor:

```sql
-- Avatar Library
CREATE TABLE avatar_library (
  gloss_label TEXT PRIMARY KEY,
  video_url TEXT NOT NULL,
  category TEXT NOT NULL,
  metadata JSONB DEFAULT '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}'
);

-- Messages (History)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  direction TEXT CHECK (direction IN ('sign_to_audio', 'audio_to_sign')),
  original_text TEXT,
  translated_text TEXT,
  gloss_sequence TEXT[],
  created_at TIMESTAMP DEFAULT now()
);

-- Seed initial data
INSERT INTO avatar_library (gloss_label, video_url, category, metadata) VALUES
('HELLO', '/avatars/hello.mp4', 'greetings', '{"duration_ms": 1500}'),
('WORLD', '/avatars/world.mp4', 'nouns', '{"duration_ms": 1200}'),
('THANK_YOU', '/avatars/thank_you.mp4', 'expressions', '{"duration_ms": 1800}'),
('YES', '/avatars/yes.mp4', 'responses', '{"duration_ms": 800}'),
('NO', '/avatars/no.mp4', 'responses', '{"duration_ms": 800}'),
('PLEASE', '/avatars/please.mp4', 'expressions', '{"duration_ms": 1200}'),
('SORRY', '/avatars/sorry.mp4', 'expressions', '{"duration_ms": 1500}'),
('HELP', '/avatars/help.mp4', 'verbs', '{"duration_ms": 1200}');
```

4. Create Storage bucket "avatars" and upload real ASL videos

#### 2. Get Gemini API Key
1. Go to https://aistudio.google.com/apikey
2. Create new API key

#### 3. Update Environment Variables
Edit `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-real-key
GEMINI_API_KEY=AIza...your-real-key
```

#### 4. Enable Real Mode
Edit `src/config/constants.ts`:
```typescript
export const USE_MOCK_DATA = false;  // Change from true to false
```

---

### Priority 2: Real ASL Videos

The current avatar system uses canvas-based mock animations. For production:

1. **Record real ASL videos** for each gloss word
2. **Upload to Supabase Storage** (bucket: "avatars")
3. **Update avatar_library table** with real video URLs
4. **Modify AvatarPlayer.tsx** to use `<video>` elements instead of canvas

Key file: `src/components/avatar/AvatarPlayer.tsx`

---

### Priority 3: Speech Recognition

Currently, the LISTENING mode has a placeholder waveform but no actual speech recognition.

**To implement:**
1. Add Web Speech API or a service like Deepgram
2. Create `src/hooks/useAudio.ts` for microphone capture
3. Connect recognized text to Gemini for gloss translation
4. Play avatar sequence based on result

---

### Priority 4: ElevenLabs TTS (Optional)

For speaking the translated text aloud:

1. Get API key from https://elevenlabs.io
2. Create `src/lib/elevenlabs/audioService.ts`
3. Call TTS after sign-to-text translation
4. Play audio in SIGNING mode

---

### Priority 5: Authentication

The TRD mentions user preferences and roles. To implement:

1. Enable Supabase Auth
2. Create login/signup UI at `src/app/auth/`
3. Create `useUserStore.ts` for preferences
4. Apply user preferences (high contrast, avatar mode, voice selection)

---

## Key Files to Understand

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main app logic, SigningView and ListeningView components |
| `src/hooks/useTranslation.ts` | Orchestrates motion detection → translation → mode switch |
| `src/lib/avatar/avatarService.ts` | Maps gloss labels to video data (sync + async versions) |
| `src/lib/gemini/translationService.ts` | Gemini API integration for text→gloss |
| `src/lib/supabase/client.ts` | Supabase client with auto-detection of configuration |
| `src/config/constants.ts` | `USE_MOCK_DATA` flag and other settings |

---

## Known Issues / Limitations

1. **Camera permission:** Browser may block camera on non-HTTPS. Use localhost or deploy with SSL.

2. **MediaPipe loading:** First load may be slow as WASM modules download (~5MB).

3. **Mock translation input:** Currently uses placeholder text "Hello, how are you?" instead of actual recognized signs. Real sign recognition requires ML model training.

4. **No real videos:** Avatar uses canvas drawings. Need actual ASL video recordings.

5. **Lockfile warning:** There's a duplicate package-lock.json in parent directory causing Next.js warnings. Can be ignored or cleaned up.

---

## Testing the App

### Manual Test Flow
1. `npm run dev` → Open http://localhost:3000
2. Allow camera permission
3. Show hand → See red skeleton
4. Move hand → "Detecting signs..." message
5. Hold still 1.5s → Progress bar fills → "Processing..."
6. Auto-switch to LISTENING mode
7. Avatar plays gloss sequence
8. Click microphone button to return to SIGNING

### Console Logs
The app logs extensively to browser console:
- `[Translation]` - Motion detection and translation events
- `[AvatarPlayer]` - Playback queue events
- `[Supabase]` - Database connection status
- `[Gemini]` - API call results

---

## Contact / Questions

Refer to:
- `TRD.md` - Original technical requirements document
- `CLAUDE.md` - AI assistant context file
- This handoff document

---

*Last updated: January 13, 2026*
