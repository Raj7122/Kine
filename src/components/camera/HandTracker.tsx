'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  initializeHandTracker,
  initializeFaceTracker,
  detectHands,
  detectFace,
  closeHandTracker,
  closeFaceTracker,
  drawHandLandmarks,
  drawFaceLandmarks,
  clearCanvas,
  initializeGestureRecognizer,
  detectGestures,
  getPrimaryGesture,
  closeGestureRecognizer,
  type LandmarkResult,
  type GestureResult,
  type HandLandmarkResult,
  type FaceLandmarkResult,
} from '@/lib/mediapipe';
import { LANDMARK_SAMPLING_RATE } from '@/config/constants';

interface HandTrackerProps {
  videoElement: HTMLVideoElement | null;
  className?: string;
  onLandmarksDetected?: (result: LandmarkResult) => void;
  onGestureDetected?: (gesture: GestureResult | null) => void;
  showFaceMesh?: boolean;
  enableGestureRecognition?: boolean;
}

export function HandTracker({
  videoElement,
  className = '',
  onLandmarksDetected,
  onGestureDetected,
  showFaceMesh = false,
  enableGestureRecognition = true,
}: HandTrackerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);

  // Cache last detected landmarks for smooth drawing between detections
  const cachedHandResultRef = useRef<HandLandmarkResult | null>(null);
  const cachedFaceResultRef = useRef<FaceLandmarkResult | null>(null);

  // Track last gesture for stability
  const lastGestureRef = useRef<string | null>(null);
  const gestureCountRef = useRef(0);
  const GESTURE_STABILITY_THRESHOLD = 5; // Frames before confirming gesture

  // Initialize MediaPipe
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        // Initialize hand and face trackers
        await Promise.all([
          initializeHandTracker(),
          initializeFaceTracker(),
        ]);

        // Also initialize gesture recognizer if enabled
        if (enableGestureRecognition) {
          await initializeGestureRecognizer();
        }

        if (mounted) {
          setIsInitialized(true);
          setError(null);
          console.log('[HandTracker] Initialized with gesture recognition:', enableGestureRecognition);
        }
      } catch (err) {
        console.error('Failed to initialize MediaPipe:', err);
        if (mounted) {
          setError('Failed to load hand tracking. Please refresh the page.');
        }
      }
    }

    init();

    return () => {
      mounted = false;
      closeHandTracker();
      closeFaceTracker();
      if (enableGestureRecognition) {
        closeGestureRecognizer();
      }
    };
  }, [enableGestureRecognition]);

  // Resize canvas to match video
  const resizeCanvas = useCallback(() => {
    if (!canvasRef.current || !videoElement) return;

    const canvas = canvasRef.current;
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
  }, [videoElement]);

  // High-frequency drawing loop (60 FPS) - uses cached landmarks for smooth rendering
  useEffect(() => {
    if (!isInitialized || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    function draw() {
      if (!running || !ctx) return;

      // Clear and redraw with cached landmarks at 60 FPS
      clearCanvas(ctx);

      if (cachedHandResultRef.current) {
        drawHandLandmarks(
          ctx,
          cachedHandResultRef.current,
          canvas.width,
          canvas.height,
          true // mirrored
        );
      }

      if (cachedFaceResultRef.current) {
        drawFaceLandmarks(
          ctx,
          cachedFaceResultRef.current,
          canvas.width,
          canvas.height,
          true, // mirrored
          showFaceMesh
        );
      }

      drawFrameRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      running = false;
      if (drawFrameRef.current) {
        cancelAnimationFrame(drawFrameRef.current);
      }
    };
  }, [isInitialized, showFaceMesh]);

  // Detection loop (runs at LANDMARK_SAMPLING_RATE)
  useEffect(() => {
    if (!isInitialized || !videoElement || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;

    let running = true;

    function detect() {
      if (!running || !videoElement) return;

      const now = performance.now();

      // Only run detection at specified rate
      if (now - lastDetectionTimeRef.current >= LANDMARK_SAMPLING_RATE) {
        lastDetectionTimeRef.current = now;

        // Ensure canvas matches video dimensions
        if (
          canvas.width !== videoElement.videoWidth ||
          canvas.height !== videoElement.videoHeight
        ) {
          resizeCanvas();
        }

        // Detect hands and face
        const handResult = detectHands(videoElement, now);
        const faceResult = detectFace(videoElement, now);

        // Cache results for smooth drawing
        cachedHandResultRef.current = handResult;
        cachedFaceResultRef.current = faceResult;

        // Detect gestures (if enabled)
        let detectedGesture: GestureResult | null = null;
        if (enableGestureRecognition && onGestureDetected) {
          const gestureResult = detectGestures(videoElement, now);
          const primaryGesture = getPrimaryGesture(gestureResult);

          if (primaryGesture && primaryGesture.gesture !== 'None') {
            // Check for gesture stability
            if (primaryGesture.gesture === lastGestureRef.current) {
              gestureCountRef.current++;
            } else {
              lastGestureRef.current = primaryGesture.gesture;
              gestureCountRef.current = 1;
            }

            // Only report stable gestures
            if (gestureCountRef.current >= GESTURE_STABILITY_THRESHOLD) {
              detectedGesture = primaryGesture;
              onGestureDetected(primaryGesture);
            }
          } else {
            // Reset if no gesture
            if (lastGestureRef.current !== null) {
              lastGestureRef.current = null;
              gestureCountRef.current = 0;
              onGestureDetected(null);
            }
          }
        }

        // Notify parent of detection results
        if (onLandmarksDetected) {
          onLandmarksDetected({
            hands: handResult,
            face: faceResult,
            timestamp: now,
            gesture: detectedGesture,
          });
        }
      }

      animationFrameRef.current = requestAnimationFrame(detect);
    }

    // Start detection loop
    detect();

    return () => {
      running = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    isInitialized,
    videoElement,
    resizeCanvas,
    onLandmarksDetected,
    enableGestureRecognition,
    onGestureDetected,
  ]);

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <p className="text-center text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      style={{ transform: 'scaleX(-1)' }} // Mirror to match video
      aria-hidden="true"
    />
  );
}
