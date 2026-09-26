// ⭐⭐⭐ ACP `_meta` 에 **이 턴을 연 쪽의 세션**(예: TUI 채팅 세션)을 실어 보낸다.
//
// ⛔ 왜 필요한가 (실측 2026-08-02 · 원장 `MEAS-S14` · 계획 `PLAN-session-join-across-scope-switch`):
// TUI 의 턴은 **ACP 서버를 지난다**. 서버 쪽 `runCoreTurn` 은 자기 세션(`elanous-session-N`)으로
// ambient 스코프를 열고, 그 뒤 모든 로그(`capability.resolve/tool-selected` 포함)가 그 세션으로 찍힌다.
// ⇒ ***채팅 세션으로 "그 턴에 무슨 툴을 썼나" 를 물으면 위임 턴이 통째로 사라진다.***
// 계측으로 확인: `runCoreTurn` 진입 시 ambient 부모가 **null** — 채팅 세션은 **ACP 경계를 넘지 않는다**.
//
// ⇒ ambient 에 기대지 않고 **명시로** 건넌다. `input_source` 와 **같은 그릇**을 쓰므로 프로토콜 변경이 없다.
// ⚠️ 세션 값을 바꾸지 않는다 — 서버는 이 값을 **간선(`session.link`)에만** 쓴다.

export const ORIGIN_SESSION_META_KEY = 'origin_session';

/** Attach the originating (client-side) session id to an ACP `_meta` blob. */
export function writeOriginSessionMeta(sessionId: string): Record<string, unknown> {
  return { [ORIGIN_SESSION_META_KEY]: sessionId };
}

/**
 * Read the originating session id from an inbound ACP `_meta` blob.
 *
 * ⛔ 없거나 문자열이 아니면 **null** — 빈 문자열도 null 이다(부재와 빈 값을 같은 자리에 두지 않는다).
 */
export function readOriginSessionMeta(
  meta: Readonly<Record<string, unknown>> | null | undefined,
): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = (meta as Record<string, unknown>)[ORIGIN_SESSION_META_KEY];
  return typeof raw === 'string' && raw.trim() ? raw : null;
}
