/**
 * Translation API Route
 *
 * Server-side endpoint for English to ASL gloss translation.
 * Keeps the Gemini API key secure on the server.
 */

import { NextRequest, NextResponse } from 'next/server';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

const ASL_GLOSS_PROMPT = `You are an ASL (American Sign Language) translation expert. Convert the following English text to ASL gloss notation.

Rules:
- Output ONLY the gloss words separated by spaces
- Use UPPERCASE for all glosses
- Common mappings: "hello/hi" -> HELLO, "thank you/thanks" -> THANK-YOU, "I/me/my" -> I, "you/your" -> YOU
- Drop articles (a, an, the) and auxiliary verbs (am, is, are, was, were)
- For single letters, output the letter itself (for fingerspelling)
- Keep it concise - ASL uses fewer words than English

Text to translate:`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Text is required' },
        { status: 400 }
      );
    }

    // If Gemini not configured, use simple fallback
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'your-gemini-api-key-here') {
      console.log('[Translate API] Gemini not configured, using fallback');
      const gloss = simpleTextToGloss(text);
      return NextResponse.json({
        success: true,
        gloss,
        source: 'fallback',
      });
    }

    // Call Gemini API
    console.log('[Translate API] Calling Gemini for:', text);

    const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${ASL_GLOSS_PROMPT}\n${text}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 256,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Translate API] Gemini error:', response.status, errorText);
      // Fall back to simple translation
      const gloss = simpleTextToGloss(text);
      return NextResponse.json({
        success: true,
        gloss,
        source: 'fallback',
      });
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[Translate API] Gemini response:', responseText);

    // Parse the response
    const gloss = parseGlossResponse(responseText, text);

    return NextResponse.json({
      success: true,
      gloss,
      source: 'gemini',
    });
  } catch (error) {
    console.error('[Translate API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * Parse Gemini response to extract gloss array
 */
function parseGlossResponse(response: string, originalText: string): string[] {
  // Clean up the response
  let cleaned = response
    .replace(/```[^`]*```/g, '') // Remove code blocks
    .replace(/["\[\]]/g, '')     // Remove quotes and brackets
    .trim();

  // Split by spaces or commas
  const words = cleaned
    .split(/[\s,]+/)
    .map((w) => w.toUpperCase().replace(/[^A-Z-]/g, ''))
    .filter((w) => w.length > 0);

  if (words.length > 0) {
    return words;
  }

  // Fallback if parsing fails
  return simpleTextToGloss(originalText);
}

/**
 * Simple text to gloss conversion (fallback)
 */
function simpleTextToGloss(text: string): string[] {
  const wordMap: Record<string, string> = {
    hello: 'HELLO',
    hi: 'HELLO',
    thanks: 'THANK-YOU',
    'thank you': 'THANK-YOU',
    thank: 'THANK-YOU',
    you: 'YOU',
    your: 'YOU',
    i: 'I',
    my: 'I',
    me: 'I',
    how: 'HOW',
    what: 'WHAT',
    where: 'WHERE',
    when: 'WHEN',
    why: 'WHY',
    who: 'WHO',
    good: 'GOOD',
    bad: 'BAD',
    yes: 'YES',
    no: 'NO',
    please: 'PLEASE',
    sorry: 'SORRY',
    help: 'HELP',
    name: 'NAME',
    like: 'LIKE',
    love: 'LOVE',
    want: 'WANT',
    need: 'NEED',
  };

  // Words to skip (articles, auxiliary verbs)
  const skipWords = new Set(['a', 'an', 'the', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);

  const words = text.toLowerCase().split(/\s+/);
  const gloss: string[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (!clean) continue;
    if (skipWords.has(clean)) continue;

    if (wordMap[clean]) {
      gloss.push(wordMap[clean]);
    } else {
      // Single letter - keep for fingerspelling
      // Otherwise uppercase the word
      gloss.push(clean.toUpperCase());
    }
  }

  return gloss.length > 0 ? gloss : ['HELLO'];
}
