'use client';

import { useCallback, useRef, useState } from 'react';
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
import { SILENCE_TRIGGER_THRESHOLD, USE_MOCK_DATA, MAX_BUFFER_SIZE } from '@/config/constants';

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
}

export interface UseTranslationReturn {
  state: TranslationState;
  translation: TranslationResult | null;
  silenceProgress: number; // 0 to 1, how close to triggering
  processLandmarks: (result: LandmarkResult) => void;
  setVideoElement: (video: HTMLVideoElement | null) => void;
  reset: () => void;
}

// Session ID for message tracking
let sessionId: string | null = null;

// Video frame capture interval (capture every N landmark frames)
const VIDEO_CAPTURE_INTERVAL = 4; // Capture every 4th frame (~5 FPS at 20 FPS landmark rate)

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

  // Buffer to collect video frames for true multimodal input
  const videoFrameBufferRef = useRef<VideoFrame[]>([]);

  // Reference to video element for frame capture
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  // Frame counter for video capture interval
  const frameCounterRef = useRef(0);

  // Initialize session ID
  if (!sessionId) {
    sessionId = generateSessionId();
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
      setState('idle');
      silenceStartRef.current = null;
      setSilenceProgress(0);
      // Clear buffers when no hands
      if (landmarkBufferRef.current.length > 0) {
        landmarkBufferRef.current = [];
        videoFrameBufferRef.current = [];
        frameCounterRef.current = 0;
      }
      return;
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
        // Keep video buffer manageable (max 20 frames)
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
      // Start or continue silence timer
      if (!silenceStartRef.current) {
        silenceStartRef.current = Date.now();
        setState('pause_detected');
        console.log('[Translation] Pause detected, starting silence timer');
        console.log('[Translation] Buffers - Landmarks:', landmarkBufferRef.current.length, 'Video frames:', videoFrameBufferRef.current.length);
      }

      const silenceDuration = Date.now() - silenceStartRef.current;
      const progress = Math.min(silenceDuration / SILENCE_TRIGGER_THRESHOLD, 1);
      setSilenceProgress(progress);

      // Check if silence threshold reached
      if (silenceDuration >= SILENCE_TRIGGER_THRESHOLD) {
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
      let recognitionSource: 'gemini' | 'gemini-vision' | 'mock' = 'mock';

      // Step 1: Sign Recognition - Gemini as "The Eyes"
      // Convert landmarks + video frames to English text
      if (!USE_MOCK_DATA && isGeminiMultimodalConfigured && landmarkBufferRef.current.length > 5) {
        console.log('[Translation] Step 1: Gemini Sign Recognition (The Eyes) with video frames');

        // Create buffer with both landmarks and video frames
        const buffer = createLandmarkBuffer(
          landmarkBufferRef.current,
          videoFrameBufferRef.current,
          40 // Use more landmark frames for better accuracy
        );

        const recognition = await recognizeSign(buffer);
        recognizedText = recognition.text;
        recognitionSource = recognition.source;

        console.log('[Translation] Recognized:', recognizedText, '(source:', recognition.source, ', confidence:', recognition.confidence, ')');
      } else if (!USE_MOCK_DATA && isGeminiConfigured) {
        // Fallback: Use a context-aware placeholder if sign recognition not available
        console.log('[Translation] Sign recognition not available, using contextual placeholder');
        recognizedText = 'Hello, how are you?';
        recognitionSource = 'mock';
      } else {
        // Mock mode
        const mockPhrases = ['Hello', 'Thank you', 'How are you?', 'Nice to meet you'];
        recognizedText = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];
        console.log('[Translation] Mock recognition:', recognizedText);
        recognitionSource = 'mock';
      }

      // Clear the buffers after processing
      landmarkBufferRef.current = [];
      videoFrameBufferRef.current = [];
      frameCounterRef.current = 0;

      // Step 1.5: Audio Synthesis - ElevenLabs TTS
      // Generate and play audio for the hearing person
      if (recognizedText) {
        console.log('[Translation] Step 1.5: ElevenLabs Audio Synthesis');
        try {
          const audioResult = await synthesizeSpeech(recognizedText);
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
      if (!USE_MOCK_DATA && isGeminiConfigured) {
        console.log('[Translation] Step 2: Gemini Translation (The Linguist)');
        const geminiResult = await translateToGloss(recognizedText);

        result = {
          id: crypto.randomUUID(),
          input: recognizedText,
          gloss: geminiResult.gloss,
          category: 'translation',
          source: recognitionSource,
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
    landmarkBufferRef.current = [];
    videoFrameBufferRef.current = [];
    frameCounterRef.current = 0;
    console.log('[Translation] State reset');
  }, []);

  return {
    state,
    translation,
    silenceProgress,
    processLandmarks,
    setVideoElement,
    reset,
  };
}
