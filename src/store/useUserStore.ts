'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserPreferences {
  visualMode: 'text_only' | 'text_plus_avatar';
  voiceId: string;
  textSize: 'small' | 'medium' | 'large';
  highContrast: boolean;
}

export interface UserProfile {
  id: string | null;
  email: string | null;
  fullName: string | null;
  role: 'deaf' | 'hard_of_hearing' | 'hearing' | 'blind';
}

interface UserState {
  // User profile
  profile: UserProfile;
  isAuthenticated: boolean;

  // User preferences
  preferences: UserPreferences;

  // Actions
  setProfile: (profile: Partial<UserProfile>) => void;
  setPreferences: (preferences: Partial<UserPreferences>) => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  resetUser: () => void;
}

const defaultPreferences: UserPreferences = {
  visualMode: 'text_plus_avatar',
  voiceId: 'default',
  textSize: 'medium',
  highContrast: true, // Default to high contrast for accessibility
};

const defaultProfile: UserProfile = {
  id: null,
  email: null,
  fullName: null,
  role: 'deaf',
};

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      profile: defaultProfile,
      isAuthenticated: false,
      preferences: defaultPreferences,

      setProfile: (profile) =>
        set((state) => ({
          profile: { ...state.profile, ...profile },
        })),

      setPreferences: (preferences) =>
        set((state) => ({
          preferences: { ...state.preferences, ...preferences },
        })),

      setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

      resetUser: () =>
        set({
          profile: defaultProfile,
          isAuthenticated: false,
          preferences: defaultPreferences,
        }),
    }),
    {
      name: 'kine-user-storage',
      partialize: (state) => ({
        preferences: state.preferences,
        profile: state.profile,
      }),
    }
  )
);
