#!/usr/bin/env npx ts-node

/**
 * Prompt Update Generator
 *
 * Generates updated Gemini prompt based on feedback patterns.
 * Creates a new prompt file that can be reviewed and applied.
 *
 * Usage: npx ts-node scripts/generate-prompt-update.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_PROMPT = `You are an ASL (American Sign Language) sign recognition expert analyzing video frames and hand landmarks.

Your task is to identify what ASL sign is being performed based on:
1. Hand shape (finger positions, palm orientation)
2. Location (where hands are positioned relative to body)
3. Movement (direction and type of motion)
4. Non-manual markers (facial expressions if visible)

Output ONLY the ASL gloss in UPPERCASE. If multiple signs, separate with spaces.
If you cannot determine the sign with confidence, output "UNKNOWN".`;

interface CorrectionPattern {
  geminiOutput: string;
  userCorrection: string;
  count: number;
  addedToPrompt: boolean;
}

async function getPatterns(): Promise<CorrectionPattern[]> {
  // Try learned_corrections first
  const { data: learned, error: learnedError } = await supabase
    .from('learned_corrections')
    .select('gemini_misrecognition, correct_sign, occurrence_count, added_to_prompt')
    .gte('occurrence_count', 3)
    .order('occurrence_count', { ascending: false });

  if (!learnedError && learned && learned.length > 0) {
    return learned.map(l => ({
      geminiOutput: l.gemini_misrecognition,
      userCorrection: l.correct_sign,
      count: l.occurrence_count,
      addedToPrompt: l.added_to_prompt,
    }));
  }

  // Fallback to aggregating from translation_feedback
  const { data: feedback } = await supabase
    .from('translation_feedback')
    .select('gemini_output, user_correction')
    .eq('rating', 'negative')
    .not('user_correction', 'is', null);

  const patternMap = new Map<string, number>();
  for (const f of feedback || []) {
    const key = `${f.gemini_output}|${f.user_correction}`;
    patternMap.set(key, (patternMap.get(key) || 0) + 1);
  }

  return Array.from(patternMap.entries())
    .filter(([, count]) => count >= 3)
    .map(([key, count]) => {
      const [geminiOutput, userCorrection] = key.split('|');
      return { geminiOutput, userCorrection, count, addedToPrompt: false };
    })
    .sort((a, b) => b.count - a.count);
}

function generateLearnedCorrectionsSection(patterns: CorrectionPattern[]): string {
  if (patterns.length === 0) {
    return '';
  }

  const lines: string[] = [
    '',
    '## LEARNED CORRECTIONS FROM USER FEEDBACK',
    '',
    'The following corrections are based on real user feedback. Apply these learned patterns:',
    '',
  ];

  // Group by frequency
  const highPriority = patterns.filter(p => p.count >= 10);
  const mediumPriority = patterns.filter(p => p.count >= 5 && p.count < 10);
  const lowPriority = patterns.filter(p => p.count >= 3 && p.count < 5);

  if (highPriority.length > 0) {
    lines.push('### HIGH PRIORITY (10+ corrections):');
    for (const p of highPriority) {
      lines.push(`- When you would output "${p.geminiOutput}", strongly consider "${p.userCorrection}" instead`);
    }
    lines.push('');
  }

  if (mediumPriority.length > 0) {
    lines.push('### MEDIUM PRIORITY (5-9 corrections):');
    for (const p of mediumPriority) {
      lines.push(`- "${p.geminiOutput}" is often meant to be "${p.userCorrection}"`);
    }
    lines.push('');
  }

  if (lowPriority.length > 0) {
    lines.push('### NOTED PATTERNS (3-4 corrections):');
    for (const p of lowPriority) {
      lines.push(`- Some users sign "${p.userCorrection}" but it's recognized as "${p.geminiOutput}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateUpdatedPrompt(patterns: CorrectionPattern[]): string {
  const learnedSection = generateLearnedCorrectionsSection(patterns);

  return `${BASE_PROMPT}
${learnedSection}
## RESPONSE FORMAT

Output only the ASL gloss. Examples:
- "HELLO"
- "THANK-YOU"
- "HOW YOU"
- "UNKNOWN" (if unsure)

Do not include explanations or multiple options.`;
}

async function markPatternsAsAdded(patterns: CorrectionPattern[]): Promise<void> {
  const updates = patterns.map(p =>
    supabase
      .from('learned_corrections')
      .update({
        added_to_prompt: true,
        added_to_prompt_at: new Date().toISOString(),
      })
      .eq('gemini_misrecognition', p.geminiOutput)
      .eq('correct_sign', p.userCorrection)
  );

  await Promise.all(updates);
}

async function main() {
  console.log('🚀 Prompt Update Generator\n');
  console.log('='.repeat(50) + '\n');

  try {
    // Get patterns
    const patterns = await getPatterns();
    console.log(`📊 Found ${patterns.length} correction patterns (3+ occurrences)\n`);

    if (patterns.length === 0) {
      console.log('ℹ️ No significant patterns found. Need more feedback data.');
      console.log('   Minimum 3 corrections of the same type required.');
      return;
    }

    // Show patterns
    console.log('📝 Patterns to include:');
    for (const p of patterns) {
      const status = p.addedToPrompt ? '✓' : '○';
      console.log(`   ${status} "${p.geminiOutput}" → "${p.userCorrection}" (×${p.count})`);
    }
    console.log('');

    // Generate updated prompt
    const updatedPrompt = generateUpdatedPrompt(patterns);

    // Save to file
    const outputDir = path.join(process.cwd(), 'prompts');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const version = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const filename = `sign-recognition-prompt-v${version}.txt`;
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, updatedPrompt);
    console.log(`📁 Updated prompt saved to: ${filepath}`);

    // Also save as latest
    const latestPath = path.join(outputDir, 'sign-recognition-prompt-latest.txt');
    fs.writeFileSync(latestPath, updatedPrompt);
    console.log(`📁 Also saved as: ${latestPath}`);

    console.log('\n' + '='.repeat(50));
    console.log('\n✅ Prompt generated successfully!\n');
    console.log('Next steps:');
    console.log('1. Review the generated prompt in prompts/ directory');
    console.log('2. Test with a few signs to verify improvements');
    console.log('3. Update signRecognitionService.ts with the new prompt');
    console.log('4. Monitor accuracy metrics after deployment');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
