/**
 * AWS GenASL Service
 *
 * Client service for interacting with the AWS GenASL API.
 * Handles text/audio translation to ASL avatar videos.
 *
 * Flow:
 * 1. Client uploads audio/sends text to API Gateway
 * 2. Step Functions workflow processes the request
 * 3. Bedrock (Claude) translates to ASL gloss
 * 4. Lambda stitches avatar video from gloss sequence
 * 5. Pre-signed S3 URL returned for video playback
 */

import {
  AWS_GENASL_CONFIG,
  GENASL_ENDPOINTS,
  GENASL_TIMEOUTS,
  isGenASLConfigured,
  type GenASLAvatarStyle,
  type GenASLVideoQuality,
} from './config';

// Types
export interface GenASLTranslateRequest {
  text: string;
  style?: GenASLAvatarStyle;
  quality?: GenASLVideoQuality;
  speed?: number;
}

export interface GenASLAudioRequest {
  audioKey: string; // S3 object key for uploaded audio
  style?: GenASLAvatarStyle;
  quality?: GenASLVideoQuality;
}

export interface GenASLExecutionStatus {
  executionArn: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';
  startTime: string;
  stopTime?: string;
}

export interface GenASLTranslateResponse {
  success: boolean;
  executionArn?: string;
  videoUrl?: string;
  glossSequence?: string[];
  error?: string;
}

export interface GenASLVideoResult {
  videoUrl: string;
  glossSequence: string[];
  duration: number;
  thumbnailUrl?: string;
}

export interface GenASLGloss {
  gloss: string;
  category: string;
  hasVideo: boolean;
}

/**
 * GenASL API Client
 */
class GenASLClient {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor() {
    this.baseUrl = AWS_GENASL_CONFIG.apiEndpoint;
  }

  /**
   * Set authentication token (from Cognito)
   */
  setAuthToken(token: string) {
    this.authToken = token;
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    return headers;
  }

  /**
   * Make API request with error handling
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    if (!isGenASLConfigured) {
      throw new Error('AWS GenASL is not configured. Please set environment variables.');
    }

    const url = `${this.baseUrl}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      GENASL_TIMEOUTS.apiTimeout
    );

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GenASL API error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('GenASL API request timed out');
      }

      throw error;
    }
  }

  /**
   * Translate text to ASL avatar video
   */
  async translateText(
    request: GenASLTranslateRequest
  ): Promise<GenASLTranslateResponse> {
    console.log('[GenASL] Translating text:', request.text);

    try {
      const response = await this.request<{
        executionArn: string;
        statusUrl: string;
      }>(GENASL_ENDPOINTS.translateText, {
        method: 'POST',
        body: JSON.stringify({
          text: request.text,
          style: request.style || 'realistic',
          quality: request.quality || 'medium',
          speed: request.speed || 1.0,
        }),
      });

      return {
        success: true,
        executionArn: response.executionArn,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[GenASL] Translation error:', errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Translate audio to ASL avatar video
   */
  async translateAudio(
    request: GenASLAudioRequest
  ): Promise<GenASLTranslateResponse> {
    console.log('[GenASL] Translating audio:', request.audioKey);

    try {
      const response = await this.request<{
        executionArn: string;
      }>(GENASL_ENDPOINTS.translateAudio, {
        method: 'POST',
        body: JSON.stringify({
          audioKey: request.audioKey,
          style: request.style || 'realistic',
          quality: request.quality || 'medium',
        }),
      });

      return {
        success: true,
        executionArn: response.executionArn,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[GenASL] Audio translation error:', errorMsg);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Get Step Functions execution status
   */
  async getExecutionStatus(
    executionArn: string
  ): Promise<GenASLExecutionStatus> {
    const response = await this.request<GenASLExecutionStatus>(
      `${GENASL_ENDPOINTS.getStatus}?executionArn=${encodeURIComponent(executionArn)}`
    );

    return response;
  }

  /**
   * Poll for execution completion and get video URL
   */
  async waitForCompletion(
    executionArn: string,
    onProgress?: (status: string) => void
  ): Promise<GenASLVideoResult> {
    let attempts = 0;

    while (attempts < GENASL_TIMEOUTS.maxPollingAttempts) {
      const status = await this.getExecutionStatus(executionArn);

      onProgress?.(status.status);

      if (status.status === 'SUCCEEDED') {
        // Fetch the result from the completed execution
        const result = await this.request<GenASLVideoResult>(
          `${GENASL_ENDPOINTS.getStatus}/${executionArn}/result`
        );
        return result;
      }

      if (status.status === 'FAILED' || status.status === 'ABORTED') {
        throw new Error(`GenASL execution ${status.status.toLowerCase()}`);
      }

      if (status.status === 'TIMED_OUT') {
        throw new Error('GenASL execution timed out');
      }

      // Wait before next poll
      await new Promise(resolve =>
        setTimeout(resolve, GENASL_TIMEOUTS.pollingInterval)
      );

      attempts++;
    }

    throw new Error('GenASL polling exceeded maximum attempts');
  }

  /**
   * Translate text and wait for video result
   */
  async translateTextAndWait(
    request: GenASLTranslateRequest,
    onProgress?: (status: string) => void
  ): Promise<GenASLVideoResult> {
    const translateResponse = await this.translateText(request);

    if (!translateResponse.success || !translateResponse.executionArn) {
      throw new Error(translateResponse.error || 'Translation failed');
    }

    return await this.waitForCompletion(
      translateResponse.executionArn,
      onProgress
    );
  }

  /**
   * Get list of available glosses in the database
   */
  async getAvailableGlosses(): Promise<GenASLGloss[]> {
    try {
      const response = await this.request<{ glosses: GenASLGloss[] }>(
        GENASL_ENDPOINTS.getGlosses
      );
      return response.glosses;
    } catch (error) {
      console.error('[GenASL] Failed to fetch glosses:', error);
      return [];
    }
  }

  /**
   * Generate direct video URL from CloudFront
   */
  getVideoUrl(videoKey: string): string {
    if (AWS_GENASL_CONFIG.cloudFrontUrl) {
      return `${AWS_GENASL_CONFIG.cloudFrontUrl}/${videoKey}`;
    }
    return `https://${AWS_GENASL_CONFIG.outputBucket}.s3.${AWS_GENASL_CONFIG.region}.amazonaws.com/${videoKey}`;
  }
}

// Export singleton instance
export const genASLClient = new GenASLClient();

// Export types
export type { GenASLClient };
