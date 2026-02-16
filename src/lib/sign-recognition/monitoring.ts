export type SignRecognitionEventStatus =
  | 'success'
  | 'empty'
  | 'validation_error'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'upstream_error'
  | 'timeout'
  | 'internal_error';

export interface SignRecognitionEvent {
  id: string;
  timestamp: string;
  sessionId: string | null;
  sampleId?: string;
  provider?: string;
  source?: string;
  status: SignRecognitionEventStatus;
  latencyMs: number;
  corrected?: boolean;
  confidence?: number;
  text?: string;
  error?: string;
  payloadBytes?: number;
}

export interface FeedbackTrackingEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  sampleId?: string;
  rating: 'positive' | 'negative';
  source?: string;
  originalText?: string;
  correctedText?: string;
  userCorrection?: string;
}

interface MonitoringStore {
  recognitionEvents: SignRecognitionEvent[];
  feedbackEvents: FeedbackTrackingEvent[];
}

interface MonitoringSnapshotOptions {
  sessionId?: string;
  recentLimit?: number;
}

const MAX_RECOGNITION_EVENTS = 500;
const MAX_FEEDBACK_EVENTS = 500;

declare global {
  var __kineSignMonitoringStore: MonitoringStore | undefined;
}

function getStore(): MonitoringStore {
  if (!globalThis.__kineSignMonitoringStore) {
    globalThis.__kineSignMonitoringStore = {
      recognitionEvents: [],
      feedbackEvents: [],
    };
  }

  return globalThis.__kineSignMonitoringStore;
}

function appendWithLimit<T>(items: T[], item: T, maxItems: number): void {
  items.push(item);
  if (items.length > maxItems) {
    items.splice(0, items.length - maxItems);
  }
}

function makeEventId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(index, 0)] ?? 0;
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toUpperCase();
}

export function recordSignRecognitionEvent(
  event: Omit<SignRecognitionEvent, 'id' | 'timestamp'> & Partial<Pick<SignRecognitionEvent, 'id' | 'timestamp'>>
): void {
  const store = getStore();
  const normalized: SignRecognitionEvent = {
    id: event.id || makeEventId(),
    timestamp: event.timestamp || new Date().toISOString(),
    sessionId: event.sessionId ?? null,
    sampleId: event.sampleId,
    provider: event.provider,
    source: event.source,
    status: event.status,
    latencyMs: Math.max(0, Math.round(event.latencyMs || 0)),
    corrected: event.corrected,
    confidence: event.confidence,
    text: event.text,
    error: event.error,
    payloadBytes: event.payloadBytes,
  };

  appendWithLimit(store.recognitionEvents, normalized, MAX_RECOGNITION_EVENTS);
}

export function recordFeedbackTrackingEvent(
  event: Omit<FeedbackTrackingEvent, 'id' | 'timestamp'> & Partial<Pick<FeedbackTrackingEvent, 'id' | 'timestamp'>>
): void {
  const store = getStore();
  const normalized: FeedbackTrackingEvent = {
    id: event.id || makeEventId(),
    timestamp: event.timestamp || new Date().toISOString(),
    sessionId: event.sessionId,
    sampleId: event.sampleId,
    rating: event.rating,
    source: event.source,
    originalText: event.originalText,
    correctedText: event.correctedText,
    userCorrection: event.userCorrection,
  };

  appendWithLimit(store.feedbackEvents, normalized, MAX_FEEDBACK_EVENTS);
}

export function getSignRecognitionMonitoringSnapshot(options: MonitoringSnapshotOptions = {}) {
  const { sessionId, recentLimit = 25 } = options;
  const safeLimit = Math.min(100, Math.max(1, Math.round(recentLimit)));

  const store = getStore();
  const recognitions = sessionId
    ? store.recognitionEvents.filter((event) => event.sessionId === sessionId)
    : store.recognitionEvents;
  const feedback = sessionId
    ? store.feedbackEvents.filter((event) => event.sessionId === sessionId)
    : store.feedbackEvents;

  const statusCounts = recognitions.reduce<Record<string, number>>((acc, event) => {
    acc[event.status] = (acc[event.status] || 0) + 1;
    return acc;
  }, {});

  const sourceCounts = recognitions.reduce<Record<string, number>>((acc, event) => {
    const key = event.source || event.provider || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const correctedCount = recognitions.filter((event) => event.corrected).length;
  const emptyCount = recognitions.filter((event) => event.status === 'empty').length;

  const latencies = recognitions
    .map((event) => event.latencyMs)
    .filter((latency) => Number.isFinite(latency) && latency >= 0);

  const positiveFeedback = feedback.filter((item) => item.rating === 'positive').length;
  const negativeFeedback = feedback.filter((item) => item.rating === 'negative').length;

  const correctionPairCounts = new Map<string, { from: string; to: string; count: number }>();
  for (const item of feedback) {
    const from = normalizeText(item.originalText);
    const to = normalizeText(item.userCorrection);
    if (!from || !to) continue;

    const key = `${from}=>${to}`;
    const current = correctionPairCounts.get(key);
    if (current) {
      current.count += 1;
    } else {
      correctionPairCounts.set(key, { from, to, count: 1 });
    }
  }

  const topCorrections = [...correctionPairCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    sessionId: sessionId ?? null,
    recognition: {
      total: recognitions.length,
      correctedCount,
      correctedRate: recognitions.length > 0 ? Number((correctedCount / recognitions.length).toFixed(4)) : 0,
      emptyCount,
      avgLatencyMs:
        latencies.length > 0
          ? Number((latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length).toFixed(2))
          : 0,
      p95LatencyMs: percentile(latencies, 95),
      statusCounts,
      sourceCounts,
    },
    feedback: {
      total: feedback.length,
      positive: positiveFeedback,
      negative: negativeFeedback,
      positiveRate: feedback.length > 0 ? Number((positiveFeedback / feedback.length).toFixed(4)) : 0,
      topCorrections,
    },
    recent: {
      recognitions: recognitions.slice(-safeLimit).reverse(),
      feedback: feedback.slice(-safeLimit).reverse(),
    },
  };
}
