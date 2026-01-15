/**
 * Gemini Multimodal Sign Recognition Service
 * "The Eyes" of the Gemini Sandwich - interprets ASL landmarks → English
 */

import type { Landmark, HandLandmarkResult, FaceLandmarkResult } from '@/lib/mediapipe/types';

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const GEMINI_MULTIMODAL_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export const isGeminiMultimodalConfigured = !!(
  GEMINI_API_KEY &&
  GEMINI_API_KEY !== 'your-gemini-api-key-here'
);

/**
 * Hand landmark data structure for sign recognition
 */
export interface SignLandmarkData {
  hands: HandLandmarkResult | null;
  face: FaceLandmarkResult | null;
  timestamp: number;
}

/**
 * Buffer of landmark frames for temporal analysis
 */
export interface LandmarkBuffer {
  frames: SignLandmarkData[];
  startTime: number;
  endTime: number;
}

/**
 * Sign recognition result
 */
export interface SignRecognitionResult {
  text: string;
  confidence: number;
  source: 'gemini' | 'mock';
}

/**
 * System prompt for ASL interpretation
 */
const ASL_INTERPRETATION_PROMPT = `You are an expert American Sign Language (ASL) interpreter.

You will receive hand and face landmark coordinates captured from a video of someone signing in ASL.
Each landmark has x, y, z coordinates normalized to 0-1.

Hand landmarks follow the MediaPipe hand model:
- 21 landmarks per hand (WRIST, THUMB_*, INDEX_*, MIDDLE_*, RING_*, PINKY_*)
- The sequence shows motion over time

Face landmarks provide context for:
- Eyebrow position (affects meaning)
- Mouth shape (grammatical markers)
- Head tilt (questions, negation)

Based on the landmark positions and movements, interpret what ASL sign or phrase is being performed.

Rules:
1. Focus on the overall gesture pattern, not exact coordinates
2. Consider the motion trajectory across frames
3. Account for common ASL signs like: HELLO, THANK-YOU, YES, NO, PLEASE, SORRY, HELP, etc.
4. If unsure, provide your best guess with lower confidence
5. Return ONLY the English interpretation, nothing else

Example responses:
- "Hello"
- "Thank you"
- "How are you?"
- "Nice to meet you"`;

/**
 * Format landmark data for Gemini input
 */
function formatLandmarksForPrompt(buffer: LandmarkBuffer): string {
  const frameDescriptions: string[] = [];

  buffer.frames.forEach((frame, idx) => {
    const frameTime = frame.timestamp - buffer.startTime;
    let description = `Frame ${idx + 1} (${frameTime.toFixed(0)}ms):`;

    if (frame.hands && frame.hands.landmarks && frame.hands.landmarks.length > 0) {
      frame.hands.landmarks.forEach((hand, handIdx) => {
        const handedness = frame.hands?.handedness?.[handIdx]?.[0]?.categoryName || (handIdx === 0 ? 'Right' : 'Left');
        // Summarize key landmarks for efficiency
        const wrist = hand[0];
        const indexTip = hand[8];
        const thumbTip = hand[4];
        const middleTip = hand[12];

        description += `\n  ${handedness} Hand:`;
        description += `\n    Wrist: (${wrist.x.toFixed(2)}, ${wrist.y.toFixed(2)})`;
        description += `\n    Index Tip: (${indexTip.x.toFixed(2)}, ${indexTip.y.toFixed(2)})`;
        description += `\n    Thumb Tip: (${thumbTip.x.toFixed(2)}, ${thumbTip.y.toFixed(2)})`;
        description += `\n    Middle Tip: (${middleTip.x.toFixed(2)}, ${middleTip.y.toFixed(2)})`;
      });
    } else {
      description += '\n  No hands detected';
    }

    frameDescriptions.push(description);
  });

  return frameDescriptions.join('\n\n');
}

/**
 * Recognize sign language from landmark buffer using Gemini Multimodal
 */
export async function recognizeSign(buffer: LandmarkBuffer): Promise<SignRecognitionResult> {
  console.log('[SignRecognition] Processing', buffer.frames.length, 'frames');

  // Check if Gemini is configured
  if (!isGeminiMultimodalConfigured) {
    console.log('[SignRecognition] Gemini not configured, using mock');
    return getMockRecognition();
  }

  try {
    const landmarkText = formatLandmarksForPrompt(buffer);

    const response = await fetch(`${GEMINI_MULTIMODAL_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: ASL_INTERPRETATION_PROMPT },
              { text: `\nHere are the landmark frames to interpret:\n\n${landmarkText}\n\nWhat is being signed?` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 100,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[SignRecognition] API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Clean up the response
    const cleanedText = responseText.trim().replace(/^["']|["']$/g, '');

    console.log('[SignRecognition] Gemini response:', cleanedText);

    return {
      text: cleanedText || 'Hello',
      confidence: 0.8,
      source: 'gemini',
    };
  } catch (error) {
    console.error('[SignRecognition] Error:', error);
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
    'How are you?',
    'Nice to meet you',
    'Please help me',
    'Yes',
    'No',
  ];

  const randomPhrase = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];

  return {
    text: randomPhrase,
    confidence: 0.6,
    source: 'mock',
  };
}

/**
 * Create a landmark buffer from accumulated frames
 */
export function createLandmarkBuffer(
  frames: SignLandmarkData[],
  maxFrames: number = 30
): LandmarkBuffer {
  // Keep only the most recent frames
  const recentFrames = frames.slice(-maxFrames);

  return {
    frames: recentFrames,
    startTime: recentFrames[0]?.timestamp || Date.now(),
    endTime: recentFrames[recentFrames.length - 1]?.timestamp || Date.now(),
  };
}
