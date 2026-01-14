import translationsData from '@/lib/mock-data/translations.json';

export interface MockTranslation {
  id: string;
  input: string;
  gloss: string[];
  category: string;
}

const translations = translationsData as MockTranslation[];

/**
 * Get a random mock translation
 */
export function getRandomTranslation(): MockTranslation {
  const index = Math.floor(Math.random() * translations.length);
  return translations[index];
}

/**
 * Simulate translation with network delay
 * Returns a promise that resolves after a delay with a mock translation
 */
export async function getMockTranslation(delayMs: number = 1000): Promise<MockTranslation> {
  console.log('[MockTranslation] Starting translation...');

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const translation = getRandomTranslation();
  console.log('[MockTranslation] Translation complete:', translation);

  return translation;
}

/**
 * Get all available translations
 */
export function getAllTranslations(): MockTranslation[] {
  return translations;
}

/**
 * Get translations by category
 */
export function getTranslationsByCategory(category: string): MockTranslation[] {
  return translations.filter((t) => t.category === category);
}
