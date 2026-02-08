'use client';

import { useCallback, useRef, useState } from 'react';
import { MotionDetector, type LandmarkResult } from '@/lib/mediapipe';
import {
  createLandmarkBuffer,
  captureVideoFrame,
  type SignLandmarkData,
  type VideoFrame,
} from '@/lib/gemini';
import { synthesizeSpeech, playAudioBlob } from '@/lib/elevenlabs';
import { saveMessage } from '@/lib/supabase';
import { SILENCE_TRIGGER_THRESHOLD, MAX_BUFFER_SIZE } from '@/config/constants';
import { useAppStore } from '@/store/useAppStore';
import type { SignRecognizeResult } from '@/lib/sign-recognition/types';

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
  source: SignRecognizeResult['source'];
}

export interface UseTranslationReturn {
  state: TranslationState;
  translation: TranslationResult | null;
  translationError: string | null;
  translationRetryAfterUntil: number | null;
  silenceProgress: number; // 0 to 1, how close to triggering
  processLandmarks: (result: LandmarkResult) => void;
  setVideoElement: (video: HTMLVideoElement | null) => void;
  reset: () => void;
}

// Session ID for message tracking
let sessionId: string | null = null;

// Video frame capture interval (capture every N landmark frames)
const VIDEO_CAPTURE_INTERVAL = 3; // Capture every 3rd frame (~10 FPS at 30 FPS landmark rate)

// Cooldown after an error before allowing another translation attempt
const ERROR_COOLDOWN_MS = 5_000;

