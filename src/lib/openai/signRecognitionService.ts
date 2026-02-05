/**
 * OpenAI GPT-4o Sign Recognition Service
 * Multimodal sign language interpretation with sentence-level support
 *
 * Uses server-side API route for security (API key not exposed to client)
 */

import type { HandLandmarkResult, FaceLandmarkResult } from '@/lib/mediapipe/types';

// Check if OpenAI is configured (will be validated server-side)
export const isOpenAIConfigured = true; // Always try, server will return error if not configured

/**
 * Hand landmark names for all 21 MediaPipe landmarks
 */
const HAND_LANDMARK_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
];

/**
 * Hand landmark data structure for sign recognition
 */
export interface SignLandmarkData {
  hands: HandLandmarkResult | null;
  face: FaceLandmarkResult | null;
  timestamp: number;
}

/**
 * Video frame for multimodal input
 */
export interface VideoFrame {
  dataUrl: string; // base64 encoded image
  timestamp: number;
}

/**
 * Buffer of landmark frames and video frames for temporal analysis
 */
export interface LandmarkBuffer {
  frames: SignLandmarkData[];
  videoFrames: VideoFrame[];
  startTime: number;
  endTime: number;
}

/**
 * Sign recognition result
 */
export interface SignRecognitionResult {
  text: string;
  confidence: number;
  source: 'openai' | 'openai-vision' | 'mock';
  unclear?: boolean;
}


/**
 * Capture a video frame as base64 image
 * Using full resolution for better hand detail recognition
 */
export function captureVideoFrame(video: HTMLVideoElement): VideoFrame | null {
  if (!video || video.readyState < 2) return null;

  try {
    const canvas = document.createElement('canvas');
    // Use full resolution for better hand detail (capped at 720p for performance)
    const maxWidth = 1280;
    const maxHeight = 720;
    const scale = Math.min(1, maxWidth / video.videoWidth, maxHeight / video.videoHeight);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror the image to match what user sees
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Use high quality JPEG for better hand details
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

    return {
      dataUrl,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[OpenAI SignRecognition] Failed to capture video frame:', error);
    return null;
  }
}

/**
 * Format landmark data for the prompt
 */
function formatLandmarksForPrompt(buffer: LandmarkBuffer): string {
  const frameDescriptions: string[] = [];
  const maxFrames = 60; // More frames for sentence recognition
  const sampleCount = Math.min(buffer.frames.length, maxFrames);
  const step = Math.max(1, Math.floor(buffer.frames.length / sampleCount));

  for (let i = 0; i < buffer.frames.length; i += step) {
    const frame = buffer.frames[i];
    const frameTime = frame.timestamp - buffer.startTime;
    const lines: string[] = [`Frame ${Math.floor(i / step) + 1} (${frameTime.toFixed(0)}ms):`];

    if (frame.hands?.landmarks?.length) {
      frame.hands.landmarks.forEach((hand, handIdx) => {
        const handedness = frame.hands?.handedness?.[handIdx]?.[0]?.categoryName || (handIdx === 0 ? 'Right' : 'Left');
        lines.push(`  ${handedness} Hand:`);

        hand.forEach((landmark, lmIdx) => {
          const name = HAND_LANDMARK_NAMES[lmIdx] || `LM${lmIdx}`;
          lines.push(`    ${name}: (${landmark.x.toFixed(3)}, ${landmark.y.toFixed(3)}, ${landmark.z.toFixed(3)})`);
        });
      });
    } else {
      lines.push('  No hands detected');
    }

    // Face landmarks for non-manual markers
    if (frame.face?.faceLandmarks?.length) {
      const faceLandmarks = frame.face.faceLandmarks[0];
      if (faceLandmarks) {
        lines.push('  Face:');
        const leftEyebrow = faceLandmarks[105];
        const rightEyebrow = faceLandmarks[334];
        const topLip = faceLandmarks[13];
        const bottomLip = faceLandmarks[14];

        if (leftEyebrow) lines.push(`    Left Eyebrow Y: ${leftEyebrow.y.toFixed(3)}`);
        if (rightEyebrow) lines.push(`    Right Eyebrow Y: ${rightEyebrow.y.toFixed(3)}`);
        if (topLip && bottomLip) {
          const mouthOpen = Math.abs(topLip.y - bottomLip.y);
          lines.push(`    Mouth Opening: ${mouthOpen.toFixed(3)}`);
        }
      }
    }

    frameDescriptions.push(lines.join('\n'));
  }

  return frameDescriptions.join('\n\n');
}

/**
 * Recognize sign language using OpenAI GPT-4o via API route
 */
export async function recognizeSignWithOpenAI(
  buffer: LandmarkBuffer,
  lstmHint?: string | null
): Promise<SignRecognitionResult> {
  console.log('[OpenAI SignRecognition] Processing', buffer.frames.length, 'landmark frames,', buffer.videoFrames.length, 'video frames');

  if (lstmHint) {
    console.log('[OpenAI SignRecognition] LSTM hint:', lstmHint);
  }

  try {
    const landmarkText = formatLandmarksForPrompt(buffer);

    // Sample video frames evenly (up to 20 for better temporal context)
    const maxFrames = 20;
    const sampledFrames: VideoFrame[] = [];
    const step = Math.max(1, Math.floor(buffer.videoFrames.length / maxFrames));

    for (let i = 0; i < buffer.videoFrames.length; i += step) {
      if (sampledFrames.length >= maxFrames) break;
      sampledFrames.push(buffer.videoFrames[i]);
    }

    console.log('[OpenAI SignRecognition] Sending', sampledFrames.length, 'video frames to API');

    // Call our secure API route
    const response = await fetch('/api/openai/recognize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoFrames: sampledFrames,
        landmarkText,
        lstmHint,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[OpenAI SignRecognition] API error:', response.status, errorData);
      throw new Error(errorData.error || `API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[OpenAI SignRecognition] GPT-4o response:', result.text || '(empty)', result.unclear ? '(unclear)' : '', '| confidence:', result.confidence);

    // Handle unclear responses - don't fall back to random text
    if (result.unclear || !result.text) {
      return {
        text: '',
        confidence: 0,
        source: result.source || 'openai-vision',
        unclear: true,
      };
    }

    return {
      text: result.text,
      confidence: result.confidence || 0.75,
      source: result.source || 'openai',
    };
  } catch (error) {
    console.error('[OpenAI SignRecognition] Error:', error);
    return getMockRecognition();
  }
}

/**
 * Mock recognition for testing/fallback
 */
function getMockRecognition(): SignRecognitionResult {
  const mockPhrases = [
    'Hello',
    'Thank you',
    'Nice to meet you',
    'How are you?',
    'My name is...',
    'Please help me',
  ];

  const randomPhrase = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];

  return {
    text: randomPhrase,
    confidence: 0.5,
    source: 'mock',
  };
}

/**
 * Create a landmark buffer from accumulated frames
 */
export function createLandmarkBuffer(
  frames: SignLandmarkData[],
  videoFrames: VideoFrame[] = [],
  maxFrames: number = 80
): LandmarkBuffer {
  const recentFrames = frames.slice(-maxFrames);
  const recentVideoFrames = videoFrames.slice(-40); // Keep more video frames for better temporal context

  return {
    frames: recentFrames,
    videoFrames: recentVideoFrames,
    startTime: recentFrames[0]?.timestamp || Date.now(),
    endTime: recentFrames[recentFrames.length - 1]?.timestamp || Date.now(),
  };
}
