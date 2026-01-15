// ElevenLabs Text-to-Speech and Speech-to-Text Service

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Check if ElevenLabs is configured
const elevenlabsApiKey = process.env.ELEVENLABS_API_KEY;
export const isElevenLabsConfigured = !!(
  elevenlabsApiKey &&
  elevenlabsApiKey !== 'your-elevenlabs-key-here'
);

// Default voice settings
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel - default female voice
const DEFAULT_MODEL_ID = 'eleven_monolingual_v1';

export interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface TextToSpeechOptions {
  voiceId?: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
}

export interface SpeechToTextResult {
  text: string;
  confidence: number;
}

const defaultVoiceSettings: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
};

/**
 * Convert text to speech using ElevenLabs API
 * Returns an audio blob that can be played
 */
export async function textToSpeech(
  text: string,
  options: TextToSpeechOptions = {}
): Promise<Blob | null> {
  const {
    voiceId = DEFAULT_VOICE_ID,
    modelId = DEFAULT_MODEL_ID,
    voiceSettings = defaultVoiceSettings,
  } = options;

  console.log('[ElevenLabs] Converting text to speech:', text.substring(0, 50));

  if (!isElevenLabsConfigured) {
    console.log('[ElevenLabs] API not configured, returning null');
    return null;
  }

  try {
    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': elevenlabsApiKey!,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: voiceSettings,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ElevenLabs] TTS error:', response.status, errorText);
      throw new Error(`ElevenLabs TTS error: ${response.status}`);
    }

    const audioBlob = await response.blob();
    console.log('[ElevenLabs] TTS successful, audio size:', audioBlob.size);
    return audioBlob;
  } catch (error) {
    console.error('[ElevenLabs] TTS error:', error);
    return null;
  }
}

/**
 * Convert speech (audio) to text using ElevenLabs API
 * Note: ElevenLabs primarily offers TTS, for STT we'd typically use
 * another service. This is a placeholder for potential future support.
 */
export async function speechToText(audioBlob: Blob): Promise<SpeechToTextResult | null> {
  console.log('[ElevenLabs] Speech to text requested, audio size:', audioBlob.size);

  // ElevenLabs doesn't have native STT as of 2024
  // For now, we'll use the Web Speech API as a fallback
  // In production, you might use Google Speech-to-Text, Whisper, or Deepgram

  try {
    return await webSpeechToText();
  } catch (error) {
    console.error('[ElevenLabs] STT error:', error);
    return null;
  }
}

/**
 * Fallback: Use Web Speech API for speech-to-text
 * This runs entirely in the browser
 */
function webSpeechToText(): Promise<SpeechToTextResult | null> {
  return new Promise((resolve) => {
    // Check for SpeechRecognition support (browser-specific API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const windowWithSpeech = window as any;
    const SpeechRecognitionAPI =
      windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.log('[WebSpeech] Speech recognition not supported');
      resolve(null);
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const result = event.results[0][0];
      resolve({
        text: result.transcript,
        confidence: result.confidence,
      });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('[WebSpeech] Recognition error:', event.error);
      resolve(null);
    };

    recognition.onend = () => {
      // If no result was returned
    };

    recognition.start();

    // Timeout after 10 seconds
    setTimeout(() => {
      recognition.stop();
      resolve(null);
    }, 10000);
  });
}

/**
 * Get list of available voices from ElevenLabs
 */
export async function getVoices(): Promise<Array<{ voice_id: string; name: string }>> {
  if (!isElevenLabsConfigured) {
    console.log('[ElevenLabs] API not configured');
    return [];
  }

  try {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        'xi-api-key': elevenlabsApiKey!,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch voices: ${response.status}`);
    }

    const data = await response.json();
    return data.voices || [];
  } catch (error) {
    console.error('[ElevenLabs] Failed to fetch voices:', error);
    return [];
  }
}

/**
 * Check ElevenLabs API health
 */
export async function checkElevenLabsHealth(): Promise<boolean> {
  if (!isElevenLabsConfigured) {
    return false;
  }

  try {
    const voices = await getVoices();
    return voices.length > 0;
  } catch {
    return false;
  }
}
