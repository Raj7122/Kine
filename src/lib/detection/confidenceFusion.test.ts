import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTemporallyConsistent,
  fuseDetections,
  getBestDetection,
  createDetectionHistory,
  addToHistory,
  getAverageConfidence,
  getMostCommonClass,
} from './confidenceFusion';
import { RoboflowDetection } from '../roboflow/types';
import { DetectionHistory } from './types';

// Mock the constants module
vi.mock('@/config/constants', () => ({
  ROBOFLOW_CONFIDENCE_THRESHOLD: 0.5,
  ROBOFLOW_HIGH_CONFIDENCE: 0.85,
  ROBOFLOW_TEMPORAL_WINDOW: 3,
}));

// Helper to create mock detection
function createMockDetection(
  className: string,
  confidence: number,
  timestamp: number = Date.now()
): RoboflowDetection {
  return {
    class: className,
    confidence,
    bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    timestamp,
  };
}

// Helper to create history with specific classes
function createHistoryWithClasses(
  classes: string[],
  baseConfidence: number = 0.9
): DetectionHistory {
  return {
    classes,
    confidences: classes.map(() => baseConfidence),
    timestamps: classes.map((_, i) => Date.now() + i * 100),
    maxSize: 10,
  };
}

describe('isTemporallyConsistent', () => {
  it('returns false for empty history', () => {
    expect(isTemporallyConsistent('hello', [], 3)).toBe(false);
  });

  it('returns false for partial history (not enough entries)', () => {
    expect(isTemporallyConsistent('hello', ['hello'], 3)).toBe(false);
  });

  it('returns true when history is consistent with current class', () => {
    expect(isTemporallyConsistent('hello', ['hello', 'hello'], 3)).toBe(true);
  });

  it('returns false when history is inconsistent', () => {
    expect(isTemporallyConsistent('hello', ['hello', 'world'], 3)).toBe(false);
  });

  it('only checks the most recent entries based on requiredCount', () => {
    // Last 2 are 'hello', matching current class
    expect(isTemporallyConsistent('hello', ['world', 'hello', 'hello'], 3)).toBe(true);
  });

  it('returns false when recent history differs from current', () => {
    // Last 2 are 'world' and 'hello', not consistent with 'hello'
    expect(isTemporallyConsistent('hello', ['hello', 'world', 'hello'], 3)).toBe(false);
  });

  it('handles requiredCount of 1 (only current frame matters)', () => {
    // requiredCount - 1 = 0, so we check 0 history entries
    expect(isTemporallyConsistent('hello', [], 1)).toBe(true);
  });
});

describe('fuseDetections', () => {
  describe('no detection scenarios', () => {
    it('returns rely_gemini when detection is null', () => {
      const history = createHistoryWithClasses([]);
      const result = fuseDetections(null, history);
      expect(result.action).toBe('rely_gemini');
      expect(result.hint).toBeNull();
    });

    it('returns rely_gemini when confidence is below threshold (0.5)', () => {
      const detection = createMockDetection('hello', 0.3);
      const history = createHistoryWithClasses([]);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('rely_gemini');
      expect(result.hint).toBeNull();
    });
  });

  describe('high confidence scenarios', () => {
    it('returns use_roboflow when confidence >= 0.85 and temporally consistent', () => {
      const detection = createMockDetection('hello', 0.9);
      const history = createHistoryWithClasses(['hello', 'hello']);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('use_roboflow');
      expect(result.sign).toBe('hello');
      expect(result.confidence).toBe(0.9);
    });

    it('returns enhance_gemini when confidence >= 0.85 but not temporally consistent', () => {
      const detection = createMockDetection('hello', 0.9);
      const history = createHistoryWithClasses(['world', 'world']);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('enhance_gemini');
      expect(result.hint).toContain('YOLO detected "hello"');
      expect(result.hint).toContain('90% confidence');
    });
  });

  describe('medium confidence scenarios', () => {
    it('returns enhance_gemini for confidence between 0.5 and 0.85', () => {
      const detection = createMockDetection('hello', 0.7);
      const history = createHistoryWithClasses([]);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('enhance_gemini');
      expect(result.hint).toBe('YOLO detected "hello" (70% confidence)');
      expect(result.confidence).toBe(0.7);
    });

    it('includes correct percentage in hint', () => {
      const detection = createMockDetection('thank_you', 0.65);
      const history = createHistoryWithClasses([]);
      const result = fuseDetections(detection, history);
      expect(result.hint).toBe('YOLO detected "thank_you" (65% confidence)');
    });
  });

  describe('edge cases at threshold boundaries', () => {
    it('returns rely_gemini at exactly threshold - epsilon', () => {
      const detection = createMockDetection('hello', 0.499);
      const history = createHistoryWithClasses([]);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('rely_gemini');
    });

    it('returns enhance_gemini at exactly threshold', () => {
      const detection = createMockDetection('hello', 0.5);
      const history = createHistoryWithClasses([]);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('enhance_gemini');
    });

    it('returns enhance_gemini at exactly high confidence - epsilon', () => {
      const detection = createMockDetection('hello', 0.849);
      const history = createHistoryWithClasses(['hello', 'hello']);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('enhance_gemini');
    });

    it('returns use_roboflow at exactly high confidence with consistency', () => {
      const detection = createMockDetection('hello', 0.85);
      const history = createHistoryWithClasses(['hello', 'hello']);
      const result = fuseDetections(detection, history);
      expect(result.action).toBe('use_roboflow');
    });
  });
});

