// ── 세션 딥링크 @session:<id> (PLAN §P6·Hermes·Warp permalink · 2026-07-16) ──────────
//
// 한 서피스에서 세션 링크를 뱉으면 다른 서피스가 그 링크로 세션을 연다(크로스서피스 참조).
// 형식 = `@session:<id-or-prefix>` — Hermes/Warp permalink 관행. resolveSessionId prefix
// 해소 재사용(재구현 0). 순수 파서 — 부작용 없음(resolve 는 세션 인덱스만 읽음).

import { resolveSessionId, sessionRoot } from './index.js';

/** 딥링크 토큰 매치 — @session: 뒤 id/prefix(4자+·uuid 하이픈 포함). */
const DEEPLINK_RE = /@session:([a-zA-Z0-9][a-zA-Z0-9-]{3,})/g;

/** 세션 id → 공유용 딥링크(짧은 prefix). 한 서피스가 방출. */
export function formatSessionDeepLink(id: string): string {
  return `@session:${id.slice(0, 8)}`;
}

/** 텍스트에서 딥링크 토큰(id/prefix) 전부 추출 — 중복 제거·순서 보존. */
export function extractSessionDeepLinks(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(DEEPLINK_RE)) {
    const tok = m[1]!;
    if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
  }
  return out;
}

/** 딥링크 토큰(또는 raw prefix)을 실제 세션 id 로 해소. 없거나 모호하면 null.
 *  `@session:` 접두 유무 모두 허용. resolveSessionId(ambiguous 시 throw)를 삼켜 null. */
export function resolveSessionDeepLink(token: string, root: string = sessionRoot()): string | null {
  const raw = token.replace(/^@session:/, '').trim();
  if (!raw) return null;
  try { return resolveSessionId(raw, root); }
  catch { return null; } // ambiguous prefix → null(호출자 "더 긴 prefix" 안내)
}
