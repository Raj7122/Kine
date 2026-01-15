Kine - Technical Requirements Document (TRD)
Target Builder: Claude Code (Cursor) / AI Agent
Project Type: Real-Time Accessibility PWA / Mobile Web App (Android/iOS Compatible)
Tech Stack: Next.js 14+ (App Router), TypeScript, Tailwind CSS, Supabase, Google MediaPipe (Web), Gemini 3.0 API, ElevenLabs API.
Date: January 14, 2026
Last Updated: January 14, 2026 (Flipbook Avatar System)
1. System Architecture Overview
Core Philosophy
The application acts as a bi-directional bridge. It is "State-Driven" rather than "Page-Driven," relying on two primary modes (SIGNING_MODE vs. LISTENING_MODE) within a single dynamic view to reduce latency.
Tech Stack Definitions
Frontend: Next.js (React) optimized for Mobile Viewport (PWA).
Styling: Tailwind CSS (Mobile-first, Accessibility-focused classes).
State Management: Zustand (for global mode switching and preference storage).
Vision AI (Edge): Google MediaPipe task-vision package (running in a Web Worker to prevent UI freezing).
Generative AI (Server): Google Gemini 3.0 via Supabase Edge Functions.
Audio AI (Server): ElevenLabs API via Supabase Edge Functions.
Database: Supabase (PostgreSQL).
2. UI/UX Specifications
Instructions for AI: Strictly follow these layouts and UX laws.
UX Principles (The Framework)
Don't Make Me Think (Steve Krug): The UI has only two states. No complex navigation menus.
Fitts's Law: The "Mode Switch" button must be massive and located in the bottom "Thumb Zone".
Jakob's Law:
Signing Mode = Mental Model of a "Camera App".
Listening Mode = Mental Model of "Siri/Voice Assistant".
Accessibility: All text must be text-yellow-400 on bg-black (High Contrast) by default.
View 1: SIGNING_MODE (The Input Interface)
Layout Structure:
Background Layer (Z-0): A full-screen video element (<CameraFeed />) covering 100vh/100vw.
Overlay Layer (Z-10): A <canvas> element (<HandTracker />) perfectly aligned with the video feed to draw the red skeleton overlays.
UI Layer (Z-20):
Top Bar: A transparent flex container positioned absolute top. Contains a "History" icon (left) and "Settings" icon (right).
Translation Box: A floating text container (<TranscriptionBox />) positioned in the lower-middle of the screen (above the controls). It displays the real-time inference text.
Status Indicator: A pulsing ring animation that overlays the center screen when isProcessing is true.
Bottom Control Bar: A fixed bottom container taking up the bottom 20% of the viewport. Background is semi-transparent black gradient.
Primary Action: Inside the bottom bar, a massive (h-20 w-20 or larger) circular button (<ModeToggle />) with a Microphone Icon.
Interaction: Tapping the button triggers setMode('LISTENING').
View 2: LISTENING_MODE (The Receiver Interface)
Layout Structure:
Background Layer (Z-0): Solid Black (bg-black).
Content Container (Z-10): A Flex column centered vertically.
Transcription Area: Large, High-Contrast Text (text-4xl text-yellow-400 font-bold) left-aligned at the top of the container.
Avatar Display: The <AvatarPlayer /> component centered in the middle. It renders a flipbook animation using WebP frames at 24fps. When idle, it shows a "breathing" animation. When active, it plays the Gloss sequence frame-by-frame using requestAnimationFrame for smooth playback.
Waveform: The <Waveform /> component positioned below the avatar. It animates CSS bars based on microphone input volume to provide visual feedback that the app is "hearing."
Bottom Control Bar (Z-20):
Identical positioning to View 1.
Primary Action: The button transforms to show a Hand/Palm Icon.
Interaction: Tapping the button triggers setMode('SIGNING') and re-initializes the camera.
3. File & Folder Structure
Instructions for the AI: Establish this structure immediately to ensure modularity.

