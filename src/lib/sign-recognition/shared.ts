/**
 * Shared types and utilities for sign recognition across providers (Gemini, OpenAI).
 *
 * This module is the single source of truth for:
 * - SignLandmarkData, VideoFrame, LandmarkBuffer types
 * - HAND_LANDMARK_NAMES constant
 * - captureVideoFrame (client-side frame capture)
 * - formatLandmarksForPrompt (landmark text formatting for AI prompts)
 * - createLandmarkBuffer (buffer slicing)
 */

import type { HandLandmarkResult, FaceLandmarkResult } from '@/lib/mediapipe/types';
import { SIGN_RECOGNITION_FRAME_COUNT, SIGN_RECOGNITION_MAX_LANDMARKS } from '@/config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hand landmark names for all 21 MediaPipe landmarks
 */
export const HAND_LANDMARK_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
] as const;

// ---------------------------------------------------------------------------
// Client-side utilities
// ---------------------------------------------------------------------------

/**
 * Capture a video frame as base64 image.
 * Caps resolution to 640×480 for efficient payload sizes (~30-60 KB per frame).
 */
export function captureVideoFrame(video: HTMLVideoElement): VideoFrame | null {
  if (!video || video.readyState < 2) return null;

  try {
    const canvas = document.createElement('canvas');
    const maxWidth = 640;
    const maxHeight = 480;
    const scale = Math.min(1, maxWidth / video.videoWidth, maxHeight / video.videoHeight);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror the image to match what user sees
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.65);

    return {
      dataUrl,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[SignRecognition] Failed to capture video frame:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prompt formatting (used server-side in API routes)
// ---------------------------------------------------------------------------

/**
 * Format ALL landmark data for AI prompt input (all 21 landmarks per hand + face).
 */
export function formatLandmarksForPrompt(buffer: LandmarkBuffer): string {
  const frameDescriptions: string[] = [];

  const sampleCount = Math.min(buffer.frames.length, SIGN_RECOGNITION_MAX_LANDMARKS);
  const step = Math.max(1, Math.floor(buffer.frames.length / sampleCount));

  for (let i = 0; i < buffer.frames.length; i += step) {
    const frame = buffer.frames[i];
    const frameTime = frame.timestamp - buffer.startTime;
    const lines: string[] = [`Frame ${Math.floor(i / step) + 1} (${frameTime.toFixed(0)}ms):`];

    // Include ALL hand landmarks
    if (frame.hands?.landmarks?.length) {
      frame.hands.landmarks.forEach((hand, handIdx) => {
        const handedness = frame.hands?.handedness?.[handIdx]?.[0]?.categoryName || (handIdx === 0 ? 'Right' : 'Left');
        lines.push(`  ${handedness} Hand:`);

        // All 21 landmarks
        hand.forEach((landmark, lmIdx) => {
          const name = HAND_LANDMARK_NAMES[lmIdx] || `LM${lmIdx}`;
          lines.push(`    ${name}: (${landmark.x.toFixed(3)}, ${landmark.y.toFixed(3)}, ${landmark.z.toFixed(3)})`);
        });
      });
    } else {
      lines.push('  No hands detected');
    }

    // Include face landmarks for non-manual markers
    if (frame.face?.faceLandmarks?.length) {
      const faceLandmarks = frame.face.faceLandmarks[0];
      if (faceLandmarks) {
        lines.push('  Face:');
        const leftEyebrow = faceLandmarks[105];
        const rightEyebrow = faceLandmarks[334];
        const noseTip = faceLandmarks[4];
        const chin = faceLandmarks[152];
        const leftMouth = faceLandmarks[61];
        const rightMouth = faceLandmarks[291];
        const topLip = faceLandmarks[13];
        const bottomLip = faceLandmarks[14];

        if (leftEyebrow) lines.push(`    Left Eyebrow: (${leftEyebrow.x.toFixed(3)}, ${leftEyebrow.y.toFixed(3)})`);
        if (rightEyebrow) lines.push(`    Right Eyebrow: (${rightEyebrow.x.toFixed(3)}, ${rightEyebrow.y.toFixed(3)})`);
        if (noseTip) lines.push(`    Nose: (${noseTip.x.toFixed(3)}, ${noseTip.y.toFixed(3)})`);
        if (chin) lines.push(`    Chin: (${chin.x.toFixed(3)}, ${chin.y.toFixed(3)})`);
        if (topLip && bottomLip) {
          const mouthOpen = Math.abs(topLip.y - bottomLip.y);
          lines.push(`    Mouth Opening: ${mouthOpen.toFixed(3)}`);
        }
        if (leftMouth && rightMouth) {
          const mouthWidth = Math.abs(leftMouth.x - rightMouth.x);
          lines.push(`    Mouth Width: ${mouthWidth.toFixed(3)}`);
        }
      }
    }

    frameDescriptions.push(lines.join('\n'));
  }

  return frameDescriptions.join('\n\n');
}

// ---------------------------------------------------------------------------
// Buffer construction
// ---------------------------------------------------------------------------

/**
 * Create a landmark buffer from accumulated frames.
 */
export function createLandmarkBuffer(
  frames: SignLandmarkData[],
  videoFrames: VideoFrame[] = [],
  maxFrames: number = SIGN_RECOGNITION_MAX_LANDMARKS
): LandmarkBuffer {
  const recentFrames = frames.slice(-maxFrames);
  const recentVideoFrames = videoFrames.slice(-SIGN_RECOGNITION_FRAME_COUNT * 2);

  return {
    frames: recentFrames,
    videoFrames: recentVideoFrames,
    startTime: recentFrames[0]?.timestamp || Date.now(),
    endTime: recentFrames[recentFrames.length - 1]?.timestamp || Date.now(),
  };
}
