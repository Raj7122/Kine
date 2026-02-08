'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import type { TranslationState } from '@/hooks/useSigningModeTranslation';
import type { GestureResult } from '@/lib/mediapipe';

interface SubtitleEntry {
  id: string;
  text: string;
  timestamp: number;
}

interface SubtitleOverlayProps {
  translationState?: TranslationState;
  silenceProgress?: number;
  maxHistory?: number;
  currentGesture?: GestureResult | null;
}

export function SubtitleOverlay({
  translationState = 'idle',
  silenceProgress = 0,
  maxHistory = 3,
  currentGesture = null,
}: SubtitleOverlayProps) {
  const { lastTranslation } = useAppStore();
  const [history, setHistory] = useState<SubtitleEntry[]>([]);

  // Add new translation to history
  useEffect(() => {
    if (lastTranslation && translationState === 'complete') {
      const newEntry: SubtitleEntry = {
        id: crypto.randomUUID(),
        text: typeof lastTranslation === 'string' ? lastTranslation : lastTranslation?.text ?? '',
        timestamp: Date.now(),
      };
      setHistory((prev) => [newEntry, ...prev].slice(0, maxHistory));
    }
  }, [lastTranslation, translationState, maxHistory]);

  // Auto-fade old entries after 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setHistory((prev) => prev.filter((entry) => now - entry.timestamp < 10000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Status indicator text
  const getStatusText = () => {
    switch (translationState) {
      case 'signing':
        return 'Signing...';
      case 'pause_detected':
        return `Hold still... ${Math.round(silenceProgress * 100)}%`;
      case 'processing':
        return 'Recognizing...';
      default:
        return null;
    }
  };

  const statusText = getStatusText();

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 flex flex-col items-center gap-2 px-4">
      {/* Real-time gesture detection (MediaPipe - instant) */}
      <AnimatePresence>
        {currentGesture && currentGesture.gesture !== 'None' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="rounded-lg bg-green-500/20 px-4 py-2 backdrop-blur-sm"
          >
            <span className="text-lg font-semibold text-green-400">
              {currentGesture.aslMeaning}
            </span>
            <span className="ml-2 text-xs text-green-400/70">
              {Math.round(currentGesture.confidence * 100)}%
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status indicator - subtle */}
      <AnimatePresence>
        {statusText && !currentGesture && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 0.7, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="rounded-full bg-black/50 px-3 py-1 text-sm text-white/80"
          >
            {statusText}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Silence progress bar */}
      {translationState === 'pause_detected' && silenceProgress > 0 && (
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          className="h-1 w-32 overflow-hidden rounded-full bg-white/20"
        >
          <motion.div
            className="h-full bg-yellow-400"
            initial={{ width: 0 }}
            animate={{ width: `${silenceProgress * 100}%` }}
            transition={{ duration: 0.1 }}
          />
        </motion.div>
      )}

      {/* Translation history - subtitles */}
      <div className="flex flex-col items-center gap-1">
        <AnimatePresence>
          {history.map((entry, index) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{
                opacity: index === 0 ? 1 : 0.5,
                y: 0,
                scale: index === 0 ? 1 : 0.9,
              }}
              exit={{ opacity: 0, y: -20, scale: 0.8 }}
              transition={{ duration: 0.3 }}
              className={`rounded-lg px-4 py-2 ${
                index === 0
                  ? 'bg-black/80 text-xl font-semibold text-yellow-400'
                  : 'bg-black/50 text-base text-yellow-400/70'
              }`}
            >
              {entry.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