/
├── app/
│   ├── layout.tsx       # Global wrappers (Toaster, Theme)
│   ├── page.tsx         # Main entry (Mode Switcher Logic)
│   ├── globals.css      # Tailwind directives + Animations
│   └── auth/            # Login/Signup routes (Phase 5)
├── components/
│   ├── camera/
│   │   ├── HandTracker.tsx    # MediaPipe Canvas overlay
│   │   └── CameraFeed.tsx     # Raw video element
│   ├── avatar/
│   │   ├── AvatarPlayer.tsx   # Main avatar wrapper (delegates to FlipbookPlayer)
│   │   └── FlipbookPlayer.tsx # Canvas-based 24fps frame animation
│   ├── ui/
│   │   ├── ModeToggle.tsx     # The "Thumb Zone" button
│   │   ├── Waveform.tsx       # CSS Animation for listening
│   │   └── TranscriptionBox.tsx # High contrast text display
│   └── modals/
│       ├── SettingsModal.tsx
│       └── HistoryModal.tsx
├── lib/
│   ├── mock-data/       # JSON mocks for development
│   │   ├── avatars.json # Mock gloss mappings
│   │   └── history.json # Mock conversation logs
│   ├── supabase/        # Client instantiation
│   ├── mediapipe/       # Worker setup for landmark detection
│   ├── gemini/          # Prompt templates & API wrappers
│   ├── elevenlabs/      # Audio conversion services
│   ├── avatar/          # Flipbook avatar system
│   │   ├── types.ts         # FlipbookEntry, FlipbookState types
│   │   ├── flipbookService.ts # Frame loading, caching, Supabase Storage
│   │   └── index.ts         # Barrel exports
│   └── utils.ts         # Formatting helpers
├── hooks/
│   ├── useCamera.ts     # Stream management
│   ├── useAudio.ts      # Mic recording & permissions
│   ├── useFlipbook.ts   # Flipbook playback timing (requestAnimationFrame)
│   └── useTranslation.ts# Orchestrator for API calls
├── scripts/             # Python data pipeline
│   ├── extract_frames.py     # FFmpeg frame extraction from How2Sign
│   ├── upload_to_supabase.py # Upload frames to Supabase Storage
│   ├── generate_sample_frames.py # Generate placeholder frames
│   └── requirements.txt      # Python dependencies
├── store/
│   ├── useAppStore.ts   # Global state (CurrentMode, IsProcessing)
│   └── useUserStore.ts  # Preferences (TextSize, AvatarMode)
└── __tests__/           # Co-located tests per module

