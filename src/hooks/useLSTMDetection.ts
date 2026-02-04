'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandLandmarkResult } from '@/lib/mediapipe/types';
import {
  TemporalBuffer,
  loadModel,
  predictSign,
  isConfidentPrediction,
  getLSTMServiceState,
  disposeModel,
  isModelReady,
  type LSTMPrediction,
  type TemporalDetectorState,
} from '@/lib/lstm';
import { LSTM_MIN_MOTION_FRAMES } from '@/config/constants';

/**
 * Return type for the useLSTMDetection hook
 */
export interface UseLSTMDetectionReturn {
  // State
  isEnabled: boolean;
  isModelLoaded: boolean;
  isModelLoading: boolean;
  isProcessing: boolean;
  lastPrediction: LSTMPrediction | null;
  predictionHistory: LSTMPrediction[];
  error: string | null;

  // Actions
  processLandmarks: (handResult: HandLandmarkResult | null) => Promise<void>;
  enable: () => Promise<void>;
  disable: () => void;
  reset: () => void;
  getState: () => TemporalDetectorState;

  // Dynamic mode awareness (for translation flow integration)
  getMotionFrameCount: () => number;
  hasPendingDynamicSign: () => boolean;
}

/**
 * Configuration options for the hook
 */
interface UseLSTMDetectionOptions {
  autoLoad?: boolean;           // Auto-load model on mount
  maxHistorySize?: number;      // Max predictions to keep in history
  onPrediction?: (prediction: LSTMPrediction) => void;  // Callback on confident prediction
}

/**
 * React hook for LSTM-based dynamic gesture recognition
 * Manages temporal buffer, model loading, and inference coordination
 */
