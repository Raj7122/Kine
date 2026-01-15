'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sun, Moon, Type, Volume2, User, Eye } from 'lucide-react';
import { useUserStore } from '@/store/useUserStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { preferences, profile, setPreferences, setProfile } = useUserStore();
  const [localPrefs, setLocalPrefs] = useState(preferences);
  const [localRole, setLocalRole] = useState(profile.role);

  // Sync local state when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalPrefs(preferences);
      setLocalRole(profile.role);
    }
  }, [isOpen, preferences, profile.role]);

  const handleSave = () => {
    setPreferences(localPrefs);
    setProfile({ role: localRole });
    onClose();
  };

  const textSizeOptions = [
    { value: 'small', label: 'Small' },
    { value: 'medium', label: 'Medium' },
    { value: 'large', label: 'Large' },
  ] as const;

  const roleOptions = [
    { value: 'deaf', label: 'Deaf' },
    { value: 'hard_of_hearing', label: 'Hard of Hearing' },
    { value: 'hearing', label: 'Hearing' },
    { value: 'blind', label: 'Blind' },
  ] as const;

  const visualModeOptions = [
    { value: 'text_plus_avatar', label: 'Text + Avatar' },
    { value: 'text_only', label: 'Text Only' },
  ] as const;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 bottom-4 top-auto z-50 max-h-[80vh] overflow-y-auto rounded-2xl bg-gray-900 p-6 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2"
          >
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-yellow-400">Settings</h2>
              <button
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                aria-label="Close settings"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Settings Sections */}
            <div className="space-y-6">
              {/* User Role */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <User className="h-4 w-4" />
                  I am...
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {roleOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setLocalRole(option.value)}
                      className={`rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                        localRole === option.value
                          ? 'bg-yellow-400 text-black'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Mode */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <Eye className="h-4 w-4" />
                  Display Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {visualModeOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        setLocalPrefs({ ...localPrefs, visualMode: option.value })
                      }
                      className={`rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                        localPrefs.visualMode === option.value
                          ? 'bg-yellow-400 text-black'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Size */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <Type className="h-4 w-4" />
                  Text Size
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {textSizeOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() =>
                        setLocalPrefs({ ...localPrefs, textSize: option.value })
                      }
                      className={`rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                        localPrefs.textSize === option.value
                          ? 'bg-yellow-400 text-black'
                          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* High Contrast */}
              <div className="flex items-center justify-between rounded-lg bg-gray-800 p-4">
                <div className="flex items-center gap-3">
                  {localPrefs.highContrast ? (
                    <Sun className="h-5 w-5 text-yellow-400" />
                  ) : (
                    <Moon className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="font-medium text-gray-200">High Contrast</span>
                </div>
                <button
                  onClick={() =>
                    setLocalPrefs({
                      ...localPrefs,
                      highContrast: !localPrefs.highContrast,
                    })
                  }
                  className={`relative h-7 w-12 rounded-full transition-colors ${
                    localPrefs.highContrast ? 'bg-yellow-400' : 'bg-gray-600'
                  }`}
                  role="switch"
                  aria-checked={localPrefs.highContrast}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
                      localPrefs.highContrast ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Voice Settings (placeholder) */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <Volume2 className="h-4 w-4" />
                  Voice
                </label>
                <select
                  value={localPrefs.voiceId}
                  onChange={(e) =>
                    setLocalPrefs({ ...localPrefs, voiceId: e.target.value })
                  }
                  className="w-full rounded-lg bg-gray-800 px-4 py-3 text-gray-200 outline-none focus:ring-2 focus:ring-yellow-400"
                >
                  <option value="default">Default (Rachel)</option>
                  <option value="male_1">Male Voice 1</option>
                  <option value="male_2">Male Voice 2</option>
                  <option value="female_1">Female Voice 1</option>
                  <option value="female_2">Female Voice 2</option>
                </select>
              </div>
            </div>

            {/* Save Button */}
            <div className="mt-8">
              <button
                onClick={handleSave}
                className="w-full rounded-xl bg-yellow-400 py-4 text-lg font-bold text-black transition-colors hover:bg-yellow-300"
              >
                Save Settings
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