4. Database Schema & Types (Supabase)
Note: During Phases 1-4, define these as TypeScript Interfaces only. Implement actual Tables in Phase 5.
Table: users
id: UUID (PK) - references auth.users
role: 'deaf' | 'hearing' | 'blind'
preferences: JSONB { "visual_mode": "text_plus_avatar", "voice_id": "string", "high_contrast": boolean }
Table: avatar_library (Flipbook System)
gloss_label: String (PK/Unique Index) - e.g., "COFFEE"
frame_count: Integer - Number of WebP frames for this gloss
fps: Integer (default 24) - Playback frame rate
storage_path: String - Path in Supabase Storage (e.g., "avatars/COFFEE")
video_url: String (legacy, nullable) - For backwards compatibility
category: String
metadata: JSONB (e.g., duration_ms, signer_id, dialect, source)
Table: messages
id: UUID (PK)
session_id: UUID
direction: 'sign_to_audio' | 'audio_to_sign'
original_text: String (The raw input)
translated_text: String (The final output)
gloss_sequence: String[] (Array of Gloss keys for debug/playback)
audio_url: String (Nullable)
5. Module Specifications & Logic Flow
Module A: Camera & MediaPipe (The Input Eye)
Responsibility: Capture video, extract vector data, perform NO rendering logic (pure data).
Initialization: useCamera hook requests navigator.mediaDevices.getUserMedia.
Processing:
Instantiate FilesetResolver and HandLandmarker.
CRITICAL: Also instantiate FaceLandmarker for grammatical context (eyebrows/mouth).
Optimization: Run inference every 100ms (not every frame) to save battery.
Output: Stream a JSON object: { hands: Landmark[], face: Landmark[] } to the useTranslation hook.
Test Requirement: Mock getUserMedia and ensure the hook returns error if permission denied.
Module B: The Translation Orchestrator (The Brain)
Responsibility: Managing the flow between Client -> Gemini -> ElevenLabs.
Buffering: Accumulate landmarks for 1.5 - 2 seconds (sliding window).
Trigger: When hand motion < threshold (user stops signing), fire API request.
Payload: Send JSON history of landmarks.
Gemini Logic (Mock First):
Phase 1-4: Return random mock response from lib/mock-data.
Phase 5: Send prompt: "Analyze these temporal landmarks..."
Test Requirement: Write a unit test that pushes mock landmark data and asserts the correct API payload is formed.
Module C: Flipbook Avatar Engine (The Output Eye)
Responsibility: Playing smooth 24fps flipbook animations from WebP frame sequences.
Input: Receives an array of Gloss keys: ['WHERE', 'COFFEE'].
Architecture:
```
How2Sign Videos → Python Extract (24fps) → WebP Frames → Supabase Storage
                                                              ↓
Frontend: FlipbookPlayer → Load frames → requestAnimationFrame → 41.67ms/frame
```
Logic:
1. Query avatar_library for frame_count, fps, storage_path.
2. Generate frame URLs: `{storage_path}/0001.webp`, `{storage_path}/0002.webp`, etc.
3. Preload all frames as HTMLImageElement objects into memory cache.
4. Use requestAnimationFrame with timestamp delta for precise 24fps timing.
5. Draw current frame to canvas element.
6. On sequence complete, trigger onComplete callback and play next gloss in queue.
Preloading Strategy:
- Preload current gloss + next gloss in queue (lookahead).
- Cache frames in memory Map for instant replay.
- Limit concurrent loads to prevent bandwidth saturation.
Fallback: If a Gloss key is missing in the DB, show error state with gloss label.
Test Requirement: Mock Image loading and ensure frame index increments at correct timing.
Module D: UI/UX & State (The Interaction)
Responsibility: "Don't Make Me Think" implementation.
Global Store (useAppStore):
mode: 'SIGNING' | 'LISTENING'
isProcessing: boolean
lastTranslation: string
Mode Toggle:
Clicking the Bottom Bar Button triggers setMode.
Transition: Use Framer Motion AnimatePresence to cross-fade the entire view.
Accessibility:
All text must use Tailwind classes text-yellow-400 bg-black (High Contrast) if user.preferences.high_contrast is true.
6. Development Phases for Agent
Phase 1: Skeleton & UI Layout (Local Only)
Goal: A working interactive wireframe with no real backend.
Tasks:
Setup Next.js + Tailwind.
Build ModeToggle component.
Build the "Listening" view (Black screen + Yellow text) using hardcoded strings.
Build the "Signing" view (Camera feed placeholder).
Verify: User can click the bottom button to swap views smoothly.
Phase 2: MediaPipe Integration (Local Only)
Goal: Get the camera working and tracking hands.
Tasks:
Implement useCamera to get real video stream.
Connect MediaPipe HandLandmarker.
Draw red skeleton overlays on a canvas on top of the video.
Verify: Moving hand in front of camera updates the red lines in real-time.
Phase 3: The Flipbook Avatar Engine (Local + Supabase Storage) ✅ COMPLETE
Goal: Implement 24fps flipbook animation system with frame sequences.
Tasks:
Set up Supabase Storage bucket "avatars" for WebP frames.
Create Python scripts for frame extraction (extract_frames.py) and upload (upload_to_supabase.py).
Build FlipbookPlayer component with canvas-based rendering.
Implement flipbookService for frame URL generation and caching.
Create useFlipbook hook with requestAnimationFrame timing.
Verify: Calling playFlipbookSequence(['HELLO', 'COFFEE']) plays frames smoothly at 24fps.
Phase 4: Mock Translation Loop
Goal: Simulate the full app loop.
Tasks:
Connect "Stop Signing" trigger (from Phase 2) to a "Fake Translation" function.
When user stops signing, wait 1s, then display a random mock translation from Phase 3.
Verify: User signs -> Red lines move -> User stops -> App "thinks" -> App plays a video.
Phase 5: Backend & API Injection (Final Polish)
Goal: Connect to the real world.
Tasks:
Initialize Supabase Client & Auth.
Create Edge Functions for Gemini & ElevenLabs.
Replace lib/mock-data calls with real supabase.from('avatar_library').select('*').
Add .env.local variables.
Verify: Real API calls are returning data.
7. Variables & Configuration Constants
config/constants.ts
USE_MOCK_DATA: false (Now using real Supabase data)
LANDMARK_SAMPLING_RATE: 100 (ms)
SILENCE_TRIGGER_THRESHOLD: 1500 (ms of no motion to trigger translation)
MAX_BUFFER_SIZE: 50 (frames)
FRAME_DURATION_MS: 41.67 (1000ms / 24fps)
DEFAULT_FPS: 24 (flipbook playback rate)
SUPABASE_STORAGE_BUCKET: "avatars"
8. Testing Strategy (Mandatory)
Unit Tests (vitest):
Test utils.ts formatters.
Test useAppStore state changes.
Component Tests (react-testing-library):
AvatarPlayer: Ensure video src changes when prop updates.
ModeToggle: Ensure click fires the state change function.
Integration Tests:
Phases 1-4: Verify mock data flows correctly.
Phase 5: Verify that fetchTranslation calls the correct Edge Function URL.

