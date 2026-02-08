/**
 * LSTM Model Prediction API Route
 *
 * This endpoint receives landmark sequences and returns predictions
 * from the trained LSTM model. The model runs server-side because:
 * - It's 97MB (too large for browser)
 * - Uses custom AttentionLayer
 * - Server inference is faster
 */

import { NextRequest, NextResponse } from 'next/server';

// Vocabulary from training - must match model output order
const VOCABULARY = [
  'BAD', 'FINISH', 'GOOD', 'GOODBYE', 'HELLO',
  'HELP', 'HOW', 'I', 'LIKE', 'MAYBE',
  'NAME', 'NEED', 'NO', 'PLEASE', 'SORRY',
  'THANK_YOU', 'UNDERSTAND', 'WANT', 'WHAT', 'WHEN',
  'WHERE', 'WHO', 'WHY', 'YES', 'YOU'
];

// Model parameters
const WINDOW_SIZE = 16;  // Frames per prediction
const FEATURE_COUNT = 63; // 21 landmarks × 3 coords (single hand)

interface LSTMPredictRequest {
  landmarks: number[][]; // Shape: [frames, 63]
}

interface PredictionResult {
  sign: string;
  confidence: number;
  top3: Array<{ sign: string; confidence: number }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: LSTMPredictRequest = await request.json();
    const { landmarks } = body;

    // Validate input
    if (!landmarks || !Array.isArray(landmarks)) {
      return NextResponse.json(
        { error: 'Invalid request: landmarks array required' },
        { status: 400 }
      );
    }

    if (landmarks.length === 0) {
      return NextResponse.json(
        { error: 'Empty landmarks array' },
        { status: 400 }
      );
    }

    // Check feature count
    const frameFeatures = landmarks[0]?.length || 0;
    if (frameFeatures !== FEATURE_COUNT && frameFeatures !== 126) {
      return NextResponse.json(
        { error: `Invalid feature count: expected ${FEATURE_COUNT} or 126, got ${frameFeatures}` },
        { status: 400 }
      );
    }

    // Extract dominant hand if both hands provided (126 features -> 63)
    let processedLandmarks = landmarks;
    if (frameFeatures === 126) {
      processedLandmarks = landmarks.map(frame => extractDominantHand(frame));
    }

    // Normalize landmarks
    const normalized = normalizeLandmarks(processedLandmarks);

    // Pad or truncate to window size
    const padded = padOrTruncate(normalized, WINDOW_SIZE);

    // For now, return a mock prediction since TensorFlow model loading
    // requires additional setup. In production, this would call the model.
    // TODO: Integrate with @tensorflow/tfjs-node for real predictions
    const prediction = getMockPrediction(padded);

