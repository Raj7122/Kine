/**
 * Gemini Multimodal Sign Recognition Service
 * "The Eyes" of the Gemini Sandwich - interprets ASL landmarks + video → English
 *
 * Accuracy improvements:
 * - Sends actual video frames (true multimodal)
 * - Includes all 21 hand landmarks per hand
 * - Includes face landmarks for grammatical markers
 * - Enhanced prompt with ASL handshape references
 */

import type { HandLandmarkResult, FaceLandmarkResult } from '@/lib/mediapipe/types';
import { SIGN_RECOGNITION_FRAME_COUNT, SIGN_RECOGNITION_MAX_LANDMARKS } from '@/config/constants';

// Gemini API configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
const GEMINI_VISION_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

export const isGeminiMultimodalConfigured = !!(
  GEMINI_API_KEY &&
  GEMINI_API_KEY !== 'your-gemini-api-key-here'
);

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
  source: 'gemini' | 'gemini-vision' | 'mock';
}

/**
 * Enhanced system prompt for ASL interpretation with handshape references
 */
const ASL_INTERPRETATION_PROMPT = `You are an expert American Sign Language (ASL) interpreter with deep knowledge of ASL linguistics.

You will receive:
1. Video frames showing someone signing in ASL
2. Hand and face landmark coordinates from MediaPipe

## ASL Handshapes Reference
Common ASL handshapes to recognize:
- **A/S handshape**: Fist with thumb alongside (MOTHER, FATHER, SORRY)
- **B handshape**: Flat hand, fingers together (BOOK, DOOR, THANK-YOU)
- **C handshape**: Curved hand like holding a cup (CUP, CLASS, COOKIE)
- **D handshape**: Index up, others curved to thumb (DOG)
- **F handshape**: Thumb and index touch, others spread (FINE, FATHER)
- **G/Q handshape**: Index and thumb extended parallel (GO, QUESTION)
- **I handshape**: Pinky extended (I, ITALY)
- **L handshape**: L-shape with thumb and index (LIKE, LOSE)
- **O handshape**: All fingers curved to meet thumb (KNOW, THINK)
- **V handshape**: Index and middle extended (SEE, UNDERSTAND)
- **W handshape**: Index, middle, ring extended (WATER, WANT)
- **Y handshape**: Thumb and pinky extended (YES, PHONE, PLAY)
- **5 handshape**: All fingers spread (MOTHER, FINE, KNOW)
- **1 handshape**: Index pointing up (ONE, ME, WAIT)
- **Open-8**: Middle finger bent down (FEEL, SICK)

## Common ASL Signs
- **HELLO**: Wave or B-hand salute from forehead
- **THANK-YOU**: Flat hand from chin outward
- **YES**: S-hand nodding
- **NO**: Index and middle fingers snap to thumb
- **PLEASE**: Flat hand circles on chest
- **SORRY**: A-hand circles on chest
- **HELP**: Thumbs-up on flat palm, lift up
- **I-LOVE-YOU**: Pinky, index, and thumb extended (I+L+Y combined)
- **UNDERSTAND**: Index flicks up near forehead
- **GOOD**: Flat hand from chin to palm
- **BAD**: Flat hand from chin, flip down
- **WANT**: Claw hands pull toward body
- **NEED**: X-hand bends down repeatedly
- **LIKE**: Middle finger and thumb pull from chest
- **NAME**: H-hands tap together
- **WHAT**: Index draws line across palm
- **WHERE**: Index waves side to side
- **WHO**: Circle around mouth with index
- **WHEN**: Index circles, lands on other index
- **WHY**: Touch forehead, pull down to Y-hand
- **HOW**: Backs of hands together, roll out
- **FINISH/DONE**: 5-hands flip outward

## Non-Manual Markers (Face/Body)
Pay attention to:
- **Raised eyebrows**: Yes/no questions, conditionals
- **Furrowed eyebrows**: WH-questions (what, where, who, why, how)
- **Head tilt**: Questions, topic markers
- **Head shake**: Negation
- **Mouth morphemes**: Intensity, manner (e.g., "CHA" for large, "MM" for enjoyment)

## Hand Landmark Structure
21 landmarks per hand:
- WRIST (0)
- THUMB: CMC(1), MCP(2), IP(3), TIP(4)
- INDEX: MCP(5), PIP(6), DIP(7), TIP(8)
- MIDDLE: MCP(9), PIP(10), DIP(11), TIP(12)
- RING: MCP(13), PIP(14), DIP(15), TIP(16)
- PINKY: MCP(17), PIP(18), DIP(19), TIP(20)

## Fingerspelling (Single Letters)
When a handshape is held STATIC (no movement), it's likely fingerspelling a letter:
- **Y**: Thumb and pinky extended, others closed → Return "Y" (the letter)
- **A**: Fist with thumb alongside → Return "A"
- **B**: Flat hand, fingers together, thumb tucked → Return "B"
- **C**: Curved hand like a C → Return "C"
- **I**: Pinky only extended → Return "I"
- **L**: Thumb and index in L-shape → Return "L"
- **O**: Fingers curved to meet thumb → Return "O"
- **V**: Index and middle extended in V → Return "V"
- **W**: Index, middle, ring extended → Return "W"

## Instructions
1. FIRST check if this is a STATIC handshape (fingerspelling a letter)
   - If hand is mostly still and matches a letter handshape, return just the letter (e.g., "Y")
2. If there is MOVEMENT, it's likely a sign - match to known ASL signs
3. Analyze the video frames to see the actual hand shapes and movements
4. Use landmark data to confirm precise finger positions
5. Note any facial expressions for grammatical context

Return ONLY the English translation of what is being signed.
- For fingerspelled letters, return just the letter: "Y", "A", "B", etc.
- For signs, return the English meaning: "Hello", "Thank you", etc.
- Do NOT return colors or objects unless the person is clearly signing about them.`;

