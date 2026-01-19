import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock constants - include all constants used by hybridDetector and confidenceFusion
vi.mock('@/config/constants', () => ({
  ROBOFLOW_TEMPORAL_WINDOW: 3,
  ROBOFLOW_CONFIDENCE_THRESHOLD: 0.5,
  ROBOFLOW_HIGH_CONFIDENCE: 0.85,
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

describe('hybridDetector', () => {
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

  describe('initHybridDetector', () => {
    it('enables Roboflow when configured and requested', () => {
      mockIsRoboflowConfigured.mockReturnValue(true);

      hybridModule.initHybridDetector(true);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isEnabled).toBe(true);
      expect(state.history.maxSize).toBe(6); // ROBOFLOW_TEMPORAL_WINDOW * 2
    });

    it('disables Roboflow when not configured even if requested', () => {
      mockIsRoboflowConfigured.mockReturnValue(false);

      hybridModule.initHybridDetector(true);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isEnabled).toBe(false);
    });

    it('disables Roboflow when explicitly disabled', () => {
      mockIsRoboflowConfigured.mockReturnValue(true);

      hybridModule.initHybridDetector(false);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isEnabled).toBe(false);
    });

    it('clears previous state on init', async () => {
      // First, set up some state
      mockDetectSign.mockResolvedValue([
        { class: 'hello', confidence: 0.9, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, timestamp: 1 },
      ]);

      hybridModule.initHybridDetector(true);
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      await hybridModule.processFrame(mockVideo, 0.01, true);

      // Now reinit
      hybridModule.initHybridDetector(false);
      const state = hybridModule.getHybridDetectorState();

      expect(state.lastRoboflowResult).toBeNull();
      expect(state.lastFusionOutput).toBeNull();
      expect(state.history.classes).toHaveLength(0);
    });
  });

  describe('processFrame', () => {
    beforeEach(() => {
      hybridModule.initHybridDetector(true);
    });

    it('returns rely_gemini when Roboflow is disabled', async () => {
      hybridModule.initHybridDetector(false);
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

      const result = await hybridModule.processFrame(mockVideo, 0.01, true);

      expect(result.fusionOutput.action).toBe('rely_gemini');
      expect(result.roboflowDetections).toHaveLength(0);
      expect(mockDetectSign).not.toHaveBeenCalled();
    });

    it('processes frame with detection and returns use_roboflow for high confidence', async () => {
      const mockDetection = {
        class: 'hello',
        confidence: 0.95,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        timestamp: Date.now(),
      };
      mockDetectSign.mockResolvedValue([mockDetection]);

      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

      // Process multiple times to build temporal consistency
      await hybridModule.processFrame(mockVideo, 0.01, true);
      await hybridModule.processFrame(mockVideo, 0.01, true);
      const result = await hybridModule.processFrame(mockVideo, 0.01, true);

      expect(result.fusionOutput.action).toBe('use_roboflow');
      expect(result.fusionOutput.sign).toBe('hello');
    });

    it('returns enhance_gemini for medium confidence', async () => {
      const mockDetection = {
        class: 'hello',
        confidence: 0.7,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        timestamp: Date.now(),
      };
      mockDetectSign.mockResolvedValue([mockDetection]);

      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      const result = await hybridModule.processFrame(mockVideo, 0.01, true);

      expect(result.fusionOutput.action).toBe('enhance_gemini');
      expect(result.fusionOutput.hint).toContain('YOLO detected "hello"');
    });

    it('skips API call when shouldCallAPI returns false', async () => {
      mockShouldCallAPI.mockReturnValue(false);
      mockDetectSign.mockResolvedValue([
        { class: 'hello', confidence: 0.9, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, timestamp: 1 },
      ]);

      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      const result = await hybridModule.processFrame(mockVideo, 0.5, true);

      // Should still return last result or default
      expect(result.fusionOutput.action).toBe('rely_gemini');
      expect(mockDetectSign).not.toHaveBeenCalled();
    });

    it('returns last result when rate limited', async () => {
      const mockDetection = {
        class: 'hello',
        confidence: 0.7,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        timestamp: Date.now(),
      };
      mockDetectSign.mockResolvedValue([mockDetection]);

      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

      // First call succeeds
      mockShouldCallAPI.mockReturnValue(true);
      await hybridModule.processFrame(mockVideo, 0.01, true);

      // Second call is rate limited but should return last result
      mockShouldCallAPI.mockReturnValue(false);
      const result = await hybridModule.processFrame(mockVideo, 0.01, true);

      expect(result.roboflowDetections).toHaveLength(1);
      expect(result.fusionOutput.action).toBe('enhance_gemini');
    });

    it('includes mediapipeActive flag in result', async () => {
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

      const resultActive = await hybridModule.processFrame(mockVideo, 0.01, true);
      expect(resultActive.mediapipeActive).toBe(true);

      const resultInactive = await hybridModule.processFrame(mockVideo, 0.01, false);
      expect(resultInactive.mediapipeActive).toBe(false);
    });

    it('includes timestamp in result', async () => {
      const beforeTime = Date.now();
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;

      const result = await hybridModule.processFrame(mockVideo, 0.01, true);

      expect(result.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(result.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('handles API error gracefully', async () => {
      mockDetectSign.mockRejectedValue(new Error('API error'));

      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      const result = await hybridModule.processFrame(mockVideo, 0.01, true);

      // Should return default rely_gemini on error
      expect(result.fusionOutput.action).toBe('rely_gemini');
    });

    it('updates history with detections', async () => {
      const mockDetection = {
        class: 'hello',
        confidence: 0.9,
        bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        timestamp: Date.now(),
      };
      mockDetectSign.mockResolvedValue([mockDetection]);

      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      await hybridModule.processFrame(mockVideo, 0.01, true);

      const history = hybridModule.getDetectionHistory();
      expect(history.classes).toContain('hello');
    });
  });

  describe('setRoboflowEnabled', () => {
    it('enables Roboflow when configured', () => {
      mockIsRoboflowConfigured.mockReturnValue(true);
      hybridModule.initHybridDetector(false);

      hybridModule.setRoboflowEnabled(true);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isEnabled).toBe(true);
    });

    it('does not enable when not configured', () => {
      mockIsRoboflowConfigured.mockReturnValue(false);
      hybridModule.initHybridDetector(false);

      hybridModule.setRoboflowEnabled(true);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isEnabled).toBe(false);
    });

    it('disables Roboflow', () => {
      mockIsRoboflowConfigured.mockReturnValue(true);
      hybridModule.initHybridDetector(true);

      hybridModule.setRoboflowEnabled(false);
      const state = hybridModule.getHybridDetectorState();

      expect(state.isEnabled).toBe(false);
    });
  });

  describe('clearHistory', () => {
    it('clears detection history', async () => {
      mockDetectSign.mockResolvedValue([
        { class: 'hello', confidence: 0.9, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, timestamp: 1 },
      ]);

      hybridModule.initHybridDetector(true);
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      await hybridModule.processFrame(mockVideo, 0.01, true);

      hybridModule.clearHistory();
      const history = hybridModule.getDetectionHistory();

      expect(history.classes).toHaveLength(0);
    });

    it('clears lastRoboflowResult and lastFusionOutput', async () => {
      mockDetectSign.mockResolvedValue([
        { class: 'hello', confidence: 0.9, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, timestamp: 1 },
      ]);

      hybridModule.initHybridDetector(true);
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      await hybridModule.processFrame(mockVideo, 0.01, true);

      hybridModule.clearHistory();
      const state = hybridModule.getHybridDetectorState();

      expect(state.lastRoboflowResult).toBeNull();
      expect(state.lastFusionOutput).toBeNull();
    });
  });

  describe('getLastFusionOutput', () => {
    it('returns null before any processing', () => {
      hybridModule.initHybridDetector(true);
      expect(hybridModule.getLastFusionOutput()).toBeNull();
    });

    it('returns last fusion output after processing', async () => {
      mockDetectSign.mockResolvedValue([
        { class: 'hello', confidence: 0.7, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, timestamp: 1 },
      ]);

      hybridModule.initHybridDetector(true);
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      await hybridModule.processFrame(mockVideo, 0.01, true);

      const output = hybridModule.getLastFusionOutput();
      expect(output).not.toBeNull();
      expect(output?.action).toBe('enhance_gemini');
    });
  });

  describe('getCurrentDetections', () => {
    it('returns empty array before any processing', () => {
      hybridModule.initHybridDetector(true);
      expect(hybridModule.getCurrentDetections()).toEqual([]);
    });

    it('returns last detections after processing', async () => {
      const mockDetections = [
        { class: 'hello', confidence: 0.9, bbox: { x: 0, y: 0, width: 0.1, height: 0.1 }, timestamp: 1 },
        { class: 'world', confidence: 0.7, bbox: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 }, timestamp: 1 },
      ];
      mockDetectSign.mockResolvedValue(mockDetections);

      hybridModule.initHybridDetector(true);
      const mockVideo = { videoWidth: 640, videoHeight: 640 } as HTMLVideoElement;
      await hybridModule.processFrame(mockVideo, 0.01, true);

      const detections = hybridModule.getCurrentDetections();
      expect(detections).toHaveLength(2);
    });
  });
});