describe('getBestDetection', () => {
  it('returns null for empty array', () => {
    expect(getBestDetection([])).toBeNull();
  });

  it('returns the single detection when only one exists', () => {
    const detection = createMockDetection('hello', 0.8);
    const result = getBestDetection([detection]);
    expect(result).toEqual(detection);
  });

  it('returns detection with highest confidence', () => {
    const detections = [
      createMockDetection('hello', 0.6),
      createMockDetection('world', 0.9),
      createMockDetection('thank_you', 0.7),
    ];
    const result = getBestDetection(detections);
    expect(result?.class).toBe('world');
    expect(result?.confidence).toBe(0.9);
  });

  it('returns first detection when confidences are equal', () => {
    const detections = [
      createMockDetection('hello', 0.8),
      createMockDetection('world', 0.8),
    ];
    const result = getBestDetection(detections);
    expect(result?.class).toBe('hello');
  });
});

describe('createDetectionHistory', () => {
  it('creates empty history with default size', () => {
    const history = createDetectionHistory();
    expect(history.classes).toHaveLength(0);
    expect(history.confidences).toHaveLength(0);
    expect(history.timestamps).toHaveLength(0);
    expect(history.maxSize).toBe(10);
  });

  it('creates empty history with custom size', () => {
    const history = createDetectionHistory(5);
    expect(history.maxSize).toBe(5);
  });
});

describe('addToHistory', () => {
  it('adds detection to empty history', () => {
    const history = createDetectionHistory(5);
    const detection = createMockDetection('hello', 0.9, 12345);
    const newHistory = addToHistory(history, detection);

    expect(newHistory.classes).toEqual(['hello']);
    expect(newHistory.confidences).toEqual([0.9]);
    expect(newHistory.timestamps).toEqual([12345]);
    expect(newHistory.maxSize).toBe(5);
  });

  it('adds detection to history under max size', () => {
    const history = createHistoryWithClasses(['a', 'b']);
    const detection = createMockDetection('c', 0.7);
    const newHistory = addToHistory(history, detection);

    expect(newHistory.classes).toHaveLength(3);
    expect(newHistory.classes[2]).toBe('c');
  });

  it('trims oldest entry when at max size', () => {
    const history: DetectionHistory = {
      classes: ['a', 'b', 'c'],
      confidences: [0.1, 0.2, 0.3],
      timestamps: [1, 2, 3],
      maxSize: 3,
    };
    const detection = createMockDetection('d', 0.4, 4);
    const newHistory = addToHistory(history, detection);

    expect(newHistory.classes).toEqual(['b', 'c', 'd']);
    expect(newHistory.confidences).toEqual([0.2, 0.3, 0.4]);
    expect(newHistory.timestamps).toEqual([2, 3, 4]);
  });

  it('trims multiple oldest entries when over max size', () => {
    // History that's already over max somehow
    const history: DetectionHistory = {
      classes: ['a', 'b', 'c', 'd'],
      confidences: [0.1, 0.2, 0.3, 0.4],
      timestamps: [1, 2, 3, 4],
      maxSize: 2,
    };
    const detection = createMockDetection('e', 0.5, 5);
    const newHistory = addToHistory(history, detection);

    expect(newHistory.classes).toEqual(['d', 'e']);
    expect(newHistory.classes).toHaveLength(2);
  });

  it('does not mutate original history', () => {
    const history = createHistoryWithClasses(['a']);
    const detection = createMockDetection('b', 0.5);
    addToHistory(history, detection);

    expect(history.classes).toEqual(['a']);
  });
});

