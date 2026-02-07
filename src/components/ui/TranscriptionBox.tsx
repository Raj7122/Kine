'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/useAppStore';
import { FeedbackButtons } from '@/components/feedback';
import type { TranslationState } from '@/hooks/useSigningModeTranslation';

interface TranscriptionBoxProps {
  translationState?: TranslationState;
  translationError?: string | null;
  translationRetryAfterUntil?: number | null;
  translationId?: string | null;
}

export function TranscriptionBox({
  translationState = 'idle',
  translationError = null,
  translationRetryAfterUntil = null,
  translationId = null,
}: TranscriptionBoxProps) {
  const { lastTranslation, isProcessing, sessionId } = useAppStore();

  const [dismissedTranslationId, setDismissedTranslationId] = useState<string | null>(null);
  const [retryCountdown, setRetryCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!translationRetryAfterUntil) {
      const timeout = setTimeout(() => setRetryCountdown(null), 0);
      return () => clearTimeout(timeout);
    }

    const updateCountdown = () => {
      const remainingMs = translationRetryAfterUntil - Date.now();
      if (remainingMs <= 0) {
        setRetryCountdown(null);
        return;
      }
      setRetryCountdown(Math.ceil(remainingMs / 1000));
    };

    const timeout = setTimeout(updateCountdown, 0);
    const interval = setInterval(updateCountdown, 1000);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [translationRetryAfterUntil]);

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
      case 'error':
        return translationError || 'Recognition failed. Try again.';
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
              className={`text-lg font-medium ${
                translationState === 'error' ? 'text-red-400' : 'text-yellow-400'
              }`}
            >
              {getMessage()}
            </motion.p>
          )}
        </AnimatePresence>

        {translationState === 'error' && retryCountdown !== null && (
          <p className="mt-2 text-sm text-red-300">
            Retry available in {retryCountdown}s
          </p>
        )}

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
