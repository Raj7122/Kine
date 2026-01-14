# Kine - Project Context for Claude Code

## Project Overview

Kine is a real-time accessibility PWA/Mobile Web App that acts as a **bi-directional bridge** for sign language translation. It enables communication between deaf/hard-of-hearing users and hearing users through two primary modes:

- **SIGNING_MODE**: User signs via camera → AI translates → Audio output
- **LISTENING_MODE**: Hearing user speaks → AI translates → Avatar signs back

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **State Management**: Zustand
- **Vision AI (Edge)**: Google MediaPipe (task-vision, running in Web Worker)
- **Generative AI (Server)**: Google Gemini 3.0 via Supabase Edge Functions
- **Audio AI (Server)**: ElevenLabs API via Supabase Edge Functions
- **Database**: Supabase (PostgreSQL)
- **Deployment**: PWA optimized for mobile (Android/iOS compatible)

## Architecture

The app is **State-Driven** (not Page-Driven) with two primary modes within a single dynamic view to minimize latency.

### Core State (useAppStore)
```typescript
mode: 'SIGNING' | 'LISTENING'
isProcessing: boolean
lastTranslation: string
```

## File Structure

```
/src
├── app/
│   ├── layout.tsx         # Global wrappers (Toaster, Theme)
│   ├── page.tsx           # Main entry (Mode Switcher Logic)
│   ├── globals.css        # Tailwind directives + Animations
│   └── auth/              # Login/Signup routes (Phase 5)
├── components/
│   ├── camera/
│   │   ├── HandTracker.tsx    # MediaPipe Canvas overlay
│   │   └── CameraFeed.tsx     # Raw video element
│   ├── avatar/
│   │   ├── AvatarPlayer.tsx   # Sequential Video Looper
│   │   └── AvatarPreloader.ts # Caching logic
│   ├── ui/
│   │   ├── ModeToggle.tsx     # The "Thumb Zone" button
│   │   ├── Waveform.tsx       # CSS Animation for listening
│   │   ├── TopBar.tsx         # History/Settings icons
│   │   └── TranscriptionBox.tsx
│   └── modals/
│       ├── SettingsModal.tsx
│       └── HistoryModal.tsx
├── lib/
│   ├── mock-data/         # JSON mocks for Phases 1-4
│   ├── supabase/          # Client instantiation (Phase 5)
│   ├── mediapipe/         # Worker setup for landmark detection
│   ├── gemini/            # Prompt templates & API wrappers
│   ├── elevenlabs/        # Audio conversion services
│   └── utils.ts
├── hooks/
│   ├── useCamera.ts       # Stream management
│   ├── useAudio.ts        # Mic recording & permissions
│   └── useTranslation.ts  # Orchestrator for API calls
├── store/
│   ├── useAppStore.ts     # Global state
│   └── useUserStore.ts    # User preferences
├── config/
│   └── constants.ts       # Configuration constants
└── __tests__/             # Co-located tests per module
```

## UX Principles (MUST FOLLOW)

1. **Don't Make Me Think**: Only two UI states, no complex navigation
2. **Fitts's Law**: Mode Switch button must be massive, in bottom "Thumb Zone"
3. **Jakob's Law**:
   - Signing Mode = Camera App mental model
   - Listening Mode = Voice Assistant mental model
4. **Accessibility**: Default to `text-yellow-400` on `bg-black` (High Contrast)

## View Specifications

### SIGNING_MODE Layout (Z-index layers)
- **Z-0**: Full-screen video element (`<CameraFeed />`)
- **Z-10**: Canvas overlay for hand skeleton (`<HandTracker />`)
- **Z-20**: UI Layer
  - Top: History icon (left), Settings icon (right)
  - Middle-lower: `<TranscriptionBox />` for real-time inference
  - Bottom 20%: Semi-transparent bar with massive circular `<ModeToggle />` (Microphone icon)

