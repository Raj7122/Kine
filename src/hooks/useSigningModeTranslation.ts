'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { MotionDetector, type LandmarkResult } from '@/lib/mediapipe';
import { getMockTranslation } from '@/lib/translation';
import {
  translateToGloss,
  isGeminiConfigured,
  recognizeSign,
  createLandmarkBuffer,
  isGeminiMultimodalConfigured,
  captureVideoFrame,
  type SignLandmarkData,
  type VideoFrame,
} from '@/lib/gemini';
import { synthesizeSpeech, playAudioBlob } from '@/lib/elevenlabs';
import { saveMessage, generateSessionId } from '@/lib/supabase';
import {
  SILENCE_TRIGGER_THRESHOLD,
  DYNAMIC_MODE_STILLNESS_THRESHOLD,
  DYNAMIC_MODE_BUFFER_THRESHOLD,
  USE_MOCK_DATA,
  MAX_BUFFER_SIZE,
  LSTM_CONFIDENCE_THRESHOLD,
} from '@/config/constants';
import { useLSTMDetection, type UseLSTMDetectionReturn } from './useLSTMDetection';
import type { LSTMPrediction } from '@/lib/lstm';

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
  source: 'gemini' | 'gemini-vision' | 'mock';
  lstmHint?: string | null;
}

export interface UseSigningModeTranslationReturn {
  // Translation state
  state: TranslationState;
  translation: TranslationResult | null;
  silenceProgress: number;

  // LSTM state
  lstmPrediction: LSTMPrediction | null;
  lstmEnabled: boolean;
  isLSTMLoading: boolean;

  // Actions
  processLandmarks: (result: LandmarkResult) => void;
  setVideoElement: (video: HTMLVideoElement | null) => void;
  reset: () => void;
  enableLSTM: () => Promise<void>;
  disableLSTM: () => void;

  // Helpers
  getLSTMHint: () => string | null;
  isDynamicModeActive: boolean;
}

// Session ID for message tracking
let sessionId: string | null = null;

// Video frame capture interval
const VIDEO_CAPTURE_INTERVAL = 4;

/**
 * Combined hook for SIGNING_MODE that orchestrates:
 * - LSTM dynamic gesture detection
 * - Motion detection with dynamic threshold
 * - Gemini sign recognition with LSTM hints
 * - Audio synthesis
 *
 * This hook solves the timing mismatch between motion detection
 * and LSTM inference by using dynamic stillness thresholds.
 */
