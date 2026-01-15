'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

export interface AudioState {
  isRecording: boolean;
  isPlaying: boolean;
  hasPermission: boolean | null;
  error: string | null;
  volume: number; // 0-1 for visualization
  audioBlob: Blob | null;
}

interface UseAudioOptions {
  onVolumeChange?: (volume: number) => void;
  onRecordingComplete?: (blob: Blob) => void;
  sampleRate?: number;
}

export function useAudio(options: UseAudioOptions = {}) {
  const { onVolumeChange, onRecordingComplete, sampleRate = 44100 } = options;

  const [state, setState] = useState<AudioState>({
    isRecording: false,
    isPlaying: false,
    hasPermission: null,
    error: null,
    volume: 0,
    audioBlob: null,
  });

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  // Request microphone permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Store stream for later use
      streamRef.current = stream;

      setState((prev) => ({ ...prev, hasPermission: true, error: null }));
      return true;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to access microphone';
      setState((prev) => ({ ...prev, hasPermission: false, error }));
      return false;
    }
  }, [sampleRate]);

  // Volume analysis loop
  const analyzeVolume = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume (0-255) and normalize to 0-1
    const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
    const normalizedVolume = Math.min(average / 128, 1);

    setState((prev) => ({ ...prev, volume: normalizedVolume }));
    onVolumeChange?.(normalizedVolume);

    animationFrameRef.current = requestAnimationFrame(analyzeVolume);
  }, [onVolumeChange]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      // Request permission if not already granted
      if (!streamRef.current) {
        const hasPermission = await requestPermission();
        if (!hasPermission) return;
      }

      if (!streamRef.current) {
        throw new Error('No audio stream available');
      }

      // Setup audio context for volume analysis
      audioContextRef.current = new AudioContext({ sampleRate });
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;

      const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
      source.connect(analyserRef.current);

      // Setup media recorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      mediaRecorderRef.current = new MediaRecorder(streamRef.current, { mimeType });
      chunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setState((prev) => ({ ...prev, audioBlob: blob }));
        onRecordingComplete?.(blob);
      };

      mediaRecorderRef.current.start(100); // Collect data every 100ms
      setState((prev) => ({ ...prev, isRecording: true, error: null }));

      // Start volume analysis
      analyzeVolume();
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to start recording';
      setState((prev) => ({ ...prev, error }));
    }
  }, [requestPermission, sampleRate, analyzeVolume, onRecordingComplete]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    setState((prev) => ({ ...prev, isRecording: false, volume: 0 }));
  }, []);

  // Play audio from URL or blob
  const playAudio = useCallback(async (source: string | Blob) => {
    try {
      if (audioElementRef.current) {
        audioElementRef.current.pause();
      }

      audioElementRef.current = new Audio();

      if (source instanceof Blob) {
        audioElementRef.current.src = URL.createObjectURL(source);
      } else {
        audioElementRef.current.src = source;
      }

      audioElementRef.current.onended = () => {
        setState((prev) => ({ ...prev, isPlaying: false }));
      };

      audioElementRef.current.onerror = () => {
        setState((prev) => ({ ...prev, isPlaying: false, error: 'Failed to play audio' }));
      };

      setState((prev) => ({ ...prev, isPlaying: true, error: null }));
      await audioElementRef.current.play();
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to play audio';
      setState((prev) => ({ ...prev, isPlaying: false, error }));
    }
  }, []);

  // Stop audio playback
  const stopAudio = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    ...state,
    requestPermission,
    startRecording,
    stopRecording,
    playAudio,
    stopAudio,
    cleanup,
  };
}
