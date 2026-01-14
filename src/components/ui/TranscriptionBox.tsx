'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import type { TranslationState } from '@/hooks/useTranslation';

interface TranscriptionBoxProps {
  translationState?: TranslationState;
}

export function TranscriptionBox({ translationState = 'idle' }: TranscriptionBoxProps) {
  const { lastTranslation, isProcessing } = useAppStore();

  // Get message based on translation state
  const getMessage = (): string => {
    switch (translationState) {
      case 'idle':
        return 'Show your hands to start...';
      case 'signing':
        return 'Detecting signs...';
      case 'pause_detected':
        return 'Hold still to translate...';
      case 'processing':
        return 'Processing...';
      case 'complete':
        return lastTranslation || 'Translation complete!';
      default:
        return 'Start signing to see translation...';
    }
  };

  const showSpinner = translationState === 'processing' || isProcessing;

  return (
    <div className="w-full max-w-md px-4">
      <motion.div
        className="rounded-lg bg-black/80 px-4 py-3 backdrop-blur-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <AnimatePresence mode="wait">
          {showSpinner ? (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="h-2 w-2 rounded-full bg-yellow-400"
                    animate={{ y: [0, -8, 0] }}
                    transition={{
                      duration: 0.6,
                      repeat: Infinity,
                      delay: i * 0.15,
                    }}
                  />
                ))}
              </div>
              <span className="text-lg font-medium text-yellow-400">
                Processing...
              </span>
            </motion.div>
          ) : (
            <motion.p
              key={translationState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-lg font-medium text-yellow-400"
            >
              {getMessage()}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
