// Roboflow API configuration

import { RoboflowConfig } from './types';
import { ROBOFLOW_API_URL } from '@/config/constants';

export function getRoboflowConfig(): RoboflowConfig {
  const apiKey = process.env.NEXT_PUBLIC_ROBOFLOW_API_KEY;
  const modelId = process.env.NEXT_PUBLIC_ROBOFLOW_MODEL_ID;
  const version = process.env.NEXT_PUBLIC_ROBOFLOW_MODEL_VERSION || '1';

  if (!apiKey) {
    console.warn('NEXT_PUBLIC_ROBOFLOW_API_KEY is not set');
  }

  if (!modelId) {
    console.warn('NEXT_PUBLIC_ROBOFLOW_MODEL_ID is not set');
  }

  return {
    apiKey: apiKey || '',
    modelId: modelId || 'american-sign-language-eiq9k',
    version,
    apiUrl: ROBOFLOW_API_URL,
  };
}

export function isRoboflowConfigured(): boolean {
  const config = getRoboflowConfig();
  return Boolean(config.apiKey && config.modelId);
}
