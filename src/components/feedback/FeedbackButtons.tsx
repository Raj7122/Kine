'use client';

import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ThumbsUp, ThumbsDown, Check, Loader2 } from 'lucide-react';
import type { SignRecognizeResult } from '@/lib/sign-recognition/types';

const AMBIGUOUS_CORRECTION_SUGGESTIONS: Record<
  string,
  Array<{ value: string; label: string }>
> = {
  V: [
    { value: 'SEE', label: 'See' },
    { value: 'TWICE', label: 'Twice' },
  ],
};

interface FeedbackButtonsProps {
  recognition: SignRecognizeResult;
  sessionId: string;
  translationId?: string | null;
  landmarkData?: object;
  onFeedbackSubmitted?: (rating: 'positive' | 'negative') => void;
  className?: string;
}

export function FeedbackButtons({
  recognition,
  sessionId,
  translationId = null,
  landmarkData,
  onFeedbackSubmitted,
  className = '',
}: FeedbackButtonsProps) {
  const shownAtRef = useRef<number>(Date.now());
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);
  const [correctionInput, setCorrectionInput] = useState('');
  const [corrections, setCorrections] = useState<string[]>([]);
  const [primaryCorrection, setPrimaryCorrection] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<'positive' | 'negative' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const ambiguityKey = recognition.originalText.trim().toUpperCase();
  const ambiguousSuggestions = AMBIGUOUS_CORRECTION_SUGGESTIONS[ambiguityKey] ?? [];

  const normalizeCorrection = (value: string) => value.trim().toUpperCase();

  const addCorrection = (value: string) => {
    const normalized = normalizeCorrection(value);
    if (!normalized) return;
    setCorrections((prev) => {
      if (prev.includes(normalized)) return prev;
      const next = [...prev, normalized];
      // First correction added becomes primary by default
      if (next.length === 1) setPrimaryCorrection(normalized);
      return next;
    });
    setCorrectionInput('');
  };

  const removeCorrection = (value: string) => {
    const normalized = normalizeCorrection(value);
    if (!normalized) return;
    setCorrections((prev) => {
      const next = prev.filter((item) => item !== normalized);
      // If removing the primary, promote the next one
      if (primaryCorrection === normalized) {
        setPrimaryCorrection(next.length > 0 ? next[0] : null);
      }
      return next;
    });
  };

  const toggleCorrection = (value: string) => {
    const normalized = normalizeCorrection(value);
    if (!normalized) return;
    setCorrections((prev) => {
      if (prev.includes(normalized)) {
        const next = prev.filter((item) => item !== normalized);
        if (primaryCorrection === normalized) {
          setPrimaryCorrection(next.length > 0 ? next[0] : null);
        }
        return next;
      }
      const next = [...prev, normalized];
      if (next.length === 1) setPrimaryCorrection(normalized);
      return next;
    });
  };

  const buildSubmitPayload = () => {
    const allCorrections = [...corrections];
    const inputNormalized = normalizeCorrection(correctionInput);
    if (inputNormalized && !allCorrections.includes(inputNormalized)) {
      allCorrections.push(inputNormalized);
    }
    if (allCorrections.length === 0) return null;

    // Determine primary: use explicit selection, or fall back to first
    const primary = primaryCorrection && allCorrections.includes(primaryCorrection)
      ? primaryCorrection
      : allCorrections[0];
    const alternates = allCorrections.filter((c) => c !== primary);

    return { primary, alternates };
  };

  const handlePositive = async () => {
    if (submitted) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    const elapsedMs = Date.now() - shownAtRef.current;
    const geminiOutput = recognition.text;
    console.log('[FeedbackUI] Submitting positive feedback', {
      sessionId,
      geminiOutput,
      originalText: recognition.originalText,
      corrected: recognition.corrected,
      elapsedMs,
    });

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          translationId: translationId ?? undefined,
          sampleId: recognition.sampleId,
          geminiOutput,
          rating: 'positive',
          landmarkData,
          confidenceScore: recognition.confidence,
          originalText: recognition.originalText,
          corrected: recognition.corrected,
          correctedText: recognition.text,
          source: recognition.source,
        }),
      });

      if (response.ok) {
        console.log('[FeedbackUI] Positive feedback stored', {
          sessionId,
          geminiOutput,
          originalText: recognition.originalText,
          corrected: recognition.corrected,
          elapsedMs,
        });
        setSubmitted('positive');
        onFeedbackSubmitted?.('positive');
      } else {
        const payload = await response.json().catch(() => null);
        console.warn('[FeedbackUI] Positive feedback failed', {
          sessionId,
          geminiOutput,
          elapsedMs,
          error: payload?.error,
        });
        setErrorMessage(payload?.error || 'Failed to submit feedback');
      }
    } catch (error) {
      console.error('[Feedback] Error submitting positive feedback:', error);
      setErrorMessage('Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNegative = () => {
    if (submitted) return;
    console.log('[FeedbackUI] Opening correction input', {
      sessionId,
      geminiOutput: recognition.text,
      originalText: recognition.originalText,
      corrected: recognition.corrected,
    });
    setShowCorrectionInput(true);
    setCorrectionInput('');
    setCorrections([]);
  };

  const submitFeedback = async (primary: string, alternates: string[]) => {
    if (submitted) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    const elapsedMs = Date.now() - shownAtRef.current;
    const geminiOutput = recognition.text;

    console.log('[FeedbackUI] Submitting negative feedback', {
      sessionId,
      geminiOutput,
      displayedText: recognition.text,
      corrected: recognition.corrected,
      primaryCorrection: primary,
      alternateCorrections: alternates,
      elapsedMs,
    });

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          translationId: translationId ?? undefined,
          sampleId: recognition.sampleId,
          geminiOutput,
          rating: 'negative',
          userCorrection: primary,
          alternateCorrections: alternates,
          landmarkData,
          confidenceScore: recognition.confidence,
          originalText: recognition.originalText,
          corrected: recognition.corrected,
          correctedText: recognition.text,
          source: recognition.source,
        }),
      });

      if (response.ok) {
        console.log('[FeedbackUI] Negative feedback stored', {
          sessionId,
          geminiOutput,
          primaryCorrection: primary,
          alternateCorrections: alternates,
          elapsedMs,
        });
        setSubmitted('negative');
        setShowCorrectionInput(false);
        setCorrections([]);
        setPrimaryCorrection(null);
        setCorrectionInput('');
        onFeedbackSubmitted?.('negative');
      } else {
        const payload = await response.json().catch(() => null);
        console.warn('[FeedbackUI] Negative feedback failed', {
          sessionId,
          geminiOutput,
          primaryCorrection: primary,
          alternateCorrections: alternates,
          elapsedMs,
          error: payload?.error,
        });
        setErrorMessage(payload?.error || 'Failed to submit correction');
      }
    } catch (error) {
      console.error('[Feedback] Error submitting correction:', error);
      setErrorMessage('Failed to submit correction');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddCorrection = () => {
    addCorrection(correctionInput);
  };

  const handleSubmitCorrections = async () => {
    const payload = buildSubmitPayload();
    if (!payload) return;
    await submitFeedback(payload.primary, payload.alternates);
  };

  const handleCancelCorrection = () => {
    console.log('[FeedbackUI] Cancel correction input', {
      sessionId,
      geminiOutput: recognition.text,
      originalText: recognition.originalText,
      corrected: recognition.corrected,
    });
    setShowCorrectionInput(false);
    setCorrectionInput('');
    setCorrections([]);
    setPrimaryCorrection(null);
  };

  // Already submitted - show confirmation
  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`flex items-center gap-2 ${className}`}
      >
        <Check className="h-4 w-4 text-green-400" />
        <span className="text-xs text-green-400">
          {submitted === 'positive' ? 'Thanks!' : 'Correction saved'}
        </span>
      </motion.div>
    );
  }

  return (
    <div className={`${className}`}>
      <AnimatePresence mode="wait">
        {showCorrectionInput ? (
          <motion.div
            key="correction"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col gap-2"
          >
            <p className="text-xs text-gray-400">What should it be?</p>

            {ambiguousSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {ambiguousSuggestions.map((s) => {
                  const normalized = normalizeCorrection(s.value);
                  const isSelected = corrections.includes(normalized);
                  return (
                    <button
                      key={s.value}
                      onClick={() => toggleCorrection(s.value)}
                      disabled={isSubmitting}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        isSelected
                          ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                          : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            )}

            {corrections.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-gray-500">
                  {corrections.length > 1 ? 'Click a correction to set it as primary (used for auto-correct):' : 'Primary correction:'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {corrections.map((value) => {
                    const isPrimary = value === primaryCorrection;
                    return (
                      <span
                        key={value}
                        onClick={() => setPrimaryCorrection(value)}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                          isPrimary
                            ? 'bg-yellow-400/30 text-yellow-200 ring-1 ring-yellow-400'
                            : 'bg-gray-700 text-gray-100 hover:bg-gray-600'
                        }`}
                      >
                        {isPrimary && <span title="Primary correction">&#9733;</span>}
                        {value}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeCorrection(value); }}
                          className="text-gray-300 hover:text-white"
                          aria-label={`Remove ${value}`}
                        >
                          x
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={correctionInput}
                onChange={(e) => setCorrectionInput(e.target.value)}
                placeholder="Add a correction (press Enter to add)"
                className="flex-1 rounded-md bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCorrection();
                  }
                  if (e.key === 'Escape') handleCancelCorrection();
                }}
              />
              <button
                type="button"
                onClick={handleAddCorrection}
                disabled={!correctionInput.trim() || isSubmitting}
                className="rounded-md bg-gray-700 px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600 disabled:opacity-50"
              >
                Add
              </button>
            </div>

            {errorMessage && (
              <p className="text-xs text-red-400">{errorMessage}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSubmitCorrections}
                disabled={isSubmitting || (!correctionInput.trim() && corrections.length === 0)}
                className="flex-1 rounded-md bg-yellow-400 px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-yellow-300 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                ) : (
                  'Submit'
                )}
              </button>
              <button
                onClick={handleCancelCorrection}
                className="rounded-md bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="buttons"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">Was this correct?</span>
              <button
                onClick={handlePositive}
                disabled={isSubmitting}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/20 text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-50"
                title="Correct"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ThumbsUp className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={handleNegative}
                disabled={isSubmitting}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/20 text-red-400 transition-colors hover:bg-red-500/30 disabled:opacity-50"
                title="Incorrect - provide correction"
              >
                <ThumbsDown className="h-4 w-4" />
              </button>
            </div>

            {errorMessage && (
              <p className="text-xs text-red-400">{errorMessage}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
