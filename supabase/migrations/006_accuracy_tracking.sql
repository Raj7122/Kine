-- Migration: Accuracy Tracking for Confusion-Pair Prompt Augmentation
-- Adds per-sign accuracy tracking from user feedback (👍/👎)
-- to enable accuracy-gated prompt augmentation.

-- ============================================
-- 1. SIGN ACCURACY TABLE
-- ============================================
-- One row per unique sign output. Tracks how often Gemini
-- gets each sign right (positive) vs wrong (negative).
-- Accuracy = total_positive / (total_positive + total_negative)
CREATE TABLE IF NOT EXISTS sign_accuracy (
  sign_text TEXT PRIMARY KEY,
  total_positive INTEGER NOT NULL DEFAULT 0,
  total_negative INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE sign_accuracy ENABLE ROW LEVEL SECURITY;

-- Public read access for prompt augmentation queries
CREATE POLICY "Anyone can read sign accuracy" ON sign_accuracy
  FOR SELECT USING (true);

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_sign_accuracy_updated ON sign_accuracy(last_updated_at DESC);

-- ============================================
-- 2. UPDATE TRIGGER TO TRACK BOTH POSITIVE AND NEGATIVE
-- ============================================
-- Replace the existing trigger function to also:
--   - Upsert sign_accuracy on positive feedback
--   - Upsert sign_accuracy on negative feedback
CREATE OR REPLACE FUNCTION update_learned_corrections()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Track accuracy for ALL feedback (positive and negative)
  IF NEW.rating = 'positive' THEN
    INSERT INTO sign_accuracy (sign_text, total_positive, total_negative, last_updated_at)
    VALUES (NEW.gemini_output, 1, 0, NOW())
    ON CONFLICT (sign_text)
    DO UPDATE SET
      total_positive = sign_accuracy.total_positive + 1,
      last_updated_at = NOW();
  END IF;

  IF NEW.rating = 'negative' THEN
    -- Update sign_accuracy for the misrecognized sign
    INSERT INTO sign_accuracy (sign_text, total_negative, total_positive, last_updated_at)
    VALUES (NEW.gemini_output, 1, 0, NOW())
    ON CONFLICT (sign_text)
    DO UPDATE SET
      total_negative = sign_accuracy.total_negative + 1,
      last_updated_at = NOW();

    -- Existing behavior: upsert learned_corrections pair
    IF NEW.user_correction IS NOT NULL THEN
      INSERT INTO learned_corrections (gemini_misrecognition, correct_sign, occurrence_count, last_seen_at)
      VALUES (NEW.gemini_output, NEW.user_correction, 1, NOW())
      ON CONFLICT (gemini_misrecognition, correct_sign)
      DO UPDATE SET
        occurrence_count = learned_corrections.occurrence_count + 1,
        last_seen_at = NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================
-- 3. BACKFILL FROM EXISTING FEEDBACK DATA
-- ============================================
-- Seed sign_accuracy with historical translation_feedback
-- so the system has accuracy data immediately.
INSERT INTO sign_accuracy (sign_text, total_positive, total_negative, last_updated_at)
SELECT
  gemini_output,
  COUNT(*) FILTER (WHERE rating = 'positive'),
  COUNT(*) FILTER (WHERE rating = 'negative'),
  MAX(created_at)
FROM translation_feedback
WHERE gemini_output IS NOT NULL AND gemini_output != ''
GROUP BY gemini_output
ON CONFLICT (sign_text)
DO UPDATE SET
  total_positive = EXCLUDED.total_positive,
  total_negative = EXCLUDED.total_negative,
  last_updated_at = EXCLUDED.last_updated_at;
