'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { TranscriptionBox } from '@/components/ui/TranscriptionBox';
import { TopBar } from '@/components/ui/TopBar';
import { CameraFeed } from '@/components/camera/CameraFeed';
import { HandTracker } from '@/components/camera/HandTracker';
import { DebugOverlay } from '@/components/ui/DebugOverlay';
import { DiagnosticPanel } from '@/components/ui/DiagnosticPanel';
import { TRANSITION_DURATION } from '@/config/constants';
import type { LandmarkResult } from '@/lib/mediapipe';
import { useSigningModeTranslation, type TranslationState } from '@/hooks/useSigningModeTranslation';

export interface ViewProps {
  onSettingsClick: () => void;
  onHistoryClick: () => void;
}

export function SigningView({ onSettingsClick, onHistoryClick }: ViewProps) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [lastCompletedTranslationId, setLastCompletedTranslationId] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(true); // Debug overlay visible by default
  const {
    setProcessing,
    setLastTranslation,
    setGlossSequence,
  } = useAppStore();

  // Translation hook - handles motion detection, LSTM, gesture recognition, and translation triggering
  const {
    state: translationState,
    translationError,
    translationRetryAfterUntil,
    silenceProgress,
    currentGesture,
    translation,
    processLandmarks,
    setVideoElement: setTranslationVideoElement,
    reset: resetTranslation,
    lstmPrediction,
    lstmEnabled,
    isDynamicModeActive,
    landmarkBufferSize,
    videoFrameBufferSize,
  } = useSigningModeTranslation((translationResult) => {
    // Called when translation completes
    console.log('[SigningView] Translation complete:', translationResult);

    // Store the translation result
    setLastCompletedTranslationId(translationResult.id);
    setLastTranslation(translationResult.recognition);
    setGlossSequence(translationResult.gloss);
  });

  // Reset after a delay so user can read the result
  // The audio has already played during processing
  useEffect(() => {
    if (translationState === 'complete') {
      const timeout = setTimeout(() => {
        resetTranslation();
        console.log('[SigningView] Ready for next sign');
      }, 2000);
      return () => clearTimeout(timeout);
    }
    // Auto-clear error state after cooldown so user can retry
    if (translationState === 'error') {
      const timeout = setTimeout(() => {
        resetTranslation();
        console.log('[SigningView] Error cleared, ready to retry');
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [translationState, resetTranslation]);

  // Sync translation state with app store processing state
  useEffect(() => {
    setProcessing(translationState === 'processing');
  }, [translationState, setProcessing]);

  // Expose translation state for TranscriptionBox via Zustand-compatible window bridge
  useEffect(() => {
    (window as unknown as { __translationState: TranslationState }).__translationState = translationState;
    (window as unknown as { __silenceProgress: number }).__silenceProgress = silenceProgress;
    (window as unknown as { __lstmPrediction: typeof lstmPrediction }).__lstmPrediction = lstmPrediction;
    (window as unknown as { __isDynamicMode: boolean }).__isDynamicMode = isDynamicModeActive;
  }, [translationState, silenceProgress, lstmPrediction, isDynamicModeActive]);

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    setVideoElement(video);
    // Also set video element for translation hook to capture frames
    setTranslationVideoElement(video);
  }, [setTranslationVideoElement]);

  const handleLandmarksDetected = useCallback((result: LandmarkResult) => {
    // Pass landmarks to motion detector via translation hook
    processLandmarks(result);
  }, [processLandmarks]);

  const handleCameraError = useCallback((error: string) => {
    console.error('Camera error:', error);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: TRANSITION_DURATION }}
      className="absolute inset-0"
    >
      {/* Z-0: Camera Feed Background */}
      <CameraFeed
        className="absolute inset-0 h-full w-full"
        onVideoReady={handleVideoReady}
        onError={handleCameraError}
      />

      {/* Z-10: Hand Tracker Canvas Overlay */}
      <HandTracker
        videoElement={videoElement}
        className="absolute inset-0 h-full w-full"
        onLandmarksDetected={handleLandmarksDetected}
        showFaceMesh={false}
      />

      {/* Debug Overlay - shows recognition state, buffer sizes, etc. */}
      <DebugOverlay
        state={translationState}
        silenceProgress={silenceProgress}
        translation={translation}
        currentGesture={currentGesture}
        lstmPrediction={lstmPrediction}
        lstmEnabled={lstmEnabled}
        isDynamicModeActive={isDynamicModeActive}
        landmarkBufferSize={landmarkBufferSize}
        videoFrameBufferSize={videoFrameBufferSize}
        isVisible={showDebug}
      />

      {/* Diagnostic Log Panel - in-app pipeline log */}
      <DiagnosticPanel isVisible={showDebug} />

      {/* Debug Toggle Button */}
      <button
        onClick={() => setShowDebug(!showDebug)}
        className="absolute top-4 right-20 z-40 rounded-full bg-black/50 px-3 py-1.5 text-xs text-white/70 hover:bg-black/70 hover:text-white transition-colors"
      >
        {showDebug ? 'Hide Debug' : 'Show Debug'}
      </button>

      {/* Z-20: UI Layer */}
      <div className="absolute inset-0 z-20 flex flex-col">
        {/* Top Bar */}
        <TopBar
          onHistoryClick={onHistoryClick}
          onSettingsClick={onSettingsClick}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Silence Progress Indicator - Shows when pause detected */}
        {translationState === 'pause_detected' && (
          <div className="mb-4 flex flex-col items-center">
            <div className="h-1 w-48 overflow-hidden rounded-full bg-gray-700">
              <motion.div
                className={`h-full ${isDynamicModeActive ? 'bg-green-400' : 'bg-yellow-400'}`}
                initial={{ width: 0 }}
                animate={{ width: `${silenceProgress * 100}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
            {isDynamicModeActive && (
              <span className="mt-1 text-xs text-green-400">Dynamic sign detected</span>
            )}
          </div>
        )}

        {/* LSTM Prediction Indicator */}
        {lstmPrediction && lstmEnabled && (
          <div className="mb-2 flex justify-center">
            <span className="rounded-full bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400">
              LSTM: {lstmPrediction.class} ({Math.round(lstmPrediction.confidence * 100)}%)
            </span>
          </div>
        )}

        {/* Transcription Box - positioned above bottom bar */}
        <div className="mb-[22vh] flex justify-center">
          <TranscriptionBox
            translationState={translationState}
            translationError={translationError}
            translationRetryAfterUntil={translationRetryAfterUntil}
            translationId={lastCompletedTranslationId}
          />
        </div>
      </div>
    </motion.div>
  );
}
