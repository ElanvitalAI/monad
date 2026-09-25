import type { ClipboardEntry } from '../clipboard/history.js';

export interface DashboardClipboardEntryView {
  id: string;
  text: string;
  ts: number;
}

export interface DashboardClipboardHistoryRuntime {
  mapEntries(entries: readonly ClipboardEntry[]): DashboardClipboardEntryView[];
  normalizeCursor(value: unknown): number | null;
}

export function createDashboardClipboardHistoryRuntime(): DashboardClipboardHistoryRuntime {
  return {
    mapEntries: (entries) =>
      entries.map((entry, index) => ({
        id: `c${entry.ts}-${index}`,
        text: entry.text,
        ts: entry.ts,
      })),
    normalizeCursor(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      return Math.max(0, value);
    },
  };
}
