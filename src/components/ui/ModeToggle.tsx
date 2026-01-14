'use client';

import { motion } from 'framer-motion';
import { Mic, Hand } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export function ModeToggle() {
  const { mode, toggleMode, isProcessing } = useAppStore();

  const Icon = mode === 'SIGNING' ? Mic : Hand;
  const label = mode === 'SIGNING' ? 'Switch to Listening' : 'Switch to Signing';

  return (
    <motion.button
      onClick={toggleMode}
      disabled={isProcessing}
      className="relative flex h-20 w-20 items-center justify-center rounded-full bg-yellow-400 text-black shadow-lg transition-colors hover:bg-yellow-300 focus:outline-none focus:ring-4 focus:ring-yellow-400/50 disabled:opacity-50"
      whileTap={{ scale: 0.95 }}
      whileHover={{ scale: 1.05 }}
      aria-label={label}
    >
      <Icon className="h-10 w-10" strokeWidth={2.5} />

      {/* Processing indicator ring */}
      {isProcessing && (
        <motion.div
          className="absolute inset-0 rounded-full border-4 border-yellow-400"
          animate={{ scale: [1, 1.2, 1], opacity: [1, 0.5, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
    </motion.button>
  );
}