Mermaid Chart
graph TD
    subgraph Client_Device [User's Mobile Device]
        UI[User Interface]
        Cam[Camera Input]
        Mic[Microphone Input]
        MP[MediaPipe Hand + Face Mesh]
        AudioPlayer[Audio Player]
        FlipbookEngine[Flipbook Avatar Engine]
        FrameCache[Frame Memory Cache]
    end

    subgraph Backend_Services [Backend & API Layer]
        API[API Gateway / Edge Functions]
        Auth[Supabase Auth]
        DB[(Supabase DB - avatar_library)]
        Storage[(Supabase Storage - WebP Frames)]
    end

    subgraph AI_Services [External AI Cloud]
        Gemini[Google Gemini 3.0 API]
        Eleven[ElevenLabs API]
    end

    subgraph Data_Pipeline [Offline Data Pipeline]
        H2S[How2Sign Dataset]
        FFmpeg[FFmpeg Extract 24fps]
        Upload[Python Upload Script]
    end

    %% Data Pipeline Flow
    H2S -->|Video Clips| FFmpeg
    FFmpeg -->|WebP Frames| Upload
    Upload -->|Store| Storage

    %% Sign to Speech Flow
    Cam -->|Video Stream| MP
    MP -->|Hand + Face Landmarks| UI
    UI -->|POST: /translate-sign| API
    API -->|Prompt w/ Facial Context| Gemini
    Gemini -->|Translated Text + Emotion Tag| API
    API -->|Text + Emotion| Eleven
    Eleven -->|Audio Stream| API
    API -->|Audio + Text| UI
    UI -->|Play| AudioPlayer

    %% Speech to Sign/Text Flow (Flipbook)
    Mic -->|Audio Input| UI
    UI -->|POST: /translate-audio| API
    API -->|Audio Data| Eleven
    Eleven -->|STT Transcription| API
    API -->|Text| Gemini
    Gemini -->|ASL Gloss Array| API
    API -->|Query frame_count, storage_path| DB
    DB -->|Flipbook Metadata| API
    API -->|Gloss + Frame Info| UI
    UI -->|Fetch Frames| Storage
    Storage -->|WebP Images| FrameCache
    FrameCache -->|24fps Playback| FlipbookEngine

    %% Data Persistence
    API -.->|Log History| DB
    UI -.->|Authenticate| Auth
