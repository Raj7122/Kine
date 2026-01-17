/**
 * AWS GenASL Configuration
 *
 * This module contains configuration for AWS GenASL integration.
 * GenASL is AWS's Generative AI-powered American Sign Language avatar system.
 *
 * Required AWS Services:
 * - Amazon API Gateway (REST API endpoint)
 * - AWS Step Functions (workflow orchestration)
 * - Amazon Bedrock (Claude for gloss translation)
 * - Amazon S3 (video storage)
 * - Amazon DynamoDB (gloss-to-video mappings)
 * - Amazon Cognito (authentication)
 * - Amazon CloudFront (video delivery)
 *
 * @see https://github.com/aws-samples/genai-asl-avatar-generator
 */

// Environment variables for AWS GenASL
export const AWS_GENASL_CONFIG = {
  // API Gateway endpoint for GenASL backend
  apiEndpoint: process.env.NEXT_PUBLIC_AWS_GENASL_API_ENDPOINT || '',

  // AWS Region where GenASL is deployed
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',

  // Cognito Identity Pool ID for unauthenticated access
  identityPoolId: process.env.NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID || '',

  // Cognito User Pool ID (if using authenticated access)
  userPoolId: process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID || '',

  // Cognito User Pool Client ID
  userPoolClientId: process.env.NEXT_PUBLIC_AWS_COGNITO_USER_POOL_CLIENT_ID || '',

  // S3 bucket for input audio/text uploads
  inputBucket: process.env.NEXT_PUBLIC_AWS_GENASL_INPUT_BUCKET || '',

  // S3 bucket for output avatar videos
  outputBucket: process.env.NEXT_PUBLIC_AWS_GENASL_OUTPUT_BUCKET || '',

  // CloudFront distribution URL for video delivery
  cloudFrontUrl: process.env.NEXT_PUBLIC_AWS_CLOUDFRONT_URL || '',
};

// Check if AWS GenASL is configured
// Note: For local testing, only apiEndpoint is required
// Cognito can be optional for testing purposes
export const isGenASLConfigured = Boolean(
  AWS_GENASL_CONFIG.apiEndpoint &&
  AWS_GENASL_CONFIG.region
);

// GenASL API endpoints
export const GENASL_ENDPOINTS = {
  // Translate text to ASL avatar video
  translateText: '/translate/text',

  // Translate audio to ASL avatar video
  translateAudio: '/translate/audio',

  // Get execution status
  getStatus: '/status',

  // Get available glosses
  getGlosses: '/glosses',
};

// GenASL avatar settings
export const GENASL_AVATAR_SETTINGS = {
  // Default avatar style
  defaultStyle: 'realistic' as const,

  // Available avatar styles
  styles: ['realistic', 'cartoon', 'minimal'] as const,

  // Video format
  videoFormat: 'mp4' as const,

  // Video quality options
  quality: {
    low: '480p',
    medium: '720p',
    high: '1080p',
  },

  // Default video quality
  defaultQuality: '720p',

  // Playback speed options
  speedOptions: [0.5, 0.75, 1.0, 1.25, 1.5],

  // Default playback speed
  defaultSpeed: 1.0,
};

// Request timeout settings
export const GENASL_TIMEOUTS = {
  // API request timeout (ms)
  apiTimeout: 30000,

  // Step Functions polling interval (ms)
  pollingInterval: 2000,

  // Maximum polling attempts
  maxPollingAttempts: 60,

  // Video load timeout (ms)
  videoLoadTimeout: 15000,
};

export type GenASLAvatarStyle = typeof GENASL_AVATAR_SETTINGS.styles[number];
export type GenASLVideoQuality = keyof typeof GENASL_AVATAR_SETTINGS.quality;