export function useTranslation(
  onTranslationComplete?: (translation: TranslationResult) => void
): UseTranslationReturn {
  const storeSessionId = useAppStore((state) => state.sessionId);
  const [state, setState] = useState<TranslationState>('idle');
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationRetryAfterUntil, setTranslationRetryAfterUntil] = useState<number | null>(null);
  const [silenceProgress, setSilenceProgress] = useState(0);

  // Cooldown ref to prevent rapid re-triggering after errors
  const lastErrorTimeRef = useRef<number>(0);

  const motionDetectorRef = useRef<MotionDetector>(new MotionDetector());
  const silenceStartRef = useRef<number | null>(null);
  const pauseSnapshotRef = useRef<{ frames: SignLandmarkData[]; videoFrames: VideoFrame[] } | null>(null);
  const isProcessingRef = useRef(false);
  const awaitingMotionResumeRef = useRef(false);

  // Buffer to collect landmark frames for Gemini sign recognition
  const landmarkBufferRef = useRef<SignLandmarkData[]>([]);

  // Buffer to collect video frames for true multimodal input
  const videoFrameBufferRef = useRef<VideoFrame[]>([]);

  // Reference to video element for frame capture
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  // Frame counter for video capture interval
  const frameCounterRef = useRef(0);

  // Initialize session ID
  if (!sessionId) {
    sessionId = storeSessionId;
    console.log('[Translation] Session ID:', sessionId);
  }

  // Set video element for frame capture
  const setVideoElement = useCallback((video: HTMLVideoElement | null) => {
    videoElementRef.current = video;
    console.log('[Translation] Video element set:', !!video);
  }, []);

  // Process incoming landmark data
  const processLandmarks = useCallback((result: LandmarkResult) => {
    if (isProcessingRef.current) return;

    const detector = motionDetectorRef.current;
    detector.update(result.hands);

    // No hands detected
    if (!result.hands) {
      if (awaitingMotionResumeRef.current) {
        awaitingMotionResumeRef.current = false;
        console.log('[Translation] Hands lost - unlocking translation trigger');
      }
      setState('idle');
      silenceStartRef.current = null;
      setSilenceProgress(0);
      // Clear buffers when no hands
      if (landmarkBufferRef.current.length > 0) {
        landmarkBufferRef.current = [];
        videoFrameBufferRef.current = [];
        frameCounterRef.current = 0;
      }
      pauseSnapshotRef.current = null;
      return;
    }

    if (awaitingMotionResumeRef.current) {
      if (detector.isMoving()) {
        awaitingMotionResumeRef.current = false;
        console.log('[Translation] Motion resumed - unlocking translation trigger');
      } else {
        silenceStartRef.current = null;
        setSilenceProgress(0);
        setState('idle');
        return;
      }
    }

    // Add current frame to landmark buffer
    const frameData: SignLandmarkData = {
      hands: result.hands,
      face: result.face || null,
      timestamp: Date.now(),
    };
    landmarkBufferRef.current.push(frameData);

    // Capture video frame at intervals for multimodal input
    frameCounterRef.current++;
    if (frameCounterRef.current % VIDEO_CAPTURE_INTERVAL === 0 && videoElementRef.current) {
      const videoFrame = captureVideoFrame(videoElementRef.current);
      if (videoFrame) {
        videoFrameBufferRef.current.push(videoFrame);
        // Keep video buffer manageable (max 30 frames)
        if (videoFrameBufferRef.current.length > 30) {
          videoFrameBufferRef.current = videoFrameBufferRef.current.slice(-30);
        }
      }
    }

    // Keep landmark buffer at reasonable size
    if (landmarkBufferRef.current.length > MAX_BUFFER_SIZE) {
      landmarkBufferRef.current = landmarkBufferRef.current.slice(-MAX_BUFFER_SIZE);
    }

    // Check if still (low motion)
    if (detector.isStill()) {
      // Start or continue silence timer
      if (!silenceStartRef.current) {
        silenceStartRef.current = Date.now();
        setState('pause_detected');
        pauseSnapshotRef.current = {
          frames: [...landmarkBufferRef.current],
          videoFrames: [...videoFrameBufferRef.current],
        };
        console.log('[Translation] Pause detected, starting silence timer');
        console.log('[Translation] Buffers - Landmarks:', landmarkBufferRef.current.length, 'Video frames:', videoFrameBufferRef.current.length);
      }

      const silenceDuration = Date.now() - silenceStartRef.current;
      const progress = Math.min(silenceDuration / SILENCE_TRIGGER_THRESHOLD, 1);
      setSilenceProgress(progress);

      // Check if silence threshold reached
      if (silenceDuration >= SILENCE_TRIGGER_THRESHOLD) {
        // Don't trigger during error cooldown
        const timeSinceLastError = Date.now() - lastErrorTimeRef.current;
        if (timeSinceLastError < ERROR_COOLDOWN_MS) {
          return;
        }
        console.log('[Translation] Silence threshold reached, triggering translation');
        console.log('[Translation] Final buffers - Landmarks:', landmarkBufferRef.current.length, 'Video frames:', videoFrameBufferRef.current.length);
        triggerTranslation();
      }
    } else {
      // Motion detected - reset silence timer
      if (silenceStartRef.current) {
        console.log('[Translation] Motion resumed, resetting silence timer');
      }
      silenceStartRef.current = null;
      pauseSnapshotRef.current = null;
      setSilenceProgress(0);
      setState('signing');
    }
  }, []);

  // Trigger translation - The Gemini Sandwich in action!
  const triggerTranslation = useCallback(async () => {
    if (isProcessingRef.current) return;

    // Enforce cooldown after errors to prevent rapid re-triggering
    const timeSinceLastError = Date.now() - lastErrorTimeRef.current;
    if (timeSinceLastError < ERROR_COOLDOWN_MS) {
      return;
    }

    isProcessingRef.current = true;
    setState('processing');
    setTranslationError(null);
    setTranslationRetryAfterUntil(null);
    silenceStartRef.current = null;
    setSilenceProgress(0);

    try {
      let result: TranslationResult;

      // Step 1: Sign Recognition - Gemini as "The Eyes"
      // Convert landmarks + video frames to English text
      if (landmarkBufferRef.current.length < 3) {
        console.warn('[Translation] Not enough landmark data to recognize sign (need 3+, have', landmarkBufferRef.current.length, ')');
        throw new Error('Not enough landmark data captured. Hold the sign a bit longer.');
      }

      console.log('[Translation] Step 1: Sign Recognition via /api/sign-recognize');

      // Create buffer with both landmarks and video frames
      const snapshot = pauseSnapshotRef.current;
      const buffer = createLandmarkBuffer(
        snapshot?.frames ?? landmarkBufferRef.current,
        snapshot?.videoFrames ?? videoFrameBufferRef.current,
        60 // Use more landmark frames for better accuracy
      );

      const response = await fetch('/api/sign-recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: buffer.frames,
          videoFrames: buffer.videoFrames,
          sessionId: sessionId ?? storeSessionId,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        // For rate limit errors, use a longer cooldown from Retry-After header
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('retry-after') || '30', 10);
          const retryUntil = Date.now() + (retryAfter * 1000);
          lastErrorTimeRef.current = retryUntil - ERROR_COOLDOWN_MS;
          setTranslationRetryAfterUntil(retryUntil);
        } else {
          setTranslationRetryAfterUntil(null);
        }
        throw new Error(data?.error || 'Sign recognition failed');
      }

      const recognition: SignRecognizeResult = {
        text: data.text,
        originalText: data.originalText,
        corrected: data.corrected,
        confidence: data.confidence,
        source: data.source,
        sampleId: data.sampleId,
      };

      console.log('[Translation] Recognized:', recognition.text, '(source:', recognition.source, ', confidence:', recognition.confidence, ', corrected:', recognition.corrected, ')');

      // Clear the buffers after processing
      landmarkBufferRef.current = [];
      videoFrameBufferRef.current = [];
      frameCounterRef.current = 0;
      pauseSnapshotRef.current = null;

      // Step 1.5: Audio Synthesis - ElevenLabs TTS
      // Generate and play audio for the hearing person
      if (recognition.text) {
        console.log('[Translation] Step 1.5: ElevenLabs Audio Synthesis');
        try {
          const audioResult = await synthesizeSpeech(recognition.text);
          if (audioResult.success && audioResult.audioBlob) {
            console.log('[Translation] Playing synthesized audio');
            await playAudioBlob(audioResult.audioBlob);
            console.log('[Translation] Audio playback complete');
          } else {
            console.log('[Translation] Audio synthesis failed:', audioResult.error);
          }
        } catch (audioError) {
          console.error('[Translation] Audio error:', audioError);
        }
      }

      // Step 2: Translation - Gemini as "The Linguist"
      // Convert English text to ASL Gloss
      console.log('[Translation] Step 2: Translation via /api/translate');

      const glossResponse = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: recognition.text }),
      });

      const glossData = await glossResponse.json().catch(() => null);
      if (!glossResponse.ok || !glossData?.success || !Array.isArray(glossData.gloss)) {
        throw new Error(glossData?.error || 'Gloss translation failed');
      }

      result = {
        id: crypto.randomUUID(),
        input: recognition.text,
        recognition,
        gloss: glossData.gloss,
        category: 'translation',
        source: recognition.source,
      };
      console.log('[Translation] Gloss sequence:', result.gloss);

      setTranslation(result);
      setState('complete');
      awaitingMotionResumeRef.current = true;
      console.log('[Translation] Waiting for motion before allowing next translation');

      // Save to database (non-blocking)
      if (sessionId) {
        saveMessage({
          session_id: sessionId,
          direction: 'sign_to_audio',
          original_text: result.recognition.originalText,
          translated_text: result.recognition.text,
          gloss_sequence: result.gloss,
        }).catch((err) => console.warn('[Translation] Failed to save message:', err));
      }

      if (onTranslationComplete) {
        onTranslationComplete(result);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Translation] Error:', msg);
      // Only set cooldown if not already set to a longer value (e.g. 429 Retry-After)
      if (lastErrorTimeRef.current <= Date.now()) {
        lastErrorTimeRef.current = Date.now();
      }
      setTranslationError(msg);
      setState('error');
    } finally {
      isProcessingRef.current = false;
    }
  }, [onTranslationComplete, storeSessionId]);

  // Reset state
  const reset = useCallback(() => {
    setState('idle');
    setTranslation(null);
    setTranslationError(null);
    setTranslationRetryAfterUntil(null);
    setSilenceProgress(0);
    silenceStartRef.current = null;
    pauseSnapshotRef.current = null;
    isProcessingRef.current = false;
    motionDetectorRef.current.reset();
    landmarkBufferRef.current = [];
    videoFrameBufferRef.current = [];
    frameCounterRef.current = 0;
    console.log('[Translation] State reset');
  }, []);

  return {
    state,
    translation,
    translationError,
    translationRetryAfterUntil,
    silenceProgress,
    processLandmarks,
    setVideoElement,
    reset,
  };
}
