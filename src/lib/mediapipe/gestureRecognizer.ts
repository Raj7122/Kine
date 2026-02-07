'use client';

import {
  FilesetResolver,
  GestureRecognizer,
  type GestureRecognizerResult,
} from '@mediapipe/tasks-vision';
import type { GestureResult } from './types';

let gestureRecognizer: GestureRecognizer | null = null;
let isInitializing = false;

const VISION_WASM_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

export async function initializeGestureRecognizer(): Promise<GestureRecognizer> {
  if (gestureRecognizer) {
    return gestureRecognizer;
  }

  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (gestureRecognizer) {
      return gestureRecognizer;
    }
  }

  isInitializing = true;

  try {
    const vision = await FilesetResolver.forVisionTasks(VISION_WASM_PATH);

    gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    });

    return gestureRecognizer;
  } finally {
    isInitializing = false;
  }
}

export function detectGestures(
  video: HTMLVideoElement,
  timestamp: number
): GestureResult | null {
  if (!gestureRecognizer) {
    return null;
  }

  try {
    const result: GestureRecognizerResult = gestureRecognizer.recognizeForVideo(
      video,
      timestamp
    );

    if (!result.gestures || result.gestures.length === 0) {
      return null;
    }

    const primary = getPrimaryGesture(result);
    return primary;
  } catch (error) {
    console.error('Gesture detection error:', error);
    return null;
  }
}

export function getPrimaryGesture(result: GestureRecognizerResult | GestureResult | null): GestureResult | null {
  if (!result) return null;

  // If already normalized
  if ((result as GestureResult).gesture !== undefined) {
    return result as GestureResult;
  }

  const res = result as GestureRecognizerResult;
  const first = res.gestures?.[0]?.[0];
  if (!first) return null;

  const name = first.categoryName || 'None';
  const confidence = typeof first.score === 'number' ? first.score : 0;

  return {
    gesture: name,
    aslMeaning: normalizeGestureToMeaning(name),
    confidence,
  };
}

export function closeGestureRecognizer(): void {
  if (gestureRecognizer) {
    gestureRecognizer.close();
    gestureRecognizer = null;
  }
}

function normalizeGestureToMeaning(gestureName: string): string {
  const normalized = gestureName.trim();

  switch (normalized) {
    case 'Thumb_Up':
      return 'Yes';
    case 'Thumb_Down':
      return 'No';
    case 'Open_Palm':
      return 'Hello';
    case 'Closed_Fist':
      return 'Stop';
    case 'Victory':
      return 'Peace';
    case 'ILoveYou':
      return 'I love you';
    default:
      return normalized === 'None' ? '' : normalized;
  }
}
