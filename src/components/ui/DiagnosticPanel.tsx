'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getDiagEntries,
  subscribeDiag,
  clearDiag,
  type DiagEntry,
  type DiagCategory,
} from '@/lib/diagnostics/diagnosticLog';

const CATEGORY_COLORS: Record<DiagCategory, string> = {
  lstm: 'text-green-400',
  gemini: 'text-blue-400',
  pipeline: 'text-yellow-400',
  motion: 'text-purple-400',
  error: 'text-red-400',
};

const CATEGORY_LABELS: Record<DiagCategory, string> = {
  lstm: 'LSTM',
  gemini: 'GEMINI',
  pipeline: 'PIPE',
  motion: 'MOTION',
  error: 'ERROR',
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
}

function EntryRow({ entry }: { entry: DiagEntry }) {
  return (
    <div className="flex gap-2 py-0.5 font-mono text-[11px] leading-tight">
      <span className="shrink-0 text-white/40">{formatTs(entry.ts)}</span>
      <span className={`shrink-0 font-bold ${CATEGORY_COLORS[entry.category]}`}>
        [{CATEGORY_LABELS[entry.category]}]
      </span>
      <span className="text-white/80">{entry.message}</span>
      {entry.data && (
        <span className="text-white/40 truncate">
          {(() => { try { return JSON.stringify(entry.data); } catch { return '[unserializable]'; } })()}
        </span>
      )}
    </div>
  );
}

interface DiagnosticPanelProps {
  isVisible: boolean;
}

export function DiagnosticPanel({ isVisible }: DiagnosticPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Subscribe to the diagnostic store
  const entries = useSyncExternalStore(
    subscribeDiag,
    getDiagEntries,
    getDiagEntries,
  );

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setAutoScroll(isAtBottom);
  }, []);

  if (!isVisible) return null;

  if (!expanded) {
    // Collapsed: show a small pill with entry count + last message
    const last = entries.length > 0 ? entries[entries.length - 1] : null;
    return (
      <button
        onClick={() => setExpanded(true)}
        className="absolute bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 backdrop-blur-sm border border-white/10 hover:border-white/30 transition-colors"
      >
        <span className="text-[10px] font-bold text-green-400">DIAG</span>
        <span className="text-[10px] text-white/50">{entries.length} entries</span>
        {last && (
          <span className={`text-[10px] truncate max-w-[200px] ${CATEGORY_COLORS[last.category]}`}>
            {last.message}
          </span>
        )}
      </button>
    );
  }

  // Expanded: scrollable log panel
  return (
    <div className="absolute bottom-4 left-4 z-50 flex w-[min(500px,calc(100vw-2rem))] flex-col rounded-lg bg-black/90 backdrop-blur-sm border border-white/10 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] font-bold text-green-400">DIAGNOSTIC LOG</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40">{entries.length} entries</span>
          <button
            onClick={() => clearDiag()}
            className="text-[10px] text-white/40 hover:text-white transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="text-[10px] text-white/40 hover:text-white transition-colors"
          >
            Minimize
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[300px] overflow-y-auto px-3 py-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/20"
      >
        {entries.length === 0 ? (
          <div className="py-4 text-center text-[11px] text-white/30">
            No events yet. Start signing to see diagnostic data.
          </div>
        ) : (
          entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
