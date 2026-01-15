'use client';

import { useCallback, useRef, useState } from 'react';
import { MotionDetector, type LandmarkResult } from '@/lib/mediapipe';
import { getMockTranslation, type MockTranslation } from '@/lib/translation';
import {
  translateToGloss,
  isGeminiConfigured,
  recognizeSign,
  createLandmarkBuffer,
  isGeminiMultimodalConfigured,
  type SignLandmarkData,
} from '@/lib/gemini';
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

  // Buffer to collect landmark frames for Gemini sign recognition
  const landmarkBufferRef = useRef<SignLandmarkData[]>([]);

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
      // Clear buffer when no hands
      if (landmarkBufferRef.current.length > 0) {
        landmarkBufferRef.current = [];
      }
      return;
    }

    // Add current frame to buffer (for Gemini sign recognition)
    const frameData: SignLandmarkData = {
      hands: result.hands,
      face: result.face || null,
      timestamp: Date.now(),
    };
    landmarkBufferRef.current.push(frameData);

    // Keep buffer at reasonable size (last 60 frames ~6 seconds at 10fps)
    if (landmarkBufferRef.current.length > 60) {
      landmarkBufferRef.current = landmarkBufferRef.current.slice(-60);
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
        console.log('[Translation] Landmark buffer size:', landmarkBufferRef.current.length);
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

  // Trigger translation - The Gemini Sandwich in action!
  const triggerTranslation = useCallback(async () => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    setState('processing');
    silenceStartRef.current = null;
    setSilenceProgress(0);

    try {
      let result: TranslationResult;
      let recognizedText: string;

      // Step 1: Sign Recognition - Gemini as "The Eyes"
      // Convert landmarks to English text
      if (!USE_MOCK_DATA && isGeminiMultimodalConfigured && landmarkBufferRef.current.length > 5) {
        console.log('[Translation] Step 1: Gemini Sign Recognition (The Eyes)');
        const buffer = createLandmarkBuffer(landmarkBufferRef.current, 30);
        const recognition = await recognizeSign(buffer);
        recognizedText = recognition.text;
        console.log('[Translation] Recognized:', recognizedText, '(source:', recognition.source, ')');
      } else if (!USE_MOCK_DATA && isGeminiConfigured) {
        // Fallback: Use a context-aware placeholder if sign recognition not available
        console.log('[Translation] Sign recognition not available, using contextual placeholder');
        recognizedText = 'Hello, how are you?';
      } else {
        // Mock mode
        const mockPhrases = ['Hello', 'Thank you', 'How are you?', 'Nice to meet you'];
        recognizedText = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
        console.log('[Translation] Mock recognition:', recognizedText);
      }

      // Clear the landmark buffer after processing
      landmarkBufferRef.current = [];

      // Step 2: Translation - Gemini as "The Linguist"
      // Convert English text to ASL Gloss
      if (!USE_MOCK_DATA && isGeminiConfigured) {
        console.log('[Translation] Step 2: Gemini Translation (The Linguist)');
        const geminiResult = await translateToGloss(recognizedText);

        result = {
          id: crypto.randomUUID(),
          input: recognizedText,
          gloss: geminiResult.gloss,
          category: 'translation',
          source: geminiResult.source,
        };
        console.log('[Translation] Gloss sequence:', result.gloss);
      } else {
        // Use mock translation
        console.log('[Translation] Using mock translation');
        const mockResult = await getMockTranslation(1000);
        result = {
          id: mockResult.id,
          input: recognizedText,
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
    landmarkBufferRef.current = []; // Clear landmark buffer
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