describe('getAverageConfidence', () => {
  it('returns 0 for empty history', () => {
    const history = createDetectionHistory();
    expect(getAverageConfidence(history)).toBe(0);
  });

  it('returns confidence when only one entry', () => {
    const history: DetectionHistory = {
      classes: ['hello'],
      confidences: [0.8],
      timestamps: [1],
      maxSize: 10,
    };
    expect(getAverageConfidence(history)).toBe(0.8);
  });

  it('calculates average for partial window', () => {
    const history: DetectionHistory = {
      classes: ['a', 'b'],
      confidences: [0.6, 0.8],
      timestamps: [1, 2],
      maxSize: 10,
    };
    expect(getAverageConfidence(history, 5)).toBe(0.7);
  });

  it('calculates average for full window', () => {
    const history: DetectionHistory = {
      classes: ['a', 'b', 'c', 'd', 'e'],
      confidences: [0.5, 0.6, 0.7, 0.8, 0.9],
      timestamps: [1, 2, 3, 4, 5],
      maxSize: 10,
    };
    expect(getAverageConfidence(history, 5)).toBe(0.7);
  });

  it('only considers last N entries for window', () => {
    const history: DetectionHistory = {
      classes: ['a', 'b', 'c', 'd', 'e', 'f'],
      confidences: [0.1, 0.2, 0.6, 0.7, 0.8, 0.9],
      timestamps: [1, 2, 3, 4, 5, 6],
      maxSize: 10,
    };
    // Last 3: 0.7, 0.8, 0.9 → average = 0.8
    expect(getAverageConfidence(history, 3)).toBeCloseTo(0.8, 5);
  });
});

describe('getMostCommonClass', () => {
  it('returns null for empty history', () => {
    const history = createDetectionHistory();
    expect(getMostCommonClass(history)).toBeNull();
  });

  it('returns the single class when only one entry', () => {
    const history: DetectionHistory = {
      classes: ['hello'],
      confidences: [0.8],
      timestamps: [1],
      maxSize: 10,
    };
    expect(getMostCommonClass(history)).toBe('hello');
  });

  it('returns most common class when all same', () => {
    const history = createHistoryWithClasses(['hello', 'hello', 'hello']);
    expect(getMostCommonClass(history)).toBe('hello');
  });

  it('returns most common class with mixed entries', () => {
    const history = createHistoryWithClasses(['hello', 'world', 'hello', 'hello', 'world']);
    expect(getMostCommonClass(history)).toBe('hello');
  });

  it('returns first found class on tie', () => {
    // When iterating a Map, the first set key is returned first
    const history = createHistoryWithClasses(['hello', 'world']);
    const result = getMostCommonClass(history);
    // Both have count 1, first encountered in Map iteration wins
    expect(['hello', 'world']).toContain(result);
  });

  it('only considers last N entries for window', () => {
    const history = createHistoryWithClasses([
      'old', 'old', 'old', 'old', 'old',
      'new', 'new', 'new',
    ]);
    // Window of 3: ['new', 'new', 'new']
    expect(getMostCommonClass(history, 3)).toBe('new');
  });
});
