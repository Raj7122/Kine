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
import { AvatarPlayer, isQuickMode, setQuickMode } from '@/components/avatar/AvatarPlayer';
import { SettingsModal, HistoryModal } from '@/components/modals';
import { TRANSITION_DURATION } from '@/config/constants';
import type { LandmarkResult } from '@/lib/mediapipe';
import { useTranslation, type TranslationState } from '@/hooks/useTranslation';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { Play, Square, Mic, MicOff } from 'lucide-react';

export default function Home() {
  const { mode } = useAppStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <AnimatePresence mode="wait">
        {mode === 'SIGNING' ? (
          <SigningView
            key="signing"
            onSettingsClick={() => setIsSettingsOpen(true)}
            onHistoryClick={() => setIsHistoryOpen(true)}
          />
        ) : (
          <ListeningView
            key="listening"
            onSettingsClick={() => setIsSettingsOpen(true)}
            onHistoryClick={() => setIsHistoryOpen(true)}
          />
        )}
      </AnimatePresence>

      {/* Bottom Control Bar - Fixed across both modes */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex h-[20vh] items-center justify-center bg-gradient-to-t from-black via-black/90 to-transparent">
        <ModeToggle />
      </div>

      {/* Modals */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
    </div>
  );
}

interface ViewProps {
  onSettingsClick: () => void;
  onHistoryClick: () => void;
}

function SigningView({ onSettingsClick, onHistoryClick }: ViewProps) {
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
    setVideoElement: setTranslationVideoElement,
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

function ListeningView({ onSettingsClick, onHistoryClick }: ViewProps) {
  const [isTestMode, setIsTestMode] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [quickMode, setQuickModeState] = useState(isQuickMode());
  const hasAutoPlayedRef = useRef(false);

  const {
    currentGlossSequence,
    shouldAutoPlay,
    setShouldAutoPlay,
    clearGlossSequence,
    lastTranslation,
    setGlossSequence,
  } = useAppStore();

  // Speech recognition hook - Gemini as "The Linguist"
  const {
    state: speechState,
    isListening,
    interimTranscript,
    finalTranscript,
    translation: speechTranslation,
    startListening,
    stopListening,
    reset: resetSpeech,
  } = useSpeechRecognition((result) => {
    // Called when speech is translated to gloss
    console.log('[ListeningView] Speech translated:', result.gloss);
    setGlossSequence(result.gloss);

    // Play the avatar sequence
    setTimeout(() => {
      // @ts-expect-error - Accessing window function for testing
      if (window.playAvatarSequence) {
        // @ts-expect-error - Accessing window function for testing
        window.playAvatarSequence(result.gloss);
        setIsPlaying(true);
      }
    }, 300);
  });

  // Auto-start listening when entering this view (unless auto-playing from SIGNING_MODE)
  useEffect(() => {
    if (!shouldAutoPlay && speechState === 'idle') {
      console.log('[ListeningView] Starting speech recognition');
      startListening();
    }

    return () => {
      stopListening();
    };
  }, []); // Only on mount

  // Auto-play sequence when entering from SIGNING_MODE translation
  useEffect(() => {
    if (shouldAutoPlay && currentGlossSequence.length > 0 && !hasAutoPlayedRef.current) {
      hasAutoPlayedRef.current = true;
      console.log('[ListeningView] Auto-playing sequence from SIGNING_MODE:', currentGlossSequence);

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

  const handleMicToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      resetSpeech();
      startListening();
    }
  };

  const handleQuickModeToggle = () => {
    const newValue = !quickMode;
    setQuickModeState(newValue);
    setQuickMode(newValue);
  };

  // Display text - prioritize speech input, then last translation
  const displayText = interimTranscript || finalTranscript || speechTranslation?.spokenText || lastTranslation || 'Listening...';

  // Sub text based on state
  const getSubText = () => {
    if (speechState === 'not_supported') return 'Speech recognition not supported in this browser';
    if (speechState === 'error') return 'Error with speech recognition. Try again.';
    if (speechState === 'processing') return 'Translating to sign language...';
    if (interimTranscript) return 'Listening...';
    if (finalTranscript || speechTranslation) return 'Translating to sign language...';
    if (isListening) return 'Speak naturally. Your words will be translated to sign language.';
    return 'Tap the microphone to start speaking.';
  };
  const subText = getSubText();

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
          <div className="flex items-start justify-between">
            <h2 className="flex-1 text-4xl font-bold leading-tight text-yellow-400">
              {displayText}
            </h2>
            {/* Mic indicator */}
            <button
              onClick={handleMicToggle}
              className={`ml-4 flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
                isListening
                  ? 'animate-pulse bg-red-500/20 text-red-400'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {isListening ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
            </button>
          </div>
          <p className="mt-2 text-lg text-yellow-400/70">
            {subText}
          </p>
          {/* Show gloss sequence if available */}
          {(currentGlossSequence.length > 0 || speechTranslation?.gloss) && (
            <p className="mt-2 text-sm text-gray-500">
              Gloss: {(speechTranslation?.gloss || currentGlossSequence).join(' → ')}
            </p>
          )}
          {/* Processing indicator */}
          {speechState === 'processing' && (
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 w-2 animate-bounce rounded-full bg-yellow-400" />
              <div className="h-2 w-2 animate-bounce rounded-full bg-yellow-400" style={{ animationDelay: '0.1s' }} />
              <div className="h-2 w-2 animate-bounce rounded-full bg-yellow-400" style={{ animationDelay: '0.2s' }} />
            </div>
          )}
        </div>

        {/* Avatar Display - Centered */}
        <div className="mt-6 flex flex-1 flex-col items-center justify-center">
          <AvatarPlayer className="h-64 w-64" />
          {/* Quick Mode Toggle */}
          <button
            onClick={handleQuickModeToggle}
            className={`mt-3 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              quickMode
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
            }`}
          >
            {quickMode ? '⚡ Quick Mode (Fast)' : '🤖 AWS GenASL (Slow)'}
          </button>
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
        onHistoryClick={onHistoryClick}
        onSettingsClick={onSettingsClick}
      />
    </motion.div>
  );
}
