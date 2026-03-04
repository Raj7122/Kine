import { NextRequest, NextResponse } from 'next/server';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * System prompt for ASL interpretation - optimized for accuracy with better fallbacks
 */
const ASL_SYSTEM_PROMPT = `You are an expert ASL (American Sign Language) interpreter. You will analyze a sequence of video frames showing someone signing.

## CRITICAL INSTRUCTIONS
1. The frames are in CHRONOLOGICAL ORDER - frame 1 is earliest, last frame is most recent
2. Watch for MOVEMENT between frames - ASL signs have motion
3. Focus on the COMPLETE GESTURE from start to finish
4. Return ONLY the English meaning - no explanations

## RECOGNITION APPROACH
1. Look at ALL frames to understand the complete sign motion
2. Identify the handshape (which fingers are extended)
3. Note hand location (near face, chest, neutral space)
4. Track movement direction and type across frames

## Common Single Signs to Check
HELLO: Wave near head, OR flat hand salute from forehead
THANK YOU: Flat hand touches chin, moves outward/down
YES: Fist (S-hand) nods up and down like nodding head
NO: Index+middle fingers snap to thumb (like beak closing)
PLEASE: Flat hand circles on chest
SORRY: Fist circles on chest
GOOD: Flat hand from chin forward
BAD: Flat hand from chin, palm flips down
WHAT: Palms up, shake side-to-side OR index across palm
WHERE: Index finger shakes/waves side-to-side
WHO: Index circles around lips/chin
WHY: Touch forehead, hand becomes Y-shape moving down
HOW: Knuckles together, hands roll/open outward
HELP: Thumbs-up on flat palm, lifts up
WANT: Palms up, pull toward body with bent fingers
NEED: X-hand (bent index) bobs downward
LIKE: Middle finger + thumb pull away from chest
LOVE: Arms cross on chest, OR fists over heart
I-LOVE-YOU: Thumb + index + pinky extended together (ILY)
NAME: H-hands (index+middle) tap together
MY/MINE: Flat palm on chest

## Handshapes Reference
- Fist/S/A: Closed hand
- B/flat: Open flat hand, fingers together
- 5/open: All fingers spread
- Index/1/D: Index pointing
- ILY: Pinky + Index + Thumb (I Love You handshape)
- Y: Thumb + Pinky only
- L: Thumb + Index in L-shape
- V: Index + Middle (peace sign)
- C: Curved like holding cup

## FINGERSPELLED LETTERS (CRITICAL - commonly confused)
These are SINGLE LETTERS from the ASL manual alphabet:
- **I**: ONLY pinky extended, hand STATIC (no movement), palm facing viewer
- **J**: ONLY pinky extended, hand traces a J-curve DOWNWARD (dynamic motion required!)
- **Y**: Thumb + Pinky extended (NO index finger), hand STATIC
- **I-LOVE-YOU (ILY)**: Thumb + Index + Pinky ALL extended together — this is NOT a letter, it's a sign

## CRITICAL DISAMBIGUATION: J vs I vs ILY vs Y
1. Count the extended fingers carefully across ALL frames:
   - 1 finger (pinky only) + NO motion = letter "I"
   - 1 finger (pinky only) + DOWNWARD CURVE motion = letter "J"
   - 2 fingers (thumb + pinky, index folded) = letter "Y"
   - 3 fingers (thumb + index + pinky) = "I love you" (ILY)
2. For "J": the KEY indicator is the pinky tracing a curved/hook path downward across frames
3. If the hint says "ILY" but you only see pinky extended (no index, no thumb), override the hint — it is "I" or "J"

## OUTPUT FORMAT
- Return ONLY the English word(s) or letter that match the sign
- For fingerspelled letters, return just the letter: "J", "I", "Y"
- If multiple signs in sequence, list them naturally: "thank you", "how are you"
- Be brief and direct
- NEVER explain or describe - just give the meaning
- If hands not visible: respond "unclear gesture"`;

