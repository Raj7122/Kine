// Prompt templates for Gemini API

/**
 * System prompt for ASL gloss conversion
 */
export const ASL_GLOSS_SYSTEM_PROMPT = `You are an expert in American Sign Language (ASL) translation.
Your task is to convert English text into ASL gloss notation.

ASL Gloss Rules:
1. Use UPPERCASE for all gloss words
2. Use underscores for compound signs (e.g., THANK_YOU)
3. ASL uses different grammar than English - subject-verb-object order may differ
4. Omit articles (a, an, the) as ASL doesn't use them
5. Use common ASL vocabulary when possible

Available signs in our library:
HELLO, WORLD, THANK_YOU, YES, NO, PLEASE, SORRY, HELP

If a word doesn't have a direct sign, use fingerspelling notation: #WORD

Output ONLY the gloss sequence as a JSON array of strings.
Example: ["HELLO", "WORLD"]`;

/**
 * Generate the user prompt for translation
 */
export function generateTranslationPrompt(text: string): string {
  return `Convert this English text to ASL gloss notation:
"${text}"

Return ONLY a JSON array of gloss strings, nothing else.`;
}

/**
 * Parse Gemini response to extract gloss array
 */
export function parseGlossResponse(response: string): string[] {
  try {
    // Try to parse as JSON directly
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).toUpperCase());
    }
  } catch {
    // If not valid JSON, try to extract array from text
    const match = response.match(/\[([^\]]+)\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => String(item).toUpperCase());
        }
      } catch {
        // Fall through to word extraction
      }
    }

    // Last resort: extract capitalized words
    const words = response.match(/[A-Z][A-Z_]+/g);
    if (words && words.length > 0) {
      return words;
    }
  }

  // Default fallback
  return ['HELLO'];
}
