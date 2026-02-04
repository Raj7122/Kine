import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock constants - include all constants used by hybridDetector and confidenceFusion
vi.mock('@/config/constants', () => ({
  ROBOFLOW_TEMPORAL_WINDOW: 3,
  ROBOFLOW_CONFIDENCE_THRESHOLD: 0.78,
  ROBOFLOW_HIGH_CONFIDENCE: 0.85,
  LSTM_CONFIDENCE_THRESHOLD: 0.7,
  MIN_MOTION_THRESHOLD: 0.023,
  LSTM_VOCABULARY: ['HELLO', 'GOODBYE', 'PLEASE', 'THANK_YOU', 'SORRY'] as const,
}));

// Mock roboflow module
const mockDetectSign = vi.fn();
const mockCaptureFrameAsBase64 = vi.fn();
const mockShouldCallAPI = vi.fn();
const mockIsRoboflowConfigured = vi.fn();

vi.mock('../roboflow', () => ({
  detectSign: () => mockDetectSign(),
  captureFrameAsBase64: () => mockCaptureFrameAsBase64(),
  shouldCallAPI: (motion: number) => mockShouldCallAPI(motion),
  isRoboflowConfigured: () => mockIsRoboflowConfigured(),
}));

// Re-import module after mocking to get fresh state
let hybridModule: typeof import('./hybridDetector');

import type { LSTMPrediction } from '../lstm/types';
import type { LSTMSignClass } from '@/config/constants';

// Helper to create mock LSTM prediction
function createMockLSTMPrediction(
  className: LSTMSignClass,
  confidence: number
): LSTMPrediction {
  return {
    class: className,
    confidence,
    timestamp: Date.now(),
    windowStart: Date.now() - 1000,
    windowEnd: Date.now(),
  };
}

