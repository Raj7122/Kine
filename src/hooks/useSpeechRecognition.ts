'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { translateToGloss, isGeminiConfigured } from '@/lib/gemini';
import { saveMessage, generateSessionId } from '@/lib/supabase';
import { USE_MOCK_DATA } from '@/config/constants';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export type SpeechState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'complete'
  | 'error'
  | 'not_supported';

export interface SpeechTranslationResult {
  id: string;
  spokenText: string;
  gloss: string[];
  source: 'gemini' | 'mock';
}

export interface UseSpeechRecognitionReturn {
  state: SpeechState;
  isListening: boolean;
  interimTranscript: string;
  finalTranscript: string;
  translation: SpeechTranslationResult | null;
  startListening: () => void;
  stopListening: () => void;
  reset: () => void;
}

// Session ID for message tracking
let sessionId: string | null = null;

/**
 * Hook for speech recognition and translation to ASL gloss
 * Part of "The Gemini Sandwich" - LISTENING_MODE flow
 */
export function useSpeechRecognition(
  onTranslationComplete?: (result: SpeechTranslationResult) => void
): UseSpeechRecognitionReturn {
  const [state, setState] = useState<SpeechState>('idle');
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [translation, setTranslation] = useState<SpeechTranslationResult | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isProcessingRef = useRef(false);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize session ID
  if (!sessionId) {
    sessionId = generateSessionId();
  }

  // Check if speech recognition is supported
  const isSupported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Initialize speech recognition
  useEffect(() => {
    if (!isSupported) {
      setState('not_supported');
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionAPI();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      console.log('[Speech] Recognition started');
      setIsListening(true);
      setState('listening');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setInterimTranscript(interim);
      }

      if (final) {
        setFinalTranscript((prev) => prev + final);
        setInterimTranscript('');

        // Reset silence timeout when we get final text
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }

        // Auto-translate after 2 seconds of silence
        silenceTimeoutRef.current = setTimeout(() => {
          console.log('[Speech] Silence detected, triggering translation');
          triggerTranslation(finalTranscript + final);
        }, 2000);
      }
    };

    recognition.onerror = (event) => {
      console.error('[Speech] Recognition error:', event);
      setState('error');
      setIsListening(false);
    };

    recognition.onend = () => {
      console.log('[Speech] Recognition ended');
      setIsListening(false);
      if (state === 'listening') {
        setState('idle');
      }
    };

    recognitionRef.current = recognition;

    return () => {
      if (recognition) {
        recognition.abort();
      }
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, [isSupported]);

  // Trigger translation with Gemini
  const triggerTranslation = useCallback(async (text: string) => {
    if (isProcessingRef.current || !text.trim()) return;

    isProcessingRef.current = true;
    setState('processing');

    // Stop listening while processing
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    try {
      let result: SpeechTranslationResult;

      // Use Gemini API if configured
      if (!USE_MOCK_DATA && isGeminiConfigured) {
        console.log('[Speech] Translating with Gemini (The Linguist):', text);
        const geminiResult = await translateToGloss(text);

        result = {
          id: crypto.randomUUID(),
          spokenText: text,
          gloss: geminiResult.gloss,
          source: geminiResult.source,
        };
      } else {
        // Mock translation
        console.log('[Speech] Using mock translation');
        const mockGloss = text
          .toUpperCase()
          .split(' ')
          .filter((word) => word.length > 2)
          .slice(0, 5);

        result = {
          id: crypto.randomUUID(),
          spokenText: text,
          gloss: mockGloss.length > 0 ? mockGloss : ['HELLO'],
          source: 'mock',
        };
      }

      console.log('[Speech] Translation result:', result.gloss);
      setTranslation(result);
      setState('complete');

      // Save to database (non-blocking)
      if (sessionId) {
        saveMessage({
          session_id: sessionId,
          direction: 'audio_to_sign',
          original_text: text,
          translated_text: result.gloss.join(' '),
          gloss_sequence: result.gloss,
        }).catch((err) => console.warn('[Speech] Failed to save message:', err));
      }

      if (onTranslationComplete) {
        onTranslationComplete(result);
      }
    } catch (error) {
      console.error('[Speech] Translation error:', error);
      setState('error');
    } finally {
      isProcessingRef.current = false;
    }
  }, [onTranslationComplete]);

  // Start listening
  const startListening = useCallback(() => {
    if (!isSupported) {
      setState('not_supported');
      return;
    }

    if (recognitionRef.current && !isListening) {
      setFinalTranscript('');
      setInterimTranscript('');
      setTranslation(null);
      recognitionRef.current.start();
    }
  }, [isSupported, isListening]);

  // Stop listening
  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop();

      // If we have text, translate it
      if (finalTranscript.trim()) {
        triggerTranslation(finalTranscript);
      }
    }

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
  }, [isListening, finalTranscript, triggerTranslation]);

  // Reset state
  const reset = useCallback(() => {
    setState('idle');
    setIsListening(false);
    setInterimTranscript('');
    setFinalTranscript('');
    setTranslation(null);
    isProcessingRef.current = false;

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
  }, []);

  return {
    state,
    isListening,
    interimTranscript,
    finalTranscript,
    translation,
    startListening,
    stopListening,
    reset,
  };
}
