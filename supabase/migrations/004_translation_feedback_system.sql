-- Migration: Translation Feedback System
-- Enhanced feedback tracking for ASL translation improvement

-- ============================================
-- 1. TRANSLATION FEEDBACK TABLE
-- ============================================
-- Stores individual translation ratings and corrections
CREATE TABLE IF NOT EXISTS translation_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  translation_id UUID DEFAULT gen_random_uuid(),
  
  -- What Gemini predicted
  gemini_output TEXT NOT NULL,
  
  -- User feedback
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  user_correction TEXT, -- What the user said it should be (nullable for positive ratings)
  
  -- Context for analysis
  landmark_data JSONB, -- MediaPipe landmarks at time of translation
  confidence_score DECIMAL(4,3), -- Gemini's confidence if available
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Indexes will be created below
  CONSTRAINT valid_correction CHECK (
    (rating = 'positive') OR 
    (rating = 'negative' AND user_correction IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE translation_feedback ENABLE ROW LEVEL SECURITY;

-- Public write access for anonymous feedback (no auth required)
CREATE POLICY "Anyone can submit translation feedback" ON translation_feedback
  FOR INSERT WITH CHECK (true);

-- Public read access for analytics
CREATE POLICY "Anyone can read translation feedback" ON translation_feedback
  FOR SELECT USING (true);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_translation_feedback_session ON translation_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_translation_feedback_rating ON translation_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_translation_feedback_created ON translation_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_translation_feedback_gemini_output ON translation_feedback(gemini_output);

-- ============================================
-- 2. ACCURACY METRICS TABLE
-- ============================================
-- Stores aggregated accuracy metrics over time periods
CREATE TABLE IF NOT EXISTS accuracy_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Time period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  
  -- Counts
  total_translations INTEGER NOT NULL DEFAULT 0,
  positive_ratings INTEGER NOT NULL DEFAULT 0,
  negative_ratings INTEGER NOT NULL DEFAULT 0,
  
  -- Calculated metrics
  accuracy_rate DECIMAL(5,4), -- e.g., 0.8523 = 85.23%
  
  -- Analysis data
  top_corrections JSONB, -- Array of {gemini_output, user_correction, count}
  improvement_from_previous DECIMAL(5,4), -- Change from previous period
  
  -- Metadata
  calculated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_period CHECK (period_end >= period_start),
  CONSTRAINT unique_period UNIQUE (period_start, period_end, period_type)
);

-- Enable RLS
ALTER TABLE accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Public read access for metrics
CREATE POLICY "Anyone can read accuracy metrics" ON accuracy_metrics
  FOR SELECT USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_accuracy_metrics_period ON accuracy_metrics(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_accuracy_metrics_type ON accuracy_metrics(period_type);

-- ============================================
-- 3. LEARNED CORRECTIONS TABLE
-- ============================================
-- Stores patterns that have been incorporated into prompts
CREATE TABLE IF NOT EXISTS learned_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- The pattern
  gemini_misrecognition TEXT NOT NULL,
  correct_sign TEXT NOT NULL,
  
  -- Evidence
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prompt integration status
  added_to_prompt BOOLEAN DEFAULT false,
  added_to_prompt_at TIMESTAMPTZ,
  prompt_version INTEGER,
  
  -- Effectiveness tracking
  post_prompt_occurrences INTEGER DEFAULT 0, -- Still happening after prompt update?
  
  CONSTRAINT unique_correction UNIQUE (gemini_misrecognition, correct_sign)
);

-- Enable RLS
ALTER TABLE learned_corrections ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can read learned corrections" ON learned_corrections
  FOR SELECT USING (true);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_learned_corrections_count ON learned_corrections(occurrence_count DESC);
CREATE INDEX IF NOT EXISTS idx_learned_corrections_prompt ON learned_corrections(added_to_prompt);

-- ============================================
-- 4. HELPER FUNCTIONS
-- ============================================

-- Function to calculate accuracy for a given period
CREATE OR REPLACE FUNCTION calculate_period_accuracy(
  p_start DATE,
  p_end DATE
) RETURNS TABLE (
  total INTEGER,
  positive INTEGER,
  negative INTEGER,
  accuracy DECIMAL(5,4)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::INTEGER as total,
    COUNT(*) FILTER (WHERE rating = 'positive')::INTEGER as positive,
    COUNT(*) FILTER (WHERE rating = 'negative')::INTEGER as negative,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        (COUNT(*) FILTER (WHERE rating = 'positive')::DECIMAL / COUNT(*)::DECIMAL)
      ELSE 0
    END as accuracy
  FROM translation_feedback
  WHERE created_at::DATE >= p_start AND created_at::DATE <= p_end;
END;
$$ LANGUAGE plpgsql;

-- Function to get top misrecognitions
CREATE OR REPLACE FUNCTION get_top_misrecognitions(
  p_limit INTEGER DEFAULT 10
) RETURNS TABLE (
  gemini_output TEXT,
  user_correction TEXT,
  occurrence_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    tf.gemini_output,
    tf.user_correction,
    COUNT(*) as occurrence_count
  FROM translation_feedback tf
  WHERE tf.rating = 'negative' AND tf.user_correction IS NOT NULL
  GROUP BY tf.gemini_output, tf.user_correction
  ORDER BY occurrence_count DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. TRIGGER TO UPDATE LEARNED CORRECTIONS
-- ============================================
CREATE OR REPLACE FUNCTION update_learned_corrections()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rating = 'negative' AND NEW.user_correction IS NOT NULL THEN
    INSERT INTO learned_corrections (gemini_misrecognition, correct_sign, occurrence_count, last_seen_at)
    VALUES (NEW.gemini_output, NEW.user_correction, 1, NOW())
    ON CONFLICT (gemini_misrecognition, correct_sign)
    DO UPDATE SET
      occurrence_count = learned_corrections.occurrence_count + 1,
      last_seen_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_learned_corrections
AFTER INSERT ON translation_feedback
FOR EACH ROW
EXECUTE FUNCTION update_learned_corrections();
