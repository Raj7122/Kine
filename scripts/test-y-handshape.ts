/**
 * Test script to simulate Y handshape and see Gemini's recognition
 * Run with: npx ts-node --esm scripts/test-y-handshape.ts
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Use Gemini 3.0 Flash Preview
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// Y handshape: thumb and pinky extended, other fingers curled
// Simulating a static Y held in front of camera
function generateYHandshapeLandmarks() {
  // Normalized coordinates (0-1), hand centered in frame
  // Y handshape characteristics:
  // - Thumb extended outward (low x, mid y)
  // - Pinky extended outward (high x, mid y)
  // - Index, middle, ring fingers curled into palm

  const wrist = { x: 0.5, y: 0.7, z: 0 };

  // Thumb - extended outward to the side
  const thumb_cmc = { x: 0.45, y: 0.65, z: 0 };
  const thumb_mcp = { x: 0.38, y: 0.60, z: 0 };
  const thumb_ip = { x: 0.32, y: 0.55, z: 0 };
  const thumb_tip = { x: 0.28, y: 0.50, z: 0 }; // Extended far out

  // Index finger - curled into palm
  const index_mcp = { x: 0.48, y: 0.55, z: 0 };
  const index_pip = { x: 0.47, y: 0.50, z: 0.02 };
  const index_dip = { x: 0.48, y: 0.52, z: 0.04 }; // Curled back
  const index_tip = { x: 0.50, y: 0.55, z: 0.05 }; // Near palm

  // Middle finger - curled into palm
  const middle_mcp = { x: 0.52, y: 0.54, z: 0 };
  const middle_pip = { x: 0.52, y: 0.49, z: 0.02 };
  const middle_dip = { x: 0.52, y: 0.51, z: 0.04 };
  const middle_tip = { x: 0.52, y: 0.54, z: 0.05 };

  // Ring finger - curled into palm
  const ring_mcp = { x: 0.56, y: 0.55, z: 0 };
  const ring_pip = { x: 0.56, y: 0.50, z: 0.02 };
  const ring_dip = { x: 0.56, y: 0.52, z: 0.04 };
  const ring_tip = { x: 0.56, y: 0.55, z: 0.05 };

  // Pinky - extended outward to the side
  const pinky_mcp = { x: 0.60, y: 0.58, z: 0 };
  const pinky_pip = { x: 0.65, y: 0.55, z: 0 };
  const pinky_dip = { x: 0.70, y: 0.52, z: 0 };
  const pinky_tip = { x: 0.75, y: 0.50, z: 0 }; // Extended far out

  return [
    wrist,
    thumb_cmc, thumb_mcp, thumb_ip, thumb_tip,
    index_mcp, index_pip, index_dip, index_tip,
    middle_mcp, middle_pip, middle_dip, middle_tip,
    ring_mcp, ring_pip, ring_dip, ring_tip,
    pinky_mcp, pinky_pip, pinky_dip, pinky_tip,
  ];
}

const HAND_LANDMARK_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
];

async function testYHandshape() {
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  console.log('Testing Y handshape recognition...\n');

  const landmarks = generateYHandshapeLandmarks();

  // Format landmarks as text
  let landmarkText = 'Frame 1 (0ms):\n  Right Hand:\n';
  landmarks.forEach((lm, idx) => {
    landmarkText += `    ${HAND_LANDMARK_NAMES[idx]}: (${lm.x.toFixed(3)}, ${lm.y.toFixed(3)}, ${lm.z.toFixed(3)})\n`;
  });

  // Generate a few more "frames" to simulate static hold
  for (let frame = 2; frame <= 5; frame++) {
    landmarkText += `\nFrame ${frame} (${(frame - 1) * 200}ms):\n  Right Hand:\n`;
    landmarks.forEach((lm, idx) => {
      // Add tiny variation to simulate real detection
      const jitter = () => (Math.random() - 0.5) * 0.01;
      landmarkText += `    ${HAND_LANDMARK_NAMES[idx]}: (${(lm.x + jitter()).toFixed(3)}, ${(lm.y + jitter()).toFixed(3)}, ${(lm.z + jitter()).toFixed(3)})\n`;
    });
  }

  const prompt = `You are an expert American Sign Language (ASL) interpreter.

You will receive hand landmark coordinates from MediaPipe showing someone signing.

## ASL Handshapes Reference
- **Y handshape**: Thumb and pinky extended, other fingers closed (used in: Y, YES, PHONE, PLAY, WHY)
- **I handshape**: Pinky extended only (I, ITALY)
- **A handshape**: Fist with thumb alongside
- **5 handshape**: All fingers spread

## ASL Fingerspelling
The letter Y is signed with the Y handshape held still.

## Instructions
Look at the landmark positions:
- Are thumb and pinky extended while other fingers are curled?
- Is this a static hold (fingerspelling) or a moving sign?

Based on the landmarks, what is being signed?
Return ONLY the English interpretation.

## Landmark Data
${landmarkText}

What is being signed?`;

  console.log('Sending to Gemini...\n');

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 100 },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('API Error:', response.status, error);
      return;
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

    console.log('=== GEMINI RESPONSE ===');
    console.log(result.trim());
    console.log('=======================\n');

    console.log('Expected: "Y" (the letter) or a Y-handshape sign like YES, PLAY, PHONE');

  } catch (error) {
    console.error('Error:', error);
  }
}

testYHandshape();
