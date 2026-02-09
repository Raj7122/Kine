/**
 * Parses ASL sign definitions from ASL_INTERPRETATION_PROMPT to extract
 * handshape/motion descriptions for confusion-pair augmentation.
 *
 * Used by promptAugmentation.ts to include concrete disambiguation cues
 * when generating confusion-pair corrections.
 */

import { ASL_INTERPRETATION_PROMPT } from '@/lib/gemini/signRecognitionService';

export interface SignDefinition {
  /** Canonical sign name (uppercase), e.g. "YES", "WANT" */
  sign: string;
  /** Description from the prompt, e.g. "S-hand nodding" */
  description: string;
}

/**
 * Parse the "Common ASL Signs" section of ASL_INTERPRETATION_PROMPT.
 * Matches lines like:
 *   - **HELLO**: Wave or B-hand salute from forehead
 *   - **FINISH/DONE**: 5-hands flip outward
 *
 * Returns a map of uppercase sign name → description.
 * Signs with slashes (e.g. "FINISH/DONE") are indexed under each variant.
 */
let cachedDefinitions: Map<string, string> | null = null;

export function getSignDefinitions(): Map<string, string> {
  if (cachedDefinitions) return cachedDefinitions;

  const map = new Map<string, string>();

  // Match lines like: - **SIGN-NAME**: description text
  const linePattern = /^-\s+\*\*([^*]+)\*\*:\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(ASL_INTERPRETATION_PROMPT)) !== null) {
    const rawName = match[1].trim();
    const description = match[2].trim();

    // Handle slash-separated names like "FINISH/DONE", "EAT/FOOD"
    const variants = rawName.split('/').map((v) => v.trim().toUpperCase());
    for (const variant of variants) {
      if (variant) {
        map.set(variant, description);
      }
    }
  }

  cachedDefinitions = map;
  return map;
}

/**
 * Look up the description for a sign name. Case-insensitive.
 * Returns null if the sign is not defined in the prompt.
 */
export function getSignDescription(signName: string): string | null {
  const defs = getSignDefinitions();
  return defs.get(signName.trim().toUpperCase()) ?? null;
}

/**
 * Build a disambiguation string for a confusion pair.
 * If definitions exist for both signs, returns something like:
 *   "YES = S-hand nodding; WANT = Claw hands pull toward body"
 * If only one or neither has a definition, returns a partial or null.
 */
export function buildDisambiguationHint(signA: string, signB: string): string | null {
  const descA = getSignDescription(signA);
  const descB = getSignDescription(signB);

  if (descA && descB) {
    return `${signA.toUpperCase()} = ${descA}; ${signB.toUpperCase()} = ${descB}`;
  }
  if (descA) {
    return `${signA.toUpperCase()} = ${descA}`;
  }
  if (descB) {
    return `${signB.toUpperCase()} = ${descB}`;
  }
  return null;
}

/**
 * Build context rules for a context-dependent sign with multiple corrections.
 * Returns an array of lines like:
 *   "If <motion description> → likely WANT"
 * for each correction that has a definition in the prompt.
 */
export function buildContextRules(
  originalSign: string,
  corrections: Array<{ sign: string; percentage: number }>
): string[] {
  const rules: string[] = [];
  const originalDesc = getSignDescription(originalSign);

  for (const corr of corrections) {
    const desc = getSignDescription(corr.sign);
    if (desc) {
      rules.push(`If ${desc.toLowerCase()} → likely ${corr.sign.toUpperCase()} (${corr.percentage}%)`);
    }
  }

  // Add the original sign as the "correct" option if it has a definition
  if (originalDesc) {
    rules.push(`If ${originalDesc.toLowerCase()} → likely ${originalSign.toUpperCase()} (correct)`);
  }

  return rules;
}

/** Clear cached definitions (for testing). */
export function clearSignDefinitionsCacheForTests(): void {
  cachedDefinitions = null;
}
