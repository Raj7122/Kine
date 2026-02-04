import { ASL_GLOSS_SYSTEM_PROMPT, generateTranslationPrompt, parseGlossResponse } from './prompts';

// Check if Gemini is configured (support both server and client-side)
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
export const isGeminiConfigured = !!(
  geminiApiKey &&
  geminiApiKey !== 'your-gemini-api-key-here'
);

// Gemini API endpoint
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

export interface TranslationResult {
  input: string;
  gloss: string[];
  source: 'gemini' | 'mock';
}

/**
 * Translate text to ASL gloss using Gemini API
 */
export async function translateToGloss(text: string): Promise<TranslationResult> {
  console.log('[Gemini] Translating:', text);

  // If Gemini not configured, return mock result
  if (!isGeminiConfigured) {
    console.log('[Gemini] API not configured, using mock translation');
    return getMockGlossTranslation(text);
  }

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: ASL_GLOSS_SYSTEM_PROMPT },
              { text: generateTranslationPrompt(text) }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 256,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Gemini] API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[Gemini] Raw response:', responseText);

    const gloss = parseGlossResponse(responseText);
    console.log('[Gemini] Parsed gloss:', gloss);

    return {
      input: text,
      gloss,
      source: 'gemini',
    };
  } catch (error) {
    console.error('[Gemini] Translation error:', error);
    // Fall back to mock on error
    return getMockGlossTranslation(text);
  }
}

/**
 * Mock translation fallback
 */
function getMockGlossTranslation(text: string): TranslationResult {
  // Simple keyword-based mock translation
  const lowerText = text.toLowerCase();
  const gloss: string[] = [];

  if (lowerText.includes('hello') || lowerText.includes('hi')) {
    gloss.push('HELLO');
  }
  if (lowerText.includes('world')) {
    gloss.push('WORLD');
  }
  if (lowerText.includes('thank')) {
    gloss.push('THANK_YOU');
  }
  if (lowerText.includes('yes')) {
    gloss.push('YES');
  }
  if (lowerText.includes('no')) {
    gloss.push('NO');
  }
  if (lowerText.includes('please')) {
    gloss.push('PLEASE');
  }
  if (lowerText.includes('sorry')) {
    gloss.push('SORRY');
  }
  if (lowerText.includes('help')) {
    gloss.push('HELP');
  }

  // Default if no matches
  if (gloss.length === 0) {
    gloss.push('HELLO', 'WORLD');
  }

  return {
    input: text,
    gloss,
    source: 'mock',
  };
}

/**
 * Check Gemini API health
 */
export async function checkGeminiHealth(): Promise<boolean> {
  if (!isGeminiConfigured) {
    return false;
  }

  try {
    const result = await translateToGloss('test');
    return result.source === 'gemini';
  } catch {
    return false;
  }
}
