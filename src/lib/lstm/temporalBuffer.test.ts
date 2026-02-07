import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporalBuffer, windowToTensorInput } from './temporalBuffer';
import type { HandLandmarkResult, Landmark } from '@/lib/mediapipe/types';

// Mock the constants module
vi.mock('@/config/constants', () => ({
  LSTM_WINDOW_SIZE: 32,
  LSTM_STRIDE: 15,
  LSTM_MIN_MOTION_FRAMES: 8,
  LSTM_FEATURE_COUNT: 126,
  MIN_MOTION_THRESHOLD: 0.023,
}));

// Helper to create 21 landmarks for a hand
function create21Landmarks(
  baseX: number = 0.5,
  baseY: number = 0.5,
  baseZ: number = 0
): Landmark[] {
  return Array.from({ length: 21 }, (_, i) => ({
    x: baseX + i * 0.01,
    y: baseY + i * 0.01,
    z: baseZ + i * 0.001,
  }));
}

// Helper to create a HandLandmarkResult
function createMockHandResult(
  hasLeft: boolean,
  hasRight: boolean,
  leftPosition?: { x: number; y: number; z: number },
  rightPosition?: { x: number; y: number; z: number }
): HandLandmarkResult {
  const landmarks: Landmark[][] = [];
  const handedness: Array<{ categoryName: string; score: number }[]> = [];

  if (hasLeft) {
    const pos = leftPosition || { x: 0.3, y: 0.5, z: 0 };
    landmarks.push(create21Landmarks(pos.x, pos.y, pos.z));
    handedness.push([{ categoryName: 'Left', score: 0.99 }]);
  }
  if (hasRight) {
    const pos = rightPosition || { x: 0.7, y: 0.5, z: 0 };
    landmarks.push(create21Landmarks(pos.x, pos.y, pos.z));
    handedness.push([{ categoryName: 'Right', score: 0.99 }]);
  }

  return { landmarks, worldLandmarks: landmarks, handedness };
}

// Helper to create moving hands (simulating motion)
function createMovingHandResult(
  frameIndex: number,
  amplitude: number = 0.05
): HandLandmarkResult {
  const offset = Math.sin(frameIndex * 0.2) * amplitude;
  return createMockHandResult(
    true,
    true,
    { x: 0.3 + offset, y: 0.5 + offset, z: 0 },
    { x: 0.7 + offset, y: 0.5 + offset, z: 0 }
  );
}

describe('Landmark Flattening (via TemporalBuffer.addFrame)', () => {
  let buffer: TemporalBuffer;

  beforeEach(() => {
    buffer = new TemporalBuffer({ windowSize: 32, stride: 15, minMotionFrames: 8 });
  });

  it('returns 126 zeros for null hand result', () => {
    buffer.addFrame(null);
    const state = buffer.getState();
    expect(state.frames).toHaveLength(1);
    expect(state.frames[0].landmarks).toHaveLength(126);
    expect(state.frames[0].landmarks.every(v => v === 0)).toBe(true);
  });

  it('returns 126 zeros for empty hand result', () => {
    const emptyResult: HandLandmarkResult = {
      landmarks: [],
      worldLandmarks: [],
      handedness: [],
    };
    buffer.addFrame(emptyResult);
    const state = buffer.getState();
    expect(state.frames[0].landmarks.every(v => v === 0)).toBe(true);
  });

  it('populates first 63 indices for left hand only', () => {
    const leftOnly = createMockHandResult(true, false);
    buffer.addFrame(leftOnly);
    const state = buffer.getState();
    const landmarks = state.frames[0].landmarks;

    // Left hand (indices 0-62) should have non-zero values
    const leftHandFeatures = landmarks.slice(0, 63);
    expect(leftHandFeatures.some(v => v !== 0)).toBe(true);

    // Right hand (indices 63-125) should be zeros
    const rightHandFeatures = landmarks.slice(63, 126);
    expect(rightHandFeatures.every(v => v === 0)).toBe(true);
  });

  it('populates indices 63-125 for right hand only', () => {
    const rightOnly = createMockHandResult(false, true);
    buffer.addFrame(rightOnly);
    const state = buffer.getState();
    const landmarks = state.frames[0].landmarks;

    // Left hand (indices 0-62) should be zeros
    const leftHandFeatures = landmarks.slice(0, 63);
    expect(leftHandFeatures.every(v => v === 0)).toBe(true);

    // Right hand (indices 63-125) should have non-zero values
    const rightHandFeatures = landmarks.slice(63, 126);
    expect(rightHandFeatures.some(v => v !== 0)).toBe(true);
  });

  it('populates both hand regions when both hands present', () => {
    const bothHands = createMockHandResult(true, true);
    buffer.addFrame(bothHands);
    const state = buffer.getState();
    const landmarks = state.frames[0].landmarks;

    // Both should have non-zero values
    const leftHandFeatures = landmarks.slice(0, 63);
    const rightHandFeatures = landmarks.slice(63, 126);
    expect(leftHandFeatures.some(v => v !== 0)).toBe(true);
    expect(rightHandFeatures.some(v => v !== 0)).toBe(true);
  });

  it('handles missing z-coordinates by defaulting to 0', () => {
    const handWithNoZ: HandLandmarkResult = {
      landmarks: [[
        { x: 0.5, y: 0.5 } as Landmark, // Missing z
        ...Array(20).fill(null).map((_, i) => ({ x: 0.5 + i * 0.01, y: 0.5 + i * 0.01, z: 0 })),
      ]],
      worldLandmarks: [[{ x: 0.5, y: 0.5 } as Landmark]],
      handedness: [[{ categoryName: 'Left', score: 0.99 }]],
    };
    buffer.addFrame(handWithNoZ);
    const state = buffer.getState();
    // z-coordinate at index 2 should be 0
    expect(state.frames[0].landmarks[2]).toBe(0);
  });

  it('correctly identifies handedness from categoryName', () => {
    const leftOnly = createMockHandResult(true, false);
    buffer.addFrame(leftOnly);
    const state = buffer.getState();
    expect(state.frames[0].hasLeftHand).toBe(true);
    expect(state.frames[0].hasRightHand).toBe(false);
  });
});

