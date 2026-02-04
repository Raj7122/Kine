// Roboflow API client for ASL sign detection

import {
  RoboflowResponse,
  RoboflowDetection,
  RoboflowError,
} from './types';
import { getRoboflowConfig, isRoboflowConfigured } from './config';
import {
  ROBOFLOW_MAX_CONCURRENT,
  ROBOFLOW_INFERENCE_INTERVAL,
  ROBOFLOW_IMAGE_SIZE,
} from '@/config/constants';

// Track active requests for rate limiting
let activeRequests = 0;
let lastRequestTime = 0;

/**
 * Detect ASL signs in an image using Roboflow's hosted inference API
 * @param imageBase64 Base64 encoded image (without data:image prefix)
 * @returns Array of detected signs with bounding boxes
 */
export async function detectSign(imageBase64: string): Promise<RoboflowDetection[]> {
  if (!isRoboflowConfigured()) {
    console.warn('Roboflow not configured, skipping detection');
    return [];
  }

  // Rate limiting check
  const now = Date.now();
  if (now - lastRequestTime < ROBOFLOW_INFERENCE_INTERVAL) {
    return [];
  }

  // Concurrent request limit
  if (activeRequests >= ROBOFLOW_MAX_CONCURRENT) {
    console.debug('Max concurrent Roboflow requests reached, skipping');
    return [];
  }

  const config = getRoboflowConfig();
  const url = `${config.apiUrl}/${config.modelId}/${config.version}?api_key=${config.apiKey}`;

  activeRequests++;
  lastRequestTime = now;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: imageBase64,
    });

    if (!response.ok) {
      const error = await handleApiError(response);
      throw error;
    }

    const data: RoboflowResponse = await response.json();

    // Normalize predictions to 0-1 coordinates
    return data.predictions.map((p) => ({
      class: p.class,
      confidence: p.confidence,
      bbox: {
        x: (p.x - p.width / 2) / data.image.width,
        y: (p.y - p.height / 2) / data.image.height,
        width: p.width / data.image.width,
        height: p.height / data.image.height,
      },
      timestamp: Date.now(),
    }));
  } catch (error) {
    if (error instanceof Error) {
      console.error('Roboflow API error:', error.message);
    }
    return [];
  } finally {
    activeRequests--;
  }
}

/**
 * Extract base64 image from video element for API submission
 * @param video HTMLVideoElement to capture
 * @returns Base64 encoded image string (without data:image prefix)
 */
export function captureFrameAsBase64(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  const size = ROBOFLOW_IMAGE_SIZE;
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Calculate center crop to maintain aspect ratio
  const videoAspect = video.videoWidth / video.videoHeight;
  let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;

  if (videoAspect > 1) {
    // Video is wider, crop horizontally
    sw = video.videoHeight;
    sx = (video.videoWidth - sw) / 2;
  } else if (videoAspect < 1) {
    // Video is taller, crop vertically
    sh = video.videoWidth;
    sy = (video.videoHeight - sh) / 2;
  }

  // Draw resized and cropped image
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, size, size);

  // Get base64 without the data:image/jpeg;base64, prefix
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return dataUrl.split(',')[1];
}

/**
 * Check if motion magnitude allows API call (skip during rapid motion)
 * @param motionMagnitude Normalized motion value (0-1)
 */
export function shouldCallAPI(motionMagnitude: number): boolean {
  const now = Date.now();

  // Respect minimum interval
  if (now - lastRequestTime < ROBOFLOW_INFERENCE_INTERVAL) {
    return false;
  }

  // Skip API during rapid motion (save credits, detection unreliable anyway)
  if (motionMagnitude > 0.1) {
    return false;
  }

  return true;
}

async function handleApiError(response: Response): Promise<RoboflowError> {
  let message = `Roboflow API error: ${response.status}`;
  let retryAfter: number | undefined;

  if (response.status === 429) {
    // Rate limited
    const retryHeader = response.headers.get('Retry-After');
    retryAfter = retryHeader ? parseInt(retryHeader, 10) : 60;
    message = `Rate limited. Retry after ${retryAfter} seconds`;
  } else if (response.status === 401) {
    message = 'Invalid Roboflow API key';
  } else if (response.status === 404) {
    message = 'Roboflow model not found. Check MODEL_ID and VERSION';
  }

  return { message, status: response.status, retryAfter };
}

/**
 * Test Roboflow API connectivity
 * Exposed for browser console testing
 */
export async function testRoboflowAPI(): Promise<boolean> {
  if (!isRoboflowConfigured()) {
    console.error('Roboflow not configured. Set NEXT_PUBLIC_ROBOFLOW_API_KEY and NEXT_PUBLIC_ROBOFLOW_MODEL_ID');
    return false;
  }

  console.log('Testing Roboflow API connection...');
  const config = getRoboflowConfig();
  console.log(`Model: ${config.modelId} v${config.version}`);

  // Create a small test image (1x1 black pixel)
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, 64, 64);
  }
  const testImage = canvas.toDataURL('image/jpeg').split(',')[1];

  try {
    const result = await detectSign(testImage);
    console.log('Roboflow API test successful!');
    console.log('Detections:', result);
    return true;
  } catch (error) {
    console.error('Roboflow API test failed:', error);
    return false;
  }
}

// Expose test function to window for browser console testing
if (typeof window !== 'undefined') {
  (window as unknown as { testRoboflowAPI: typeof testRoboflowAPI }).testRoboflowAPI = testRoboflowAPI;
}
