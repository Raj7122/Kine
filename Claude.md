# Kine - Project Context for Claude Code

## Project Overview

Kine is a real-time accessibility PWA/Mobile Web App that acts as a **bi-directional bridge** for sign language translation. It enables communication between deaf/hard-of-hearing users and hearing users through two primary modes:

- **SIGNING_MODE**: User signs via camera → AI translates → Audio output
- **LISTENING_MODE**: Hearing user speaks → AI translates → Flipbook avatar signs back

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **State Management**: Zustand
- **Vision AI (Edge)**: Google MediaPipe (task-vision, CPU delegate)
- **Generative AI (Server)**: Google Gemini 3 Pro Preview via API
- **Audio AI (Server)**: ElevenLabs API via Supabase Edge Functions
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (WebP frame sequences for flipbook avatars)
- **Data Pipeline**: Python scripts for How2Sign frame extraction
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
│   ├── api/test/route.ts  # Test endpoint for translation API
│   └── auth/              # Login/Signup routes
├── components/
│   ├── camera/
│   │   ├── HandTracker.tsx    # MediaPipe Canvas overlay
│   │   └── CameraFeed.tsx     # Raw video element
│   ├── avatar/
│   │   ├── AvatarPlayer.tsx   # Main wrapper (delegates to FlipbookPlayer)
│   │   └── FlipbookPlayer.tsx # Canvas-based 24fps flipbook animation
│   ├── ui/
│   │   ├── ModeToggle.tsx     # The "Thumb Zone" button
│   │   ├── Waveform.tsx       # CSS Animation for listening
│   │   ├── TopBar.tsx         # History/Settings icons
│   │   └── TranscriptionBox.tsx
│   └── modals/
│       ├── SettingsModal.tsx
│       └── HistoryModal.tsx
├── lib/
│   ├── mock-data/         # JSON mocks for development
│   ├── supabase/          # Client instantiation & types
│   ├── mediapipe/         # Worker setup for landmark detection
│   ├── gemini/            # Prompt templates & API wrappers
│   ├── elevenlabs/        # Audio conversion services (speechService.ts)
│   ├── avatar/            # Flipbook avatar system
│   │   ├── types.ts           # FlipbookEntry, FlipbookState interfaces
│   │   ├── flipbookService.ts # Frame loading, caching, Supabase Storage
│   │   └── index.ts           # Barrel exports
│   └── utils.ts
├── hooks/
│   ├── useCamera.ts       # Stream management
│   ├── useAudio.ts        # Mic recording & permissions
│   ├── useFlipbook.ts     # Flipbook playback timing (requestAnimationFrame)
│   ├── useAvatarPlayer.ts # Avatar queue management
│   └── useTranslation.ts  # Orchestrator for API calls
├── store/
│   ├── useAppStore.ts     # Global state (mode, isProcessing)
│   └── useUserStore.ts    # User preferences (persisted with Zustand)
├── config/
│   └── constants.ts       # Configuration constants
└── __tests__/             # Co-located tests per module

/scripts                   # Python data pipeline
├── extract_frames.py      # FFmpeg extraction from How2Sign videos
├── upload_to_supabase.py  # Upload frames to Supabase Storage
├── generate_sample_frames.py # Generate placeholder frames for testing
├── download_how2sign.py   # Download How2Sign dataset
└── requirements.txt       # Python dependencies

/supabase
└── migrations/
    ├── 001_initial_schema.sql      # Base tables
    ├── 002_complete_erd_schema.sql # Sessions, feedback, saved_phrases
    └── 003_flipbook_schema.sql     # frame_count, fps, storage_path columns
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
  - `<AvatarPlayer />` → `<FlipbookPlayer />` (24fps WebP frame animation)
  - `<Waveform />` (visual mic feedback)
- **Z-20**: Bottom bar with `<ModeToggle />` (Hand/Palm icon)

## Configuration Constants

```typescript
// config/constants.ts
USE_MOCK_DATA: false              // Now using real Supabase data
LANDMARK_SAMPLING_RATE: 100       // ms
SILENCE_TRIGGER_THRESHOLD: 1500   // ms of no motion to trigger translation
MAX_BUFFER_SIZE: 50               // frames

// Flipbook Avatar System
FRAME_DURATION_MS: 41.67          // 1000ms / 24fps
DEFAULT_FPS: 24                   // Flipbook playback rate
SUPABASE_STORAGE_BUCKET: "avatars"
```

