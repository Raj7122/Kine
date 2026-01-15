'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MessageSquare, ArrowRight, Trash2, Clock } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { MessageRow, SessionRow } from '@/lib/supabase/types';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface HistoryEntry {
  id: string;
  direction: 'sign_to_audio' | 'audio_to_sign';
  originalText: string | null;
  translatedText: string | null;
  glossSequence: string[] | null;
  createdAt: string;
}

// Mock history data for when Supabase is not configured
const mockHistory: HistoryEntry[] = [
  {
    id: '1',
    direction: 'sign_to_audio',
    originalText: null,
    translatedText: 'Hello, how are you today?',
    glossSequence: ['HELLO', 'HOW', 'YOU', 'TODAY'],
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: '2',
    direction: 'audio_to_sign',
    originalText: 'I would like some coffee please',
    translatedText: null,
    glossSequence: ['I', 'WANT', 'COFFEE', 'PLEASE'],
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: '3',
    direction: 'sign_to_audio',
    originalText: null,
    translatedText: 'Thank you very much!',
    glossSequence: ['THANK-YOU', 'VERY-MUCH'],
    createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
];

export function HistoryModal({ isOpen, onClose }: HistoryModalProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const loadHistory = async () => {
    setIsLoading(true);
    setError(null);

    if (!isSupabaseConfigured || !supabase) {
      // Use mock data
      setHistory(mockHistory);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;

      const entries: HistoryEntry[] = (data as MessageRow[]).map((msg) => ({
        id: msg.id,
        direction: msg.direction,
        originalText: msg.original_text,
        translatedText: msg.translated_text,
        glossSequence: msg.gloss_sequence,
        createdAt: msg.created_at,
      }));

      setHistory(entries);
    } catch (err) {
      console.error('[HistoryModal] Failed to load history:', err);
      setError('Failed to load history');
      setHistory(mockHistory);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm('Are you sure you want to clear all history?')) return;

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('messages').delete().neq('id', '');
      } catch (err) {
        console.error('[HistoryModal] Failed to clear history:', err);
      }
    }

    setHistory([]);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

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
            className="fixed inset-x-4 bottom-4 top-auto z-50 max-h-[80vh] overflow-hidden rounded-2xl bg-gray-900 shadow-2xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-800 p-4">
              <h2 className="text-xl font-bold text-yellow-400">History</h2>
              <div className="flex items-center gap-2">
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400"
                    aria-label="Clear history"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
                  aria-label="Close history"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent" />
                </div>
              ) : error ? (
                <div className="py-8 text-center text-gray-400">{error}</div>
              ) : history.length === 0 ? (
                <div className="py-12 text-center">
                  <MessageSquare className="mx-auto mb-4 h-12 w-12 text-gray-600" />
                  <p className="text-gray-400">No translation history yet</p>
                  <p className="mt-2 text-sm text-gray-500">
                    Start signing or speaking to see your translations here
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {history.map((entry) => (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-xl bg-gray-800 p-4"
                    >
                      {/* Direction indicator */}
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              entry.direction === 'sign_to_audio'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-green-500/20 text-green-400'
                            }`}
                          >
                            {entry.direction === 'sign_to_audio'
                              ? 'Sign → Audio'
                              : 'Audio → Sign'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock className="h-3 w-3" />
                          {formatTime(entry.createdAt)}
                        </div>
                      </div>

                      {/* Translation content */}
                      <div className="space-y-2">
                        {entry.originalText && (
                          <p className="text-sm text-gray-400">
                            {entry.originalText}
                          </p>
                        )}

                        {entry.translatedText && (
                          <p className="text-lg font-medium text-yellow-400">
                            {entry.translatedText}
                          </p>
                        )}

                        {entry.glossSequence && entry.glossSequence.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {entry.glossSequence.map((gloss, idx) => (
                              <span
                                key={idx}
                                className="rounded bg-gray-700 px-2 py-0.5 text-xs text-gray-300"
                              >
                                {gloss}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