/**
 * Capture a video frame as base64 image
 */
export function captureVideoFrame(video: HTMLVideoElement): VideoFrame | null {
  if (!video || video.readyState < 2) return null;

  try {
    const canvas = document.createElement('canvas');
    // Use smaller resolution for API efficiency
    const scale = 0.5;
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror the image to match what user sees
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

    return {
      dataUrl,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('[SignRecognition] Failed to capture video frame:', error);
    return null;
  }
}

/**
 * Format ALL landmark data for Gemini input (all 21 landmarks per hand + face)
 */
function formatLandmarksForPrompt(buffer: LandmarkBuffer): string {
  const frameDescriptions: string[] = [];

  // Sample frames evenly across the buffer
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
        // Key face landmarks for ASL interpretation
        // Eyebrows (for question markers)
        const leftEyebrow = faceLandmarks[105]; // Left eyebrow
        const rightEyebrow = faceLandmarks[334]; // Right eyebrow
        const noseTip = faceLandmarks[4]; // Nose tip
        const chin = faceLandmarks[152]; // Chin
        const leftMouth = faceLandmarks[61]; // Left mouth corner
        const rightMouth = faceLandmarks[291]; // Right mouth corner
        const topLip = faceLandmarks[13]; // Top lip center
        const bottomLip = faceLandmarks[14]; // Bottom lip center

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

/**
 * Recognize sign language using Gemini with video frames (true multimodal)
 */
export async function recognizeSign(buffer: LandmarkBuffer): Promise<SignRecognitionResult> {
  console.log('[SignRecognition] Processing', buffer.frames.length, 'landmark frames,', buffer.videoFrames.length, 'video frames');

  if (!isGeminiMultimodalConfigured) {
    console.log('[SignRecognition] Gemini not configured, using mock');
    return getMockRecognition();
  }

  try {
    const landmarkText = formatLandmarksForPrompt(buffer);

    // Build multimodal content with video frames
    const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> = [];

    // Add system prompt
    parts.push({ text: ASL_INTERPRETATION_PROMPT });

    // Add video frames (sample evenly)
    if (buffer.videoFrames.length > 0) {
      const frameCount = Math.min(buffer.videoFrames.length, SIGN_RECOGNITION_FRAME_COUNT);
      const step = Math.max(1, Math.floor(buffer.videoFrames.length / frameCount));

      parts.push({ text: '\n\n## Video Frames\nHere are video frames showing the signing:' });

      for (let i = 0; i < buffer.videoFrames.length; i += step) {
        if (parts.filter(p => 'inline_data' in p).length >= SIGN_RECOGNITION_FRAME_COUNT) break;

        const frame = buffer.videoFrames[i];
        const base64Data = frame.dataUrl.replace(/^data:image\/\w+;base64,/, '');

        parts.push({
          inline_data: {
            mime_type: 'image/jpeg',
            data: base64Data,
          },
        });
      }

      console.log('[SignRecognition] Sending', parts.filter(p => 'inline_data' in p).length, 'video frames to Gemini');
    }

    // Add landmark data
    parts.push({ text: `\n\n## Landmark Data\nHere are the precise hand and face landmark coordinates:\n\n${landmarkText}` });

    // Final instruction
    parts.push({ text: '\n\n## Task\nBased on the video frames and landmark data above, what is being signed? Respond with ONLY the English translation.' });

    const response = await fetch(`${GEMINI_VISION_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts,
          },
        ],
        generationConfig: {
          temperature: 0.2, // Lower temperature for more consistent recognition
          maxOutputTokens: 150,
        },
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
    const cleanedText = responseText
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/^(The person is signing |The sign means |This means |Translation: )/i, '');

    console.log('[SignRecognition] Gemini response:', cleanedText);

    return {
      text: cleanedText || 'Hello',
      confidence: buffer.videoFrames.length > 0 ? 0.9 : 0.75,
      source: buffer.videoFrames.length > 0 ? 'gemini-vision' : 'gemini',
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
