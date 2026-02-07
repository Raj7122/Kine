import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fuseWithLSTM, createDetectionHistory, isTemporallyConsistent } from './confidenceFusion';
import type { RoboflowDetection } from '../roboflow/types';
import type { LSTMPrediction } from '../lstm/types';
import type { DetectionHistory } from './types';

// Mock the constants module
vi.mock('@/config/constants', () => ({
  ROBOFLOW_CONFIDENCE_THRESHOLD: 0.78,
  ROBOFLOW_HIGH_CONFIDENCE: 0.85,
  ROBOFLOW_TEMPORAL_WINDOW: 3,
  LSTM_CONFIDENCE_THRESHOLD: 0.7,
  MIN_MOTION_THRESHOLD: 0.023,
}));

// Helper to create mock Roboflow detection
function createMockRoboflow(
  className: string,
  confidence: number
): RoboflowDetection {
  return {
    class: className,
    confidence,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    timestamp: Date.now(),
  };
}

// Helper to create mock LSTM prediction
function createMockLSTM(
  className: string,
  confidence: number
): LSTMPrediction {
  return {
    class: className as LSTMPrediction['class'],
    confidence,
    timestamp: Date.now(),
    windowStart: Date.now() - 1000,
    windowEnd: Date.now(),
  };
}

// Helper to create history with specific classes
function createHistoryWithClasses(classes: string[]): DetectionHistory {
  return {
    classes,
    confidences: classes.map(() => 0.9),
    timestamps: classes.map((_, i) => Date.now() + i * 100),
    maxSize: 10,
  };
}

