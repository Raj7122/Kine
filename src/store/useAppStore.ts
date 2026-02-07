'use client';

import { create } from 'zustand';
import type { SignRecognizeResult } from '@/lib/sign-recognition/types';
import type { LSTMPrediction } from '@/lib/lstm/types';

export type AppMode = 'SIGNING' | 'LISTENING';
export type DetectionMode = 'STATIC' | 'DYNAMIC' | 'HYBRID';

interface AppState {
  // Mode
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;

  // Session ID for feedback tracking
  sessionId: string;

  // Processing state
  isProcessing: boolean;
  setProcessing: (isProcessing: boolean) => void;

  // Translation
  lastTranslation: SignRecognizeResult | null;
  setLastTranslation: (translation: SignRecognizeResult | null) => void;

  // Gloss sequence for avatar playback
  currentGlossSequence: string[];
  setGlossSequence: (sequence: string[]) => void;
  clearGlossSequence: () => void;

  // Auto-play flag (set when coming from translation)
  shouldAutoPlay: boolean;
  setShouldAutoPlay: (value: boolean) => void;

  // LSTM Detection State
  isLSTMEnabled: boolean;
  setLSTMEnabled: (enabled: boolean) => void;
  isLSTMModelLoaded: boolean;
  setLSTMModelLoaded: (loaded: boolean) => void;
  lastLSTMPrediction: LSTMPrediction | null;
  setLastLSTMPrediction: (prediction: LSTMPrediction | null) => void;
  detectionMode: DetectionMode;
  setDetectionMode: (mode: DetectionMode) => void;
}

// Generate a session ID on store creation
const generateSessionId = () => crypto.randomUUID();

export const useAppStore = create<AppState>((set) => ({
  // Mode
  mode: 'SIGNING',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({
    mode: state.mode === 'SIGNING' ? 'LISTENING' : 'SIGNING'
  })),

  // Session ID for feedback tracking
  sessionId: generateSessionId(),

  // Processing state
  isProcessing: false,
  setProcessing: (isProcessing) => set({ isProcessing }),

  // Translation
  lastTranslation: null,
  setLastTranslation: (translation) => set({ lastTranslation: translation }),

  // Gloss sequence
  currentGlossSequence: [],
  setGlossSequence: (sequence) => set({ currentGlossSequence: sequence }),
  clearGlossSequence: () => set({ currentGlossSequence: [] }),

  // Auto-play
  shouldAutoPlay: false,
  setShouldAutoPlay: (value) => set({ shouldAutoPlay: value }),

  // LSTM Detection
  isLSTMEnabled: true,  // Enabled by default in HYBRID mode
  setLSTMEnabled: (enabled) => set({ isLSTMEnabled: enabled }),
  isLSTMModelLoaded: false,
  setLSTMModelLoaded: (loaded) => set({ isLSTMModelLoaded: loaded }),
  lastLSTMPrediction: null,
  setLastLSTMPrediction: (prediction) => set({ lastLSTMPrediction: prediction }),
  detectionMode: 'HYBRID',  // Default to hybrid mode (YOLO + LSTM)
  setDetectionMode: (mode) => set({ detectionMode: mode }),
}));
