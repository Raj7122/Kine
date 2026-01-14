'use client';

import { useCallback, useRef, useState } from 'react';
import { buildPlaybackQueue, type PlaybackItem, FALLBACK_DURATION_MS } from '@/lib/avatar';

export interface UseAvatarPlayerReturn {
  // State
  isPlaying: boolean;
  currentGloss: string | null;
  currentIndex: number;
  totalItems: number;
  isFallback: boolean;

  // Actions
  playSequence: (glossSequence: string[]) => void;
  stop: () => void;

  // For component integration
  onItemComplete: () => void;
  getCurrentDuration: () => number;
}

export function useAvatarPlayer(): UseAvatarPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queue, setQueue] = useState<PlaybackItem[]>([]);

  const queueRef = useRef<PlaybackItem[]>([]);
  const currentIndexRef = useRef(0);

  // Get current item
  const currentItem = queue[currentIndex] || null;
  const currentGloss = currentItem?.gloss || null;
  const isFallback = currentItem?.isFallback || false;

  // Get duration for current item
  const getCurrentDuration = useCallback(() => {
    if (!currentItem) return 0;
    if (currentItem.isFallback) return FALLBACK_DURATION_MS;
    return currentItem.entry?.duration_ms || FALLBACK_DURATION_MS;
  }, [currentItem]);

  // Start playing a sequence
  const playSequence = useCallback((glossSequence: string[]) => {
    if (glossSequence.length === 0) return;

    const playbackQueue = buildPlaybackQueue(glossSequence);
    queueRef.current = playbackQueue;
    currentIndexRef.current = 0;

    setQueue(playbackQueue);
    setCurrentIndex(0);
    setIsPlaying(true);

    console.log('[AvatarPlayer] Starting sequence:', glossSequence);
    console.log('[AvatarPlayer] Queue built:', playbackQueue);
  }, []);

  // Stop playback
  const stop = useCallback(() => {
    setIsPlaying(false);
    setCurrentIndex(0);
    setQueue([]);
    queueRef.current = [];
    currentIndexRef.current = 0;

    console.log('[AvatarPlayer] Stopped');
  }, []);

  // Called when current item completes (video ended or fallback timer done)
  const onItemComplete = useCallback(() => {
    const nextIndex = currentIndexRef.current + 1;

    if (nextIndex >= queueRef.current.length) {
      // Queue complete
      console.log('[AvatarPlayer] Sequence complete');
      setIsPlaying(false);
      setCurrentIndex(0);
      setQueue([]);
      queueRef.current = [];
      currentIndexRef.current = 0;
    } else {
      // Move to next item
      console.log('[AvatarPlayer] Moving to next item:', nextIndex);
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
    }
  }, []);

  return {
    isPlaying,
    currentGloss,
    currentIndex,
    totalItems: queue.length,
    isFallback,
    playSequence,
    stop,
    onItemComplete,
    getCurrentDuration,
  };
}
