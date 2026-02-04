'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useFlipbook } from '@/hooks/useFlipbook';

interface FlipbookPlayerProps {
  className?: string;
  onSequenceComplete?: () => void;
  onGlossChange?: (gloss: string, index: number) => void;
}

interface QueueItem {
  gloss: string;
  index: number;
}

export function FlipbookPlayer({
  className = '',
  onSequenceComplete,
  onGlossChange,
}: FlipbookPlayerProps) {
  const {
    state,
    currentFrameImage,
    play,
    stop,
    preload,
  } = useFlipbook();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isIdle, setIsIdle] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw current frame to canvas
  useEffect(() => {
    if (!canvasRef.current || !currentFrameImage) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match image
    if (canvas.width !== currentFrameImage.width || canvas.height !== currentFrameImage.height) {
      canvas.width = currentFrameImage.width || 256;
      canvas.height = currentFrameImage.height || 256;
    }

    // Clear and draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(currentFrameImage, 0, 0);
  }, [currentFrameImage]);

  // Play next item in queue
  const playNext = useCallback(() => {
    const nextIndex = currentIndex + 1;

    if (nextIndex >= queue.length) {
      // Sequence complete
      setIsIdle(true);
      setCurrentIndex(-1);
      setQueue([]);
      onSequenceComplete?.();
      return;
    }

    const nextItem = queue[nextIndex];
    setCurrentIndex(nextIndex);
    setIsIdle(false);
    onGlossChange?.(nextItem.gloss, nextIndex);

    // Preload next gloss while playing current
    if (nextIndex + 1 < queue.length) {
      preload(queue[nextIndex + 1].gloss);
    }

    play(nextItem.gloss, {
      loop: false,
      onComplete: playNext,
    });
  }, [currentIndex, queue, play, preload, onSequenceComplete, onGlossChange]);

  // Start playing when queue changes
  useEffect(() => {
    if (queue.length > 0 && currentIndex === -1) {
      playNext();
    }
  }, [queue, currentIndex, playNext]);

  // Expose play function globally for testing
  useEffect(() => {
    const playSequence = (glosses: string[]) => {
      stop();
      setCurrentIndex(-1);
      setQueue(glosses.map((gloss, index) => ({ gloss, index })));
    };

    const stopPlayer = () => {
      stop();
      setIsIdle(true);
      setCurrentIndex(-1);
      setQueue([]);
    };

    // @ts-expect-error - Exposing for testing
    window.playFlipbookSequence = playSequence;
    // @ts-expect-error - Exposing for testing
    window.stopFlipbook = stopPlayer;

    return () => {
      // @ts-expect-error - Cleanup
      delete window.playFlipbookSequence;
      // @ts-expect-error - Cleanup
      delete window.stopFlipbook;
    };
  }, [stop]);

  const currentGloss = currentIndex >= 0 ? queue[currentIndex]?.gloss : null;

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      {/* Canvas for frame display */}
      <div className="relative flex h-48 w-48 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-yellow-400/20 to-yellow-600/10">
        <AnimatePresence mode="wait">
          {state.isLoading ? (
            // Loading state
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
              <span className="text-sm text-yellow-400/70">
                Loading {state.currentFrame}/{state.totalFrames}
              </span>
            </motion.div>
          ) : state.error ? (
            // Error state - show gloss as text fallback
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 px-4 text-center"
            >
              <span className="text-4xl font-bold text-yellow-400">
                {currentGloss || '?'}
              </span>
              <span className="text-xs text-yellow-400/50">(no animation)</span>
            </motion.div>
          ) : isIdle ? (
            // Idle state - breathing animation
            <motion.div
              key="idle"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: 1,
                scale: [1, 1.05, 1],
              }}
              transition={{
                scale: {
                  repeat: Infinity,
                  duration: 2,
                  ease: 'easeInOut',
                },
              }}
              className="flex flex-col items-center gap-2"
            >
              <span className="text-6xl">🧏</span>
              <span className="text-sm text-yellow-400/50">Ready</span>
            </motion.div>
          ) : (
            // Playing state - show canvas
            <motion.div
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative"
            >
              <canvas
                ref={canvasRef}
                className="h-44 w-44 rounded-lg object-cover"
                style={{ imageRendering: 'crisp-edges' }}
              />
              {/* Frame counter overlay */}
              <div className="absolute bottom-1 right-1 rounded bg-black/50 px-1 text-xs text-white">
                {state.currentFrame + 1}/{state.totalFrames}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Current gloss label */}
      {currentGloss && !isIdle && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 text-center"
        >
          <span className="rounded-full bg-yellow-400/20 px-4 py-1 text-lg font-medium text-yellow-400">
            {currentGloss}
          </span>
        </motion.div>
      )}

      {/* Queue progress dots */}
      {queue.length > 1 && (
        <div className="mt-3 flex gap-1">
          {queue.map((item, idx) => (
            <motion.div
              key={item.gloss + idx}
              className={`h-2 w-2 rounded-full ${
                idx === currentIndex
                  ? 'bg-yellow-400'
                  : idx < currentIndex
                  ? 'bg-yellow-400/50'
                  : 'bg-gray-600'
              }`}
              animate={idx === currentIndex ? { scale: [1, 1.3, 1] } : {}}
              transition={{ repeat: Infinity, duration: 0.5 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
