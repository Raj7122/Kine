'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAppStore } from '@/store/useAppStore';
import { FeedbackButtons, MetricsDashboard } from '@/components/feedback';
import type { SignRecognizeResult } from '@/lib/sign-recognition/types';

export default function FeedbackTestPage() {
  const { sessionId } = useAppStore();
  const [translationText, setTranslationText] = useState('HELLO');
  const [dashboardKey, setDashboardKey] = useState(0);

  const recognition: SignRecognizeResult = {
    text: translationText,
    originalText: translationText,
    corrected: false,
    confidence: 0.5,
    source: 'gemini',
  };

  return (
    <div className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-yellow-400">Feedback Test</h1>
          <Link
            href="/"
            className="text-sm font-medium text-yellow-400/80 hover:text-yellow-400"
          >
            Back to app
          </Link>
        </div>

        <div className="rounded-lg bg-gray-900 p-4">
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500">Session ID</p>
              <p className="break-all font-mono text-xs text-gray-300">{sessionId}</p>
            </div>

            <div>
              <label className="block text-xs text-gray-500">Translation text</label>
              <input
                type="text"
                value={translationText}
                onChange={(e) => setTranslationText(e.target.value)}
                className="mt-1 w-full rounded-md bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                placeholder="e.g., HELLO"
              />
            </div>

            <FeedbackButtons
              recognition={recognition}
              sessionId={sessionId}
              onFeedbackSubmitted={() => setDashboardKey((k) => k + 1)}
            />
          </div>
        </div>

        <MetricsDashboard key={dashboardKey} />
      </div>
    </div>
  );
}
