// W5 Y3 · log-normalizer extractor — coarse JSONL line / item → normalized record.
// Cf. ROADMAP-background-reasoning §3.7 patcher-extractors.

import type { PatcherInputItem, PatcherInputKind } from '../patcher-input-sources.js';

export interface NormalizedRecord {
  /** Where this record came from. */
  source: PatcherInputKind;
  /** ISO-8601 UTC timestamp when knowable; '' when not. */
  ts: string;
  /** Short categorical label — `user_intent.utterance`, `workflow_runs.failed`, ... */
  kind: string;
  /** Free-form summary text — passed to entity-extractor / embedding. */
  text: string;
  /** Optional original payload for downstream cards. */
  raw?: unknown;
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v).slice(0, 2048);
  } catch {
    return String(v).slice(0, 2048);
  }
}

export function normalizeItem(item: PatcherInputItem): NormalizedRecord {
  if (item.kind === 'user_intent') {
    const b = item.payload as { event: { ts: string; intent: { layer: string; kind: string; value?: unknown }; surface: string }; cardKindHint: string };
    return {
      source: 'user_intent',
      ts: b.event.ts,
      kind: `${b.cardKindHint}.${b.event.intent.layer}`,
      text: `[${b.event.surface}] ${b.event.intent.kind}${b.event.intent.value ? ` :: ${safeStringify(b.event.intent.value)}` : ''}`,
      raw: b,
    };
  }
  const payload = item.payload as Record<string, unknown>;
  const ts = (payload?.ts as string) ?? new Date(item.at).toISOString();
  const summary = (payload?.message as string)
    ?? (payload?.summary as string)
    ?? (payload?.text as string)
    ?? safeStringify(payload);
  return {
    source: item.kind,
    ts,
    kind: `${item.kind}.${(payload?.kind as string) ?? 'generic'}`,
    text: summary.slice(0, 1024),
    raw: payload,
  };
}

export function normalizeBatch(items: PatcherInputItem[]): NormalizedRecord[] {
  return items.map(normalizeItem);
}
