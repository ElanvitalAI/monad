// ── Notification adapters (NT2) ──
//
// Pure builders that translate upstream events (AgentStatusStore
// transitions, BlockStore commits, matrix lifecycle events) into
// NotificationPushInput shapes. dashboard.ts calls notificationStore.
// push(adapter(...)) so the mapping (kind / title / body / meta) is
// testable without the full wiring harness.

import type { AgentStatusRecord } from '../agent-status/store.js';
import type { Block } from '../block/store.js';
import type { NotificationPushInput } from './store.js';
import type { OscNotifyEvent } from '../preview/terminal.js';

export function statusToNotification(sessionId: string, rec: AgentStatusRecord): NotificationPushInput {
  return {
    sessionId,
    kind: rec.status === 'err' ? 'error' : 'status',
    title: rec.lastEvent ? `${rec.status} · ${rec.lastEvent}` : rec.status,
    ...(rec.lastEvent ? { meta: { event: rec.lastEvent } } : {}),
  };
}

export function blockToNotification(block: Block): NotificationPushInput {
  const firstLine = block.text.split('\n', 1)[0] ?? '';
  const preview = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  return {
    sessionId: block.sessionId,
    kind: 'block',
    title: `block ${block.id}`,
    ...(preview.length > 0 ? { body: preview } : {}),
    meta: { blockId: block.id, kind: block.kind },
  };
}

export function exitToNotification(sessionId: string, code: number | null): NotificationPushInput {
  return {
    sessionId,
    kind: 'exit',
    title: code === null ? 'killed' : `exited (code ${code})`,
    meta: { code: code ?? null },
  };
}

export function attentionToNotification(sessionId: string, level: number): NotificationPushInput {
  return {
    sessionId,
    kind: 'hitl',
    title: `attention level ${level}`,
    meta: { level },
  };
}

/** NT-E1 — parsed OSC 9/99/777 desktop-notification → notification.
 *  Title comes from the OSC payload; body falls back to a hint about
 *  the source code when empty (helps the user distinguish empty
 *  notifies from bell-ringers). */
export function oscToNotification(sessionId: string, ev: OscNotifyEvent): NotificationPushInput {
  const title = ev.title.length > 0 ? ev.title : `osc:${ev.code}`;
  return {
    sessionId,
    kind: 'osc',
    title,
    ...(ev.body.length > 0 ? { body: ev.body } : {}),
    meta: { code: ev.code },
  };
}
