// R6 v2 (2026-05-09) — daily-reflection push fan-out.
//
// Sibling of `notify-turn-end.ts`. Fired by the daily-reflection
// scheduler at the configured wall-clock hour. Body = the Hansei
// polished summary when the LLM polish is wired + succeeds; otherwise
// a deterministic counts-only fallback so the user still gets a
// reflection ping even when the LLM is offline.
//
// Cross-ref:
//   src/web-push/notify-turn-end.ts (sibling pattern)
//   src/notes/daily-reflection.ts (snapshot data)
//   src/notes/daily-reflection-polish.ts (Hansei LLM polish)
//   src/notes/daily-reflection-scheduler.ts (caller)

import { debug } from '../debug/log.js';
import { listSubscriptions } from './subscriptions.js';
import { sendPushToAll } from './sender.js';
import type { DailyReflectionSnapshot } from '../notes/daily-reflection.js';

const BODY_MAX = 280;

function truncate(s: string, n: number): string {
  const trimmed = s.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= n) return trimmed;
  return `${trimmed.slice(0, n - 1)}…`;
}

/** Deterministic fallback body when the Hansei polish isn't
 *  available / threw. Keeps the daily ping informative even when
 *  the LLM provider is offline. */
export function buildFallbackReflectionBody(snap: DailyReflectionSnapshot): string {
  const parts: string[] = [];
  parts.push(`오늘 ${snap.date}`);
  parts.push(`노트 ${snap.notesSaved}건 · OCR ${snap.ocrRuns}회 · 세션 ${snap.sessionsToday}개`);
  if (snap.topSessions.length > 0 && snap.topSessions[0]!.lastMsgPreview) {
    const preview = snap.topSessions[0]!.lastMsgPreview!.slice(0, 80);
    parts.push(`가장 활발한 세션: ${preview}`);
  }
  return parts.join(' · ');
}

export interface NotifyDailyReflectionInput {
  snapshot: DailyReflectionSnapshot;
  /** Pre-computed Hansei polish (optional · scheduler hands it in
   *  when the polish callable wired + succeeded). */
  hanseiText?: string;
}

/** Fire a Web Push announcing today's daily reflection. No-op when
 *  there are zero subscribers. Errors are caught + debug-logged. */
export async function notifyDailyReflection(
  input: NotifyDailyReflectionInput,
): Promise<void> {
  if (listSubscriptions().length === 0) return;
  const body = input.hanseiText && input.hanseiText.trim().length > 0
    ? truncate(input.hanseiText, BODY_MAX)
    : buildFallbackReflectionBody(input.snapshot);
  try {
    const result = await sendPushToAll({
      title: 'elanous — 오늘의 회고',
      body,
      url: `/app/reflection?date=${encodeURIComponent(input.snapshot.date)}`,
      tag: `daily-reflection-${input.snapshot.date}`,
      data: {
        kind: 'daily-reflection',
        date: input.snapshot.date,
        usedHansei: !!input.hanseiText,
      },
    });
    if (debug.enabled) {
      debug.log('webpush.notify', 'daily-reflection', {
        date: input.snapshot.date,
        usedHansei: !!input.hanseiText,
        delivered: result.delivered,
        attempted: result.attempted,
      });
    }
  } catch (e) {
    if (debug.enabled) {
      debug.log('webpush.notify', 'daily-reflection.error', {
        date: input.snapshot.date,
        message: (e as { message?: string })?.message ?? String(e),
      }, { level: 'error' });
    }
  }
}
