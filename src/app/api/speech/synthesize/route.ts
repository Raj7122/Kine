/**
 * Speech Synthesis API Route
 *
 * Server-side endpoint for text-to-speech using ElevenLabs API.
 * This endpoint converts English text (from ASL recognition) to audio.
 *
 * Flow: Deaf person signs -> ASL recognized -> English text -> THIS API -> Audio for hearing person
 */

import { NextRequest, NextResponse } from 'next/server';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Default voice: Rachel - natural sounding female voice
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
// Using eleven_turbo_v2_5 - fast, high-quality, available on free tier
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

// Check if ElevenLabs is configured
const isConfigured = !!(
  ELEVENLABS_API_KEY &&
  ELEVENLABS_API_KEY !== 'your-elevenlabs-key-here'
);

export interface SynthesizeRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
  languageCode?: string; // Force language (e.g., 'en' for English)
}

export async function POST(request: NextRequest) {
  try {
    const body: SynthesizeRequest = await request.json();
    const { text, voiceId, modelId, voiceSettings, languageCode = 'en' } = body;

    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Text is required' },
        { status: 400 }
      );
    }

    if (!isConfigured) {
      console.log('[Speech API] ElevenLabs not configured');
      return NextResponse.json(
        { success: false, error: 'ElevenLabs API not configured' },
        { status: 503 }
      );
    }

    console.log('[Speech API] Synthesizing speech for:', text.substring(0, 50));

    // Call ElevenLabs Text-to-Speech API
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId || DEFAULT_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY!,
        },
        body: JSON.stringify({
          text,
          model_id: modelId || DEFAULT_MODEL_ID,
          voice_settings: voiceSettings || {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0,
            use_speaker_boost: true,
          },
          language_code: languageCode, // Force English to prevent auto-detection issues
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Speech API] ElevenLabs error:', response.status, errorText);
      return NextResponse.json(
        { success: false, error: `ElevenLabs API error: ${response.status}` },
        { status: response.status }
      );
    }

    // Get the audio blob
    const audioBuffer = await response.arrayBuffer();
    console.log('[Speech API] Audio generated, size:', audioBuffer.byteLength, 'bytes');

    // Return audio as binary response with proper headers
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error('[Speech API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check if ElevenLabs is configured
 */
export async function GET() {
  return NextResponse.json({
    configured: isConfigured,
    defaultVoiceId: DEFAULT_VOICE_ID,
  });
}
