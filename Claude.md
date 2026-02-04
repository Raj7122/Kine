# Kine - Project Context for Claude Code

## Project Overview

Kine is a real-time accessibility PWA/Mobile Web App that acts as a **bi-directional bridge** for sign language translation. It enables communication between deaf/hard-of-hearing users and hearing users through two primary modes:

- **SIGNING_MODE**: User signs via camera → Gemini 3.0 Multimodal interprets → Audio output
- **LISTENING_MODE**: Hearing user speaks → Gemini 3.0 translates → AWS GenASL avatar signs back

## Architecture: The Gemini Sandwich 🥪

Gemini 3.0 powers **both sides** of the bidirectional bridge:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SIGNING_MODE (Input)                          │
│  Camera → MediaPipe → Gemini 3.0 Multimodal → English → Audio   │
│                       "The Eyes" 👁️                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   LISTENING_MODE (Output)                        │
│  Mic → STT → Gemini 3.0 → ASL Gloss → GenASL → Avatar Video     │
│              "The Linguist" 🗣️                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS
- **State Management**: Zustand
- **Vision AI (Edge)**: Google MediaPipe (task-vision, CPU delegate)
- **Generative AI - "The Gemini Sandwich"**:
  - **Input**: Google Gemini 3.0 Multimodal - interprets ASL landmarks → English
  - **Output**: Google Gemini 3.0 - translates English → ASL Gloss
- **Avatar Engine**: AWS GenASL (primary) - generates video avatars from gloss
- **Avatar Fallback**: Supabase Storage (flipbook frames at 24fps)
- **Audio AI (Server)**: ElevenLabs API for text-to-speech
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
│   ├── api/test/route.ts  # Test endpoint for translation API
│   └── auth/              # Login/Signup routes
├── components/
│   ├── camera/
│   │   ├── HandTracker.tsx    # MediaPipe Canvas overlay
│   │   └── CameraFeed.tsx     # Raw video element
│   ├── avatar/
│   │   ├── AvatarPlayer.tsx   # Main wrapper (mode: genasl | flipbook | legacy)
│   │   ├── GenASLPlayer.tsx   # AWS GenASL video-based avatar player
│   │   └── FlipbookPlayer.tsx # Canvas-based 24fps flipbook (fallback)
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
│   ├── gemini/            # Gemini 3.0 - "The Gemini Sandwich"
│   │   ├── prompts.ts         # ASL gloss translation prompts
│   │   ├── translationService.ts # English → ASL Gloss (The Linguist)
│   │   ├── signRecognitionService.ts # Landmarks → English (The Eyes)
│   │   └── index.ts           # Barrel exports
│   ├── aws/               # AWS GenASL integration
│   │   ├── config.ts          # AWS environment configuration
│   │   ├── genASLService.ts   # GenASL API client
│   │   └── index.ts           # Barrel exports
│   ├── elevenlabs/        # Audio conversion services (speechService.ts)
│   ├── avatar/            # Flipbook avatar system (fallback)
│   │   ├── types.ts           # FlipbookEntry, FlipbookState interfaces
│   │   ├── flipbookService.ts # Frame loading, caching, Supabase Storage
│   │   └── index.ts           # Barrel exports
│   └── utils.ts
├── hooks/
│   ├── useCamera.ts       # Stream management
│   ├── useAudio.ts        # Mic recording & permissions
│   ├── useFlipbook.ts     # Flipbook playback timing (fallback)
│   ├── useAvatarPlayer.ts # Avatar queue management
│   └── useTranslation.ts  # Orchestrator for API calls
├── store/
│   ├── useAppStore.ts     # Global state (mode, isProcessing)
│   └── useUserStore.ts    # User preferences (persisted with Zustand)
├── config/
│   └── constants.ts       # Configuration constants
└── __tests__/             # Co-located tests per module

/scripts                   # Python data pipeline (flipbook fallback)
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

/docs
└── AWS_GENASL_SETUP.md    # AWS GenASL deployment guide
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
  - `<AvatarPlayer />` → `<GenASLPlayer />` (AWS video) or `<FlipbookPlayer />` (fallback)
  - `<Waveform />` (visual mic feedback)
- **Z-20**: Bottom bar with `<ModeToggle />` (Hand/Palm icon)

## Configuration Constants

```typescript
// config/constants.ts
USE_MOCK_DATA: false              // Now using real APIs
LANDMARK_SAMPLING_RATE: 100       // ms
SILENCE_TRIGGER_THRESHOLD: 1500   // ms of no motion to trigger translation
MAX_BUFFER_SIZE: 50               // frames

// Flipbook Avatar System (Fallback)
FRAME_DURATION_MS: 41.67          // 1000ms / 24fps
DEFAULT_FPS: 24                   // Flipbook playback rate
SUPABASE_STORAGE_BUCKET: "avatars"

// AWS GenASL Settings (Primary Avatar Engine)
GENASL_POLL_INTERVAL: 2000        // ms between status checks
GENASL_MAX_POLL_ATTEMPTS: 30      // max polling iterations
GENASL_AVATAR_STYLES: ['realistic', 'cartoon', 'minimal']
GENASL_VIDEO_QUALITIES: ['low', 'medium', 'high']
GENASL_SPEED_OPTIONS: [0.5, 0.75, 1.0, 1.25, 1.5]
```

