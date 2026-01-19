// Server-side speech service (for API routes)
export {
  textToSpeech,
  speechToText,
  getVoices,
  checkElevenLabsHealth,
  isElevenLabsConfigured,
  type TextToSpeechOptions,
  type SpeechToTextResult,
  type VoiceSettings,
} from './speechService';

// Client-side speech service (for React components)
export {
  synthesizeSpeech,
  speakText,
  playAudioBlob,
  checkSpeechConfigured,
  type SynthesizeSpeechOptions,
  type SpeechSynthesisResult,
} from './clientService';
