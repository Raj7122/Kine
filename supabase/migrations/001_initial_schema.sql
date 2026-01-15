-- Avatar Library table - stores ASL sign videos
CREATE TABLE IF NOT EXISTS avatar_library (
  gloss_label TEXT PRIMARY KEY,
  video_url TEXT NOT NULL,
  category TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table - stores translation history
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('sign_to_audio', 'audio_to_sign')),
  original_text TEXT,
  translated_text TEXT,
  gloss_sequence TEXT[],
  audio_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users table - stores user preferences
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT NOT NULL CHECK (role IN ('deaf', 'hearing', 'blind')),
  preferences JSONB NOT NULL DEFAULT '{"visual_mode": "text_plus_avatar", "voice_id": "default", "high_contrast": true}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE avatar_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Public read access for avatar library
CREATE POLICY "Avatar library is publicly readable" ON avatar_library
  FOR SELECT USING (true);

-- Users can read/write their own messages
CREATE POLICY "Users can manage their own messages" ON messages
  FOR ALL USING (true);

-- Users can read/write their own profile
CREATE POLICY "Users can manage their own profile" ON users
  FOR ALL USING (auth.uid() = id);

-- Insert some sample avatar data
INSERT INTO avatar_library (gloss_label, video_url, category, metadata) VALUES
  ('HELLO', '/assets/video/hello.mp4', 'greetings', '{"duration_ms": 1200, "signer_id": "default", "dialect": "ASL"}'),
  ('THANK-YOU', '/assets/video/thank-you.mp4', 'greetings', '{"duration_ms": 1500, "signer_id": "default", "dialect": "ASL"}'),
  ('YES', '/assets/video/yes.mp4', 'common', '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('NO', '/assets/video/no.mp4', 'common', '{"duration_ms": 800, "signer_id": "default", "dialect": "ASL"}'),
  ('PLEASE', '/assets/video/please.mp4', 'common', '{"duration_ms": 1000, "signer_id": "default", "dialect": "ASL"}')
ON CONFLICT (gloss_label) DO NOTHING;
