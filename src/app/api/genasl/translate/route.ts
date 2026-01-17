/**
 * GenASL Translation API Route
 *
 * This API route proxies requests to the AWS GenASL backend and polls
 * Step Functions for completion. This is needed because the client-side
 * can't directly call AWS Step Functions without Cognito setup.
 */

import { NextRequest, NextResponse } from 'next/server';

const GENASL_API_ENDPOINT = process.env.NEXT_PUBLIC_AWS_GENASL_API_ENDPOINT;
const AWS_REGION = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';

// Maximum polling attempts (2 minutes total with 2s intervals)
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 2000;

interface StepFunctionsStatus {
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';
  output?: string;
  error?: string;
  cause?: string;
}

/**
 * Poll Step Functions execution status using AWS SDK
 */
async function pollStepFunctions(
  executionArn: string
): Promise<StepFunctionsStatus> {
  // Dynamic import to avoid bundling AWS SDK for client
  const { SFNClient, DescribeExecutionCommand } = await import(
    '@aws-sdk/client-sfn'
  );

  const client = new SFNClient({ region: AWS_REGION });
  const command = new DescribeExecutionCommand({ executionArn });
  const response = await client.send(command);

  return {
    status: response.status as StepFunctionsStatus['status'],
    output: response.output,
    error: response.error,
    cause: response.cause,
  };
}

/**
 * Wait for Step Functions execution to complete
 */
async function waitForCompletion(
  executionArn: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const status = await pollStepFunctions(executionArn);

    if (status.status === 'SUCCEEDED') {
      return { success: true, output: status.output };
    }

    if (
      status.status === 'FAILED' ||
      status.status === 'TIMED_OUT' ||
      status.status === 'ABORTED'
    ) {
      return {
        success: false,
        error: status.error || status.cause || `Execution ${status.status}`,
      };
    }

    // Still running, wait and retry
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { success: false, error: 'Polling timeout exceeded' };
}

export async function POST(request: NextRequest) {
  if (!GENASL_API_ENDPOINT) {
    return NextResponse.json(
      { success: false, error: 'GenASL API not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json(
        { success: false, error: 'Text is required' },
        { status: 400 }
      );
    }

    console.log('[GenASL API] Translating:', text);

    // Start the GenASL translation
    const startResponse = await fetch(`${GENASL_API_ENDPOINT}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Text: text }),
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text();
      return NextResponse.json(
        { success: false, error: `GenASL API error: ${errorText}` },
        { status: startResponse.status }
      );
    }

    const startResult = await startResponse.json();
    const { executionArn } = startResult;

    console.log('[GenASL API] Execution started:', executionArn);

    // Poll for completion
    const result = await waitForCompletion(executionArn);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // Parse the output
    const output = JSON.parse(result.output || '{}');

    console.log('[GenASL API] Translation complete');

    return NextResponse.json({
      success: true,
      videoUrl: output.PoseURL || output.SignURL,
      poseUrl: output.PoseURL,
      signUrl: output.SignURL,
      executionArn,
    });
  } catch (error) {
    console.error('[GenASL API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