describe('Landmark Normalization (via getWindowForInference)', () => {
  let buffer: TemporalBuffer;

  beforeEach(() => {
    buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
  });

  it('normalizes landmarks relative to wrist position', () => {
    // Fill buffer with 4 frames
    for (let i = 0; i < 4; i++) {
      buffer.addFrame(createMovingHandResult(i, 0.1));
    }

    const normalized = buffer.getWindowForInference();
    expect(normalized).not.toBeNull();

    // After normalization, wrist (index 0,1,2) should be near 0 (centered)
    const firstFrame = normalized![0];
    // The wrist position after centering should be 0
    expect(firstFrame.features[0]).toBeCloseTo(0, 5);
    expect(firstFrame.features[1]).toBeCloseTo(0, 5);
    expect(firstFrame.features[2]).toBeCloseTo(0, 5);
  });

  it('scales landmarks to unit bounding box', () => {
    // Fill buffer with 4 frames
    for (let i = 0; i < 4; i++) {
      buffer.addFrame(createMockHandResult(true, false));
    }

    const normalized = buffer.getWindowForInference();
    expect(normalized).not.toBeNull();

    // All normalized values should be bounded
    const frame = normalized![0];
    const leftHand = frame.features.slice(0, 63);

    // After scaling, values should be reasonable (not Infinity or NaN)
    leftHand.forEach(v => {
      expect(Number.isFinite(v)).toBe(true);
    });
  });

  it('passes through zero hand data without modification', () => {
    // Fill buffer with null results
    for (let i = 0; i < 4; i++) {
      buffer.addFrame(null);
    }

    const normalized = buffer.getWindowForInference();
    expect(normalized).not.toBeNull();

    // All values should remain zero
    const frame = normalized![0];
    expect(frame.features.every(v => v === 0)).toBe(true);
  });

  it('normalizes only the hand with data when one hand missing', () => {
    // Fill buffer with left hand only
    for (let i = 0; i < 4; i++) {
      buffer.addFrame(createMockHandResult(true, false));
    }

    const normalized = buffer.getWindowForInference();
    expect(normalized).not.toBeNull();

    const frame = normalized![0];
    // Left hand normalized
    const leftHand = frame.features.slice(0, 63);
    expect(leftHand.some(v => v !== 0)).toBe(true);

    // Right hand still zeros
    const rightHand = frame.features.slice(63, 126);
    expect(rightHand.every(v => v === 0)).toBe(true);
  });

  it('handles very small bounding box with minimum scale', () => {
    // Create hand with very close landmarks (small bounding box)
    const tinyHand: HandLandmarkResult = {
      landmarks: [
        Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 })),
      ],
      worldLandmarks: [
        Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 })),
      ],
      handedness: [[{ categoryName: 'Left', score: 0.99 }]],
    };

    for (let i = 0; i < 4; i++) {
      buffer.addFrame(tinyHand);
    }

    const normalized = buffer.getWindowForInference();
    expect(normalized).not.toBeNull();

    // Should not have Infinity or NaN due to division by near-zero
    const frame = normalized![0];
    frame.features.forEach(v => {
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isNaN(v)).toBe(false);
    });
  });
});

