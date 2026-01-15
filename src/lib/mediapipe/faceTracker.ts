import {
  FilesetResolver,
  FaceLandmarker,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { FaceLandmarkResult } from './types';

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

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true,
    });

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