### Environment Variables (.env.local)
```bash
# Gemini 3.0 - "The Gemini Sandwich"
GEMINI_API_KEY=your-gemini-api-key

# AWS GenASL (Primary Avatar Engine)
NEXT_PUBLIC_AWS_GENASL_API_ENDPOINT=https://xxx.execute-api.us-east-1.amazonaws.com/prod
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID=us-east-1:xxx
NEXT_PUBLIC_AWS_CLOUDFRONT_URL=https://xxx.cloudfront.net

# Supabase (Database + Flipbook Fallback)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx

# ElevenLabs (TTS for SIGNING_MODE output)
ELEVENLABS_API_KEY=your-elevenlabs-key
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

### Phase 3: Avatar Engine ✅ COMPLETE (Option B: Flipbook)
- ✅ Set up Supabase Storage bucket "avatars" for WebP frames
- ✅ Create Python scripts for frame extraction and upload
- ✅ Build FlipbookPlayer component with canvas-based rendering
- ✅ Flipbook as primary avatar output (GenASL available as future upgrade)
- Verify: `playFlipbookSequence(['HELLO', 'WORLD'])` plays 24fps animation

### Phase 4: The Gemini Sandwich Integration ✅ COMPLETE
- ✅ signRecognitionService.ts: Gemini Multimodal for SIGNING_MODE (landmarks → English)
- ✅ translationService.ts: Gemini for LISTENING_MODE (English → ASL gloss)
- ✅ useSpeechRecognition.ts: Web Speech API integration for speech input
- ✅ Connect Flipbook player to receive gloss from Gemini output
- Full loop: Sign → Gemini Eyes → English → Display
- Full loop: Speak → Gemini Linguist → Gloss → Flipbook Avatar

### Phase 5: Backend & API Integration ✅ PARTIAL
- Supabase Client configured with real credentials
- Gemini 3.0 API integration (translation service)
- AWS GenASL service files created
- avatar_library table with flipbook metadata (fallback)
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

### The Gemini Sandwich (Module B) 🥪

**SIGNING_MODE - Gemini as "The Eyes":**
```
Camera → MediaPipe Landmarks → Gemini 3.0 Multimodal → English Text → ElevenLabs → Audio
```
- Buffer landmarks for 1.5-2 seconds (sliding window)
- Trigger translation when hand motion < threshold
- Send landmarks + video frames to Gemini 3.0 Multimodal
- Prompt: "Interpret these ASL hand/face landmarks and return the English translation"
- Output: English text for display + ElevenLabs TTS

**LISTENING_MODE - Gemini as "The Linguist":**
```
Microphone → Speech-to-Text → Gemini 3.0 → ASL Gloss Array → GenASL → Avatar Video
```
- Input: Transcribed speech text
- Prompt: "Translate this English text to ASL gloss notation"
- Output: Array of gloss keys (e.g., ["HELLO", "HOW", "YOU"])
- Handoff: Pass gloss array to GenASL for video generation

### AWS GenASL Avatar Engine (Module C - Primary)
- Receive gloss array from Gemini translation
- Call GenASL API with text/gloss sequence
- Poll execution status via Step Functions ARN
- Retrieve pre-signed video URL from CloudFront
- Play video in GenASLPlayer component
- Queue management for sequential playback

### Flipbook Avatar Playback (Module C - Fallback)
- Used when AWS GenASL is not configured
- Query avatar_library for frame_count, fps, storage_path
- Generate frame URLs and preload as HTMLImageElement
- Use requestAnimationFrame for 24fps timing
- Fallback: Error state with gloss label for missing entries

### Data Pipeline (Python Scripts - Flipbook Fallback)
- `extract_frames.py`: FFmpeg extraction from How2Sign videos at 24fps
- `upload_to_supabase.py`: Upload WebP frames to Supabase Storage
- `generate_sample_frames.py`: Create placeholder frames for testing
- Frame naming: `0001.webp`, `0002.webp`, etc. (4-digit zero-padded)

## Testing Requirements

- **Unit Tests (vitest)**: utils.ts formatters, useAppStore state changes
- **Component Tests (react-testing-library)**:
  - GenASLPlayer: video playback and status handling
  - FlipbookPlayer: frame playback at correct timing (fallback)
  - ModeToggle: click fires state change
- **Integration Tests**: Gemini API calls, GenASL API calls, Supabase Storage
- **Browser Console Tests**:
  - `setAvatarMode('genasl')` - switch to GenASL mode
  - `setAvatarMode('flipbook')` - switch to flipbook fallback
  - `playGenASL('Hello world')` - test GenASL video playback
  - `stopGenASL()` - stop current video
  - `playFlipbookSequence(['HELLO', 'COFFEE'])` - test frame playback (fallback)
  - `getAvatarMode()` - check current avatar mode

## Important Patterns

- Use Framer Motion `AnimatePresence` for view transitions
- All interactive elements must be accessible
- Mobile-first responsive design
- High contrast mode as default accessibility feature
