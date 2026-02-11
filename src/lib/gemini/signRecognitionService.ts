/**
 * Gemini Multimodal Sign Recognition Service
 * "The Eyes" of the Gemini Sandwich - interprets ASL landmarks + video → English
 *
 * Shared types & utilities (SignLandmarkData, VideoFrame, LandmarkBuffer,
 * captureVideoFrame, formatLandmarksForPrompt, createLandmarkBuffer) live in
 * @/lib/sign-recognition/shared to avoid duplication across providers.
 */

// Re-export shared types so existing barrel imports keep working
export type { SignLandmarkData, VideoFrame, LandmarkBuffer } from '@/lib/sign-recognition/shared';
export { captureVideoFrame, formatLandmarksForPrompt, createLandmarkBuffer } from '@/lib/sign-recognition/shared';

/**
 * Enhanced system prompt for ASL interpretation with handshape references
 */
export const ASL_INTERPRETATION_PROMPT = `You are an expert American Sign Language (ASL) interpreter with deep knowledge of ASL linguistics.

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
- **HELP-ME**: Holding one hand up with the palm toward another person, tucking the thumb into the palm, and closing the four fingers over the thumb into a fist.
- **I-LOVE-YOU**: Pinky, index, and thumb extended (I+L+Y combined)
- **UNDERSTAND**: Index flicks up near forehead
- **GOOD**: Flat hand from chin moving it straight down and slightly forward.
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
- **NICE/CLEAN**: Dominant flat hand slides across non-dominant flat palm
- **MEET**: Both index fingers (1-handshape) come together, representing two people meeting
- **NICE-TO-MEET-YOU**: Combination of NICE + MEET + point-to-you (three distinct movements)
- **MY-NAME**: Point to self + H-hands tap together (MY + NAME)
- **HOW-ARE-YOU**: Thumbs-up hands roll outward + point to person
- **EAT/FOOD**: Fingertips tap mouth
- **DRINK**: C-hand tilts to mouth
- **WATER**: W-hand taps chin
- **BATHROOM**: T-hand shakes
- **AGAIN/REPEAT**: Bent hand flips into open palm

## Common Phrases (Multi-Sign Sequences)
If you see multiple distinct movements in sequence, these may be multi-sign phrases:
- **NICE + MEET + YOU** → "Nice to meet you"
- **HOW + YOU** → "How are you?"
- **THANK + YOU** → "Thank you"
- **MY + NAME + [fingerspelling]** → "My name is [name]"
- **PLEASE + HELP** → "Please help me"
- **I + LOVE + YOU** → "I love you" (as separate signs, not the ILY handshape)

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
Use the FULL sequence (all frames) to decide if this is fingerspelling.

If the ENTIRE sequence is mostly STATIC (no meaningful movement) and matches ONE letter handshape throughout, output that single letter.

If you see MULTIPLE distinct letter handshapes across frames (fingerspelling a word), output the combined word by concatenating the letters with NO spaces (e.g., "C A T" → "CAT").

Most fingerspelled letters are STATIC handshapes (held still):
- **A**: Fist with thumb alongside → Return "A"
- **B**: Flat hand, fingers together, thumb tucked → Return "B"
- **C**: Curved hand like a C → Return "C"
- **D**: Index up, others curved to thumb → Return "D"
- **E**: Fingers curled, thumb tucked → Return "E"
- **F**: Index and thumb touch, others spread → Return "F"
- **G**: Index and thumb horizontal, parallel → Return "G"
- **H**: Index and middle extended horizontally → Return "H"
- **I**: Pinky only extended → Return "I"
- **K**: Index up, middle forward, thumb between → Return "K"
- **L**: Thumb and index in L-shape → Return "L"
- **M**: Three fingers over thumb → Return "M"
- **N**: Two fingers over thumb → Return "N"
- **O**: Fingers curved to meet thumb → Return "O"
- **P**: Like K but pointing down → Return "P"
- **Q**: Like G but pointing down → Return "Q"
- **R**: Index and middle crossed → Return "R"
- **S**: Fist with thumb over fingers → Return "S"
- **T**: Thumb between index and middle → Return "T"
- **U**: Index and middle together, up → Return "U"
- **V**: Index and middle extended in V → Return "V"
- **W**: Index, middle, ring extended → Return "W"
- **X**: Index bent like a hook → Return "X"
- **Y**: Thumb and pinky extended, others closed → Return "Y"

**DYNAMIC fingerspelled letters** (require movement to identify):
- **J**: Pinky extended, draw a J-shape downward motion → Return "J"
- **Z**: Index finger draws a Z-shape in the air → Return "Z"

When distinguishing J from I: If the pinky is extended AND there is a curved downward motion, it is "J". If static, it is "I".

## CRITICAL DISAMBIGUATION
- **THANK-YOU vs NICE-TO-MEET-YOU**: THANK-YOU = single motion, flat hand starts at CHIN and moves outward. NICE-TO-MEET-YOU = THREE distinct movements: (1) flat hand slides across palm, (2) index fingers come together, (3) point forward. If you see multiple movements, it is likely "Nice to meet you", NOT "Thank you".
- **WHERE vs NICE**: WHERE = index finger waves side to side (small repetitive motion). NICE = flat hand slides ACROSS the other palm (larger forward motion). They look different — check palm orientation and motion path.
- **J vs I vs ILY vs Y**: Count extended fingers carefully. J = pinky only + downward curve motion. I = pinky only + static. ILY = thumb + index + pinky. Y = thumb + pinky only.
- **Single sign vs phrase**: If you see 2-3 distinct movements with brief pauses between them, interpret as a phrase (e.g., NICE + MEET + YOU = "Nice to meet you"), not a single sign.

## Instructions
1. Determine if this clip is fingerspelling or a lexical sign by analyzing the FULL sequence (all frames).
   - Only output a single letter if the sequence is overwhelmingly static and matches one letter handshape throughout.
   - If multiple letter handshapes appear, output the concatenated word (no spaces).
2. If there is meaningful MOVEMENT, location change, or a clear sign pattern, prefer the sign meaning.
3. Analyze the video frames to see the actual hand shapes and movements
4. Use landmark data to confirm precise finger positions
5. Note any facial expressions for grammatical context

Return ONLY the English translation of what is being signed.
- For fingerspelling, return either a single letter (e.g., "Y") or the concatenated word (e.g., "CAT").
- For signs, return the English meaning: "Hello", "Thank you", etc.
- Do NOT return colors or objects unless the person is clearly signing about them.`;

