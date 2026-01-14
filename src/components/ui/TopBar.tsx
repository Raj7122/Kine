'use client';

import { History, Settings } from 'lucide-react';
import { motion } from 'framer-motion';

interface TopBarProps {
  onHistoryClick?: () => void;
  onSettingsClick?: () => void;
}

export function TopBar({ onHistoryClick, onSettingsClick }: TopBarProps) {
  return (
    <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between p-4">
      <motion.button
        onClick={onHistoryClick}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-yellow-400 backdrop-blur-sm transition-colors hover:bg-black/70"
        whileTap={{ scale: 0.95 }}
        aria-label="View history"
      >
        <History className="h-6 w-6" />
      </motion.button>

      <motion.button
        onClick={onSettingsClick}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 text-yellow-400 backdrop-blur-sm transition-colors hover:bg-black/70"
        whileTap={{ scale: 0.95 }}
        aria-label="Open settings"
      >
        <Settings className="h-6 w-6" />
      </motion.button>
    </div>
  );
}
