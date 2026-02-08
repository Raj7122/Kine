import {
  FilesetResolver,
  FaceLandmarker,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { FaceLandmarkResult } from './types';
import { MEDIAPIPE_DETECTION_CONFIDENCE, MEDIAPIPE_TRACKING_CONFIDENCE } from '@/config/constants';

let faceLandmarker: FaceLandmarker | null = null;
let isInitializing = false;

const VISION_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

export async function initializeFaceTracker(): Promise<FaceLandmarker> {
  if (faceLandmarker) {
    return faceLandmarker;
  }

  if (isInitializing) {
    // Wait for initialization to complete
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (faceLandmarker) {
      return faceLandmarker;
    }
  }

  isInitializing = true;

  try {
    const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);

    const faceOptions = {
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      minFaceDetectionConfidence: MEDIAPIPE_DETECTION_CONFIDENCE,
      minFacePresenceConfidence: MEDIAPIPE_DETECTION_CONFIDENCE,
      minTrackingConfidence: MEDIAPIPE_TRACKING_CONFIDENCE,
      outputFaceBlendshapes: true,
    };

    // Try GPU delegate first for faster inference, fall back to CPU
    try {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        ...faceOptions,
      });
      console.log('[FaceTracker] Using GPU delegate');
    } catch {
      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        ...faceOptions,
      });
      console.log('[FaceTracker] GPU not available, using CPU delegate');
    }

    return faceLandmarker;
  } finally {
    isInitializing = false;
  }
}

export function detectFace(
  video: HTMLVideoElement,
  timestamp: number
): FaceLandmarkResult | null {
  if (!faceLandmarker) {
    return null;
  }

  try {
    const result: FaceLandmarkerResult = faceLandmarker.detectForVideo(
      video,
      timestamp
    );

    if (result.faceLandmarks.length === 0) {
      return null;
    }

    return {
      faceLandmarks: result.faceLandmarks,
      faceBlendshapes: result.faceBlendshapes,
    };
  } catch (error) {
    console.error('Face detection error:', error);
    return null;
  }
}

export function closeFaceTracker(): void {
  if (faceLandmarker) {
    faceLandmarker.close();
    faceLandmarker = null;
  }
}