### LISTENING_MODE Layout
- **Z-0**: Solid black background
- **Z-10**: Centered flex column
  - Large yellow text (`text-4xl text-yellow-400 font-bold`)
  - `<AvatarPlayer />` (video loops of signing avatar)
  - `<Waveform />` (visual mic feedback)
- **Z-20**: Bottom bar with `<ModeToggle />` (Hand/Palm icon)

## Configuration Constants

```typescript
// config/constants.ts
USE_MOCK_DATA: true           // Set false only in Phase 5
LANDMARK_SAMPLING_RATE: 100   // ms
SILENCE_TRIGGER_THRESHOLD: 1500  // ms of no motion to trigger translation
MAX_BUFFER_SIZE: 50           // frames
AVATAR_FALLBACK_URL: "/assets/video/fallback.mp4"
```

## Development Phases

### Phase 1: Skeleton & UI Layout (Local Only) ✅ COMPLETE
- Setup Next.js + Tailwind
- Build ModeToggle, Listening view (black + yellow text), Signing view (camera placeholder)
- Verify: Button swaps views smoothly

### Phase 2: MediaPipe Integration (Local Only) ✅ COMPLETE
- Implement useCamera for real video stream
- Connect MediaPipe HandLandmarker + FaceLandmarker
- Draw red skeleton overlays on canvas
- Run inference every 100ms (battery optimization)

### Phase 3: Gloss-to-Video Engine (Local Only) ✅ COMPLETE
- Create mock avatar data in `lib/mock-data/avatars.json`
- Build AvatarPlayer with queue/sequencing logic
- Implement gapless video playback (canvas-based mock for Phase 3)

### Phase 4: Mock Translation Loop
- Connect "stop signing" trigger to fake translation
- Full loop: Sign → Red lines → Stop → Think → Play video

### Phase 5: Backend & API Integration
- Initialize Supabase Client & Auth
- Create Edge Functions for Gemini & ElevenLabs
- Replace mock data with real Supabase queries
- Add `.env.local` variables

## Database Schema (TypeScript Interfaces for Phases 1-4)

```typescript
interface User {
  id: string; // UUID, references auth.users
  role: 'deaf' | 'hearing' | 'blind';
  preferences: {
    visual_mode: 'text_plus_avatar' | string;
    voice_id: string;
    high_contrast: boolean;
  };
}

interface AvatarLibraryEntry {
  gloss_label: string;  // PK, e.g., "COFFEE"
  video_url: string;
  category: string;
  metadata: {
    duration_ms: number;
    signer_id: string;
    dialect: string;
  };
}

interface Message {
  id: string;
  session_id: string;
  direction: 'sign_to_audio' | 'audio_to_sign';
  original_text: string;
  translated_text: string;
  gloss_sequence: string[];
  audio_url: string | null;
}
```

## Key Module Behaviors

### Camera & MediaPipe (Module A)
- Use Web Worker to prevent UI freezing
- Output: `{ hands: Landmark[], face: Landmark[] }`
- Face landmarks needed for grammatical context (eyebrows/mouth)

### Translation Orchestrator (Module B)
- Buffer landmarks for 1.5-2 seconds (sliding window)
- Trigger translation when hand motion < threshold
- Phases 1-4: Return mock responses
- Phase 5: Send to Gemini API

### Avatar Playback (Module C)
- Pre-fetch video URLs for all gloss keys
- Dual-player swap technique for gapless playback
- Fallback: "WORD NOT FOUND" overlay for missing gloss

## Testing Requirements

- **Unit Tests (vitest)**: utils.ts formatters, useAppStore state changes
- **Component Tests (react-testing-library)**:
  - AvatarPlayer: video src changes on prop update
  - ModeToggle: click fires state change
- **Integration Tests**: Mock data flow (Phases 1-4), Edge Function calls (Phase 5)

## Important Patterns

- Use Framer Motion `AnimatePresence` for view transitions
- All interactive elements must be accessible
- Mobile-first responsive design
- High contrast mode as default accessibility feature
