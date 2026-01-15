'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  genASLClient,
  type GenASLVideoResult,
  type GenASLTranslateRequest,
} from '@/lib/aws/genASLService';
import { isGenASLConfigured, GENASL_AVATAR_SETTINGS } from '@/lib/aws/config';

interface GenASLPlayerProps {
  className?: string;
  onTranslationComplete?: (result: GenASLVideoResult) => void;
  onError?: (error: string) => void;
}

interface QueueItem {
  text: string;
  index: number;
}

type PlayerStatus =
  | 'idle'
  | 'translating'
  | 'loading'
  | 'playing'
  | 'error'
  | 'not_configured';

export function GenASLPlayer({
  className = '',
  onTranslationComplete,
  onError,
}: GenASLPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<PlayerStatus>(
    isGenASLConfigured ? 'idle' : 'not_configured'
  );
  const [currentText, setCurrentText] = useState<string>('');
  const [glossSequence, setGlossSequence] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [progress, setProgress] = useState<string>('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [playbackSpeed, setPlaybackSpeed] = useState(
    GENASL_AVATAR_SETTINGS.defaultSpeed
  );

  /**
   * Translate text and play the resulting video
   */
  const translateAndPlay = useCallback(
    async (text: string) => {
      if (!isGenASLConfigured) {
        setStatus('not_configured');
        setErrorMessage('AWS GenASL is not configured');
        onError?.('AWS GenASL is not configured');
        return;
      }

      setCurrentText(text);
      setStatus('translating');
      setProgress('Translating...');
      setErrorMessage('');

      try {
        const request: GenASLTranslateRequest = {
          text,
          style: 'realistic',
          quality: 'medium',
          speed: playbackSpeed,
        };

        const result = await genASLClient.translateTextAndWait(
          request,
          (executionStatus) => {
            setProgress(`Status: ${executionStatus}`);
          }
        );

        setGlossSequence(result.glossSequence);
        setStatus('loading');
        setProgress('Loading video...');

        // Load and play video
        if (videoRef.current) {
          videoRef.current.src = result.videoUrl;
          videoRef.current.playbackRate = playbackSpeed;
          videoRef.current.load();
        }

        onTranslationComplete?.(result);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Translation failed';
        setStatus('error');
        setErrorMessage(msg);
        onError?.(msg);
      }
    },
    [playbackSpeed, onTranslationComplete, onError]
  );

  /**
   * Play next item in queue
   */
  const playNext = useCallback(() => {
    const nextIndex = currentIndex + 1;

    if (nextIndex >= queue.length) {
      // Queue complete
      setStatus('idle');
      setCurrentIndex(-1);
      setQueue([]);
      return;
    }

    const nextItem = queue[nextIndex];
    setCurrentIndex(nextIndex);
    translateAndPlay(nextItem.text);
  }, [currentIndex, queue, translateAndPlay]);

  /**
   * Handle video events
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleCanPlay = () => {
      setStatus('playing');
      setProgress('');
      video.play().catch(console.error);
    };

    const handleEnded = () => {
      playNext();
    };

    const handleError = () => {
      setStatus('error');
      setErrorMessage('Failed to load video');
      onError?.('Failed to load video');
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
    };
  }, [playNext, onError]);

  /**
   * Start playing when queue changes
   */
  useEffect(() => {
    if (queue.length > 0 && currentIndex === -1) {
      playNext();
    }
  }, [queue, currentIndex, playNext]);

  /**
   * Expose play function globally for testing
   */
  useEffect(() => {
    const playSequence = (texts: string[]) => {
      stop();
      setCurrentIndex(-1);
      setQueue(texts.map((text, index) => ({ text, index })));
    };

    const playSingle = (text: string) => {
      stop();
      translateAndPlay(text);
    };

    const stop = () => {
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
      setStatus('idle');
      setCurrentIndex(-1);
      setQueue([]);
      setCurrentText('');
      setGlossSequence([]);
    };

    // @ts-expect-error - Exposing for testing
    window.playGenASLSequence = playSequence;
    // @ts-expect-error - Exposing for testing
    window.playGenASL = playSingle;
    // @ts-expect-error - Exposing for testing
    window.stopGenASL = stop;

    return () => {
      // @ts-expect-error - Cleanup
      delete window.playGenASLSequence;
      // @ts-expect-error - Cleanup
      delete window.playGenASL;
      // @ts-expect-error - Cleanup
      delete window.stopGenASL;
    };
  }, [translateAndPlay]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center ${className}`}
    >
      {/* Video Player */}
      <div className="relative flex h-64 w-64 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-600/20">
        <AnimatePresence mode="wait">
          {status === 'not_configured' ? (
            <motion.div
              key="not-configured"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3 px-4 text-center"
            >
              <span className="text-4xl">⚙️</span>
              <span className="text-sm text-yellow-400">
                AWS GenASL not configured
              </span>
              <span className="text-xs text-gray-400">
                Set environment variables
              </span>
            </motion.div>
          ) : status === 'idle' ? (
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
              <span className="text-6xl">🤖</span>
              <span className="text-sm text-blue-400/70">GenASL Ready</span>
            </motion.div>
          ) : status === 'translating' ? (
            <motion.div
              key="translating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
              <span className="text-sm text-blue-400">{progress}</span>
              <span className="max-w-[200px] truncate text-xs text-gray-400">
                {currentText}
              </span>
            </motion.div>
          ) : status === 'loading' ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-3"
            >
              <div className="h-10 w-10 animate-pulse rounded-full bg-blue-400/50" />
              <span className="text-sm text-blue-400">Loading video...</span>
            </motion.div>
          ) : status === 'error' ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center gap-2 px-4 text-center"
            >
              <span className="text-4xl">⚠️</span>
              <span className="text-sm text-red-400">{errorMessage}</span>
            </motion.div>
          ) : (
            <motion.div
              key="playing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full"
            >
              <video
                ref={videoRef}
                className="h-full w-full rounded-2xl object-cover"
                playsInline
                muted={false}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Current Text Label */}
      {currentText && status !== 'idle' && status !== 'not_configured' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 max-w-[280px] text-center"
        >
          <span className="rounded-full bg-blue-400/20 px-4 py-1 text-sm text-blue-400">
            {currentText}
          </span>
        </motion.div>
      )}

      {/* Gloss Sequence */}
      {glossSequence.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          {glossSequence.map((gloss, idx) => (
            <span
              key={idx}
              className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
            >
              {gloss}
            </span>
          ))}
        </div>
      )}

      {/* Queue Progress */}
      {queue.length > 1 && (
        <div className="mt-3 flex gap-1">
          {queue.map((item, idx) => (
            <motion.div
              key={idx}
              className={`h-2 w-2 rounded-full ${
                idx === currentIndex
                  ? 'bg-blue-400'
                  : idx < currentIndex
                  ? 'bg-blue-400/50'
                  : 'bg-gray-600'
              }`}
              animate={idx === currentIndex ? { scale: [1, 1.3, 1] } : {}}
              transition={{ repeat: Infinity, duration: 0.5 }}
            />
          ))}
        </div>
      )}

      {/* Speed Control */}
      {status === 'idle' && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-xs text-gray-400">Speed:</span>
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300"
          >
            {GENASL_AVATAR_SETTINGS.speedOptions.map((speed) => (
              <option key={speed} value={speed}>
                {speed}x
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
