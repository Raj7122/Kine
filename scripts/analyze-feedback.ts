#!/usr/bin/env npx ts-node

/**
 * Feedback Analysis Script
 *
 * Analyzes collected feedback to identify patterns for prompt improvement.
 * Run weekly or after collecting 50+ new feedback items.
 *
 * Usage: npx ts-node scripts/analyze-feedback.ts
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

interface AnalysisResult {
  timestamp: string;
  totalFeedback: number;
  accuracyRate: number;
  topPatterns: Array<{
    geminiOutput: string;
    userCorrection: string;
    count: number;
    suggestedPromptAddition: string;
  }>;
  recommendations: string[];
}

async function analyzeFeedback(): Promise<AnalysisResult> {
  console.log('📊 Analyzing feedback data...\n');

  // Get all feedback
  const { data: feedback, error: feedbackError } = await supabase
    .from('translation_feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (feedbackError) {
    throw new Error(`Failed to fetch feedback: ${feedbackError.message}`);
  }

  const total = feedback?.length || 0;
  const positive = feedback?.filter(f => f.rating === 'positive').length || 0;
  const negative = feedback?.filter(f => f.rating === 'negative').length || 0;
  const accuracyRate = total > 0 ? (positive / total) * 100 : 0;

  console.log(`📈 Overall Stats:`);
  console.log(`   Total feedback: ${total}`);
  console.log(`   Positive: ${positive} (${accuracyRate.toFixed(1)}%)`);
  console.log(`   Negative: ${negative}`);
  console.log('');

  // Get learned corrections (patterns)
  const { data: patterns, error: patternsError } = await supabase
    .from('learned_corrections')
    .select('*')
    .order('occurrence_count', { ascending: false })
    .limit(20);

  if (patternsError) {
    console.warn('⚠️ Could not fetch learned_corrections, aggregating from feedback...');
  }

  // Aggregate patterns from feedback if learned_corrections not available
  const patternMap = new Map<string, number>();
  for (const f of feedback || []) {
    if (f.rating === 'negative' && f.user_correction) {
      const key = `${f.gemini_output}|${f.user_correction}`;
      patternMap.set(key, (patternMap.get(key) || 0) + 1);
    }
  }

  const topPatterns = Array.from(patternMap.entries())
    .map(([key, count]) => {
      const [geminiOutput, userCorrection] = key.split('|');
      return {
        geminiOutput,
        userCorrection,
        count,
        suggestedPromptAddition: generatePromptSuggestion(geminiOutput, userCorrection, count),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  console.log('🔍 Top Misrecognition Patterns:');
  for (const p of topPatterns) {
    console.log(`   "${p.geminiOutput}" → "${p.userCorrection}" (×${p.count})`);
  }
  console.log('');

  // Generate recommendations
  const recommendations = generateRecommendations(topPatterns, accuracyRate, total);

  console.log('💡 Recommendations:');
  for (const rec of recommendations) {
    console.log(`   • ${rec}`);
  }
  console.log('');

  return {
    timestamp: new Date().toISOString(),
    totalFeedback: total,
    accuracyRate,
    topPatterns,
    recommendations,
  };
}

function generatePromptSuggestion(gemini: string, correct: string, count: number): string {
  if (count >= 10) {
    return `IMPORTANT: When you see signs that look like "${gemini}", strongly consider if the user meant "${correct}" instead.`;
  } else if (count >= 5) {
    return `Note: "${gemini}" is often confused with "${correct}". Look for subtle differences in hand position.`;
  } else {
    return `Consider: Some users sign "${correct}" but it's being recognized as "${gemini}".`;
  }
}

function generateRecommendations(
  patterns: AnalysisResult['topPatterns'],
  accuracy: number,
  total: number
): string[] {
  const recs: string[] = [];

  if (total < 50) {
    recs.push(`Need more feedback (${total}/50 minimum) for reliable analysis`);
  }

  if (accuracy < 70) {
    recs.push('Accuracy below 70% - consider reviewing sign recognition settings');
  }

  const highFreqPatterns = patterns.filter(p => p.count >= 5);
  if (highFreqPatterns.length > 0) {
    recs.push(`${highFreqPatterns.length} patterns with 5+ occurrences should be added to prompt`);
  }

  if (patterns.length > 0) {
    recs.push('Run generate-prompt-update.ts to create updated system prompt');
  }

  return recs;
}

async function saveReport(result: AnalysisResult): Promise<void> {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const filename = `feedback-analysis-${new Date().toISOString().split('T')[0]}.json`;
  const filepath = path.join(reportsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(result, null, 2));
  console.log(`📁 Report saved to: ${filepath}`);
}

async function main() {
  try {
    console.log('🚀 Kine Feedback Analysis Tool\n');
    console.log('='.repeat(50) + '\n');

    const result = await analyzeFeedback();
    await saveReport(result);

    console.log('\n' + '='.repeat(50));
    console.log('✅ Analysis complete!');

    if (result.topPatterns.length > 0) {
      console.log('\n📝 Suggested prompt additions:\n');
      for (const p of result.topPatterns.slice(0, 5)) {
        console.log(`// ${p.geminiOutput} → ${p.userCorrection} (×${p.count})`);
        console.log(p.suggestedPromptAddition);
        console.log('');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
