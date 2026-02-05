'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { FeedbackButtons } from '@/components/feedback';
import type { TranslationState } from '@/hooks/useTranslation';

interface TranscriptionBoxProps {
  translationState?: TranslationState;
  translationId?: string | null;
}

export function TranscriptionBox({ translationState = 'idle', translationId = null }: TranscriptionBoxProps) {
  const { lastTranslation, isProcessing, sessionId } = useAppStore();

  const [dismissedTranslationId, setDismissedTranslationId] = useState<string | null>(null);

  const showSpinner = translationState === 'processing' || isProcessing;

  const showFeedback = Boolean(
    lastTranslation &&
      translationId &&
      dismissedTranslationId !== translationId &&
      !showSpinner &&
      translationState !== 'pause_detected'
  );

  // Get message based on translation state
  const getMessage = (): string => {
    // If feedback is visible, keep showing the translation
    if (showFeedback && lastTranslation) {
      return lastTranslation.text;
    }
    
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
        return lastTranslation?.text || 'Translation complete!';
      default:
        return 'Start signing to see translation...';
    }
  };

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

        {/* Feedback Buttons - Show after translation complete */}
        <AnimatePresence>
          {showFeedback && lastTranslation && translationId && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 border-t border-gray-700 pt-3"
            >
              <FeedbackButtons
                key={translationId}
                recognition={lastTranslation}
                sessionId={sessionId}
                translationId={translationId}
                onFeedbackSubmitted={() => {
                  const translationIdToDismiss = translationId;
                  setTimeout(() => setDismissedTranslationId(translationIdToDismiss), 2000);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
