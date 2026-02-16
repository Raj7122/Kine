import { describe, expect, it } from 'vitest';
import { LSTM_SHORTCIRCUIT_THRESHOLD } from '@/config/constants';
import type { LSTMPrediction } from '@/lib/lstm/types';
import { getLSTMShortCircuitPrediction } from './useSigningModeTranslation';

function makePrediction(
  signClass: LSTMPrediction['class'],
  confidence: number
): LSTMPrediction {
  return {
    class: signClass,
    confidence,
    timestamp: Date.now(),
    windowStart: Date.now() - 100,
    windowEnd: Date.now(),
  };
}

describe('getLSTMShortCircuitPrediction', () => {
  it('returns null when prediction is missing', () => {
    expect(getLSTMShortCircuitPrediction(null)).toBeNull();
  });

  it('returns null when confidence is below threshold', () => {
    const prediction = makePrediction('HELLO', LSTM_SHORTCIRCUIT_THRESHOLD - 0.01);
    expect(getLSTMShortCircuitPrediction(prediction)).toBeNull();
  });

  it('returns normalized output when confidence meets threshold', () => {
    const prediction = makePrediction('THANK_YOU', LSTM_SHORTCIRCUIT_THRESHOLD);
    const result = getLSTMShortCircuitPrediction(prediction);

    expect(result).toEqual({
      text: 'THANK YOU',
      originalText: 'THANK_YOU',
      confidence: LSTM_SHORTCIRCUIT_THRESHOLD,
    });
  });

  it('supports custom threshold override', () => {
    const prediction = makePrediction('HELP', 0.8);

    expect(getLSTMShortCircuitPrediction(prediction, 0.85)).toBeNull();
    expect(getLSTMShortCircuitPrediction(prediction, 0.75)).toEqual({
      text: 'HELP',
      originalText: 'HELP',
      confidence: 0.8,
    });
  });
});
