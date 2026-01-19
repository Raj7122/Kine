import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectSign, captureFrameAsBase64, shouldCallAPI } from './roboflowService';

// Mock the constants
vi.mock('@/config/constants', () => ({
  ROBOFLOW_API_URL: 'https://detect.roboflow.com',
  ROBOFLOW_INFERENCE_INTERVAL: 200,
  ROBOFLOW_CONFIDENCE_THRESHOLD: 0.5,
  ROBOFLOW_HIGH_CONFIDENCE: 0.85,
  ROBOFLOW_TEMPORAL_WINDOW: 3,
  ROBOFLOW_MAX_CONCURRENT: 2,
  ROBOFLOW_IMAGE_SIZE: 640,
}));

// Mock config module
const mockIsRoboflowConfigured = vi.fn();
const mockGetRoboflowConfig = vi.fn();

vi.mock('./config', () => ({
  isRoboflowConfigured: () => mockIsRoboflowConfigured(),
  getRoboflowConfig: () => mockGetRoboflowConfig(),
}));

// Reset module state between tests by re-importing
let roboflowModule: typeof import('./roboflowService');

describe('roboflowService', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());

    // Default config mock
    mockIsRoboflowConfigured.mockReturnValue(true);
    mockGetRoboflowConfig.mockReturnValue({
      apiKey: 'test-api-key',
      modelId: 'test-model',
      version: '1',
      apiUrl: 'https://detect.roboflow.com',
    });

    // Reset module to clear internal state (activeRequests, lastRequestTime)
    vi.resetModules();
    roboflowModule = await import('./roboflowService');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('detectSign', () => {
    it('returns empty array when Roboflow is not configured', async () => {
      mockIsRoboflowConfigured.mockReturnValue(false);

      const result = await roboflowModule.detectSign('base64image');

      expect(result).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('returns normalized detections on successful API call', async () => {
      const mockResponse = {
        predictions: [
          {
            class: 'hello',
            confidence: 0.95,
            x: 320, // center x
            y: 320, // center y
            width: 200,
            height: 200,
          },
        ],
        time: 0.1,
        image: { width: 640, height: 640 },
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await roboflowModule.detectSign('base64image');

      expect(result).toHaveLength(1);
      expect(result[0].class).toBe('hello');
      expect(result[0].confidence).toBe(0.95);
      // Normalized bbox: x = (320 - 100) / 640 = 0.34375, y = (320 - 100) / 640 = 0.34375
      expect(result[0].bbox.x).toBeCloseTo(0.34375, 4);
      expect(result[0].bbox.y).toBeCloseTo(0.34375, 4);
      expect(result[0].bbox.width).toBeCloseTo(0.3125, 4); // 200/640
      expect(result[0].bbox.height).toBeCloseTo(0.3125, 4);
      expect(result[0].timestamp).toBeTypeOf('number');
    });

    it('returns empty array on rate limit (429)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
      } as Response);

      const result = await roboflowModule.detectSign('base64image');

      expect(result).toEqual([]);
    });

    it('returns empty array on auth error (401)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
      } as Response);

      const result = await roboflowModule.detectSign('base64image');

      expect(result).toEqual([]);
    });

    it('returns empty array on not found error (404)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      } as Response);

      const result = await roboflowModule.detectSign('base64image');

      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      const result = await roboflowModule.detectSign('base64image');

      expect(result).toEqual([]);
    });

    it('constructs correct API URL', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          predictions: [],
          time: 0.1,
          image: { width: 640, height: 640 },
        }),
      } as Response);

      await roboflowModule.detectSign('base64image');

      expect(fetch).toHaveBeenCalledWith(
        'https://detect.roboflow.com/test-model/1?api_key=test-api-key',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'base64image',
        })
      );
    });

    it('returns empty array when called too fast (rate limiting)', async () => {
      // First call should succeed
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          predictions: [{ class: 'hello', confidence: 0.9, x: 320, y: 320, width: 100, height: 100 }],
          time: 0.1,
          image: { width: 640, height: 640 },
        }),
      } as Response);

      await roboflowModule.detectSign('base64image');

      // Second call immediately after should be rate limited
      const result = await roboflowModule.detectSign('base64image2');
      expect(result).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('allows call after rate limit interval passes', async () => {
      vi.useFakeTimers();

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          predictions: [],
          time: 0.1,
          image: { width: 640, height: 640 },
        }),
      } as Response);

      await roboflowModule.detectSign('base64image1');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Fast forward past the rate limit interval (200ms)
      vi.advanceTimersByTime(250);

      await roboflowModule.detectSign('base64image2');
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('shouldCallAPI', () => {
    it('returns false when motion magnitude is high (> 0.1)', async () => {
      // Reset module to get fresh lastRequestTime
      vi.resetModules();
      roboflowModule = await import('./roboflowService');

      // Even with time elapsed, high motion should block
      const result = roboflowModule.shouldCallAPI(0.5);
      expect(result).toBe(false);
    });

    it('returns true when motion is low and enough time has passed', async () => {
      vi.useFakeTimers();
      vi.resetModules();
      roboflowModule = await import('./roboflowService');

      // Simulate time passing since module load
      vi.advanceTimersByTime(300);

      const result = roboflowModule.shouldCallAPI(0.05);
      expect(result).toBe(true);

      vi.useRealTimers();
    });

    it('returns false immediately after a request', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          predictions: [],
          time: 0.1,
          image: { width: 640, height: 640 },
        }),
      } as Response);

      await roboflowModule.detectSign('base64image');

      // Immediately after, shouldCallAPI should return false
      const result = roboflowModule.shouldCallAPI(0.01);
      expect(result).toBe(false);
    });
  });

  describe('captureFrameAsBase64', () => {
    it('captures frame from video element', () => {
      const mockVideo = {
        videoWidth: 1920,
        videoHeight: 1080,
      } as HTMLVideoElement;

      const result = roboflowModule.captureFrameAsBase64(mockVideo);

      // Should return base64 string without data:image prefix
      expect(result).toBe('mockBase64Image');
    });

    it('handles square video (no cropping needed)', () => {
      const mockVideo = {
        videoWidth: 640,
        videoHeight: 640,
      } as HTMLVideoElement;

      const result = roboflowModule.captureFrameAsBase64(mockVideo);
      expect(result).toBe('mockBase64Image');
    });

    it('handles portrait video (taller than wide)', () => {
      const mockVideo = {
        videoWidth: 720,
        videoHeight: 1280,
      } as HTMLVideoElement;

      const result = roboflowModule.captureFrameAsBase64(mockVideo);
      expect(result).toBe('mockBase64Image');
    });

    it('handles landscape video (wider than tall)', () => {
      const mockVideo = {
        videoWidth: 1280,
        videoHeight: 720,
      } as HTMLVideoElement;

      const result = roboflowModule.captureFrameAsBase64(mockVideo);
      expect(result).toBe('mockBase64Image');
    });

    it('throws error when canvas context is not available', () => {
      // Override mock to return null
      HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      const mockVideo = {
        videoWidth: 640,
        videoHeight: 640,
      } as HTMLVideoElement;

      expect(() => roboflowModule.captureFrameAsBase64(mockVideo)).toThrow('Failed to get canvas context');

      // Restore mock
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
      })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    });
  });
});
