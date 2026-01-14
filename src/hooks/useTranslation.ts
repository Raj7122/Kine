'use client';

import { useCallback, useRef, useState } from 'react';
import { MotionDetector, type LandmarkResult } from '@/lib/mediapipe';
import { getMockTranslation, type MockTranslation } from '@/lib/translation';
import { translateToGloss, isGeminiConfigured } from '@/lib/gemini';
import { saveMessage, generateSessionId } from '@/lib/supabase';
import { SILENCE_TRIGGER_THRESHOLD, USE_MOCK_DATA } from '@/config/constants';

export type TranslationState =
  | 'idle'
  | 'signing'
  | 'pause_detected'
  | 'processing'
  | 'complete';

export interface TranslationResult {
  id: string;
  input: string;
  gloss: string[];
  category: string;
  source: 'gemini' | 'mock';
}

export interface UseTranslationReturn {
  state: TranslationState;
  translation: TranslationResult | null;
  silenceProgress: number; // 0 to 1, how close to triggering
  processLandmarks: (result: LandmarkResult) => void;
  reset: () => void;
}

// Session ID for message tracking
let sessionId: string | null = null;

export function useTranslation(
  onTranslationComplete?: (translation: TranslationResult) => void
): UseTranslationReturn {
  const [state, setState] = useState<TranslationState>('idle');
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [silenceProgress, setSilenceProgress] = useState(0);

  const motionDetectorRef = useRef<MotionDetector>(new MotionDetector());
  const silenceStartRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);

  // Initialize session ID
  if (!sessionId) {
    sessionId = generateSessionId();
    console.log('[Translation] Session ID:', sessionId);
  }

  // Process incoming landmark data
  const processLandmarks = useCallback((result: LandmarkResult) => {
    if (isProcessingRef.current) return;

    const detector = motionDetectorRef.current;
    detector.update(result.hands);

    // No hands detected
    if (!result.hands) {
      setState('idle');
      silenceStartRef.current = null;
      setSilenceProgress(0);
      return;
    }

    // Check if still (low motion)
    if (detector.isStill()) {
      // Start or continue silence timer
      if (!silenceStartRef.current) {
        silenceStartRef.current = Date.now();
        setState('pause_detected');
        console.log('[Translation] Pause detected, starting silence timer');
      }

      const silenceDuration = Date.now() - silenceStartRef.current;
      const progress = Math.min(silenceDuration / SILENCE_TRIGGER_THRESHOLD, 1);
      setSilenceProgress(progress);

      // Check if silence threshold reached
      if (silenceDuration >= SILENCE_TRIGGER_THRESHOLD) {
        console.log('[Translation] Silence threshold reached, triggering translation');
        triggerTranslation();
      }
    } else {
      // Motion detected - reset silence timer
      if (silenceStartRef.current) {
        console.log('[Translation] Motion resumed, resetting silence timer');
      }
      silenceStartRef.current = null;
      setSilenceProgress(0);
      setState('signing');
    }
  }, []);

  // Trigger translation
  const triggerTranslation = useCallback(async () => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    setState('processing');
    silenceStartRef.current = null;
    setSilenceProgress(0);

    try {
      let result: TranslationResult;

      // Use real Gemini API if configured and not in mock mode
      if (!USE_MOCK_DATA && isGeminiConfigured) {
        console.log('[Translation] Using Gemini API');
        // In a real app, we'd have speech-to-text or recognized signs as input
        // For now, use a placeholder that Gemini can translate
        const inputText = 'Hello, how are you?'; // Placeholder
        const geminiResult = await translateToGloss(inputText);

        result = {
          id: crypto.randomUUID(),
          input: geminiResult.input,
          gloss: geminiResult.gloss,
          category: 'translation',
          source: geminiResult.source,
        };
      } else {
        // Use mock translation
        console.log('[Translation] Using mock translation');
        const mockResult = await getMockTranslation(1000);
        result = {
          id: mockResult.id,
          input: mockResult.input,
          gloss: mockResult.gloss,
          category: mockResult.category,
          source: 'mock',
        };
      }

      setTranslation(result);
      setState('complete');

      // Save to database (non-blocking)
      if (sessionId) {
        saveMessage({
          session_id: sessionId,
          direction: 'sign_to_audio',
          original_text: result.input,
          translated_text: result.input,
          gloss_sequence: result.gloss,
        }).catch((err) => console.warn('[Translation] Failed to save message:', err));
      }

      if (onTranslationComplete) {
        onTranslationComplete(result);
      }
    } catch (error) {
      console.error('[Translation] Error:', error);
      setState('idle');
    } finally {
      isProcessingRef.current = false;
    }
  }, [onTranslationComplete]);

  // Reset state
  const reset = useCallback(() => {
    setState('idle');
    setTranslation(null);
    setSilenceProgress(0);
    silenceStartRef.current = null;
    isProcessingRef.current = false;
    motionDetectorRef.current.reset();
    console.log('[Translation] State reset');
  }, []);

  return {
    state,
    translation,
    silenceProgress,
    processLandmarks,
    reset,
  };
}
