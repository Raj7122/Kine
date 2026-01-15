'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { FlipbookEntry, FlipbookState, FlipbookPlaybackOptions } from '@/lib/avatar/types';
import { FRAME_DURATION_MS } from '@/lib/avatar/types';
import {
  getFlipbookEntry,
  preloadFlipbook,
  getCachedFrames,
} from '@/lib/avatar/flipbookService';

interface UseFlipbookReturn {
  state: FlipbookState;
  currentFrameImage: HTMLImageElement | null;
  play: (gloss: string, options?: FlipbookPlaybackOptions) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  preload: (gloss: string) => Promise<void>;
}

export function useFlipbook(): UseFlipbookReturn {
  const [state, setState] = useState<FlipbookState>({
    isLoading: false,
    isPlaying: false,
    currentFrame: 0,
    totalFrames: 0,
    error: null,
  });

  // Refs for animation control
  const framesRef = useRef<HTMLImageElement[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const currentFrameRef = useRef<number>(0);
  const optionsRef = useRef<FlipbookPlaybackOptions>({});
  const entryRef = useRef<FlipbookEntry | null>(null);
  const isPausedRef = useRef<boolean>(false);

  // Current frame image
  const [currentFrameImage, setCurrentFrameImage] = useState<HTMLImageElement | null>(null);

  // Animation loop using requestAnimationFrame
  const animate = useCallback((timestamp: number) => {
    if (isPausedRef.current) {
      animationFrameRef.current = requestAnimationFrame(animate);
      return;
    }

    const elapsed = timestamp - lastFrameTimeRef.current;
    const entry = entryRef.current;

    if (!entry) return;

    // Calculate frame duration based on actual FPS
    const frameDuration = 1000 / entry.fps;

    if (elapsed >= frameDuration) {
      lastFrameTimeRef.current = timestamp - (elapsed % frameDuration);

      const nextFrame = currentFrameRef.current + 1;

      if (nextFrame >= entry.frameCount) {
        // End of sequence
        if (optionsRef.current.loop) {
          currentFrameRef.current = 0;
          setState(prev => ({ ...prev, currentFrame: 0 }));
          setCurrentFrameImage(framesRef.current[0] || null);
        } else {
          // Complete
          setState(prev => ({ ...prev, isPlaying: false, currentFrame: 0 }));
          setCurrentFrameImage(null);
          optionsRef.current.onComplete?.();
          return;
        }
      } else {
        currentFrameRef.current = nextFrame;
        setState(prev => ({ ...prev, currentFrame: nextFrame }));
        setCurrentFrameImage(framesRef.current[nextFrame] || null);
        optionsRef.current.onFrameChange?.(nextFrame);
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate);
  }, []);

  // Stop animation
  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    currentFrameRef.current = 0;
    isPausedRef.current = false;
    framesRef.current = [];
    entryRef.current = null;

    setState({
      isLoading: false,
      isPlaying: false,
      currentFrame: 0,
      totalFrames: 0,
      error: null,
    });
    setCurrentFrameImage(null);
  }, []);

  // Pause animation
  const pause = useCallback(() => {
    isPausedRef.current = true;
    setState(prev => ({ ...prev, isPlaying: false }));
  }, []);

  // Resume animation
  const resume = useCallback(() => {
    if (!entryRef.current || framesRef.current.length === 0) return;

    isPausedRef.current = false;
    lastFrameTimeRef.current = performance.now();
    setState(prev => ({ ...prev, isPlaying: true }));

    if (!animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(animate);
    }
  }, [animate]);

  // Preload frames for a gloss
  const preload = useCallback(async (gloss: string) => {
    const entry = await getFlipbookEntry(gloss);
    if (entry) {
      await preloadFlipbook(entry);
    }
  }, []);

  // Play a flipbook sequence
  const play = useCallback(async (
    gloss: string,
    options: FlipbookPlaybackOptions = {}
  ) => {
    // Stop any current animation
    stop();

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Get flipbook entry
      const entry = await getFlipbookEntry(gloss);

      if (!entry) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: `No flipbook data for ${gloss}`,
        }));
        return;
      }

      entryRef.current = entry;
      optionsRef.current = options;

      // Check if already cached
      let frames = getCachedFrames(gloss);

      if (!frames || frames.length === 0) {
        // Preload frames with progress
        frames = await preloadFlipbook(entry, (loaded, total) => {
          setState(prev => ({
            ...prev,
            currentFrame: loaded,
            totalFrames: total,
          }));
        });
      }

      if (frames.length === 0) {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to load frames',
        }));
        return;
      }

      framesRef.current = frames;
      currentFrameRef.current = 0;
      lastFrameTimeRef.current = performance.now();

      setState({
        isLoading: false,
        isPlaying: true,
        currentFrame: 0,
        totalFrames: frames.length,
        error: null,
      });

      setCurrentFrameImage(frames[0]);

      // Start animation loop
      animationFrameRef.current = requestAnimationFrame(animate);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMsg,
      }));
    }
  }, [stop, animate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    state,
    currentFrameImage,
    play,
    stop,
    pause,
    resume,
    preload,
  };
}
