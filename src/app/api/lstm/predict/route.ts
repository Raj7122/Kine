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
import * as tf from '@tensorflow/tfjs';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  LSTM_FEATURE_COUNT,
  LSTM_WINDOW_SIZE,
  LSTM_VOCABULARY,
} from '@/config/constants';
import { registerAttentionLayer } from '@/lib/lstm/attentionLayer';

export const runtime = 'nodejs';

const MODEL_DIR = path.join(process.cwd(), 'public', 'models', 'asl_cnn_lstm_25');
const MODEL_JSON_PATH = path.join(MODEL_DIR, 'model.json');
const METADATA_PATH = path.join(MODEL_DIR, 'metadata.json');

const WINDOW_SIZE = LSTM_WINDOW_SIZE;
const FEATURE_COUNT = LSTM_FEATURE_COUNT;

interface LSTMPredictRequest {
  landmarks: number[][]; // Shape: [frames, 63]
}

interface PredictionResult {
  sign: string;
  confidence: number;
  top3: Array<{ sign: string; confidence: number }>;
}

type ModelJSON = {
  format?: string;
  generatedBy?: string;
  convertedBy?: string;
  modelTopology?: unknown;
  weightsManifest?: Array<{
    paths?: string[];
    weights?: tf.io.WeightsManifestEntry[];
  }>;
};

type LSTMMetadata = {
  vocabulary?: string[];
};

let modelStatePromise: Promise<{ model: tf.LayersModel; vocabulary: string[] }> | null = null;

function resolveOutputTensor(output: unknown): tf.Tensor {
  if (output instanceof tf.Tensor) {
    return output;
  }

  if (Array.isArray(output) && output.length > 0 && output[0] instanceof tf.Tensor) {
    return output[0];
  }

  if (output && typeof output === 'object') {
    const firstTensor = Object.values(output as Record<string, unknown>).find(
      (value): value is tf.Tensor => value instanceof tf.Tensor
    );
    if (firstTensor) {
      return firstTensor;
    }
  }

  throw new Error('Model inference produced no tensor outputs');
}

function resolveVocabulary(vocabulary: string[], outputSize: number): string[] {
  if (vocabulary.length === outputSize) {
    return vocabulary;
  }

  if (outputSize <= LSTM_VOCABULARY.length) {
    return [...LSTM_VOCABULARY].slice(0, outputSize);
  }

  const padded = [...vocabulary];
  while (padded.length < outputSize) {
    padded.push(`CLASS_${padded.length}`);
  }
  return padded.slice(0, outputSize);
}

async function readMetadataVocabulary(): Promise<string[]> {
  try {
    const raw = await fs.readFile(METADATA_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as LSTMMetadata;
    if (Array.isArray(parsed.vocabulary) && parsed.vocabulary.length > 0) {
      return parsed.vocabulary.map((entry) => String(entry));
    }
  } catch {
    // Fall through to constants vocabulary below
  }
  return [...LSTM_VOCABULARY];
}

async function loadModelFromDisk(): Promise<{ model: tf.LayersModel; vocabulary: string[] }> {
  registerAttentionLayer(tf);

  const rawModelJson = await fs.readFile(MODEL_JSON_PATH, 'utf-8');
  const parsed = JSON.parse(rawModelJson) as ModelJSON;

  if (!parsed.modelTopology || !Array.isArray(parsed.weightsManifest)) {
    throw new Error('Invalid layers model json: missing topology or weights manifest');
  }

  const shardPaths: string[] = [];
  const weightSpecs: tf.io.WeightsManifestEntry[] = [];

  for (const group of parsed.weightsManifest) {
    if (Array.isArray(group.paths)) {
      shardPaths.push(...group.paths);
    }
    if (Array.isArray(group.weights)) {
      weightSpecs.push(...group.weights);
    }
  }

  if (shardPaths.length === 0 || weightSpecs.length === 0) {
    throw new Error('Invalid layers model json: no weights found');
  }

  const shardBuffers = await Promise.all(
    shardPaths.map(async (relativePath) => {
      const absPath = path.join(MODEL_DIR, relativePath);
      const file = await fs.readFile(absPath);
      return new Uint8Array(file);
    })
  );

  const totalBytes = shardBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const shard of shardBuffers) {
    merged.set(shard, offset);
    offset += shard.byteLength;
  }

  const modelArtifacts: tf.io.ModelArtifacts = {
    modelTopology: parsed.modelTopology,
    format: parsed.format ?? 'layers-model',
    generatedBy: parsed.generatedBy,
    convertedBy: parsed.convertedBy,
    weightSpecs,
    weightData: merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength),
  };

  const ioHandler: tf.io.IOHandler = {
    load: async () => modelArtifacts,
  };

  const model = await tf.loadLayersModel(ioHandler);
  const vocabulary = await readMetadataVocabulary();

  return { model, vocabulary };
}

async function getModelState(): Promise<{ model: tf.LayersModel; vocabulary: string[] }> {
  if (!modelStatePromise) {
    modelStatePromise = loadModelFromDisk().catch((error) => {
      modelStatePromise = null;
      throw error;
    });
  }

  return modelStatePromise;
}

async function predictWithModel(landmarks: number[][]): Promise<PredictionResult> {
  const { model, vocabulary } = await getModelState();

  const inputTensor = tf.tensor3d([landmarks], [1, WINDOW_SIZE, FEATURE_COUNT], 'float32');
  let outputContainer: unknown = null;
  let outputTensor: tf.Tensor | null = null;

  try {
    outputContainer = model.predict(inputTensor);
    outputTensor = resolveOutputTensor(outputContainer);

    const probabilitiesArray = await outputTensor.data();
    const probabilities = Array.from(probabilitiesArray, (v) => Number(v));
    const activeVocabulary = resolveVocabulary(vocabulary, probabilities.length);

    let bestIndex = 0;
    let bestConfidence = -1;
    probabilities.forEach((probability, index) => {
      if (probability > bestConfidence) {
        bestConfidence = probability;
        bestIndex = index;
      }
    });

    const ranked = probabilities
      .map((confidence, index) => ({
        sign: activeVocabulary[index] ?? `CLASS_${index}`,
        confidence,
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    return {
      sign: activeVocabulary[bestIndex] ?? 'UNKNOWN',
      confidence: bestConfidence,
      top3: ranked,
    };
  } finally {
    inputTensor.dispose();

    if (Array.isArray(outputContainer)) {
      outputContainer.forEach((tensor) => {
        if (tensor instanceof tf.Tensor && tensor !== outputTensor) {
          tensor.dispose();
        }
      });
    } else if (outputContainer && typeof outputContainer === 'object' && !(outputContainer instanceof tf.Tensor)) {
      Object.values(outputContainer as Record<string, unknown>).forEach((tensor) => {
        if (tensor instanceof tf.Tensor && tensor !== outputTensor) {
          tensor.dispose();
        }
      });
    }

    outputTensor?.dispose();
  }
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

    const prediction = await predictWithModel(padded);

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