export async function POST(request: NextRequest) {
  if (!OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OpenAI API key not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { videoFrames, landmarkText: _landmarkText, lstmHint } = body;

    // Build messages array with images
    const content: Array<{ type: string; text?: string; image_url?: { url: string; detail: string } }> = [];

    // Add instruction text
    const frameCount = videoFrames?.length || 0;

    content.push({
      type: 'text',
      text: `Here are ${frameCount} video frames in CHRONOLOGICAL ORDER (first frame = start of sign, last frame = end of sign).

${lstmHint ? `Hint from motion analysis: ${lstmHint}\n\n` : ''}Watch the COMPLETE MOTION from frame 1 to frame ${frameCount}:
- What handshape do you see? (fist, flat hand, pointing, ILY, etc.)
- Where is the hand? (face, chin, chest, neutral space)
- How does it MOVE across the frames?

Give ONLY the English meaning. No explanations.
If hands not visible in most frames, say "unclear gesture".

What sign is this?`,
    });

    // Add video frames with high detail for better accuracy
    // Send up to 20 frames for better temporal context
    if (videoFrames && Array.isArray(videoFrames)) {
      const maxFrames = 20;
      const framesToSend = videoFrames.slice(0, maxFrames);

      // Add frame numbers to help model understand sequence
      for (let i = 0; i < framesToSend.length; i++) {
        const frame = framesToSend[i];
        content.push({
          type: 'image_url',
          image_url: {
            url: frame.dataUrl,
            detail: 'high', // High detail for better hand recognition
          },
        });
      }
    }

    console.log('[OpenAI API] Sending', videoFrames?.length || 0, 'video frames to GPT-4o');

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: ASL_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content,
          },
        ],
        max_tokens: 100, // Short responses only
        temperature: 0.1, // More deterministic for accuracy
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[OpenAI API] Error:', response.status, errorText);
      return NextResponse.json(
        { error: `OpenAI API error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const responseText = data.choices?.[0]?.message?.content || '';

    console.log('[OpenAI API] Raw GPT-4o response:', responseText);

    // Extract just the translation from verbose responses
    const cleanedText = extractTranslation(responseText);

    console.log('[OpenAI API] Cleaned response:', cleanedText);

    // If extraction failed (unclear gesture), return low confidence so UI can skip audio
    if (!cleanedText) {
      return NextResponse.json({
        text: '',
        confidence: 0,
        source: 'openai-vision',
        unclear: true,
      });
    }

    return NextResponse.json({
      text: cleanedText,
      confidence: videoFrames?.length > 0 ? 0.9 : 0.75,
      source: videoFrames?.length > 0 ? 'openai-vision' : 'openai',
    });
  } catch (error) {
    console.error('[OpenAI API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process sign recognition' },
      { status: 500 }
    );
  }
}

/**
 * Extract just the translation from potentially verbose GPT responses
 * Handles cases like:
 * - "The gesture shown appears to be HELLO" → "Hello"
 * - "This could be interpreted as a greeting, possibly HELLO or HI" → "Hello"
 * - "The sequence suggests: HELLO, YOU, THANK YOU" → "Hello, you, thank you"
 * - "Unclear gesture." → null (will use fallback)
 */
function extractTranslation(response: string): string | null {
  if (!response) return null;

  const text = response.trim();

  // Check for "unclear" or "not recognized" responses - return null to trigger fallback
  const unclearPatterns = [
    /unclear/i,
    /not.*recognized/i,
    /unable to determine/i,
    /cannot identify/i,
    /not.*asl sign/i,
    /no.*visible/i,
    /hands.*not.*visible/i,
  ];

  for (const pattern of unclearPatterns) {
    if (pattern.test(text)) {
      return null;
    }
  }

  // If response is short and clean (1-4 words), it's likely already a good translation
  const words = text.split(/\s+/);
  if (words.length <= 4 && !text.includes('.') && !text.includes(',')) {
    // Capitalize first letter, lowercase rest for cleaner speech
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  // Try to extract from common verbose patterns
  const extractionPatterns = [
    // "The sign is HELLO" or "This is HELLO"
    /(?:the sign|this|it)(?:\s+is|\s+appears to be|\s+seems to be|\s+looks like)\s*[:\-]?\s*["']?([A-Z][A-Z\s,]+)["']?/i,
    // "interpreted as HELLO"
    /interpreted as\s*[:\-]?\s*["']?([A-Z][A-Z\s,]+)["']?/i,
    // "suggests: HELLO, WORLD"
    /suggests?\s*[:\-]\s*["']?([A-Z][A-Z\s,]+)["']?/i,
    // "sequence: HELLO YOU"
    /sequence\s*[:\-]\s*["']?([A-Z][A-Z\s,]+)["']?/i,
    // Look for quoted text
    /["']([^"']+)["']/,
    // "HELLO" at the end (capitalized word)
    /\b([A-Z]{2,}(?:\s+[A-Z]{2,})*)\s*\.?$/,
  ];

  for (const pattern of extractionPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const extracted = match[1].trim();
      // Convert from ALL CAPS to Title Case for better speech
      return extracted
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(w => w.length > 0)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  // If no patterns match but text is reasonably short, clean it up
  if (words.length <= 8) {
    // Remove common verbose prefixes
    const cleaned = text
      .replace(/^(the sign|this|it)\s+(is|appears|seems|looks)\s+(to be|like)?\s*/i, '')
      .replace(/^(I think|I believe|this could be|this might be)\s*/i, '')
      .replace(/[.!?]$/, '')
      .trim();

    if (cleaned.length > 0 && cleaned.length < 50) {
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
    }
  }

  // Last resort: take first sentence if it's short enough
  const firstSentence = text.split(/[.!?]/)[0].trim();
  if (firstSentence.length > 0 && firstSentence.length < 30) {
    return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1).toLowerCase();
  }

  return null;
}
