import {
  FilesetResolver,
  HandLandmarker,
  HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandLandmarkResult } from './types';
import { MEDIAPIPE_LANDMARK_CONFIDENCE } from '@/config/constants';

let handLandmarker: HandLandmarker | null = null;
let isInitializing = false;

const VISION_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

export async function initializeHandTracker(): Promise<HandLandmarker> {
  if (handLandmarker) {
    return handLandmarker;
  }

  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (handLandmarker) {
      return handLandmarker;
    }
  }

  isInitializing = true;

  try {
    const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);

    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: MEDIAPIPE_LANDMARK_CONFIDENCE,
      minHandPresenceConfidence: MEDIAPIPE_LANDMARK_CONFIDENCE,
      minTrackingConfidence: MEDIAPIPE_LANDMARK_CONFIDENCE,
    });

    return handLandmarker;
  } finally {
    isInitializing = false;
  }
}

export function detectHands(
  video: HTMLVideoElement,
  timestamp: number
): HandLandmarkResult | null {
  if (!handLandmarker) {
    return null;
  }

  try {
    const result: HandLandmarkerResult = handLandmarker.detectForVideo(
      video,
      timestamp
    );

    if (result.landmarks.length === 0) {
      return null;
    }

    return {
      landmarks: result.landmarks,
      worldLandmarks: result.worldLandmarks,
      handedness: result.handedness,
    };
  } catch (error) {
    console.error('Hand detection error:', error);
    return null;
  }
}

export function closeHandTracker(): void {
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
}
