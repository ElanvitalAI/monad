// P1 — NL→ACP conversational continuity.
//
// After a `/cc`·/cdx`·/gem` turn, a chat enters "active delegation": plain NL
// follow-ups ("그것도 고쳐줘") continue the SAME bound ACP session (via
// session/load reuse in the turn runner) instead of falling to the brain
// blind. The ACP protocol supports multi-turn sessions natively, so this is a
// routing concern, not a capability one.
//
// SAFETY (this is core-routing state — a stuck mode would trap the user away
// from the brain): every entry has a TTL, and explicit exits (/brain · /new ·
// /cc_clear · targeting a different backend) clear it. The execution footer
// already renders `acp-<backend>` so the mode is always visible.

import { debug } from '../debug/log.js';

interface ActiveDelegation {
  /** Slash backend key ('claude' | 'codex' | 'gemini' | 'grok') to re-dispatch with. */
  backendKey: string;
  /** Last-activity epoch ms (refreshed on each continued turn). */
  ts: number;
}

const store = new Map<string, ActiveDelegation>();

/** Idle window before an active delegation auto-expires (back to the brain). */
export const DELEGATION_TTL_MS = 15 * 60 * 1000;

/** Stable per-chat key (bot-scoped, thread-scoped) — mirrors session keying.
 *  ChatKey-generic (M4b): telegram passes numeric chatIds, discord passes
 *  snowflake strings (channelId) — the key is a string either way. */
export function delegationChatKey(botId: string | undefined, chatId: number | string, threadId?: number | string): string {
  return `${botId ?? ''}:${chatId}:${threadId ?? 0}`;
}

export function setActiveDelegation(key: string, backendKey: string, now: number = Date.now()): void {
  const prev = store.get(key)?.backendKey ?? null;
  store.set(key, { backendKey, ts: now });
  // Observe delegation state transitions — this is core routing state that
  // silently traps plain NL turns onto an ACP backend (self-cognition §1).
  // Only log genuine transitions (not every re-set) to avoid hot-path spam.
  if (prev !== backendKey) {
    debug.log('acp.delegation', 'set', { key, backendKey, prev });
  }
}

/** The active backend key, or null when none / expired (expired entries are
 *  pruned on read). */
export function getActiveDelegation(key: string, now: number = Date.now()): string | null {
  const e = store.get(key);
  if (!e) return null;
  if (now - e.ts > DELEGATION_TTL_MS) { store.delete(key); return null; }
  return e.backendKey;
}

/** Refresh the idle timer after a continued turn. */
export function touchActiveDelegation(key: string, now: number = Date.now()): void {
  const e = store.get(key);
  if (e) e.ts = now;
}

export function clearActiveDelegation(key: string): void {
  store.delete(key);
}

/** When a chat is in active delegation, an EXPLICIT surface signal in the
 *  message overrides the auto-continue — the user's stated intent wins over
 *  "stay in the last backend". Returns:
 *   - 'self'   → route to the brain (user said self/브레인/직접)
 *   - backend  → switch to that ACP backend (user named a different one)
 *   - null     → no signal; continue the active backend
 *  Self-intent is checked FIRST so "codex가 만든 걸 self로 고쳐" → self. */
export function classifyDelegationOverride(text: string): 'self' | 'claude' | 'codex' | 'gemini' | null {
  const t = text.toLowerCase();
  // Self / brain intent: self·브레인·brain, elanous-as-actor (엘라누스가/엘라누스로/
  // 엘라누스 직접·elanous가/로), or a bare "직접 <action>". Not a mere "monad-agent"
  // path mention — elanous must be the SUBJECT (가/로/직접).
  if (/\bself\b|브레인|\bbrain\b|엘라누스\s*(가|로|직접)|elanous\s*(가|로|직접)|직접\s*(해|추가|수정|만들|고쳐|짜|작성|구현|바꿔|처리)/.test(t)) return 'self';
  if (/\bclaude\b|클로드/.test(t)) return 'claude';
  if (/\bcodex\b|\bcdx\b|코덱스/.test(t)) return 'codex';
  if (/\bgemini\b|\bgem\b|제미나이/.test(t)) return 'gemini';
  return null;
}

/** Test seam. */
export function _resetActiveDelegationForTests(): void {
  store.clear();
}