describe('Motion Magnitude Calculation', () => {
  let buffer: TemporalBuffer;

  beforeEach(() => {
    buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
  });

  it('returns 0 motion for first frame (no previous)', () => {
    buffer.addFrame(createMockHandResult(true, true));
    const state = buffer.getState();
    expect(state.frames[0].motionMagnitude).toBe(0);
  });

  it('returns 0 motion when no hands in either frame', () => {
    buffer.addFrame(null);
    buffer.addFrame(null);
    const state = buffer.getState();
    expect(state.frames[1].motionMagnitude).toBe(0);
  });

  it('returns small motion for stationary hands', () => {
    const staticHand = createMockHandResult(true, true);
    buffer.addFrame(staticHand);
    buffer.addFrame(staticHand);
    const state = buffer.getState();
    // Same position -> 0 motion
    expect(state.frames[1].motionMagnitude).toBe(0);
  });

  it('returns large motion for moving hands', () => {
    buffer.addFrame(createMockHandResult(true, true, { x: 0.3, y: 0.5, z: 0 }, { x: 0.7, y: 0.5, z: 0 }));
    buffer.addFrame(createMockHandResult(true, true, { x: 0.5, y: 0.7, z: 0 }, { x: 0.9, y: 0.7, z: 0 }));
    const state = buffer.getState();
    // Significant position change -> larger motion
    expect(state.frames[1].motionMagnitude).toBeGreaterThan(0);
  });

  it('handles partial hand data (one hand disappears)', () => {
    buffer.addFrame(createMockHandResult(true, true));
    buffer.addFrame(createMockHandResult(true, false)); // Right hand disappears
    const state = buffer.getState();
    // Should still calculate motion without error
    expect(typeof state.frames[1].motionMagnitude).toBe('number');
    expect(Number.isFinite(state.frames[1].motionMagnitude)).toBe(true);
  });
});

describe('TemporalBuffer Class', () => {
  describe('Constructor', () => {
    it('creates buffer with default config', () => {
      const buffer = new TemporalBuffer();
      const state = buffer.getState();
      expect(state.frames).toHaveLength(0);
      expect(state.isBufferFull).toBe(false);
    });

    it('creates buffer with custom config', () => {
      const buffer = new TemporalBuffer({
        windowSize: 16,
        stride: 8,
        minMotionFrames: 4,
      });
      // Add 16 frames to fill
      for (let i = 0; i < 16; i++) {
        buffer.addFrame(createMovingHandResult(i));
      }
      const state = buffer.getState();
      expect(state.isBufferFull).toBe(true);
    });
  });

  describe('addFrame', () => {
    let buffer: TemporalBuffer;

    beforeEach(() => {
      buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
    });

    it('adds frame to buffer', () => {
      buffer.addFrame(createMockHandResult(true, true));
      expect(buffer.length).toBe(1);
    });

    it('maintains window size (removes old frames)', () => {
      for (let i = 0; i < 10; i++) {
        buffer.addFrame(createMovingHandResult(i));
      }
      expect(buffer.length).toBe(4); // Window size is 4
    });

    it('increments stride counter', () => {
      buffer.addFrame(createMovingHandResult(0));
      const state = buffer.getState();
      expect(state.framesSinceLastInference).toBe(1);
    });

    it('returns shouldInfer=false when buffer not full', () => {
      const result = buffer.addFrame(createMovingHandResult(0));
      expect(result.shouldInfer).toBe(false);
      expect(result.reason).toBe('not_ready');
    });

    it('returns shouldInfer=false when stride not reached', () => {
      // Fill buffer (4 frames)
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i, 0.1));
      }
      // Add one more (stride is 2, so need 2 more frames after inference)
      buffer.resetStride(); // Simulate inference happened
      const result = buffer.addFrame(createMovingHandResult(4, 0.1));
      expect(result.shouldInfer).toBe(false);
    });

    it('returns shouldInfer=true at stride boundary with motion', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });

      // Fill buffer with moving frames
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i, 0.1));
      }
      buffer.resetStride();

      // Add 2 more frames (stride reached)
      buffer.addFrame(createMovingHandResult(4, 0.1));
      const result = buffer.addFrame(createMovingHandResult(5, 0.1));

      expect(result.shouldInfer).toBe(true);
      expect(result.reason).toBe('stride_reached');
    });

    it('returns insufficient_motion when motion frames below threshold', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 8 });

      // Fill buffer with static frames
      const staticHand = createMockHandResult(true, true);
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(staticHand);
      }
      buffer.resetStride();

      // Add 2 more static frames
      buffer.addFrame(staticHand);
      const result = buffer.addFrame(staticHand);

      expect(result.shouldInfer).toBe(false);
      expect(result.reason).toBe('insufficient_motion');
    });
  });

  describe('getWindowForInference', () => {
    it('returns null if buffer incomplete', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
      buffer.addFrame(createMockHandResult(true, true));
      expect(buffer.getWindowForInference()).toBeNull();
    });

    it('returns normalized frames when buffer full', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i));
      }
      const result = buffer.getWindowForInference();
      expect(result).not.toBeNull();
      expect(result).toHaveLength(4);
    });
  });

  describe('getWindowTimestamps', () => {
    it('returns null if buffer incomplete', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
      buffer.addFrame(createMockHandResult(true, true));
      expect(buffer.getWindowTimestamps()).toBeNull();
    });

    it('returns correct start and end timestamps', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
      const startTime = Date.now();

      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i));
      }

      const timestamps = buffer.getWindowTimestamps();
      expect(timestamps).not.toBeNull();
      expect(timestamps!.start).toBeLessThanOrEqual(timestamps!.end);
      expect(timestamps!.start).toBeGreaterThanOrEqual(startTime);
    });
  });

  describe('getState', () => {
    it('returns correct state snapshot', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 2 });

      for (let i = 0; i < 3; i++) {
        buffer.addFrame(createMovingHandResult(i, 0.1));
      }

      const state = buffer.getState();
      expect(state.frames).toHaveLength(3);
      expect(state.framesSinceLastInference).toBe(3);
      expect(state.isBufferFull).toBe(false);
      expect(typeof state.motionFramesInWindow).toBe('number');
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });

      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i));
      }

      buffer.clear();
      const state = buffer.getState();

      expect(state.frames).toHaveLength(0);
      expect(state.framesSinceLastInference).toBe(0);
      expect(buffer.length).toBe(0);
    });
  });

  describe('resetStride', () => {
    it('only resets stride counter without clearing buffer', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });

      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i));
      }

      buffer.resetStride();
      const state = buffer.getState();

      expect(state.frames).toHaveLength(4);
      expect(state.framesSinceLastInference).toBe(0);
    });
  });

  describe('hasEnoughMotion', () => {
    it('returns false when motion frames below threshold', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 3 });
      const staticHand = createMockHandResult(true, true);

      for (let i = 0; i < 4; i++) {
        buffer.addFrame(staticHand);
      }

      expect(buffer.hasEnoughMotion()).toBe(false);
    });

    it('returns true when motion frames meet threshold', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 2 });

      // Add frames with motion
      for (let i = 0; i < 4; i++) {
        buffer.addFrame(createMovingHandResult(i, 0.1));
      }

      expect(buffer.hasEnoughMotion()).toBe(true);
    });
  });

  describe('length getter', () => {
    it('returns current buffer length', () => {
      const buffer = new TemporalBuffer({ windowSize: 4, stride: 2, minMotionFrames: 1 });
      expect(buffer.length).toBe(0);

      buffer.addFrame(createMockHandResult(true, true));
      expect(buffer.length).toBe(1);

      buffer.addFrame(createMockHandResult(true, true));
      expect(buffer.length).toBe(2);
    });
  });
});

