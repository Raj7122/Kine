# AWS GenASL Integration Guide

This document describes how to deploy and integrate AWS GenASL (Generative AI-powered American Sign Language avatars) with Kine.

## Overview

AWS GenASL translates text or speech into ASL avatar videos using:
- **Amazon Bedrock** (Claude) for English-to-ASL gloss translation
- **AWS Step Functions** for workflow orchestration
- **Amazon S3** for video storage
- **Amazon DynamoDB** for gloss-to-video mappings
- **Amazon CloudFront** for video delivery

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Kine Frontend                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  AvatarPlayer│  │GenASLPlayer │  │  genASLService.ts      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS GenASL Backend                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ API Gateway │→ │Step Functions│→ │       Lambda            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│         │                │                    │                  │
│         ▼                ▼                    ▼                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Cognito   │  │   Bedrock   │  │      DynamoDB           │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│                          │                    │                  │
│                          ▼                    ▼                  │
│                   ┌─────────────┐  ┌─────────────────────────┐  │
│                   │     S3      │→ │      CloudFront         │  │
│                   └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS Account** with permissions to create:
   - API Gateway
   - Lambda functions
   - Step Functions
   - S3 buckets
   - DynamoDB tables
   - Cognito identity/user pools
   - CloudFront distributions
   - Bedrock model access

2. **AWS CLI** installed and configured

3. **AWS SAM CLI** for backend deployment

4. **Node.js 18+** and **Python 3.9+**

## Step 1: Deploy GenASL Backend

### Clone the GenASL Repository

```bash
git clone https://github.com/aws-samples/genai-asl-avatar-generator.git
cd genai-asl-avatar-generator
```

### Prepare the Avatar Dataset

1. Download the ASLLVD (American Sign Language Lexicon Video Dataset)
2. Configure `dataprep/config.ini` with your S3 bucket names
3. Run the data preparation scripts:

```bash
cd dataprep
python prep_metadata.py
python create_sign_videos.py
python create_pose_videos.py
```

### Deploy the Backend

```bash
cd backend
sam build
sam deploy --guided
```

During guided deployment, note down:
- API Gateway endpoint URL
- Cognito Identity Pool ID
- Cognito User Pool ID
- S3 bucket names
- CloudFront distribution URL

### Deploy the Frontend (Optional)

If you want to test GenASL independently:

```bash
cd frontend
amplify init
amplify add hosting
amplify publish
```

## Step 2: Configure Kine Environment

Add the following to your `.env.local`:

```bash
# AWS GenASL Configuration
NEXT_PUBLIC_AWS_GENASL_API_ENDPOINT=https://xxxxxxxx.execute-api.us-east-1.amazonaws.com/prod
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NEXT_PUBLIC_AWS_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
NEXT_PUBLIC_AWS_COGNITO_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_AWS_GENASL_INPUT_BUCKET=your-genasl-input-bucket
NEXT_PUBLIC_AWS_GENASL_OUTPUT_BUCKET=your-genasl-output-bucket
NEXT_PUBLIC_AWS_CLOUDFRONT_URL=https://xxxxxxxxxx.cloudfront.net
```

## Step 3: Test the Integration

### Using Browser Console

```javascript
// Switch to GenASL mode
setAvatarMode('genasl')

// Translate and play
playGenASL('Hello, how are you?')

// Stop playback
stopGenASL()

// Check current mode
getAvatarMode()
```

### Using the UI

The AvatarPlayer component automatically uses GenASL when configured:

```tsx
import { AvatarPlayer } from '@/components/avatar/AvatarPlayer';

// Auto-selects GenASL if configured
<AvatarPlayer onSequenceComplete={() => console.log('Done!')} />

// Force GenASL mode
<AvatarPlayer mode="genasl" />

// Force Flipbook mode (Supabase-based)
<AvatarPlayer mode="flipbook" />
```

## API Reference

### GenASL Service Functions

```typescript
import { genASLClient } from '@/lib/aws/genASLService';

// Translate text to ASL video
const result = await genASLClient.translateTextAndWait({
  text: 'Hello world',
  style: 'realistic',
  quality: 'medium',
  speed: 1.0,
});

console.log(result.videoUrl);      // Pre-signed S3 URL
console.log(result.glossSequence); // ['HELLO', 'WORLD']
console.log(result.duration);      // Video duration in seconds
```

### Configuration Options

```typescript
// Avatar styles
type GenASLAvatarStyle = 'realistic' | 'cartoon' | 'minimal';

// Video quality
type GenASLVideoQuality = 'low' | 'medium' | 'high';  // 480p, 720p, 1080p

// Playback speeds
const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5];
```

## Cost Considerations

AWS GenASL uses pay-per-use pricing:

| Service | Cost Factor |
|---------|-------------|
| API Gateway | Per request |
| Lambda | Per invocation + duration |
| Step Functions | Per state transition |
| Bedrock (Claude) | Per input/output token |
| S3 | Storage + transfer |
| CloudFront | Data transfer |
| DynamoDB | Read/write capacity |

**Estimated cost per translation**: $0.01 - $0.05 depending on text length and video quality.

## Troubleshooting

### "AWS GenASL not configured" Error

Ensure all required environment variables are set:
- `NEXT_PUBLIC_AWS_GENASL_API_ENDPOINT`
- `NEXT_PUBLIC_AWS_REGION`
- `NEXT_PUBLIC_AWS_COGNITO_IDENTITY_POOL_ID`

### "Translation failed" Error

1. Check CloudWatch logs for Lambda/Step Functions errors
2. Verify Bedrock model access is enabled in your region
3. Ensure the gloss exists in DynamoDB (or fingerspelling will be used)

### Video Playback Issues

1. Verify CloudFront distribution is properly configured
2. Check CORS settings on S3 buckets
3. Ensure pre-signed URLs haven't expired

## Fallback Behavior

When GenASL is unavailable, Kine automatically falls back to:
1. **Flipbook mode** - Frame-based animation from Supabase Storage
2. **Legacy mode** - Emoji-based placeholder animation

## Resources

- [GenASL GitHub Repository](https://github.com/aws-samples/genai-asl-avatar-generator)
- [AWS GenASL Blog Post](https://aws.amazon.com/blogs/machine-learning/genasl-generative-ai-powered-american-sign-language-avatars/)
- [ASL 3D Avatar Translator Guidance](https://aws.amazon.com/solutions/guidance/american-sign-language-3d-avatar-translator-on-aws/)
- [ASLLVD Dataset](https://www.bu.edu/asllrp/av/dai-asllvd.html)
