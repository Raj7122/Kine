'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { MotionDetector, type LandmarkResult, type GestureResult } from '@/lib/mediapipe';
import {
  translateToGloss,
  isGeminiConfigured,
} from '@/lib/gemini';
import {
  captureVideoFrame,
  type SignLandmarkData,
  type VideoFrame,
} from '@/lib/openai';
import { recognizeSignWithGemini } from '@/lib/sign-recognition/geminiClient';
import { synthesizeSpeech, playAudioBlob } from '@/lib/elevenlabs';
import { saveMessage, generateSessionId } from '@/lib/supabase';
import type { SignRecognizeResult } from '@/lib/sign-recognition/types';
import {
  SILENCE_TRIGGER_THRESHOLD,
  DYNAMIC_MODE_STILLNESS_THRESHOLD,
  DYNAMIC_MODE_BUFFER_THRESHOLD,
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
  | 'complete'
  | 'error';

export interface TranslationResult {
  id: string;
  input: string;
  recognition: SignRecognizeResult;
  gloss: string[];
  category: string;
  source: 'gesture' | 'openai' | 'openai-vision' | 'gemini' | 'gemini-vision' | 'mock';
  lstmHint?: string | null;
}

// Minimum confidence for gesture-based recognition
const GESTURE_CONFIDENCE_THRESHOLD = 0.75;

export interface UseSigningModeTranslationReturn {
  // Translation state
  state: TranslationState;
  translation: TranslationResult | null;
  translationError: string | null;
  translationRetryAfterUntil: number | null;
  silenceProgress: number;

  // Gesture state (MediaPipe - fast, offline)
  currentGesture: GestureResult | null;

  // LSTM state
  lstmPrediction: LSTMPrediction | null;
  lstmEnabled: boolean;
  isLSTMLoading: boolean;

  // Buffer stats (for debugging UI)
  landmarkBufferSize: number;
  videoFrameBufferSize: number;

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
 * - Gemini 3.0 Flash sign recognition with LSTM hints (supports sentences!)
 * - Audio synthesis via ElevenLabs
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
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationRetryAfterUntil, setTranslationRetryAfterUntil] = useState<number | null>(null);
  const [silenceProgress, setSilenceProgress] = useState(0);
  const [isDynamicModeActive, setIsDynamicModeActive] = useState(false);

  // Buffer stats for debugging UI
  const [landmarkBufferSize, setLandmarkBufferSize] = useState(0);
  const [videoFrameBufferSize, setVideoFrameBufferSize] = useState(0);

  // Gesture state (MediaPipe - fast, offline)
  const [currentGesture, setCurrentGesture] = useState<GestureResult | null>(null);
  const lastGestureRef = useRef<GestureResult | null>(null);

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
  const handsLostTimeRef = useRef<number | null>(null); // Track when hands left frame
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

  // Track video element availability for independent capture
  const [hasVideoElement, setHasVideoElement] = useState(false);

  // Set video element for frame capture
  const setVideoElement = useCallback((video: HTMLVideoElement | null) => {
    videoElementRef.current = video;
    setHasVideoElement(!!video);
    console.log('[SigningModeTranslation] Video element set:', !!video);
  }, []);

  // Independent video frame capture (100ms = 10 FPS) - ensures consistent frame capture
  // regardless of how fast/slow MediaPipe detection runs
  const isCapturingRef = useRef(false);
  useEffect(() => {
    if (!hasVideoElement || !videoElementRef.current) return;

    const captureInterval = setInterval(() => {
      // Only capture if we're actively signing (not idle or processing)
      if (isProcessingRef.current || !isCapturingRef.current) return;
      if (!videoElementRef.current) return;

      const videoFrame = captureVideoFrame(videoElementRef.current);
      if (videoFrame) {
        videoFrameBufferRef.current.push(videoFrame);
        // Keep buffer at reasonable size
        if (videoFrameBufferRef.current.length > 60) {
          videoFrameBufferRef.current = videoFrameBufferRef.current.slice(-60);
        }
        setVideoFrameBufferSize(videoFrameBufferRef.current.length);
      }
    }, 100); // 10 FPS independent capture

    return () => clearInterval(captureInterval);
  }, [hasVideoElement]);

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
    isCapturingRef.current = false; // Stop frame capture during processing
    setState('processing');
    setTranslationError(null);
    setTranslationRetryAfterUntil(null);
    silenceStartRef.current = null;
    setSilenceProgress(0);
    setIsDynamicModeActive(false);

    try {
      let result: TranslationResult;
      let recognizedText = '';
      let recognitionConfidence = 0;
      let recognitionSource: SignRecognizeResult['source'] = 'mock';
      let recognizedOriginalText = '';
      let recognizedCorrected = false;
      let recognizedSampleId: string | undefined;
      const lstmHint = getLSTMHint();

      // Step 0: Check for MediaPipe gesture (FAST - no API call!)
      const gestureResult = lastGestureRef.current;
      if (gestureResult && gestureResult.confidence >= GESTURE_CONFIDENCE_THRESHOLD && gestureResult.gesture !== 'None') {
        console.log('[SigningModeTranslation] Using MediaPipe gesture:', gestureResult.gesture, '->', gestureResult.aslMeaning);
        recognizedText = gestureResult.aslMeaning;
        recognitionSource = 'gesture';
        recognitionConfidence = gestureResult.confidence;
      }
      // Step 1: Fall back to Gemini 3.0 Flash for complex signs/sentences
      else if (landmarkBufferRef.current.length > 5) {
        console.log('[SigningModeTranslation] Step 1: Gemini Sign Recognition');
        if (lstmHint) {
          console.log('[SigningModeTranslation] LSTM hint:', lstmHint);
        }

        console.log('[SigningModeTranslation] Sending to Gemini:', {
          landmarkFrames: landmarkBufferRef.current.length,
          videoFrames: videoFrameBufferRef.current.length,
        });

        const geminiResult = await recognizeSignWithGemini(
          landmarkBufferRef.current,
          videoFrameBufferRef.current,
          { sessionId: sessionId ?? undefined, lstmHint }
        );
        recognizedText = geminiResult.text;
        recognitionSource = geminiResult.source;
        recognitionConfidence = geminiResult.confidence;
        recognizedOriginalText = geminiResult.originalText;
        recognizedCorrected = geminiResult.corrected;
        recognizedSampleId = geminiResult.sampleId;

        if (recognizedCorrected) {
          console.log('[SigningModeTranslation] Server applied correction:', geminiResult.originalText, '->', geminiResult.text);
        }

        if (!geminiResult.text) {
          console.log('[SigningModeTranslation] Unclear gesture - skipping audio');
          recognizedText = '';
        } else {
          console.log('[SigningModeTranslation] Recognized:', recognizedText, '(source:', geminiResult.source, ')');
        }
      } else {
        // Not enough frames captured
        console.log('[SigningModeTranslation] Not enough frames for recognition');
        recognizedText = '';
        recognitionSource = 'gesture';
        recognitionConfidence = 0;
      }

      const recognizedTextForResult = recognizedText && recognizedText.trim().length > 0
        ? recognizedText
        : 'No sign detected';

      const recognition: SignRecognizeResult = {
        text: recognizedTextForResult,
        originalText: recognizedOriginalText || recognizedTextForResult,
        corrected: recognizedCorrected,
        confidence: recognizedTextForResult === 'No sign detected' ? 0 : recognitionConfidence,
        source: recognitionSource,
        sampleId: recognizedSampleId,
      };

      // Clear buffers after processing
      landmarkBufferRef.current = [];
      videoFrameBufferRef.current = [];
      frameCounterRef.current = 0;

      // Reset LSTM buffer for next sign
      lstmDetectionRef.current.reset();

      // Step 1.5: Audio Synthesis - ElevenLabs TTS
      // Skip audio for empty or unclear responses
      const isValidRecognition = recognizedText && recognizedText.trim().length > 0;

      if (isValidRecognition) {
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
      } else {
        console.log('[SigningModeTranslation] Skipping audio for unclear recognition:', recognizedText);
      }

      // Step 2: Translation - Gemini as "The Linguist" (convert English to ASL gloss)
      if (recognizedText && isGeminiConfigured) {
        console.log('[SigningModeTranslation] Step 2: Gemini Translation to Gloss');
        const geminiResult = await translateToGloss(recognizedText);

        result = {
          id: crypto.randomUUID(),
          input: recognition.text,
          recognition,
          gloss: geminiResult.gloss,
          category: 'translation',
          source: recognition.source,
          lstmHint,
        };
        console.log('[SigningModeTranslation] Gloss sequence:', result.gloss);
      } else {
        // No text to translate or Gemini not configured
        result = {
          id: crypto.randomUUID(),
          input: recognition.text,
          recognition,
          gloss: recognizedText ? [recognizedText.toUpperCase().replace(/ /g, '_')] : [],
          category: 'translation',
          source: recognition.source,
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
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[SigningModeTranslation] Error:', msg);
      setTranslationError(msg);
      setTranslationRetryAfterUntil(null);
      setState('error');
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

      // Track gesture from MediaPipe (fast, offline recognition)
      if (result.gesture) {
        setCurrentGesture(result.gesture);
        lastGestureRef.current = result.gesture;
      } else if (currentGesture) {
        // Clear gesture after a short delay
        setCurrentGesture(null);
      }

      // No hands detected - check if we should trigger translation
      if (!result.hands) {
        // If we have enough buffered frames, wait a moment then trigger translation
        const hasSigningData = landmarkBufferRef.current.length > 10 && videoFrameBufferRef.current.length > 3;

        if (hasSigningData && !isProcessingRef.current) {
          // Start or continue tracking hands-lost time
          if (!handsLostTimeRef.current) {
            handsLostTimeRef.current = Date.now();
            setState('pause_detected');
            console.log('[SigningModeTranslation] Hands left frame - waiting to confirm...');
          }

          // Wait 300ms to confirm hands are really gone (not just a glitch)
          const handsLostDuration = Date.now() - handsLostTimeRef.current;
          const confirmThreshold = 300; // ms

          // Update progress (quick fill to show "processing soon")
          setSilenceProgress(Math.min(handsLostDuration / confirmThreshold, 1));

          if (handsLostDuration >= confirmThreshold) {
            console.log('[SigningModeTranslation] Hands confirmed gone - triggering translation');
            console.log('[SigningModeTranslation] Buffers - Landmarks:', landmarkBufferRef.current.length, 'Video frames:', videoFrameBufferRef.current.length);
            handsLostTimeRef.current = null;
            triggerTranslation();
          }
          return;
        }

        // No significant signing data - just reset
        setState('idle');
        silenceStartRef.current = null;
        handsLostTimeRef.current = null;
        setSilenceProgress(0);
        setIsDynamicModeActive(false);
        lastGestureRef.current = null;
        setCurrentGesture(null);
        landmarkBufferRef.current = [];
        videoFrameBufferRef.current = [];
        frameCounterRef.current = 0;
        setLandmarkBufferSize(0);
        setVideoFrameBufferSize(0);
        isCapturingRef.current = false; // Stop independent frame capture
        return;
      }

      // Hands detected - reset hands-lost timer and enable frame capture
      handsLostTimeRef.current = null;
      isCapturingRef.current = true; // Start independent frame capture

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

      // Capture video frame on EVERY landmark detection (since detection is already ~4-5 FPS)
      frameCounterRef.current++;
      if (videoElementRef.current) {
        const videoFrame = captureVideoFrame(videoElementRef.current);
        if (videoFrame) {
          videoFrameBufferRef.current.push(videoFrame);
          // Keep more frames for better temporal context (up to 60 frames)
          if (videoFrameBufferRef.current.length > 60) {
            videoFrameBufferRef.current = videoFrameBufferRef.current.slice(-60);
          }
        }
      }

      // Keep landmark buffer at reasonable size
      if (landmarkBufferRef.current.length > MAX_BUFFER_SIZE) {
        landmarkBufferRef.current = landmarkBufferRef.current.slice(-MAX_BUFFER_SIZE);
      }

      // Update buffer sizes for debug UI
      setLandmarkBufferSize(landmarkBufferRef.current.length);
      setVideoFrameBufferSize(videoFrameBufferRef.current.length);

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
    [triggerTranslation, isDynamicModeActive, currentGesture]
  );

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    setState('idle');
    setTranslation(null);
    setTranslationError(null);
    setTranslationRetryAfterUntil(null);
    setSilenceProgress(0);
    setIsDynamicModeActive(false);
    setCurrentGesture(null);
    setLandmarkBufferSize(0);
    setVideoFrameBufferSize(0);
    lastGestureRef.current = null;
    silenceStartRef.current = null;
    handsLostTimeRef.current = null;
    isProcessingRef.current = false;
    isCapturingRef.current = false; // Stop independent frame capture
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
    translationError,
    translationRetryAfterUntil,
    silenceProgress,

    // Gesture state (MediaPipe - fast, offline)
    currentGesture,

    // LSTM state
    lstmPrediction: lstmDetection.lastPrediction,
    lstmEnabled: lstmDetection.isEnabled,
    isLSTMLoading: lstmDetection.isModelLoading,

    // Buffer stats (for debugging UI)
    landmarkBufferSize,
    videoFrameBufferSize,

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
