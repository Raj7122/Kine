Kine - Technical Requirements Document (TRD)
Target Builder: Claude Code (Cursor) / AI Agent
Project Type: Real-Time Accessibility PWA / Mobile Web App (Android/iOS Compatible)
Tech Stack: Next.js 14+ (App Router), TypeScript, Tailwind CSS, Supabase, Google MediaPipe (Web), Gemini 3.0 API, ElevenLabs API.
Date: January 13, 2026
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
Avatar Display: The <AvatarPlayer /> component centered in the middle. It renders a high-fidelity video loop. When idle, it loops a "Breathing/Listening" video. When active, it plays the Gloss sequence.
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
│   │   ├── AvatarPlayer.tsx   # Sequential Video Looper
│   │   └── AvatarPreloader.ts # Caching logic
│   ├── ui/
│   │   ├── ModeToggle.tsx     # The "Thumb Zone" button
│   │   ├── Waveform.tsx       # CSS Animation for listening
│   │   └── TranscriptionBox.tsx # High contrast text display
│   └── modals/
│       ├── SettingsModal.tsx
│       └── HistoryModal.tsx
├── lib/
│   ├── mock-data/       # [IMPORTANT] JSON mocks for Phases 1-4
│   │   ├── avatars.json # Mock gloss-to-video mappings
│   │   └── history.json # Mock conversation logs
│   ├── supabase/        # Client instantiation (Phase 5)
│   ├── mediapipe/       # Worker setup for landmark detection
│   ├── gemini/          # Prompt templates & API wrappers
│   ├── elevenlabs/      # Audio conversion services
│   └── utils.ts         # Formatting helpers
├── hooks/
│   ├── useCamera.ts     # Stream management
│   ├── useAudio.ts      # Mic recording & permissions
│   └── useTranslation.ts# Orchestrator for API calls
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
Table: avatar_library
gloss_label: String (PK/Unique Index) - e.g., "COFFEE"
video_url: String (Public URL to Supabase Storage)
category: String
metadata: JSONB (e.g., duration_ms, signer_id, dialect)
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
Module C: Avatar Playback Engine (The Output Eye)
Responsibility: Playing "Cinematic Avatars" gaplessly.
Input: Receives an array of Gloss keys: ['WHERE', 'COFFEE'].
Logic:
Pre-fetch video URLs for all keys from avatar_library.
Queue System: Load Video 1 into Player A (Visible). Load Video 2 into Player B (Hidden).
Transition: On Video 1 onEnded event, instantly hide Player A, show/play Player B.
Fallback: If a Gloss key is missing in the DB, generate a text-overlay frame "WORD NOT FOUND".
Test Requirement: Mock the video element and ensure the playlist index increments on ended event.
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
Phase 3: The "Gloss-to-Video" Engine (Local Only)
Goal: Perfect the video playback queue without a DB.
Tasks:
Create lib/mock-data/avatars.json with 3 local video paths (put 3 dummy .mp4s in /public).
Build AvatarPlayer to read from this JSON.
Implement the queue/sequencing logic.
Verify: Calling playSequence(['HELLO', 'WORLD']) plays the two local videos back-to-back gaplessly.
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
USE_MOCK_DATA: true (Set to false only in Phase 5)
LANDMARK_Sampling_Rate: 100 (ms)
SILENCE_TRIGGER_THRESHOLD: 1500 (ms of no motion to trigger translation)
MAX_BUFFER_SIZE: 50 (frames)
AVATAR_FALLBACK_URL: "/assets/video/fallback.mp4"
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