-- Migration: Complete ERD Schema
-- Adds missing tables and updates existing ones per ERD.md

-- ============================================
-- 1. UPDATE USERS TABLE
-- ============================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS last_active TIMESTAMPTZ;

-- Update role constraint to include 'hard_of_hearing'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('deaf', 'hard_of_hearing', 'hearing', 'blind'));

-- ============================================
-- 2. UPDATE AVATAR_LIBRARY TABLE
-- ============================================
-- Add id column and difficulty_level
ALTER TABLE avatar_library
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS difficulty_level INTEGER DEFAULT 1;

-- Create index on id for faster lookups
CREATE INDEX IF NOT EXISTS idx_avatar_library_id ON avatar_library(id);

-- ============================================
-- 3. CREATE SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own sessions
CREATE POLICY "Users can manage their own sessions" ON sessions
  FOR ALL USING (auth.uid() = user_id);

-- Create index for user lookups
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- ============================================
-- 4. UPDATE MESSAGES TABLE
-- ============================================
-- Add foreign key to sessions if not exists
-- First check if session_id needs to be UUID
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS original_input_path TEXT;

-- ============================================
-- 5. CREATE SAVED_PHRASES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS saved_phrases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE saved_phrases ENABLE ROW LEVEL SECURITY;

-- Users can manage their own saved phrases
CREATE POLICY "Users can manage their own saved phrases" ON saved_phrases
  FOR ALL USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_saved_phrases_user_id ON saved_phrases(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_phrases_display_order ON saved_phrases(user_id, display_order);

-- ============================================
-- 6. CREATE FEEDBACK TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comments TEXT,
  is_resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Users can manage their own feedback
CREATE POLICY "Users can manage their own feedback" ON feedback
  FOR ALL USING (auth.uid() = user_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_feedback_message_id ON feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

-- ============================================
-- 7. INSERT SAMPLE DATA
-- ============================================
-- Add more avatar entries with difficulty levels
INSERT INTO avatar_library (gloss_label, video_url, category, difficulty_level, metadata) VALUES
  ('WORLD', '/assets/video/world.mp4', 'common', 1, '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}'),
  ('HELP', '/assets/video/help.mp4', 'emergency', 1, '{"duration_ms": 900, "signer_id": "default", "dialect": "ASL"}'),
  ('SORRY', '/assets/video/sorry.mp4', 'common', 1, '{"duration_ms": 1100, "signer_id": "default", "dialect": "ASL"}'),
  ('LOVE', '/assets/video/love.mp4', 'emotions', 1, '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}'),
  ('FRIEND', '/assets/video/friend.mp4', 'people', 2, '{"duration_ms": 1200, "signer_id": "default", "dialect": "ASL"}'),
  ('FAMILY', '/assets/video/family.mp4', 'people', 2, '{"duration_ms": 1300, "signer_id": "default", "dialect": "ASL"}'),
  ('WORK', '/assets/video/work.mp4', 'activities', 2, '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}'),
  ('HOME', '/assets/video/home.mp4', 'places', 1, '{"duration_ms": 900, "signer_id": "default", "dialect": "ASL"}'),
  ('FOOD', '/assets/video/food.mp4', 'food', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('WATER', '/assets/video/water.mp4', 'food', 1, '{"duration_ms": 900, "signer_id": "default", "dialect": "ASL"}'),
  ('COFFEE', '/assets/video/coffee.mp4', 'food', 2, '{"duration_ms": 1100, "signer_id": "default", "dialect": "ASL"}'),
  ('WANT', '/assets/video/want.mp4', 'verbs', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('NEED', '/assets/video/need.mp4', 'verbs', 1, '{"duration_ms": 900, "signer_id": "default", "dialect": "ASL"}'),
  ('LIKE', '/assets/video/like.mp4', 'verbs', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('UNDERSTAND', '/assets/video/understand.mp4', 'verbs', 2, '{"duration_ms": 1200, "signer_id": "default", "dialect": "ASL"}'),
  ('QUESTION', '/assets/video/question.mp4', 'grammar', 2, '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}'),
  ('WHERE', '/assets/video/where.mp4', 'questions', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('WHAT', '/assets/video/what.mp4', 'questions', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('WHO', '/assets/video/who.mp4', 'questions', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('HOW', '/assets/video/how.mp4', 'questions', 1, '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}')
ON CONFLICT (gloss_label) DO UPDATE SET
  difficulty_level = EXCLUDED.difficulty_level,
  metadata = EXCLUDED.metadata;