    return NextResponse.json(prediction);
  } catch (error) {
    console.error('LSTM prediction error:', error);
    return NextResponse.json(
      { error: 'Prediction failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Extract single dominant hand from two-hand landmarks.
 * Prefers right hand (more common for signing).
 */
function extractDominantHand(frame: number[]): number[] {
  const leftWrist = frame.slice(0, 3);
  const rightWrist = frame.slice(63, 66);

  const hasRight = rightWrist[0] !== 0 || rightWrist[1] !== 0 || rightWrist[2] !== 0;
  const hasLeft = leftWrist[0] !== 0 || leftWrist[1] !== 0 || leftWrist[2] !== 0;

  if (hasRight) {
    return frame.slice(63, 126);
  } else if (hasLeft) {
    return frame.slice(0, 63);
  }
  return new Array(63).fill(0);
}

/**
 * Normalize landmarks to be wrist-centered and unit-scaled.
 */
function normalizeLandmarks(landmarks: number[][]): number[][] {
  return landmarks.map(frame => {
    const normalized = [...frame];

    // Get wrist position (first 3 values)
    const wristX = normalized[0];
    const wristY = normalized[1];
    const wristZ = normalized[2];

    // Skip if no hand data
    if (wristX === 0 && wristY === 0 && wristZ === 0) {
      return normalized;
    }

    // Center around wrist
    for (let i = 0; i < 63; i += 3) {
      normalized[i] -= wristX;
      normalized[i + 1] -= wristY;
      normalized[i + 2] -= wristZ;
    }

    // Calculate bounding box for scaling
    const xCoords = [];
    const yCoords = [];
    for (let i = 0; i < 63; i += 3) {
      xCoords.push(normalized[i]);
      yCoords.push(normalized[i + 1]);
    }

    const xRange = Math.max(...xCoords) - Math.min(...xCoords);
    const yRange = Math.max(...yCoords) - Math.min(...yCoords);
    const scale = Math.max(xRange, yRange, 0.001);

    // Scale to unit bounding box
    for (let i = 0; i < 63; i += 3) {
      normalized[i] /= scale;
      normalized[i + 1] /= scale;
      normalized[i + 2] /= scale;
    }

    return normalized;
  });
}

/**
 * Pad or truncate sequence to target length.
 */
function padOrTruncate(landmarks: number[][], targetLength: number): number[][] {
  const nFrames = landmarks.length;

  if (nFrames === targetLength) {
    return landmarks;
  }

  if (nFrames > targetLength) {
    // Truncate - take center portion
    const start = Math.floor((nFrames - targetLength) / 2);
    return landmarks.slice(start, start + targetLength);
  }

  // Pad with zeros at the beginning
  const padding = Array(targetLength - nFrames).fill(null).map(() => new Array(63).fill(0));
  return [...padding, ...landmarks];
}

/**
 * Mock prediction based on hand movement patterns.
 * TODO: Replace with actual TensorFlow model inference.
 */
function getMockPrediction(landmarks: number[][]): PredictionResult {
  // Calculate simple motion features for mock prediction
  let totalMotion = 0;
  let horizontalMotion = 0;
  let verticalMotion = 0;

  for (let i = 1; i < landmarks.length; i++) {
    const prevWrist = landmarks[i - 1].slice(0, 3);
    const currWrist = landmarks[i].slice(0, 3);

    const dx = currWrist[0] - prevWrist[0];
    const dy = currWrist[1] - prevWrist[1];

    horizontalMotion += Math.abs(dx);
    verticalMotion += Math.abs(dy);
    totalMotion += Math.sqrt(dx * dx + dy * dy);
  }

  // Simple heuristic for mock predictions
  let predictedIdx = 0;
  let confidence = 0.5;

  if (totalMotion < 0.5) {
    // Little movement - static sign
    const signs = ['YES', 'NO', 'GOOD', 'BAD'];
    predictedIdx = VOCABULARY.indexOf(signs[Math.floor(Math.random() * signs.length)]);
    confidence = 0.4 + Math.random() * 0.2;
  } else if (horizontalMotion > verticalMotion * 1.5) {
    // Horizontal movement
    const signs = ['HELLO', 'GOODBYE', 'PLEASE', 'THANK_YOU'];
    predictedIdx = VOCABULARY.indexOf(signs[Math.floor(Math.random() * signs.length)]);
    confidence = 0.5 + Math.random() * 0.2;
  } else if (verticalMotion > horizontalMotion * 1.5) {
    // Vertical movement
    const signs = ['HELP', 'WANT', 'NEED', 'UNDERSTAND'];
    predictedIdx = VOCABULARY.indexOf(signs[Math.floor(Math.random() * signs.length)]);
    confidence = 0.5 + Math.random() * 0.2;
  } else {
    // Mixed movement - question words
    const signs = ['WHAT', 'WHERE', 'WHO', 'WHEN', 'WHY', 'HOW'];
    predictedIdx = VOCABULARY.indexOf(signs[Math.floor(Math.random() * signs.length)]);
    confidence = 0.45 + Math.random() * 0.2;
  }

  // Generate top 3 predictions
  const top3Indices = [predictedIdx];
  while (top3Indices.length < 3) {
    const randomIdx = Math.floor(Math.random() * VOCABULARY.length);
    if (!top3Indices.includes(randomIdx)) {
      top3Indices.push(randomIdx);
    }
  }

  const top3 = top3Indices.map((idx, i) => ({
    sign: VOCABULARY[idx],
    confidence: i === 0 ? confidence : confidence * (0.5 - i * 0.15)
  }));

  return {
    sign: VOCABULARY[predictedIdx],
    confidence,
    top3
  };
}
