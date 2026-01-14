'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { ModeToggle } from '@/components/ui/ModeToggle';
import { TranscriptionBox } from '@/components/ui/TranscriptionBox';
import { TopBar } from '@/components/ui/TopBar';
import { Waveform } from '@/components/ui/Waveform';
import { CameraFeed } from '@/components/camera/CameraFeed';
import { HandTracker } from '@/components/camera/HandTracker';
import { AvatarPlayer } from '@/components/avatar/AvatarPlayer';
import { TRANSITION_DURATION } from '@/config/constants';
import type { LandmarkResult } from '@/lib/mediapipe';
import { useTranslation, type TranslationState } from '@/hooks/useTranslation';
import { Play, Square } from 'lucide-react';

export default function Home() {
  const { mode } = useAppStore();

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <AnimatePresence mode="wait">
        {mode === 'SIGNING' ? (
          <SigningView key="signing" />
        ) : (
          <ListeningView key="listening" />
        )}
      </AnimatePresence>

      {/* Bottom Control Bar - Fixed across both modes */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex h-[20vh] items-center justify-center bg-gradient-to-t from-black via-black/90 to-transparent">
        <ModeToggle />
      </div>
    </div>
  );
}

function SigningView() {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const {
    setMode,
    setProcessing,
    setLastTranslation,
    setGlossSequence,
    setShouldAutoPlay
  } = useAppStore();

  // Translation hook - handles motion detection and translation triggering
  const {
    state: translationState,
    silenceProgress,
    processLandmarks,
    reset: resetTranslation
  } = useTranslation((translation) => {
    // Called when translation completes
    console.log('[SigningView] Translation complete:', translation);

    // Store the translation result
    setLastTranslation(translation.input);
    setGlossSequence(translation.gloss);
    setShouldAutoPlay(true);

    // Switch to LISTENING mode to play avatar
    setTimeout(() => {
      setMode('LISTENING');
    }, 500); // Small delay to show complete state
  });

  // Sync translation state with app store processing state
  useEffect(() => {
    setProcessing(translationState === 'processing');
  }, [translationState, setProcessing]);

  // Expose translation state for TranscriptionBox
  useEffect(() => {
    // Store translation state in a way TranscriptionBox can access
    (window as unknown as { __translationState: TranslationState }).__translationState = translationState;
    (window as unknown as { __silenceProgress: number }).__silenceProgress = silenceProgress;
  }, [translationState, silenceProgress]);

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    setVideoElement(video);
  }, []);

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

      {/* Z-20: UI Layer */}
      <div className="absolute inset-0 z-20 flex flex-col">
        {/* Top Bar */}
        <TopBar
          onHistoryClick={() => console.log('History clicked')}
          onSettingsClick={() => console.log('Settings clicked')}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Silence Progress Indicator - Shows when pause detected */}
        {translationState === 'pause_detected' && (
          <div className="mb-4 flex justify-center">
            <div className="h-1 w-48 overflow-hidden rounded-full bg-gray-700">
              <motion.div
                className="h-full bg-yellow-400"
                initial={{ width: 0 }}
                animate={{ width: `${silenceProgress * 100}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
          </div>
        )}

        {/* Transcription Box - positioned above bottom bar */}
        <div className="mb-[22vh] flex justify-center">
          <TranscriptionBox translationState={translationState} />
        </div>
      </div>
    </motion.div>
  );
}

function ListeningView() {
  const [isTestMode, setIsTestMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const hasAutoPlayedRef = useRef(false);

  const {
    currentGlossSequence,
    shouldAutoPlay,
    setShouldAutoPlay,
    clearGlossSequence,
    lastTranslation
  } = useAppStore();

  // Auto-play sequence when entering from translation
  useEffect(() => {
    if (shouldAutoPlay && currentGlossSequence.length > 0 && !hasAutoPlayedRef.current) {
      hasAutoPlayedRef.current = true;
      console.log('[ListeningView] Auto-playing sequence:', currentGlossSequence);

      // Small delay to let component mount
      setTimeout(() => {
        // Use the global function exposed by AvatarPlayer
        // @ts-expect-error - Accessing window function for testing
        if (window.playAvatarSequence) {
          // @ts-expect-error - Accessing window function for testing
          window.playAvatarSequence(currentGlossSequence);
          setIsPlaying(true);
        }
      }, 300);

      // Clear auto-play flag after triggering
      setShouldAutoPlay(false);
    }
  }, [shouldAutoPlay, currentGlossSequence, setShouldAutoPlay]);

  // Reset ref when component unmounts
  useEffect(() => {
    return () => {
      hasAutoPlayedRef.current = false;
    };
  }, []);

  // Test sequences for demo
  const testSequences = [
    { label: 'Greeting', sequence: ['HELLO', 'WORLD'] },
    { label: 'Thanks', sequence: ['THANK_YOU', 'PLEASE'] },
    { label: 'With Unknown', sequence: ['HELLO', 'UNKNOWN_WORD', 'WORLD'] },
    { label: 'Full Demo', sequence: ['HELLO', 'WORLD', 'THANK_YOU', 'YES', 'NO'] },
  ];

  const handlePlaySequence = (sequence: string[]) => {
    // Use the global function exposed by AvatarPlayer
    // @ts-expect-error - Accessing window function for testing
    if (window.playAvatarSequence) {
      // @ts-expect-error - Accessing window function for testing
      window.playAvatarSequence(sequence);
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    // @ts-expect-error - Accessing window function for testing
    if (window.stopAvatar) {
      // @ts-expect-error - Accessing window function for testing
      window.stopAvatar();
      setIsPlaying(false);
    }
  };

  // Display text - show translation result or default
  const displayText = lastTranslation || 'Listening...';
  const subText = lastTranslation
    ? 'Translating to sign language...'
    : 'Speak naturally. Your words will be translated to sign language.';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: TRANSITION_DURATION }}
      className="absolute inset-0 bg-black"
    >
      {/* Z-10: Content Container */}
      <div className="absolute inset-0 z-10 flex flex-col items-center px-4 pt-20">
        {/* Transcription Area - Large Yellow Text */}
        <div className="w-full max-w-md text-left">
          <h2 className="text-4xl font-bold leading-tight text-yellow-400">
            {displayText}
          </h2>
          <p className="mt-2 text-lg text-yellow-400/70">
            {subText}
          </p>
          {currentGlossSequence.length > 0 && (
            <p className="mt-2 text-sm text-gray-500">
              Gloss: {currentGlossSequence.join(' → ')}
            </p>
          )}
        </div>

        {/* Avatar Display - Centered */}
        <div className="mt-6 flex flex-1 items-center justify-center">
          <AvatarPlayer className="h-64 w-64" />
        </div>

        {/* Test Controls - Phase 3 Demo */}
        <div className="mb-4 w-full max-w-md">
          <button
            onClick={() => setIsTestMode(!isTestMode)}
            className="mb-2 text-xs text-gray-500 hover:text-gray-400"
          >
            {isTestMode ? 'Hide Test Controls' : 'Show Test Controls'}
          </button>

          {isTestMode && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-lg bg-gray-900/80 p-3"
            >
              <p className="mb-2 text-xs font-medium text-gray-400">
                Phase 3 Test - Gloss Sequences:
              </p>
              <div className="flex flex-wrap gap-2">
                {testSequences.map((test) => (
                  <button
                    key={test.label}
                    onClick={() => handlePlaySequence(test.sequence)}
                    className="flex items-center gap-1 rounded-full bg-yellow-400/20 px-3 py-1 text-xs font-medium text-yellow-400 transition-colors hover:bg-yellow-400/30"
                  >
                    <Play className="h-3 w-3" />
                    {test.label}
                  </button>
                ))}
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1 rounded-full bg-red-400/20 px-3 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-400/30"
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Or use console: <code className="text-yellow-400/70">playAvatarSequence(['HELLO', 'WORLD'])</code>
              </p>
            </motion.div>
          )}
        </div>

        {/* Waveform - Below Avatar, Above Bottom Bar */}
        <div className="mb-[22vh] w-full max-w-md">
          <Waveform isActive={true} />
        </div>
      </div>

      {/* Z-20: Top Bar */}
      <TopBar
        onHistoryClick={() => console.log('History clicked')}
        onSettingsClick={() => console.log('Settings clicked')}
      />
    </motion.div>
  );
}
