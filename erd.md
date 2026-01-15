Kine - Entity Relationship Diagram (ERD)
Date: January 14, 2026
Database System: PostgreSQL (Supabase) + AWS Services
Last Updated: January 15, 2026 (Gemini Sandwich Architecture + AWS GenASL)
1. Data Model Overview
The database is designed to support high-performance read/writes for real-time translation logs while maintaining user preferences for accessibility.

**Architecture: The Gemini Sandwich 🥪**
- **Input (SIGNING_MODE)**: Gemini 3.0 Multimodal interprets ASL landmarks → English
- **Output (LISTENING_MODE)**: Gemini 3.0 translates English → ASL Gloss → AWS GenASL renders avatar videos

Key Feature: The system uses AWS GenASL for primary avatar rendering, with Supabase Storage flipbook frames as fallback.

Core Entities:
Users: Stores authentication profiles and accessibility settings.
Sessions: Groups translation interactions into conversations.
Messages: Individual turns of translation (now includes translation source: gemini/genasl).
Avatar_Library: Maps gloss labels to avatar assets (flipbook fallback).
Saved_Phrases: Quick-access text-to-speech cards.
Feedback: User ratings on translation accuracy.
GenASL_Cache: Caches GenASL video URLs for frequently used translations.
2. Mermaid ERD Visualization
erDiagram
    USERS ||--o{ SESSIONS : "initiates"
    USERS ||--o{ SAVED_PHRASES : "manages"
    USERS ||--o{ FEEDBACK : "submits"
    SESSIONS ||--o{ MESSAGES : "contains"
    MESSAGES ||--o{ FEEDBACK : "receives"
    AVATAR_LIBRARY ||--o{ MESSAGES : "referenced_by"
    GENASL_CACHE ||--o{ MESSAGES : "caches_video_for"

    USERS {
        uuid id PK "references auth.users"
        string email
        string full_name
        enum role "deaf, hard_of_hearing, hearing, blind"
        jsonb preferences "voice_id, text_size, visual_mode, avatar_mode"
        timestamp created_at
        timestamp last_active
    }

    SESSIONS {
        uuid id PK
        uuid user_id FK
        timestamp start_time
        timestamp end_time
        string title "Auto-generated summary"
    }

    MESSAGES {
        uuid id PK
        uuid session_id FK
        enum direction "sign_to_audio, audio_to_sign"
        text original_input_path "Storage path to raw audio/landmarks"
        text translated_text "Final English text or ASL Gloss"
        text[] gloss_sequence "Array of gloss keys from Gemini"
        text audio_output_url "URL to ElevenLabs generated audio"
        text video_output_url "URL to GenASL video (if applicable)"
        enum translation_source "gemini, mock"
        enum avatar_source "genasl, flipbook, legacy"
        timestamp created_at
    }

    AVATAR_LIBRARY {
        uuid id PK
        string gloss_label UK "Unique key (e.g., 'COFFEE')"
        int frame_count "Number of WebP frames (flipbook fallback)"
        int fps "Playback rate (default 24)"
        string storage_path "Supabase Storage path (e.g., 'avatars/COFFEE')"
        string video_url "Legacy field (nullable)"
        string category "e.g., 'Food', 'Directions'"
        int difficulty_level
        jsonb metadata "duration_ms, signer_id, dialect, source"
    }

    GENASL_CACHE {
        uuid id PK
        string text_hash UK "SHA256 of input text"
        text input_text "Original English text"
        text[] gloss_sequence "Gemini-generated gloss array"
        text video_url "CloudFront URL to cached video"
        int duration_ms "Video duration"
        enum quality "low, medium, high"
        timestamp created_at
        timestamp expires_at "Pre-signed URL expiration"
    }

    SAVED_PHRASES {
        uuid id PK
        uuid user_id FK
        string label "Short title"
        text content "Full text to speak"
        int display_order
        boolean is_favorite
    }

    FEEDBACK {
        uuid id PK
        uuid message_id FK
        uuid user_id FK
        int rating "1-5 stars"
        text comments
        boolean is_resolved
    }


3. Schema Details

## The Gemini Sandwich Data Flow 🥪

**SIGNING_MODE (Gemini as "The Eyes"):**
```
Camera → MediaPipe → Landmarks JSON → Gemini 3.0 Multimodal → English Text
                                                                    ↓
                                              ElevenLabs TTS → Audio Output
```

**LISTENING_MODE (Gemini as "The Linguist"):**
```
Microphone → Speech-to-Text → English → Gemini 3.0 → ASL Gloss Array
                                                          ↓
                                    AWS GenASL → Video → CloudFront → Player
```

---

Table: public.users
preferences (JSONB):
- visual_mode: 'text_only' or 'text_plus_avatar'. Allows users to save bandwidth.
- avatar_mode: 'genasl' | 'flipbook' | 'legacy'. Preferred avatar rendering engine.
- voice_id: ElevenLabs voice ID for TTS output.

Table: public.messages
- direction: Indicates flow direction (sign_to_audio uses Gemini Eyes, audio_to_sign uses Gemini Linguist).
- gloss_sequence (Text Array): Gemini-generated ASL gloss. Crucial for debugging.
- translation_source: Tracks which AI generated the translation ('gemini' or 'mock').
- avatar_source: Tracks which renderer played the avatar ('genasl', 'flipbook', 'legacy').
- video_output_url: CloudFront URL from GenASL (if LISTENING_MODE).

**Debugging Scenario:**
User complains the avatar signed "TEA" instead of "COFFEE".
1. Check `gloss_sequence`: If it says ['TEA'], Gemini made a translation error.
2. Check `avatar_source`: If 'genasl', check GenASL logs. If 'flipbook', check AVATAR_LIBRARY mapping.
3. Check `video_output_url`: Verify the correct video was served.

Table: public.genasl_cache (NEW)
Caches GenASL video URLs to reduce API calls and costs.
- text_hash (String, Unique): SHA256 hash of input text for fast lookups.
- video_url (String): CloudFront URL to the cached video.
- expires_at (Timestamp): Pre-signed URL expiration time.

**Cache Strategy:**
1. Before calling GenASL, hash the input text.
2. Check genasl_cache for existing entry with valid expiration.
3. If found, use cached video_url. If not, call GenASL and cache result.

Table: public.avatar_library (Flipbook Fallback)
This table powers the Flipbook Avatar Engine - used when GenASL is unavailable.
- gloss_label (String, Unique Index): The lookup key for flipbook frames.
- frame_count (Integer): Number of WebP frames. Example: 36 frames = 1.5 seconds at 24fps.
- storage_path (String): Path in Supabase Storage bucket "avatars".

Flipbook Storage Structure (Supabase Storage - Fallback):
```
avatars/                    # Storage bucket
├── HELLO/
│   ├── 0001.webp          # Frame 1
│   ├── 0002.webp          # Frame 2
│   └── ... (24 frames = 1 second)
├── COFFEE/
│   ├── 0001.webp
│   └── ... (30 frames)
└── manifest.json          # Optional frame counts
```

Table: public.saved_phrases
Allows Deaf users to pre-program common phrases.
content (Text): Example: "I am Deaf and use this app to communicate. Please speak clearly."

---

## AWS GenASL Integration (External)

AWS GenASL is not stored in Supabase but integrates via API:

**AWS Services Used:**
- Amazon API Gateway: Entry point for translation requests
- AWS Step Functions: Orchestrates video generation workflow
- Amazon Bedrock: (Optional) Additional LLM processing
- Amazon S3: Video storage
- Amazon CloudFront: CDN for video delivery
- Amazon DynamoDB: Gloss-to-video mappings (AWS-managed)

**Environment Variables:**
```
NEXT_PUBLIC_AWS_GENASL_API_ENDPOINT
NEXT_PUBLIC_AWS_REGION
NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID
NEXT_PUBLIC_AWS_CLOUDFRONT_URL
```