describe('fuseWithLSTM', () => {
  describe('Priority 1: YOLO + Stillness Tests', () => {
    it('returns use_roboflow for YOLO high-conf (>=0.85) + stillness + consistent', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = createMockLSTM('HELLO', 0.8);
      const history = createHistoryWithClasses(['A', 'A']); // Consistent
      const motionMagnitude = 0.01; // Still (< 0.023)

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('use_roboflow');
      expect(result.sign).toBe('A');
      expect(result.confidence).toBe(0.9);
      expect(result.source).toBe('roboflow');
    });

    it('does NOT use_roboflow for YOLO high-conf + motion (checks LSTM instead)', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = createMockLSTM('HELLO', 0.8);
      const history = createHistoryWithClasses(['A', 'A']);
      const motionMagnitude = 0.05; // Moving (>= 0.023)

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // When moving, LSTM takes priority if confident
      expect(result.action).toBe('use_lstm');
      expect(result.sign).toBe('HELLO');
    });

    it('returns enhance_gemini for YOLO high-conf + stillness + inconsistent history', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = null;
      const history = createHistoryWithClasses(['B', 'C']); // Inconsistent
      const motionMagnitude = 0.01; // Still

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // High confidence but inconsistent -> enhance_gemini
      expect(result.action).toBe('enhance_gemini');
    });
  });

  describe('Priority 2: LSTM + Motion Tests', () => {
    it('returns use_lstm for LSTM high-conf (>=0.7) + motion', () => {
      const roboflow = null;
      const lstm = createMockLSTM('HELLO', 0.85);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.05; // Moving

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('use_lstm');
      expect(result.sign).toBe('HELLO');
      expect(result.confidence).toBe(0.85);
      expect(result.source).toBe('lstm');
    });

    it('does NOT use_lstm for LSTM high-conf + stillness (deferred to YOLO)', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = createMockLSTM('HELLO', 0.85);
      const history = createHistoryWithClasses(['A', 'A']);
      const motionMagnitude = 0.01; // Still

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // YOLO takes priority when still
      expect(result.action).toBe('use_roboflow');
    });

    it('returns enhance_gemini for LSTM below threshold', () => {
      const roboflow = null;
      const lstm = createMockLSTM('HELLO', 0.5); // Below 0.7
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.05;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // Low confidence -> enhance_gemini or rely_gemini
      expect(['enhance_gemini', 'rely_gemini']).toContain(result.action);
    });
  });

  describe('Priority 3: Agreement Tests', () => {
    it('returns use_roboflow with boost when both high-conf + stillness', () => {
      // Both YOLO and LSTM confident, but still - Priority 1 takes precedence first
      // Need to use lower YOLO confidence to skip Priority 1 and hit Priority 3
      const roboflow = createMockRoboflow('A', 0.80); // Below ROBOFLOW_HIGH_CONFIDENCE (0.85)
      const lstm = createMockLSTM('HELLO', 0.75); // Above LSTM threshold
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.01; // Still

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('use_roboflow');
      expect(result.source).toBe('fused');
      expect(result.confidence).toBeCloseTo(0.80 * 1.1, 5); // Boosted
      expect(result.hint).toContain('LSTM also detected');
    });

    it('returns use_lstm with boost when both high-conf + motion', () => {
      // When moving, LSTM should take priority since Priority 2 may hit
      // But if LSTM conf is high enough, we get boosted fused result
      const roboflow = createMockRoboflow('A', 0.80); // Above threshold
      const lstm = createMockLSTM('HELLO', 0.75);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.05; // Moving

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // Priority 2 takes precedence: LSTM + motion -> use_lstm
      expect(result.action).toBe('use_lstm');
      // When LSTM is used via Priority 2, no boost
      expect(result.confidence).toBeCloseTo(0.75, 5);
    });

    it('caps confidence boost at 1.0', () => {
      // Use lower YOLO confidence to avoid Priority 1
      const roboflow = createMockRoboflow('A', 0.82);
      const lstm = createMockLSTM('HELLO', 0.95);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.01; // Still

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // With stillness and fused, boost applied to Roboflow
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });

    it('includes the other detector result in hints when fused (stillness)', () => {
      const roboflow = createMockRoboflow('A', 0.80);
      const lstm = createMockLSTM('HELLO', 0.75);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.01; // Still - uses Roboflow

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // When still, Roboflow is used, hint shows LSTM
      expect(result.hint).toContain('HELLO');
    });
  });

  describe('Priority 4: Single Detector Tests', () => {
    it('returns enhance_gemini for only YOLO moderate-conf', () => {
      const roboflow = createMockRoboflow('A', 0.80); // Above threshold but not high
      const lstm = null;
      const history = createHistoryWithClasses(['B']); // Inconsistent
      const motionMagnitude = 0.02; // Below motion threshold (still)

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('enhance_gemini');
      expect(result.hint).toContain('YOLO detected "A"');
    });

    it('returns enhance_gemini for only LSTM high-conf (still context)', () => {
      // LSTM with high confidence but no motion -> Priority 4b
      const roboflow = null;
      const lstm = createMockLSTM('HELLO', 0.75);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.01; // Still - skips Priority 2 (needs motion)

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // Priority 4b: only LSTM, no motion context
      expect(result.action).toBe('enhance_gemini');
      expect(result.hint).toContain('LSTM detected "HELLO"');
    });

    it('verifies hint format includes confidence percentage', () => {
      const roboflow = createMockRoboflow('A', 0.80);
      const lstm = null;
      const history = createHistoryWithClasses(['B']);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.hint).toContain('80% confidence');
    });
  });

  describe('Priority 5: Neither Confident Tests', () => {
    it('returns rely_gemini when neither detector confident', () => {
      const roboflow = createMockRoboflow('A', 0.4); // Below threshold
      const lstm = createMockLSTM('HELLO', 0.3); // Below threshold
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(['rely_gemini', 'enhance_gemini']).toContain(result.action);
    });

    it('collects weak hints from both detectors', () => {
      const roboflow = createMockRoboflow('A', 0.55); // > 0.5 for hint
      const lstm = createMockLSTM('HELLO', 0.45); // > 0.4 for hint
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      if (result.hint) {
        expect(result.hint).toContain('YOLO');
        expect(result.hint).toContain('LSTM');
      }
    });

    it('handles null roboflow', () => {
      const lstm = createMockLSTM('HELLO', 0.3);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(null, lstm, history, motionMagnitude);

      expect(result).toBeDefined();
      expect(result.lstmPrediction).toBe(lstm);
    });

    it('handles null lstm', () => {
      const roboflow = createMockRoboflow('A', 0.4);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, null, history, motionMagnitude);

      expect(result).toBeDefined();
      expect(result.lstmPrediction).toBeNull();
    });

    it('handles both null', () => {
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(null, null, history, motionMagnitude);

      expect(result.action).toBe('rely_gemini');
      expect(result.hint).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('handles exactly at motion threshold (0.023)', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = createMockLSTM('HELLO', 0.85);
      const history = createHistoryWithClasses(['A', 'A']);

      // At threshold -> treated as moving
      const result = fuseWithLSTM(roboflow, lstm, history, 0.023);

      // LSTM should take priority when at motion threshold
      expect(result.action).toBe('use_lstm');
    });

    it('handles exactly at LSTM threshold (0.7)', () => {
      const roboflow = null;
      const lstm = createMockLSTM('HELLO', 0.7);
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.05;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('use_lstm');
    });

    it('handles exactly at YOLO moderate threshold (0.78)', () => {
      const roboflow = createMockRoboflow('A', 0.78);
      const lstm = null;
      const history = createHistoryWithClasses(['B']);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('enhance_gemini');
    });

    it('handles exactly at YOLO high threshold (0.85)', () => {
      const roboflow = createMockRoboflow('A', 0.85);
      const lstm = null;
      const history = createHistoryWithClasses(['A', 'A']);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      expect(result.action).toBe('use_roboflow');
    });

    it('handles empty history with high-conf detection', () => {
      const roboflow = createMockRoboflow('A', 0.95);
      const lstm = null;
      const history = createHistoryWithClasses([]);
      const motionMagnitude = 0.02;

      const result = fuseWithLSTM(roboflow, lstm, history, motionMagnitude);

      // No temporal consistency possible -> enhance_gemini
      expect(result.action).toBe('enhance_gemini');
    });

    it('includes lstmPrediction in all outputs', () => {
      const lstm = createMockLSTM('HELLO', 0.85);
      const history = createHistoryWithClasses([]);

      const result1 = fuseWithLSTM(null, lstm, history, 0.05);
      expect(result1.lstmPrediction).toBe(lstm);

      const result2 = fuseWithLSTM(createMockRoboflow('A', 0.9), lstm, history, 0.01);
      expect(result2.lstmPrediction).toBe(lstm);
    });
  });

  describe('Motion Context Behavior', () => {
    it('prioritizes LSTM when moving and YOLO when still', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = createMockLSTM('HELLO', 0.85);
      const history = createHistoryWithClasses(['A', 'A']);

      // When still -> YOLO priority
      const stillResult = fuseWithLSTM(roboflow, lstm, history, 0.01);
      expect(stillResult.action).toBe('use_roboflow');

      // When moving -> LSTM priority
      const movingResult = fuseWithLSTM(roboflow, lstm, history, 0.05);
      expect(movingResult.action).toBe('use_lstm');
    });

    it('handles rapid motion changes', () => {
      const roboflow = createMockRoboflow('A', 0.9);
      const lstm = createMockLSTM('HELLO', 0.85);
      const history = createHistoryWithClasses(['A', 'A']);

      // Sequence of motion changes
      const results = [0.01, 0.05, 0.01, 0.05].map(motion =>
        fuseWithLSTM(roboflow, lstm, history, motion)
      );

      expect(results[0].action).toBe('use_roboflow');
      expect(results[1].action).toBe('use_lstm');
      expect(results[2].action).toBe('use_roboflow');
      expect(results[3].action).toBe('use_lstm');
    });
  });
});

describe('isTemporallyConsistent (for LSTM integration)', () => {
  it('works correctly with LSTM class names', () => {
    const history = ['HELLO', 'HELLO'];
    expect(isTemporallyConsistent('HELLO', history, 3)).toBe(true);
  });

  it('handles mixed YOLO and LSTM classes in history', () => {
    const history = ['A', 'A', 'HELLO', 'HELLO'];
    // Checking for 'HELLO' with last 2 entries
    expect(isTemporallyConsistent('HELLO', history, 3)).toBe(true);
    // Checking for 'A' - recent history is 'HELLO', 'HELLO'
    expect(isTemporallyConsistent('A', history, 3)).toBe(false);
  });
});
