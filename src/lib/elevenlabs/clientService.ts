/**
 * Client-side Speech Synthesis Service
 *
 * Calls the /api/speech/synthesize endpoint to generate audio from text.
 * This is the client-side counterpart to the server-side speechService.
 *
 * Used in SIGNING_MODE: Deaf person signs -> ASL recognized -> English -> THIS -> Audio
 */

'use client';

export interface SynthesizeSpeechOptions {
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

export interface SpeechSynthesisResult {
  success: boolean;
  audioBlob: Blob | null;
  audioUrl: string | null;
  error?: string;
}

/**
 * Check if ElevenLabs speech synthesis is configured
 */
export async function checkSpeechConfigured(): Promise<boolean> {
  try {
    const response = await fetch('/api/speech/synthesize');
    if (!response.ok) return false;
    const data = await response.json();
    return data.configured === true;
  } catch {
    return false;
  }
}

/**
 * Synthesize speech from text using ElevenLabs API (via server)
 *
 * @param text - The text to convert to speech
 * @param options - Optional voice configuration
 * @returns Audio blob and URL for playback
 */
export async function synthesizeSpeech(
  text: string,
  options: SynthesizeSpeechOptions = {}
): Promise<SpeechSynthesisResult> {
  console.log('[SpeechClient] Synthesizing speech for:', text.substring(0, 50));

  try {
    const response = await fetch('/api/speech/synthesize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voiceId: options.voiceId,
        modelId: options.modelId,
        voiceSettings: options.voiceSettings,
        languageCode: options.languageCode || 'en', // Default to English
      }),
    });

    if (!response.ok) {
      // Try to parse error message
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const errorData = await response.json();
        console.error('[SpeechClient] API error:', errorData.error);
        return {
          success: false,
          audioBlob: null,
          audioUrl: null,
          error: errorData.error || `API error: ${response.status}`,
        };
      }
      return {
        success: false,
        audioBlob: null,
        audioUrl: null,
        error: `API error: ${response.status}`,
      };
    }

    // Get the audio blob
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);

    console.log('[SpeechClient] Audio generated, size:', audioBlob.size, 'bytes');

    return {
      success: true,
      audioBlob,
      audioUrl,
    };
  } catch (error) {
    console.error('[SpeechClient] Error:', error);
    return {
      success: false,
      audioBlob: null,
      audioUrl: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Play audio from a blob
 *
 * @param audioBlob - The audio blob to play
 * @returns Promise that resolves when audio finishes playing
 */
export function playAudioBlob(audioBlob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.src = URL.createObjectURL(audioBlob);

    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      resolve();
    };

    audio.onerror = (e) => {
      URL.revokeObjectURL(audio.src);
      reject(new Error('Failed to play audio'));
    };

    audio.play().catch(reject);
  });
}

/**
 * Synthesize and immediately play speech
 *
 * @param text - The text to speak
 * @param options - Optional voice configuration
 * @returns Promise that resolves when audio finishes playing
 */
export async function speakText(
  text: string,
  options: SynthesizeSpeechOptions = {}
): Promise<{ success: boolean; error?: string }> {
  const result = await synthesizeSpeech(text, options);

  if (!result.success || !result.audioBlob) {
    return { success: false, error: result.error };
  }

  try {
    await playAudioBlob(result.audioBlob);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Playback failed',
    };
  }
}
