import { NextRequest, NextResponse } from 'next/server';

import { getSignRecognitionMonitoringSnapshot } from '@/lib/sign-recognition/monitoring';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId')?.trim() || undefined;
    const parsedLimit = Number(url.searchParams.get('limit') || 25);
    const recentLimit = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
      : 25;

    const snapshot = getSignRecognitionMonitoringSnapshot({
      sessionId,
      recentLimit,
    });

    return NextResponse.json({
      success: true,
      ...snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
