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
  type LandmarkResult,
} from '@/lib/mediapipe';
import { LANDMARK_SAMPLING_RATE } from '@/config/constants';

interface HandTrackerProps {
  videoElement: HTMLVideoElement | null;
  className?: string;
  onLandmarksDetected?: (result: LandmarkResult) => void;
  showFaceMesh?: boolean;
}

export function HandTracker({
  videoElement,
  className = '',
  onLandmarksDetected,
  showFaceMesh = false,
}: HandTrackerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastDetectionTimeRef = useRef<number>(0);

  // Initialize MediaPipe
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        await Promise.all([
          initializeHandTracker(),
          initializeFaceTracker(),
        ]);
        if (mounted) {
          setIsInitialized(true);
          setError(null);
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
    };
  }, []);

  // Resize canvas to match video
  const resizeCanvas = useCallback(() => {
    if (!canvasRef.current || !videoElement) return;

    const canvas = canvasRef.current;
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
  }, [videoElement]);

  // Detection loop
  useEffect(() => {
    if (!isInitialized || !videoElement || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    function detect() {
      if (!running || !videoElement || !ctx) return;

      const now = performance.now();

      // Only run detection at specified rate (100ms = 10 FPS)
      if (now - lastDetectionTimeRef.current >= LANDMARK_SAMPLING_RATE) {
        lastDetectionTimeRef.current = now;

        // Ensure canvas matches video dimensions
        if (
          canvas.width !== videoElement.videoWidth ||
          canvas.height !== videoElement.videoHeight
        ) {
          resizeCanvas();
        }

        // Clear previous frame
        clearCanvas(ctx);

        // Detect hands and face
        const handResult = detectHands(videoElement, now);
        const faceResult = detectFace(videoElement, now);

        // Draw landmarks
        if (handResult) {
          drawHandLandmarks(
            ctx,
            handResult,
            canvas.width,
            canvas.height,
            true // mirrored
          );
        }

        if (faceResult) {
          drawFaceLandmarks(
            ctx,
            faceResult,
            canvas.width,
            canvas.height,
            true, // mirrored
            showFaceMesh
          );
        }

        // Notify parent of detection results
        if (onLandmarksDetected) {
          onLandmarksDetected({
            hands: handResult,
            face: faceResult,
            timestamp: now,
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
    showFaceMesh,
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
