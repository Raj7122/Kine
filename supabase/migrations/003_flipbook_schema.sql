-- Migration: Add flipbook support to avatar_library
-- Enables frame-based animation instead of video playback

-- Add flipbook columns to avatar_library
ALTER TABLE avatar_library
  ADD COLUMN IF NOT EXISTS frame_count INTEGER,
  ADD COLUMN IF NOT EXISTS fps INTEGER DEFAULT 24,
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- Add comment for documentation
COMMENT ON COLUMN avatar_library.frame_count IS 'Number of frames in the flipbook sequence';
COMMENT ON COLUMN avatar_library.fps IS 'Frames per second for playback (default 24)';
COMMENT ON COLUMN avatar_library.storage_path IS 'Path to frames folder in Supabase Storage (e.g., avatars/HELLO)';

-- Create index for storage path lookups
CREATE INDEX IF NOT EXISTS idx_avatar_library_storage_path ON avatar_library(storage_path);

-- Update existing entries with placeholder values
-- These will be updated when frames are uploaded
UPDATE avatar_library
SET
  frame_count = COALESCE(frame_count, 0),
  fps = COALESCE(fps, 24),
  storage_path = COALESCE(storage_path, 'avatars/' || gloss_label)
WHERE frame_count IS NULL;
