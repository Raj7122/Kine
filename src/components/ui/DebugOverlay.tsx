'use client';

import { useMemo } from 'react';
import type { TranslationState, TranslationResult } from '@/hooks/useSigningModeTranslation';
import type { GestureResult } from '@/lib/mediapipe';
import type { LSTMPrediction } from '@/lib/lstm';

interface DebugOverlayProps {
  // Translation state
  state: TranslationState;
  silenceProgress: number;
  translation: TranslationResult | null;

  // Gesture state
  currentGesture: GestureResult | null;

  // LSTM state
  lstmPrediction: LSTMPrediction | null;
  lstmEnabled: boolean;
  isDynamicModeActive: boolean;

  // Buffer stats
  landmarkBufferSize: number;
  videoFrameBufferSize: number;

  // Toggle visibility
  isVisible?: boolean;
}

/**
 * Debug overlay showing real-time recognition state
 * Helps users understand what's happening in the pipeline
 */
export function DebugOverlay({
  state,
  silenceProgress,
  translation,
  currentGesture,
  lstmPrediction,
  lstmEnabled,
  isDynamicModeActive,
  landmarkBufferSize,
  videoFrameBufferSize,
  isVisible = true,
}: DebugOverlayProps) {
  const stateConfig = useMemo(() => {
    switch (state) {
      case 'idle':
        return { label: 'Waiting for hands', color: 'bg-gray-500', icon: '👋' };
      case 'signing':
        return { label: 'Recording sign', color: 'bg-green-500', icon: '🎥' };
      case 'pause_detected':
        return { label: 'Pause detected', color: 'bg-yellow-500', icon: '⏸️' };
      case 'processing':
        return { label: 'Analyzing...', color: 'bg-blue-500', icon: '🤖' };
      case 'complete':
        return { label: 'Complete', color: 'bg-purple-500', icon: '✅' };
      default:
        return { label: 'Unknown', color: 'bg-gray-500', icon: '❓' };
    }
  }, [state]);

  if (!isVisible) return null;

  return (
    <div className="absolute top-16 left-4 right-4 z-30 pointer-events-none">
      {/* Main status card */}
      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-3 text-white text-sm max-w-sm">
        {/* State indicator with recording pulse */}
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-3 h-3 rounded-full ${stateConfig.color} ${state === 'signing' ? 'animate-pulse' : ''}`} />
          <span className="font-semibold">{stateConfig.icon} {stateConfig.label}</span>
          {state === 'signing' && (
            <span className="text-red-400 text-xs animate-pulse ml-auto">● REC</span>
          )}
        </div>

        {/* Silence/pause progress bar */}
        {(state === 'pause_detected' || state === 'signing') && (
          <div className="mb-2">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>{landmarkBufferSize > 0 && silenceProgress > 0 ? 'Processing...' : 'Stillness'}</span>
              <span>{Math.round(silenceProgress * 100)}%</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${
                  silenceProgress > 0.7 ? 'bg-yellow-400' : 'bg-green-400'
                }`}
                style={{ width: `${silenceProgress * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {state === 'pause_detected'
                ? silenceProgress >= 1
                  ? 'Triggering translation...'
                  : 'Keep still or put hands down to translate'
                : 'Sign your phrase, then pause or lower hands'}
            </p>
          </div>
        )}

        {/* Buffer stats */}
        <div className="flex gap-4 text-xs text-gray-400 mb-2">
          <div className="flex items-center gap-1">
            <span>📊</span>
            <span>Landmarks: {landmarkBufferSize}</span>
          </div>
          <div className="flex items-center gap-1">
            <span>🖼️</span>
            <span>Frames: {videoFrameBufferSize}</span>
          </div>
        </div>

        {/* Current gesture (MediaPipe fast recognition) */}
        {currentGesture && currentGesture.gesture !== 'None' && (
          <div className="bg-green-500/20 border border-green-500/40 rounded px-2 py-1 mb-2">
            <span className="text-green-400 text-xs">
              ⚡ MediaPipe: {currentGesture.aslMeaning} ({Math.round(currentGesture.confidence * 100)}%)
            </span>
          </div>
        )}

        {/* LSTM prediction */}
        {lstmEnabled && lstmPrediction && (
          <div className="bg-blue-500/20 border border-blue-500/40 rounded px-2 py-1 mb-2">
            <span className="text-blue-400 text-xs">
              🧠 LSTM: {lstmPrediction.class} ({Math.round(lstmPrediction.confidence * 100)}%)
            </span>
          </div>
        )}

        {/* Dynamic mode indicator */}
        {isDynamicModeActive && (
          <div className="bg-purple-500/20 border border-purple-500/40 rounded px-2 py-1 mb-2">
            <span className="text-purple-400 text-xs">
              🔄 Dynamic sign mode (extended threshold)
            </span>
          </div>
        )}

        {/* Last translation result */}
        {translation && state === 'complete' && (
          <div className="border-t border-gray-700 pt-2 mt-2">
            <div className="text-xs text-gray-400 mb-1">Last recognition:</div>
            <div className="text-yellow-400 font-medium">{translation.input}</div>
            <div className="text-xs text-gray-500 mt-1">
              Source: {translation.source}
              {translation.lstmHint && ' (with LSTM hint)'}
            </div>
          </div>
        )}

        {/* Processing indicator */}
        {state === 'processing' && (
          <div className="flex items-center gap-2 text-blue-400">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Sending to AI for analysis...</span>
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="mt-2 text-xs text-gray-500 bg-black/60 rounded px-2 py-1 max-w-sm">
        💡 Sign clearly, then pause with hands still to trigger translation
      </div>
    </div>
  );
}
