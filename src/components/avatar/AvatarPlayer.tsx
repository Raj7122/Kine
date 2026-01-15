'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAvatarPlayer } from '@/hooks/useAvatarPlayer';
import { FlipbookPlayer } from './FlipbookPlayer';
import { GenASLPlayer } from './GenASLPlayer';
import { AlertTriangle } from 'lucide-react';
import { isGenASLConfigured } from '@/lib/aws/config';

// Avatar rendering modes
export type AvatarMode = 'flipbook' | 'genasl' | 'legacy';

interface AvatarPlayerProps {
  className?: string;
  onSequenceComplete?: () => void;
  // Avatar rendering mode
  mode?: AvatarMode;
  // Legacy prop for backwards compatibility
  useFlipbook?: boolean;
}

// Determine default mode based on configuration
function getDefaultMode(): AvatarMode {
  if (isGenASLConfigured) return 'genasl';
  return 'flipbook';
}

export function AvatarPlayer({
  className = '',
  onSequenceComplete,
  mode,
  useFlipbook, // Deprecated, use mode instead
}: AvatarPlayerProps) {
  // Handle legacy useFlipbook prop
  const initialMode = mode || (useFlipbook === false ? 'legacy' : getDefaultMode());
  const {
    isPlaying,
    currentGloss,
    currentIndex,
    totalItems,
    isFallback,
    playSequence,
    stop,
    onItemComplete,
    getCurrentDuration,
  } = useAvatarPlayer();

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>(initialMode);

  // Handle legacy mock playback timing (when using legacy mode)
  useEffect(() => {
    if (avatarMode !== 'legacy' || !isPlaying || !currentGloss) return;

    const duration = getCurrentDuration();
    console.log(`[AvatarPlayer] Playing "${currentGloss}" for ${duration}ms`);

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      onItemComplete();
    }, duration);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [avatarMode, isPlaying, currentGloss, currentIndex, getCurrentDuration, onItemComplete]);

  // Expose playSequence to parent via global function for testing
  useEffect(() => {
    // @ts-expect-error - Expose for testing in browser console
    window.playAvatarSequence = (glosses: string[]) => {
      if (avatarMode === 'flipbook') {
        // @ts-expect-error - Call flipbook's global function
        if (window.playFlipbookSequence) {
          // @ts-expect-error
          window.playFlipbookSequence(glosses);
        }
      } else if (avatarMode === 'genasl') {
        // GenASL takes full text, not glosses - join them
        // @ts-expect-error - Call GenASL's global function
        if (window.playGenASL) {
          // @ts-expect-error
          window.playGenASL(glosses.join(' '));
        }
      } else {
        playSequence(glosses);
      }
    };

    // @ts-expect-error - Expose for testing
    window.stopAvatar = () => {
      if (avatarMode === 'flipbook') {
        // @ts-expect-error
        if (window.stopFlipbook) window.stopFlipbook();
      } else if (avatarMode === 'genasl') {
        // @ts-expect-error
        if (window.stopGenASL) window.stopGenASL();
      } else {
        stop();
      }
    };

    // Cycle through avatar modes
    // @ts-expect-error - Expose for testing
    window.setAvatarMode = (newMode: AvatarMode) => {
      setAvatarMode(newMode);
      console.log(`[AvatarPlayer] Mode set to: ${newMode}`);
    };

    // @ts-expect-error - Expose for testing
    window.cycleAvatarMode = () => {
      const modes: AvatarMode[] = ['flipbook', 'genasl', 'legacy'];
      const currentIdx = modes.indexOf(avatarMode);
      const nextMode = modes[(currentIdx + 1) % modes.length];
      setAvatarMode(nextMode);
      console.log(`[AvatarPlayer] Mode: ${nextMode}`);
    };

    // @ts-expect-error - Expose for testing
    window.getAvatarMode = () => avatarMode;

    return () => {
      // @ts-expect-error - Cleanup
      delete window.playAvatarSequence;
      // @ts-expect-error - Cleanup
      delete window.stopAvatar;
      // @ts-expect-error - Cleanup
      delete window.setAvatarMode;
      // @ts-expect-error - Cleanup
      delete window.cycleAvatarMode;
      // @ts-expect-error - Cleanup
      delete window.getAvatarMode;
    };
  }, [avatarMode, playSequence, stop]);

  // Render based on avatar mode
  if (avatarMode === 'flipbook') {
    return (
      <FlipbookPlayer
        className={className}
        onSequenceComplete={onSequenceComplete}
      />
    );
  }

  if (avatarMode === 'genasl') {
    return (
      <GenASLPlayer
        className={className}
        onTranslationComplete={() => onSequenceComplete?.()}
        onError={(error) => console.error('[AvatarPlayer] GenASL error:', error)}
      />
    );
  }

  // Legacy emoji-based avatar display
  return (
    <div className={`relative flex items-center justify-center rounded-2xl bg-gray-900/50 overflow-hidden ${className}`}>
      {/* Idle State - Breathing Animation */}
      <AnimatePresence mode="wait">
        {!isPlaying ? (
          <motion.div
            key="idle"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex h-48 w-48 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400/20 to-yellow-600/20 border-2 border-yellow-400/30"
          >
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 3, repeat: Infinity }}
              className="text-center"
            >
              <div className="text-5xl">🧏</div>
              <p className="mt-2 text-sm font-medium text-yellow-400/70">
                Ready
              </p>
            </motion.div>
          </motion.div>
        ) : isFallback ? (
          // Fallback State - Word Not Found
          <motion.div
            key={`fallback-${currentGloss}`}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="flex h-48 w-48 flex-col items-center justify-center rounded-full bg-gradient-to-br from-red-500/20 to-red-700/20 border-2 border-red-400/30"
          >
            <AlertTriangle className="h-12 w-12 text-red-400" />
            <p className="mt-2 text-sm font-bold text-red-400">
              NOT FOUND
            </p>
            <p className="text-xs text-red-400/70">
              {currentGloss}
            </p>
          </motion.div>
        ) : (
          // Playing State - Animated Gloss Display
          <motion.div
            key={`playing-${currentGloss}-${currentIndex}`}
            initial={{ opacity: 0, scale: 0.5, rotateY: -90 }}
            animate={{ opacity: 1, scale: 1, rotateY: 0 }}
            exit={{ opacity: 0, scale: 0.5, rotateY: 90 }}
            transition={{ duration: 0.3, type: 'spring', stiffness: 200 }}
            className="flex h-48 w-48 flex-col items-center justify-center rounded-full bg-gradient-to-br from-yellow-400/30 to-yellow-600/30 border-2 border-yellow-400/50"
          >
            {/* Animated signing hands emoji */}
            <motion.div
              animate={{
                rotateZ: [0, -10, 10, -10, 0],
                scale: [1, 1.1, 1]
              }}
              transition={{
                duration: getCurrentDuration() / 1000,
                ease: 'easeInOut'
              }}
              className="text-5xl"
            >
              🤟
            </motion.div>

            {/* Gloss text */}
            <motion.p
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="mt-2 text-lg font-bold text-yellow-400"
            >
              {currentGloss}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Progress Indicator */}
      {isPlaying && totalItems > 1 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1">
          {Array.from({ length: totalItems }).map((_, i) => (
            <motion.div
              key={i}
              className={`h-1.5 w-6 rounded-full ${
                i === currentIndex
                  ? 'bg-yellow-400'
                  : i < currentIndex
                  ? 'bg-yellow-400/50'
                  : 'bg-gray-600'
              }`}
              animate={i === currentIndex ? { scale: [1, 1.2, 1] } : {}}
              transition={{ duration: 0.5, repeat: Infinity }}
            />
          ))}
        </div>
      )}

      {/* Debug Info */}
      {isPlaying && (
        <div className="absolute top-2 right-2 rounded bg-black/70 px-2 py-1">
          <p className="text-xs text-gray-400">
            {currentIndex + 1}/{totalItems}
          </p>
        </div>
      )}
    </div>
  );
}

// Export hook and types for external control
export { useAvatarPlayer };
export type { AvatarMode };
