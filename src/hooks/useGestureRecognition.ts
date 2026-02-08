'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  initializeGestureRecognizer,
  detectGestures,
  getPrimaryGesture,
  closeGestureRecognizer,
  isGestureRecognizerReady,
  type GestureResult,
  type GestureDetectionResult,
} from '@/lib/mediapipe/gestureRecognizer';

export interface UseGestureRecognitionOptions {
  onGestureDetected?: (gesture: GestureResult) => void;
  onGestureChanged?: (gesture: GestureResult | null, previous: GestureResult | null) => void;
  stabilityThreshold?: number; // How many frames a gesture must be held to trigger
}

export interface UseGestureRecognitionReturn {
  isReady: boolean;
  isLoading: boolean;
  currentGesture: GestureResult | null;
  gestureHistory: GestureResult[];
  initialize: () => Promise<void>;
  processFrame: (video: HTMLVideoElement, timestamp: number) => GestureDetectionResult;
  reset: () => void;
}

/**
 * Hook for MediaPipe gesture recognition
 * Provides real-time, offline gesture detection
 */
export function useGestureRecognition(
  options: UseGestureRecognitionOptions = {}
): UseGestureRecognitionReturn {
  const {
    onGestureDetected,
    onGestureChanged,
    stabilityThreshold = 3, // Gesture must be held for 3 frames
  } = options;

  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentGesture, setCurrentGesture] = useState<GestureResult | null>(null);
  const [gestureHistory, setGestureHistory] = useState<GestureResult[]>([]);

  // Refs for tracking gesture stability
  const lastGestureRef = useRef<string | null>(null);
  const gestureCountRef = useRef(0);
  const previousGestureRef = useRef<GestureResult | null>(null);

  // Initialize gesture recognizer
  const initialize = useCallback(async () => {
    if (isReady || isLoading) return;

    setIsLoading(true);
    try {
      await initializeGestureRecognizer();
      setIsReady(true);
      console.log('[useGestureRecognition] Ready');
    } catch (error) {
      console.error('[useGestureRecognition] Failed to initialize:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isReady, isLoading]);

  // Process a video frame
  const processFrame = useCallback(
    (video: HTMLVideoElement, timestamp: number): GestureDetectionResult => {
      if (!isGestureRecognizerReady()) {
        return { gestures: [], timestamp, rawResult: null };
      }

      const rawGesture = detectGestures(video, timestamp);
      const primaryGesture = rawGesture ? getPrimaryGesture(rawGesture) : null;

      // Check gesture stability
      if (primaryGesture) {
        const gestureName = primaryGesture.gesture;

        if (gestureName === lastGestureRef.current) {
          gestureCountRef.current++;
        } else {
          lastGestureRef.current = gestureName;
          gestureCountRef.current = 1;
        }

        // Only trigger if gesture is stable
        if (gestureCountRef.current >= stabilityThreshold) {
          // Check if gesture changed
          if (previousGestureRef.current?.gesture !== gestureName) {
            setCurrentGesture(primaryGesture);

            // Add to history (avoid duplicates)
            if (primaryGesture.gesture !== 'None') {
              setGestureHistory((prev) => {
                const lastInHistory = prev[0];
                if (lastInHistory?.gesture === primaryGesture.gesture) {
                  return prev;
                }
                return [primaryGesture, ...prev].slice(0, 10);
              });

              // Callbacks
              if (onGestureDetected) {
                onGestureDetected(primaryGesture);
              }
              if (onGestureChanged) {
                onGestureChanged(primaryGesture, previousGestureRef.current);
              }
            }

            previousGestureRef.current = primaryGesture;
          }
        }
      } else {
        // No gesture detected
        if (lastGestureRef.current !== null) {
          gestureCountRef.current = 0;
          lastGestureRef.current = null;

          // Clear current gesture after a few frames of no detection
          if (gestureCountRef.current === 0) {
            setCurrentGesture(null);
            if (onGestureChanged && previousGestureRef.current) {
              onGestureChanged(null, previousGestureRef.current);
            }
            previousGestureRef.current = null;
          }
        }
      }

      return {
        gestures: primaryGesture ? [primaryGesture] : [],
        timestamp,
        rawResult: null,
      };
    },
    [stabilityThreshold, onGestureDetected, onGestureChanged]
  );

  // Reset state
  const reset = useCallback(() => {
    setCurrentGesture(null);
    setGestureHistory([]);
    lastGestureRef.current = null;
    gestureCountRef.current = 0;
    previousGestureRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeGestureRecognizer();
    };
  }, []);

  return {
    isReady,
    isLoading,
    currentGesture,
    gestureHistory,
    initialize,
    processFrame,
    reset,
  };
}