## Development Phases

### Phase 1: Skeleton & UI Layout (Local Only) ✅ COMPLETE
- Setup Next.js + Tailwind
- Build ModeToggle, Listening view (black + yellow text), Signing view (camera placeholder)
- Verify: Button swaps views smoothly

### Phase 2: MediaPipe Integration (Local Only) ✅ COMPLETE
- Implement useCamera for real video stream
- Connect MediaPipe HandLandmarker + FaceLandmarker (CPU delegate)
- Draw red skeleton overlays on canvas
- Run inference every 100ms (battery optimization)

### Phase 3: Flipbook Avatar Engine ✅ COMPLETE
- Set up Supabase Storage bucket "avatars" for WebP frames
- Create Python scripts for frame extraction and upload
- Build FlipbookPlayer component with canvas-based rendering
- Implement flipbookService for frame loading and caching
- Create useFlipbook hook with requestAnimationFrame timing
- Verify: `playFlipbookSequence(['HELLO', 'COFFEE'])` plays frames at 24fps

### Phase 4: Mock Translation Loop
- Connect "stop signing" trigger to translation
- Full loop: Sign → Red lines → Stop → Think → Play flipbook

### Phase 5: Backend & API Integration ✅ PARTIAL
- Supabase Client configured with real credentials
- Gemini 3 Pro Preview API integration
- avatar_library table with flipbook metadata
- Real frame data in Supabase Storage (20 sample glosses)

## Database Schema

```typescript
interface User {
  id: string; // UUID, references auth.users
  email: string;
  full_name: string;
  role: 'deaf' | 'hard_of_hearing' | 'hearing' | 'blind';
  preferences: {
    visual_mode: 'text_plus_avatar' | 'text_only';
    voice_id: string;
    high_contrast: boolean;
  };
  last_active: string;
}

interface AvatarLibraryEntry {
  id: string;           // UUID
  gloss_label: string;  // Unique key, e.g., "COFFEE"
  frame_count: number;  // Number of WebP frames
  fps: number;          // Playback rate (default 24)
  storage_path: string; // Supabase Storage path, e.g., "avatars/COFFEE"
  video_url: string | null; // Legacy field
  category: string;
  difficulty_level: number;
  metadata: {
    duration_ms: number;
    signer_id: string;
    dialect: string;
    source: string;     // e.g., "How2Sign Dataset"
  };
}

interface FlipbookEntry {
  gloss: string;
  frameCount: number;
  fps: number;
  storagePath: string;
  frameUrls: string[];  // Generated URLs for each frame
  durationMs: number;   // Calculated from frameCount/fps
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

### Flipbook Avatar Playback (Module C)
- Query avatar_library for frame_count, fps, storage_path
- Generate frame URLs: `{storage_path}/0001.webp`, `{storage_path}/0002.webp`, etc.
- Preload frames as HTMLImageElement objects into memory cache
- Use requestAnimationFrame with timestamp delta for 24fps timing
- Draw frames to canvas element
- Preload next gloss while playing current (lookahead)
- Fallback: Error state with gloss label for missing entries

### Data Pipeline (Python Scripts)
- `extract_frames.py`: FFmpeg extraction from How2Sign videos at 24fps
- `upload_to_supabase.py`: Upload WebP frames to Supabase Storage
- `generate_sample_frames.py`: Create placeholder frames for testing
- Frame naming: `0001.webp`, `0002.webp`, etc. (4-digit zero-padded)

## Testing Requirements

- **Unit Tests (vitest)**: utils.ts formatters, useAppStore state changes
- **Component Tests (react-testing-library)**:
  - FlipbookPlayer: frame playback at correct timing
  - ModeToggle: click fires state change
- **Integration Tests**: Supabase Storage frame loading, API calls
- **Browser Console Tests**:
  - `playFlipbookSequence(['HELLO', 'COFFEE'])` - test frame playback
  - `stopFlipbook()` - stop current animation

## Important Patterns

- Use Framer Motion `AnimatePresence` for view transitions
- All interactive elements must be accessible
- Mobile-first responsive design
- High contrast mode as default accessibility feature
