Kine - Entity Relationship Diagram (ERD)
Date: January 14, 2026
Database System: PostgreSQL (Supabase)
Last Updated: January 14, 2026 (Flipbook Avatar System)
1. Data Model Overview
The database is designed to support high-performance read/writes for real-time translation logs while maintaining user preferences for accessibility.
Key Feature: The AVATAR_LIBRARY table powers the Flipbook Avatar System - storing metadata for WebP frame sequences stored in Supabase Storage.
Core Entities:
Users: Stores authentication profiles and accessibility settings.
Sessions: Groups translation interactions into conversations.
Messages: Individual turns of translation.
Avatar_Library: Maps gloss labels to flipbook frame sequences (WebP images at 24fps) stored in Supabase Storage.
Saved_Phrases: Quick-access text-to-speech cards.
Feedback: User ratings on translation accuracy.
2. Mermaid ERD Visualization
erDiagram
    USERS ||--o{ SESSIONS : "initiates"
    USERS ||--o{ SAVED_PHRASES : "manages"
    USERS ||--o{ FEEDBACK : "submits"
    SESSIONS ||--o{ MESSAGES : "contains"
    MESSAGES ||--o{ FEEDBACK : "receives"
    AVATAR_LIBRARY ||--o{ MESSAGES : "referenced_by"

    USERS {
        uuid id PK "references auth.users"
        string email
        string full_name
        enum role "deaf, hard_of_hearing, hearing, blind"
        jsonb preferences "voice_id, text_size, visual_mode"
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
        text[] gloss_sequence "Array of gloss keys used (e.g. ['COFFEE', 'WANT'])"
        text audio_output_url "URL to ElevenLabs generated audio"
        timestamp created_at
    }

    AVATAR_LIBRARY {
        uuid id PK
        string gloss_label UK "Unique key (e.g., 'COFFEE')"
        int frame_count "Number of WebP frames"
        int fps "Playback rate (default 24)"
        string storage_path "Supabase Storage path (e.g., 'avatars/COFFEE')"
        string video_url "Legacy field (nullable)"
        string category "e.g., 'Food', 'Directions'"
        int difficulty_level
        jsonb metadata "duration_ms, signer_id, dialect, source"
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
Table: public.users
preferences (JSONB):
visual_mode: 'text_only' or 'text_plus_avatar'. Allows users to save bandwidth or battery if they don't need the cinematic visuals.
Table: public.avatar_library (Flipbook System)
This table powers the Flipbook Avatar Engine - a 24fps frame-based animation system.
gloss_label (String, Unique Index): The critical lookup key. When Gemini outputs "COFFEE", the app queries this column.
frame_count (Integer): Number of WebP frames for this gloss. Example: 36 frames = 1.5 seconds at 24fps.
fps (Integer, Default 24): Playback frame rate. Used to calculate timing: frame_duration = 1000ms / fps.
storage_path (String): Path in Supabase Storage bucket "avatars". Example: "avatars/COFFEE" → frames at "avatars/COFFEE/0001.webp", "avatars/COFFEE/0002.webp", etc.
video_url (String, Nullable): Legacy field for backwards compatibility with video-based playback.
metadata (JSONB): Stores additional info like {"duration_ms": 1500, "signer_id": "how2sign", "dialect": "ASL", "source": "How2Sign Dataset"}.

Flipbook Storage Structure (Supabase Storage):
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
Table: public.messages
gloss_sequence (Text Array): Crucial for debugging.
Scenario: User complains the avatar signed "TEA" instead of "COFFEE".
Debug: You check this column.
If it says ['TEA'], Gemini made a translation error.
If it says ['COFFEE'], but the user saw tea, your frontend played the wrong video or the video is mislabeled in AVATAR_LIBRARY.
Table: public.saved_phrases
Allows Deaf users to pre-program common phrases.
content (Text): Example: "I am Deaf and use this app to communicate. Please speak clearly."

