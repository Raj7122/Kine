'use client';

import { create } from 'zustand';

export type AppMode = 'SIGNING' | 'LISTENING';

interface AppState {
  // Mode
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;

  // Processing state
  isProcessing: boolean;
  setProcessing: (isProcessing: boolean) => void;

  // Translation
  lastTranslation: string;
  setLastTranslation: (text: string) => void;

  // Gloss sequence for avatar playback
  currentGlossSequence: string[];
  setGlossSequence: (sequence: string[]) => void;
  clearGlossSequence: () => void;

  // Auto-play flag (set when coming from translation)
  shouldAutoPlay: boolean;
  setShouldAutoPlay: (value: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Mode
  mode: 'SIGNING',
  setMode: (mode) => set({ mode }),
  toggleMode: () => set((state) => ({
    mode: state.mode === 'SIGNING' ? 'LISTENING' : 'SIGNING'
  })),

  // Processing state
  isProcessing: false,
  setProcessing: (isProcessing) => set({ isProcessing }),

  // Translation
  lastTranslation: '',
  setLastTranslation: (text) => set({ lastTranslation: text }),

  // Gloss sequence
  currentGlossSequence: [],
  setGlossSequence: (sequence) => set({ currentGlossSequence: sequence }),
  clearGlossSequence: () => set({ currentGlossSequence: [] }),

  // Auto-play
  shouldAutoPlay: false,
  setShouldAutoPlay: (value) => set({ shouldAutoPlay: value }),
}));