describe('windowToTensorInput', () => {
  it('returns correct output shape [1, windowSize, featureCount]', () => {
    const frames = Array(32).fill(null).map(() => ({
      features: Array(126).fill(0.5),
      hasMotion: true,
    }));

    const result = windowToTensorInput(frames, 32, 126);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(32);
    expect(result[0][0]).toHaveLength(126);
  });

  it('pads with zeros when frames < windowSize', () => {
    const frames = Array(10).fill(null).map(() => ({
      features: Array(126).fill(1),
      hasMotion: true,
    }));

    const result = windowToTensorInput(frames, 32, 126);

    expect(result[0]).toHaveLength(32);
    // First 22 frames should be padded zeros
    expect(result[0][0].every(v => v === 0)).toBe(true);
    // Last 10 frames should have values
    expect(result[0][22][0]).toBe(1);
  });

  it('slices to windowSize when frames > windowSize', () => {
    const frames = Array(50).fill(null).map((_, i) => ({
      features: Array(126).fill(i),
      hasMotion: true,
    }));

    const result = windowToTensorInput(frames, 32, 126);

    expect(result[0]).toHaveLength(32);
    // Should take last 32 frames (indices 18-49)
    expect(result[0][0][0]).toBe(18);
    expect(result[0][31][0]).toBe(49);
  });

  it('preserves feature order', () => {
    const frames = Array(32).fill(null).map((_, frameIdx) => ({
      features: Array(126).fill(null).map((_, featureIdx) => frameIdx * 126 + featureIdx),
      hasMotion: true,
    }));

    const result = windowToTensorInput(frames, 32, 126);

    // Check specific values
    expect(result[0][0][0]).toBe(0);
    expect(result[0][0][1]).toBe(1);
    expect(result[0][1][0]).toBe(126);
  });

  it('handles empty frames array', () => {
    const result = windowToTensorInput([], 32, 126);

    expect(result[0]).toHaveLength(32);
    // All frames should be zeros
    result[0].forEach(frame => {
      expect(frame.every(v => v === 0)).toBe(true);
    });
  });
});
