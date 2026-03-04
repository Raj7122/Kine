/**
 * In-app diagnostic log for pipeline debugging.
 *
 * Captures LSTM, Gemini, motion, and pipeline events in a ring buffer
 * that the DiagnosticPanel UI component reads from. No console filter
 * fiddling required — everything shows up in the overlay.
 *
 * Usage:
 *   import { dlog } from '@/lib/diagnostics/diagnosticLog';
 *   dlog('lstm', 'Prediction: HELLO (92.3%)');
 *   dlog('gemini', 'Response in 3200ms', { payloadKB: 120 });
 */

export type DiagCategory =
  | 'lstm'
  | 'gemini'
  | 'pipeline'
  | 'motion'
  | 'error';

export interface DiagEntry {
  id: number;
  ts: number;        // Date.now()
  category: DiagCategory;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_ENTRIES = 80;
let nextId = 1;
const entries: DiagEntry[] = [];
const listeners = new Set<() => void>();

/**
 * Append a diagnostic log entry.
 * Also mirrors to console.log for dev-tools visibility.
 */
export function dlog(
  category: DiagCategory,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry: DiagEntry = {
    id: nextId++,
    ts: Date.now(),
    category,
    message,
    data,
  };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }

  // Mirror to console so it's also in dev-tools
  const prefix = `[Diag:${category}]`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }

  // Notify subscribers (React components)
  listeners.forEach((fn) => fn());
}

/** Read all current entries (newest last). */
export function getDiagEntries(): readonly DiagEntry[] {
  return entries;
}

/** Subscribe to changes. Returns unsubscribe function. */
export function subscribeDiag(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Clear all entries. */
export function clearDiag(): void {
  entries.length = 0;
  listeners.forEach((fn) => fn());
}
