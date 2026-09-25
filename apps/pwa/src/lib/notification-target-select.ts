// PR #1730 / BACKLOG #17 — pure helper that mirrors the SW
// `notificationclick` handler's client selection logic.
//
// Why this duplicates `apps/pwa/public/sw.js`: that file runs in a
// ServiceWorker context (no module imports, plain JS), so the same
// logic can't be shared at runtime. Instead we keep this helper as
// the **contract** under unit test — when the rule changes, the SW
// inline copy gets updated alongside this file. The matching test
// file (`notification-target-select.test.ts`) makes the contract
// explicit so a stale SW copy is loud the next time anyone reads
// the rule here.
//
// Selection priority:
//   1. A client whose URL contains `session=<id>` matching the
//      payload's `data.sessionId` (user clicked an "agent done"
//      notification → prefer the tab already on that session).
//   2. A client on the PWA scope (`/app/`) — better than a random
//      foreign tab.
//   3. The first available window client.
//   4. Else `null` → caller opens a new window.

export interface NotificationClientLike {
  /** Client URL — `WindowClient.url` in browser. */
  url: string;
}

export interface NotificationTargetData {
  /** Optional payload session id (matches push payload from
   *  daemon's `notifyAgentTurnEnd`). */
  sessionId?: string | null | undefined;
}

/** Decide which existing client (if any) the SW should focus when
 *  the notification is tapped. Returns the original input reference
 *  so the caller can call `.focus()` on the actual `WindowClient`. */
export function selectNotificationTargetClient<T extends NotificationClientLike>(
  clients: readonly T[],
  data: NotificationTargetData,
): T | null {
  if (clients.length === 0) return null;

  const targetSessionId = (typeof data.sessionId === 'string' && data.sessionId.length > 0)
    ? data.sessionId
    : null;

  let preferred: T | null = null;
  let pwaScope: T | null = null;
  for (const client of clients) {
    const clientUrl = typeof client.url === 'string' ? client.url : '';
    if (targetSessionId
      && clientUrl.includes(`session=${encodeURIComponent(targetSessionId)}`)) {
      preferred = client;
      break;
    }
    if (clientUrl.includes('/app/') && pwaScope === null) {
      pwaScope = client;
    }
  }
  return preferred ?? pwaScope ?? clients[0] ?? null;
}

/** When the chosen client is focused, decide whether the SW should
 *  also call `client.navigate(target)`. We skip the call when the
 *  client is already on a matching URL — focusing alone is the
 *  smoother UX and `.navigate()` would reload state pointlessly. */
export function shouldNavigateAfterFocus(
  clientUrl: string | undefined,
  target: string,
  sessionId: string | null | undefined,
): boolean {
  if (!clientUrl) return true;
  if (sessionId) {
    return !clientUrl.includes(`session=${encodeURIComponent(sessionId)}`);
  }
  return !clientUrl.endsWith(target);
}
