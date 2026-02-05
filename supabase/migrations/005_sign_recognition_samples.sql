CREATE TABLE IF NOT EXISTS sign_recognition_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  frames_json JSONB NOT NULL,
  video_frames_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sign_recognition_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert sign recognition samples" ON sign_recognition_samples
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can read sign recognition samples" ON sign_recognition_samples
  FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS idx_sign_recognition_samples_session_id ON sign_recognition_samples(session_id);
CREATE INDEX IF NOT EXISTS idx_sign_recognition_samples_created_at ON sign_recognition_samples(created_at DESC);

ALTER TABLE translation_feedback
  ADD COLUMN IF NOT EXISTS sample_id UUID REFERENCES sign_recognition_samples(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_translation_feedback_sample_id ON translation_feedback(sample_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('sign-recognition-samples', 'sign-recognition-samples', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can upload sign recognition samples" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'sign-recognition-samples');

CREATE POLICY "Anyone can read sign recognition samples" ON storage.objects
  FOR SELECT USING (bucket_id = 'sign-recognition-samples');