export function useSigningModeTranslation(
  onTranslationComplete?: (translation: TranslationResult) => void
): UseSigningModeTranslationReturn {
  // Translation state
  const [state, setState] = useState<TranslationState>('idle');
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [silenceProgress, setSilenceProgress] = useState(0);
  const [isDynamicModeActive, setIsDynamicModeActive] = useState(false);

  // LSTM detection hook
  const lstmDetection = useLSTMDetection({
    autoLoad: false,
    onPrediction: (prediction) => {
      console.log(
        `[SigningModeTranslation] LSTM prediction: ${prediction.class} (${(prediction.confidence * 100).toFixed(1)}%)`
      );
    },
  });

  // Refs
  const motionDetectorRef = useRef<MotionDetector>(new MotionDetector());
  const silenceStartRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const landmarkBufferRef = useRef<SignLandmarkData[]>([]);
  const videoFrameBufferRef = useRef<VideoFrame[]>([]);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const frameCounterRef = useRef(0);
  const lstmDetectionRef = useRef<UseLSTMDetectionReturn>(lstmDetection);

  // Keep LSTM detection ref updated
  useEffect(() => {
    lstmDetectionRef.current = lstmDetection;
  }, [lstmDetection]);

  // Initialize session ID
  if (!sessionId) {
    sessionId = generateSessionId();
    console.log('[SigningModeTranslation] Session ID:', sessionId);
  }

  // Set video element for frame capture
  const setVideoElement = useCallback((video: HTMLVideoElement | null) => {
    videoElementRef.current = video;
    console.log('[SigningModeTranslation] Video element set:', !!video);
  }, []);

  /**
   * Get LSTM hint for Gemini sign recognition
   */
  const getLSTMHint = useCallback((): string | null => {
    const pred = lstmDetectionRef.current.lastPrediction;
    if (pred && pred.confidence >= LSTM_CONFIDENCE_THRESHOLD) {
      return `LSTM detected dynamic sign: ${pred.class} (${(pred.confidence * 100).toFixed(0)}% confidence)`;
    }
    return null;
  }, []);

  /**
   * Trigger translation with LSTM context
   */
  const triggerTranslation = useCallback(async () => {
    if (isProcessingRef.current) return;

    isProcessingRef.current = true;
    setState('processing');
    silenceStartRef.current = null;
    setSilenceProgress(0);
    setIsDynamicModeActive(false);

    try {
      let result: TranslationResult;
      let recognizedText: string;
      let recognitionSource: 'gemini' | 'gemini-vision' | 'mock' = 'mock';
      const lstmHint = getLSTMHint();

      // Step 1: Sign Recognition - Gemini as "The Eyes"
      if (!USE_MOCK_DATA && isGeminiMultimodalConfigured && landmarkBufferRef.current.length > 5) {
        console.log('[SigningModeTranslation] Step 1: Gemini Sign Recognition with LSTM context');
        if (lstmHint) {
          console.log('[SigningModeTranslation] LSTM hint:', lstmHint);
        }

        const buffer = createLandmarkBuffer(
          landmarkBufferRef.current,
          videoFrameBufferRef.current,
          40
        );

        // Pass LSTM hint to Gemini for improved accuracy
        const recognition = await recognizeSign(buffer, lstmHint);
        recognizedText = recognition.text;
        recognitionSource = recognition.source;

        console.log('[SigningModeTranslation] Recognized:', recognizedText, '(source:', recognition.source, ')');
      } else if (!USE_MOCK_DATA && isGeminiConfigured) {
        console.log('[SigningModeTranslation] Sign recognition not available, using placeholder');
        recognizedText = 'Hello, how are you?';
        recognitionSource = 'mock';
      } else {
        const mockPhrases = ['Hello', 'Thank you', 'How are you?', 'Nice to meet you'];
        recognizedText = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
        console.log('[SigningModeTranslation] Mock recognition:', recognizedText);
        recognitionSource = 'mock';
      }

      // Clear buffers after processing
      landmarkBufferRef.current = [];
      videoFrameBufferRef.current = [];
      frameCounterRef.current = 0;

      // Reset LSTM buffer for next sign
      lstmDetectionRef.current.reset();

      // Step 1.5: Audio Synthesis - ElevenLabs TTS
      if (recognizedText) {
        console.log('[SigningModeTranslation] Step 1.5: ElevenLabs Audio Synthesis');
        try {
          const audioResult = await synthesizeSpeech(recognizedText);
          if (audioResult.success && audioResult.audioBlob) {
            console.log('[SigningModeTranslation] Playing synthesized audio');
            await playAudioBlob(audioResult.audioBlob);
            console.log('[SigningModeTranslation] Audio playback complete');
          } else {
            console.log('[SigningModeTranslation] Audio synthesis failed:', audioResult.error);
          }
        } catch (audioError) {
          console.error('[SigningModeTranslation] Audio error:', audioError);
        }
      }

      // Step 2: Translation - Gemini as "The Linguist"
      if (!USE_MOCK_DATA && isGeminiConfigured) {
        console.log('[SigningModeTranslation] Step 2: Gemini Translation');
        const geminiResult = await translateToGloss(recognizedText);

        result = {
          id: crypto.randomUUID(),
          input: recognizedText,
          gloss: geminiResult.gloss,
          category: 'translation',
          source: recognitionSource,
          lstmHint,
        };
        console.log('[SigningModeTranslation] Gloss sequence:', result.gloss);
      } else {
        console.log('[SigningModeTranslation] Using mock translation');
        const mockResult = await getMockTranslation(1000);
        result = {
          id: mockResult.id,
          input: recognizedText,
          gloss: mockResult.gloss,
          category: mockResult.category,
          source: 'mock',
          lstmHint,
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
        }).catch((err) => console.warn('[SigningModeTranslation] Failed to save message:', err));
      }

      if (onTranslationComplete) {
        onTranslationComplete(result);
      }
    } catch (error) {
      console.error('[SigningModeTranslation] Error:', error);
      setState('idle');
    } finally {
      isProcessingRef.current = false;
    }
  }, [onTranslationComplete, getLSTMHint]);

  /**
   * Process incoming landmark data with LSTM-aware dynamic threshold
   */
  const processLandmarks = useCallback(
    (result: LandmarkResult) => {
      if (isProcessingRef.current) return;

      const detector = motionDetectorRef.current;
      detector.update(result.hands);

      // No hands detected
      if (!result.hands) {
        setState('idle');
        silenceStartRef.current = null;
        setSilenceProgress(0);
        setIsDynamicModeActive(false);
        if (landmarkBufferRef.current.length > 0) {
          landmarkBufferRef.current = [];
          videoFrameBufferRef.current = [];
          frameCounterRef.current = 0;
        }
        return;
      }

      // Feed LSTM detection (if enabled)
      if (lstmDetectionRef.current.isEnabled) {
        lstmDetectionRef.current.processLandmarks(result.hands);
      }

      // Add current frame to landmark buffer
      const frameData: SignLandmarkData = {
        hands: result.hands,
        face: result.face || null,
        timestamp: Date.now(),
      };
      landmarkBufferRef.current.push(frameData);

      // Capture video frame at intervals
      frameCounterRef.current++;
      if (frameCounterRef.current % VIDEO_CAPTURE_INTERVAL === 0 && videoElementRef.current) {
        const videoFrame = captureVideoFrame(videoElementRef.current);
        if (videoFrame) {
          videoFrameBufferRef.current.push(videoFrame);
          if (videoFrameBufferRef.current.length > 20) {
            videoFrameBufferRef.current = videoFrameBufferRef.current.slice(-20);
          }
        }
      }

      // Keep landmark buffer at reasonable size
      if (landmarkBufferRef.current.length > MAX_BUFFER_SIZE) {
        landmarkBufferRef.current = landmarkBufferRef.current.slice(-MAX_BUFFER_SIZE);
      }

      // Check if still (low motion)
      if (detector.isStill()) {
        // Check if LSTM has accumulated motion (dynamic sign in progress)
        const hasDynamicMotion = lstmDetectionRef.current.hasPendingDynamicSign();

        // Use extended threshold if LSTM buffer has motion frames
        const effectiveThreshold = hasDynamicMotion
          ? DYNAMIC_MODE_STILLNESS_THRESHOLD
          : SILENCE_TRIGGER_THRESHOLD;

        // Update dynamic mode state for UI feedback
        if (hasDynamicMotion && !isDynamicModeActive) {
          setIsDynamicModeActive(true);
          console.log('[SigningModeTranslation] Dynamic mode activated - using extended threshold');
        }

        if (!silenceStartRef.current) {
          silenceStartRef.current = Date.now();
          setState('pause_detected');
          console.log(
            '[SigningModeTranslation] Pause detected, threshold:',
            effectiveThreshold,
            'ms',
            hasDynamicMotion ? '(dynamic mode)' : '(standard mode)'
          );
          console.log(
            '[SigningModeTranslation] Buffers - Landmarks:',
            landmarkBufferRef.current.length,
            'Video frames:',
            videoFrameBufferRef.current.length
          );
        }

        const silenceDuration = Date.now() - silenceStartRef.current;
        const progress = Math.min(silenceDuration / effectiveThreshold, 1);
        setSilenceProgress(progress);

        // Check if silence threshold reached
        if (silenceDuration >= effectiveThreshold) {
          console.log('[SigningModeTranslation] Silence threshold reached, triggering translation');
          console.log(
            '[SigningModeTranslation] Final buffers - Landmarks:',
            landmarkBufferRef.current.length,
            'Video frames:',
            videoFrameBufferRef.current.length
          );
          triggerTranslation();
        }
      } else {
        // Motion detected - reset silence timer
        if (silenceStartRef.current) {
          console.log('[SigningModeTranslation] Motion resumed, resetting silence timer');
        }
        silenceStartRef.current = null;
        setSilenceProgress(0);
        setState('signing');
        // Keep dynamic mode active if LSTM still has motion frames
        if (!lstmDetectionRef.current.hasPendingDynamicSign()) {
          setIsDynamicModeActive(false);
        }
      }
    },
    [triggerTranslation, isDynamicModeActive]
  );

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setState('idle');
    setTranslation(null);
    setSilenceProgress(0);
    setIsDynamicModeActive(false);
    silenceStartRef.current = null;
    isProcessingRef.current = false;
    motionDetectorRef.current.reset();
    landmarkBufferRef.current = [];
    videoFrameBufferRef.current = [];
    frameCounterRef.current = 0;
    lstmDetectionRef.current.reset();
    console.log('[SigningModeTranslation] State reset');
  }, []);

  /**
   * Enable LSTM detection
   */
  const enableLSTM = useCallback(async () => {
    console.log('[SigningModeTranslation] Enabling LSTM detection...');
    await lstmDetection.enable();
  }, [lstmDetection]);

  /**
   * Disable LSTM detection
   */
  const disableLSTM = useCallback(() => {
    console.log('[SigningModeTranslation] Disabling LSTM detection...');
    lstmDetection.disable();
    setIsDynamicModeActive(false);
  }, [lstmDetection]);

  // Expose debug functions to window
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const win = window as unknown as {
        enableLSTM: () => Promise<void>;
        disableLSTM: () => void;
        getLSTMState: () => { isEnabled: boolean; hasDynamicSign: boolean; motionFrames: number };
      };

      win.enableLSTM = enableLSTM;
      win.disableLSTM = disableLSTM;
      win.getLSTMState = () => ({
        isEnabled: lstmDetection.isEnabled,
        hasDynamicSign: lstmDetection.hasPendingDynamicSign(),
        motionFrames: lstmDetection.getMotionFrameCount(),
      });
    }
  }, [enableLSTM, disableLSTM, lstmDetection]);

  return {
    // Translation state
    state,
    translation,
    silenceProgress,

    // LSTM state
    lstmPrediction: lstmDetection.lastPrediction,
    lstmEnabled: lstmDetection.isEnabled,
    isLSTMLoading: lstmDetection.isModelLoading,

    // Actions
    processLandmarks,
    setVideoElement,
    reset,
    enableLSTM,
    disableLSTM,

    // Helpers
    getLSTMHint,
    isDynamicModeActive,
  };
}