export function useLSTMDetection(
  options: UseLSTMDetectionOptions = {}
): UseLSTMDetectionReturn {
  const {
    autoLoad = false,
    maxHistorySize = 10,
    onPrediction,
  } = options;

  // State
  const [isEnabled, setIsEnabled] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastPrediction, setLastPrediction] = useState<LSTMPrediction | null>(null);
  const [predictionHistory, setPredictionHistory] = useState<LSTMPrediction[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Refs for non-reactive values
  const bufferRef = useRef<TemporalBuffer>(new TemporalBuffer());
  const processingRef = useRef(false);
  const enabledRef = useRef(false);
  const onPredictionRef = useRef(onPrediction);

  // Keep callback ref up to date
  useEffect(() => {
    onPredictionRef.current = onPrediction;
  }, [onPrediction]);

  // Sync enabled state with ref
  useEffect(() => {
    enabledRef.current = isEnabled;
  }, [isEnabled]);

  /**
   * Load the LSTM model
   */
  const loadModelInternal = useCallback(async (): Promise<boolean> => {
    if (isModelLoaded || isModelLoading) {
      return isModelLoaded;
    }

    setIsModelLoading(true);
    setError(null);

    try {
      const success = await loadModel();
      setIsModelLoaded(success);

      if (!success) {
        const state = getLSTMServiceState();
        setError(state.error || 'Failed to load model');
      }

      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      return false;
    } finally {
      setIsModelLoading(false);
    }
  }, [isModelLoaded, isModelLoading]);

  /**
   * Enable LSTM detection (loads model if needed)
   */
  const enable = useCallback(async (): Promise<void> => {
    console.log('[useLSTMDetection] Enabling...');

    // Load model if not already loaded
    if (!isModelLoaded && !isModelLoading) {
      const success = await loadModelInternal();
      if (!success) {
        console.error('[useLSTMDetection] Failed to load model');
        return;
      }
    }

    setIsEnabled(true);
    console.log('[useLSTMDetection] Enabled');
  }, [isModelLoaded, isModelLoading, loadModelInternal]);

  /**
   * Disable LSTM detection
   */
  const disable = useCallback((): void => {
    console.log('[useLSTMDetection] Disabling...');
    setIsEnabled(false);
    bufferRef.current.clear();
    console.log('[useLSTMDetection] Disabled');
  }, []);

  /**
   * Process incoming hand landmarks
   */
  const processLandmarks = useCallback(
    async (handResult: HandLandmarkResult | null): Promise<void> => {
      // Skip if not enabled or already processing
      if (!enabledRef.current || processingRef.current || !isModelReady()) {
        return;
      }

      // Add frame to buffer
      const bufferResult = bufferRef.current.addFrame(handResult);

      // Check if we should run inference
      if (!bufferResult.shouldInfer) {
        return;
      }

      // Get normalized window for inference
      const normalizedWindow = bufferRef.current.getWindowForInference();
      const timestamps = bufferRef.current.getWindowTimestamps();

      if (!normalizedWindow || !timestamps) {
        return;
      }

      // Run inference
      processingRef.current = true;
      setIsProcessing(true);

      try {
        const prediction = await predictSign(normalizedWindow, timestamps);

        if (prediction && isConfidentPrediction(prediction)) {
          console.log(
            `[useLSTMDetection] Confident prediction: ${prediction.class} (${(prediction.confidence * 100).toFixed(1)}%)`
          );

          setLastPrediction(prediction);

          // Add to history
          setPredictionHistory((prev) => {
            const updated = [...prev, prediction];
            // Keep only recent predictions
            return updated.slice(-maxHistorySize);
          });

          // Fire callback
          if (onPredictionRef.current) {
            onPredictionRef.current(prediction);
          }
        }
      } catch (err) {
        console.error('[useLSTMDetection] Inference error:', err);
      } finally {
        processingRef.current = false;
        setIsProcessing(false);
      }
    },
    [maxHistorySize]
  );

  /**
   * Reset the detector state
   */
  const reset = useCallback((): void => {
    console.log('[useLSTMDetection] Resetting...');
    bufferRef.current.clear();
    setLastPrediction(null);
    setPredictionHistory([]);
    setError(null);
    processingRef.current = false;
    setIsProcessing(false);
  }, []);

  /**
   * Get current full state
   */
  const getState = useCallback((): TemporalDetectorState => {
    const bufferState = bufferRef.current.getState();
    return {
      isModelLoaded,
      isModelLoading,
      isProcessing,
      lastPrediction,
      predictionHistory,
      currentMode: 'DYNAMIC',
      frameCount: bufferState.frames.length,
      motionFrameCount: bufferState.motionFramesInWindow,
      error,
    };
  }, [isModelLoaded, isModelLoading, isProcessing, lastPrediction, predictionHistory, error]);

  /**
   * Get current motion frame count from buffer
   * Used by translation flow to determine dynamic mode
   */
  const getMotionFrameCount = useCallback((): number => {
    return bufferRef.current.getState().motionFramesInWindow;
  }, []);

  /**
   * Check if there's a pending dynamic sign being performed
   * Returns true if LSTM buffer has accumulated enough motion frames
   * indicating a dynamic sign is likely in progress
   */
  const hasPendingDynamicSign = useCallback((): boolean => {
    if (!enabledRef.current) return false;
    const state = bufferRef.current.getState();
    return state.motionFramesInWindow >= LSTM_MIN_MOTION_FRAMES;
  }, []);

  // Auto-load model on mount if configured
  useEffect(() => {
    if (autoLoad) {
      loadModelInternal();
    }

    // Cleanup on unmount
    return () => {
      bufferRef.current.clear();
    };
  }, [autoLoad, loadModelInternal]);

  // Expose to window for debugging
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const windowWithDebug = window as unknown as {
        setLSTMEnabled: (enabled: boolean) => void;
        getLSTMPredictionHistory: () => LSTMPrediction[];
      };

      windowWithDebug.setLSTMEnabled = (enabled: boolean) => {
        if (enabled) {
          enable();
        } else {
          disable();
        }
      };

      windowWithDebug.getLSTMPredictionHistory = () => predictionHistory;
    }
  }, [enable, disable, predictionHistory]);

  return {
    // State
    isEnabled,
    isModelLoaded,
    isModelLoading,
    isProcessing,
    lastPrediction,
    predictionHistory,
    error,

    // Actions
    processLandmarks,
    enable,
    disable,
    reset,
    getState,

    // Dynamic mode awareness
    getMotionFrameCount,
    hasPendingDynamicSign,
  };
}