describe('hybridDetector LSTM Integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mocks
    mockIsRoboflowConfigured.mockReturnValue(true);
    mockCaptureFrameAsBase64.mockReturnValue('base64image');
    mockShouldCallAPI.mockReturnValue(true);
    mockDetectSign.mockResolvedValue([]);

    // Reset module to clear state
    vi.resetModules();
    hybridModule = await import('./hybridDetector');
  });

  describe('Initialization with LSTM', () => {
    it('initializes with LSTM enabled', () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      const state = hybridModule.getHybridDetectorState();

      expect(state.isLSTMEnabled).toBe(true);
      expect(state.detectionMode).toBe('HYBRID');
    });

    it('initializes with LSTM disabled', () => {
      hybridModule.initHybridDetector(true, false, 'STATIC');
      const state = hybridModule.getHybridDetectorState();

      expect(state.isLSTMEnabled).toBe(false);
      expect(state.detectionMode).toBe('STATIC');
    });

    it('sets mode to STATIC (YOLO only)', () => {
      hybridModule.initHybridDetector(true, false, 'STATIC');
      const state = hybridModule.getHybridDetectorState();

      expect(state.detectionMode).toBe('STATIC');
    });

    it('sets mode to DYNAMIC (LSTM only)', () => {
      hybridModule.initHybridDetector(false, true, 'DYNAMIC');
      const state = hybridModule.getHybridDetectorState();

      expect(state.detectionMode).toBe('DYNAMIC');
    });

    it('sets mode to HYBRID (both detectors)', () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      const state = hybridModule.getHybridDetectorState();

      expect(state.detectionMode).toBe('HYBRID');
    });
  });

  describe('LSTM State Management', () => {
    beforeEach(() => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
    });

    it('setLSTMEnabled(true) enables LSTM', () => {
      hybridModule.setLSTMEnabled(false);
      expect(hybridModule.getHybridDetectorState().isLSTMEnabled).toBe(false);

      hybridModule.setLSTMEnabled(true);
      expect(hybridModule.getHybridDetectorState().isLSTMEnabled).toBe(true);
    });

    it('setLSTMEnabled(false) disables and clears prediction', () => {
      const prediction = createMockLSTMPrediction('HELLO', 0.9);
      hybridModule.updateLSTMPrediction(prediction);

      hybridModule.setLSTMEnabled(false);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isLSTMEnabled).toBe(false);
      expect(state.lastLSTMPrediction).toBeNull();
    });

    it('updateLSTMPrediction() updates state', () => {
      const prediction = createMockLSTMPrediction('HELLO', 0.9);
      hybridModule.updateLSTMPrediction(prediction);

      const state = hybridModule.getHybridDetectorState();
      expect(state.lastLSTMPrediction).toEqual(prediction);
    });

    it('getLastLSTMPrediction() returns correct value', () => {
      expect(hybridModule.getLastLSTMPrediction()).toBeNull();

      const prediction = createMockLSTMPrediction('HELLO', 0.9);
      hybridModule.updateLSTMPrediction(prediction);

      expect(hybridModule.getLastLSTMPrediction()).toEqual(prediction);
    });

    it('clearHistory() clears LSTM prediction', () => {
      const prediction = createMockLSTMPrediction('HELLO', 0.9);
      hybridModule.updateLSTMPrediction(prediction);

      hybridModule.clearHistory();

      expect(hybridModule.getLastLSTMPrediction()).toBeNull();
    });
  });

  describe('processFrame with LSTM', () => {
    const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

    it('DYNAMIC mode skips Roboflow API calls', async () => {
      hybridModule.initHybridDetector(true, true, 'DYNAMIC');

      await hybridModule.processFrame(mockVideo, 0.05, true);

      expect(mockDetectSign).not.toHaveBeenCalled();
    });

    it('LSTM prediction is passed through to fusion', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);

      const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      expect(result.lstmPrediction).toEqual(lstmPrediction);
    });

    it('returns LSTM-only result when Roboflow disabled in DYNAMIC mode', async () => {
      hybridModule.initHybridDetector(false, true, 'DYNAMIC');
      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);

      const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      expect(result.fusionOutput.action).toBe('use_lstm');
      expect(result.fusionOutput.sign).toBe('HELLO');
      expect(result.roboflowDetections).toHaveLength(0);
    });

    it('hybrid fusion when both detectors enabled', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');

      const mockRoboflowDetection = {
        class: 'A',
        confidence: 0.9,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        timestamp: Date.now(),
      };
      mockDetectSign.mockResolvedValue([mockRoboflowDetection]);

      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.8);

      // Process multiple times to build history
      await hybridModule.processFrame(mockVideo, 0.01, true, lstmPrediction);
      await hybridModule.processFrame(mockVideo, 0.01, true, lstmPrediction);
      const result = await hybridModule.processFrame(mockVideo, 0.01, true, lstmPrediction);

      // With stillness (0.01 < 0.023), YOLO should take priority
      expect(result.fusionOutput.action).toBe('use_roboflow');
      expect(result.lstmPrediction).toEqual(lstmPrediction);
    });

    it('result includes lstmPrediction field', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      mockDetectSign.mockResolvedValue([]);

      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);
      const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      expect(result.lstmPrediction).toBeDefined();
      expect(result.lstmPrediction).toEqual(lstmPrediction);
    });

    it('result includes detectionMode field', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');

      const result = await hybridModule.processFrame(mockVideo, 0.05, true);

      expect(result.detectionMode).toBe('HYBRID');
    });

    it('updates lastLSTMPrediction when passed via processFrame', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);

      await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      expect(hybridModule.getLastLSTMPrediction()).toEqual(lstmPrediction);
    });

    it('uses last LSTM prediction when not provided', async () => {
      hybridModule.initHybridDetector(true, true, 'DYNAMIC');
      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);

      // First call with LSTM
      await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      // Second call without LSTM - should use cached
      const result = await hybridModule.processFrame(mockVideo, 0.05, true);

      expect(result.lstmPrediction).toEqual(lstmPrediction);
    });
  });

  describe('Mode-Specific Behavior', () => {
    const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

    describe('STATIC mode', () => {
      beforeEach(() => {
        hybridModule.initHybridDetector(true, false, 'STATIC');
      });

      it('only runs YOLO detection', async () => {
        const mockDetection = {
          class: 'A',
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          timestamp: Date.now(),
        };
        mockDetectSign.mockResolvedValue([mockDetection]);

        await hybridModule.processFrame(mockVideo, 0.05, true);
        await hybridModule.processFrame(mockVideo, 0.05, true);
        const result = await hybridModule.processFrame(mockVideo, 0.05, true);

        expect(mockDetectSign).toHaveBeenCalled();
        expect(result.roboflowDetections).toHaveLength(1);
        expect(result.lstmPrediction).toBeNull();
      });

      it('does not use LSTM predictions', async () => {
        const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);
        const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

        // LSTM prediction is still tracked but not used in fusion when disabled
        const state = hybridModule.getHybridDetectorState();
        expect(state.isLSTMEnabled).toBe(false);
      });
    });

    describe('DYNAMIC mode', () => {
      beforeEach(() => {
        hybridModule.initHybridDetector(false, true, 'DYNAMIC');
      });

      it('only runs LSTM detection, no YOLO API calls', async () => {
        const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);
        const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

        expect(mockDetectSign).not.toHaveBeenCalled();
        expect(result.fusionOutput.action).toBe('use_lstm');
      });

      it('uses LSTM for fusion output', async () => {
        const lstmPrediction = createMockLSTMPrediction('HELLO', 0.85);
        const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

        expect(result.fusionOutput.sign).toBe('HELLO');
        expect(result.fusionOutput.confidence).toBe(0.85);
      });
    });

    describe('HYBRID mode', () => {
      beforeEach(() => {
        hybridModule.initHybridDetector(true, true, 'HYBRID');
      });

      it('runs both detectors', async () => {
        const mockDetection = {
          class: 'A',
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          timestamp: Date.now(),
        };
        mockDetectSign.mockResolvedValue([mockDetection]);
        const lstmPrediction = createMockLSTMPrediction('HELLO', 0.85);

        await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

        expect(mockDetectSign).toHaveBeenCalled();
        const state = hybridModule.getHybridDetectorState();
        expect(state.lastLSTMPrediction).toEqual(lstmPrediction);
      });

      it('fuses both detector results based on context', async () => {
        const mockDetection = {
          class: 'A',
          confidence: 0.9,
          bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          timestamp: Date.now(),
        };
        mockDetectSign.mockResolvedValue([mockDetection]);
        const lstmPrediction = createMockLSTMPrediction('HELLO', 0.85);

        // With motion, LSTM takes priority
        const resultWithMotion = await hybridModule.processFrame(
          mockVideo,
          0.05,
          true,
          lstmPrediction
        );
        expect(resultWithMotion.fusionOutput.action).toBe('use_lstm');

        // With stillness and history, YOLO takes priority
        await hybridModule.processFrame(mockVideo, 0.01, true, lstmPrediction);
        await hybridModule.processFrame(mockVideo, 0.01, true, lstmPrediction);
        const resultWithStillness = await hybridModule.processFrame(
          mockVideo,
          0.01,
          true,
          lstmPrediction
        );
        expect(resultWithStillness.fusionOutput.action).toBe('use_roboflow');
      });
    });
  });

  describe('setDetectionMode', () => {
    it('changes detection mode at runtime', () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');

      hybridModule.setDetectionMode('STATIC');
      expect(hybridModule.getHybridDetectorState().detectionMode).toBe('STATIC');

      hybridModule.setDetectionMode('DYNAMIC');
      expect(hybridModule.getHybridDetectorState().detectionMode).toBe('DYNAMIC');

      hybridModule.setDetectionMode('HYBRID');
      expect(hybridModule.getHybridDetectorState().detectionMode).toBe('HYBRID');
    });
  });

  describe('Rate limiting with LSTM', () => {
    const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

    it('uses LSTM when Roboflow rate limited', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      mockShouldCallAPI.mockReturnValue(false);

      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);
      const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      expect(mockDetectSign).not.toHaveBeenCalled();
      expect(result.fusionOutput.action).toBe('use_lstm');
    });

    it('still returns last Roboflow result when rate limited', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');

      // First call - not rate limited
      const mockDetection = {
        class: 'A',
        confidence: 0.9,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        timestamp: Date.now(),
      };
      mockDetectSign.mockResolvedValue([mockDetection]);
      mockShouldCallAPI.mockReturnValue(true);
      await hybridModule.processFrame(mockVideo, 0.01, true);

      // Second call - rate limited
      mockShouldCallAPI.mockReturnValue(false);
      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);
      const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      // Should have both cached Roboflow and current LSTM
      expect(result.roboflowDetections).toHaveLength(1);
      expect(result.lstmPrediction).toEqual(lstmPrediction);
    });
  });

  describe('Error handling with LSTM', () => {
    const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

    it('falls back to LSTM when Roboflow API errors', async () => {
      hybridModule.initHybridDetector(true, true, 'HYBRID');
      mockDetectSign.mockRejectedValue(new Error('API error'));

      const lstmPrediction = createMockLSTMPrediction('HELLO', 0.9);
      const result = await hybridModule.processFrame(mockVideo, 0.05, true, lstmPrediction);

      // Should still have LSTM prediction in result
      expect(result.lstmPrediction).toEqual(lstmPrediction);
    });
  });
});
