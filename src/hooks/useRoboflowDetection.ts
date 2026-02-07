// React hook for managing Roboflow YOLO detection state

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  initHybridDetector,
  processFrame,
  setRoboflowEnabled,
  clearHistory,
  getCurrentDetections,
  getLastFusionOutput,
  HybridDetectionResult,
  FusionOutput,
} from '@/lib/detection';
import { RoboflowDetection, isRoboflowConfigured } from '@/lib/roboflow';
import { ROBOFLOW_INFERENCE_INTERVAL } from '@/config/constants';

interface UseRoboflowDetectionOptions {
  enabled?: boolean;
  onDetection?: (result: HybridDetectionResult) => void;
}

interface UseRoboflowDetectionReturn {
  isEnabled: boolean;
  isConfigured: boolean;
  isProcessing: boolean;
  detections: RoboflowDetection[];
  fusionOutput: FusionOutput | null;
  setEnabled: (enabled: boolean) => void;
  processVideoFrame: (
    video: HTMLVideoElement,
    motionMagnitude: number,
    mediapipeActive: boolean
  ) => Promise<HybridDetectionResult | null>;
  reset: () => void;
}

export function useRoboflowDetection(
  options: UseRoboflowDetectionOptions = {}
): UseRoboflowDetectionReturn {
  const { enabled: initialEnabled = true, onDetection } = options;

  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detections, setDetections] = useState<RoboflowDetection[]>([]);
  const [fusionOutput, setFusionOutput] = useState<FusionOutput | null>(null);

  const isConfigured = isRoboflowConfigured();
  const lastProcessTime = useRef(0);
  const isInitialized = useRef(false);

  // Initialize hybrid detector on mount
  useEffect(() => {
    if (!isInitialized.current) {
      initHybridDetector(isEnabled && isConfigured);
      isInitialized.current = true;
    }
  }, [isEnabled, isConfigured]);

  // Update Roboflow enabled state
  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
    setRoboflowEnabled(enabled);
  }, []);

  // Process a video frame through hybrid detection
  const processVideoFrame = useCallback(
    async (
      video: HTMLVideoElement,
      motionMagnitude: number,
      mediapipeActive: boolean
    ): Promise<HybridDetectionResult | null> => {
      // Rate limiting
      const now = Date.now();
      if (now - lastProcessTime.current < ROBOFLOW_INFERENCE_INTERVAL) {
        return null;
      }
      lastProcessTime.current = now;

      // Skip if disabled or not configured
      if (!isEnabled || !isConfigured) {
        return null;
      }

      setIsProcessing(true);

      try {
        const result = await processFrame(video, motionMagnitude, mediapipeActive);

        // Update local state
        setDetections(result.roboflowDetections);
        setFusionOutput(result.fusionOutput);

        // Notify callback
        if (onDetection) {
          onDetection(result);
        }

        return result;
      } catch (error) {
        console.error('useRoboflowDetection error:', error);
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [isEnabled, isConfigured, onDetection]
  );

  // Reset detection state
  const reset = useCallback(() => {
    clearHistory();
    setDetections([]);
    setFusionOutput(null);
  }, []);

  // Sync state with module-level state on unmount/remount
  useEffect(() => {
    return () => {
      // On unmount, preserve detection state in module
    };
  }, []);

  // Update local state from module state periodically (for external changes)
  useEffect(() => {
    const interval = setInterval(() => {
      setDetections(getCurrentDetections());
      setFusionOutput(getLastFusionOutput());
    }, 200);

    return () => clearInterval(interval);
  }, []);

  return {
    isEnabled,
    isConfigured,
    isProcessing,
    detections,
    fusionOutput,
    setEnabled,
    processVideoFrame,
    reset,
  };
}

export default useRoboflowDetection;
