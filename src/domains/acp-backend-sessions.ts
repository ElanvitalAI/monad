// ACP-client 백엔드 세션 read-through (G3 · 2026-07-18)
//
// `monad session` 은 canonical 전사 스토어 S1(`~/.monad/sessions`)만 읽는다. 그러나
// monad 가 백엔드(codex/claude)를 ACP 로 구동한 **코딩 위임 전사**는 S2
// (`~/.monad/acp-sessions/*.json` · `acp/session-persistence.ts`)에만 남아 `monad session`
// 에 안 보였다(감사 G3). 이 모듈은 기존 persistence 공개 API(list/load)를 재사용해 S2
// 세션을 SessionMeta 호환 형태로 노출한다. **read-only·쓰기경로 무접촉.**
//
// S2 history 는 role 없는 ContentBlock[] 이나 백엔드 ACP 는 user→agent 교대 저장이라
// 인덱스 짝/홀로 role 을 추론(짝=user·홀=assistant).

import {
  globalAcpSessionPersistence,
  sanitizeForFilename,
  type AcpSessionPersistence,
  type PersistedAcpSession,
} from '../acp/session-persistence.js';
// ⛔ 접두는 «잎»에서 온다 — `dual-role-manager` 는 무거운 그래프를 끌고 온다(`namespaces.ts` 머리말).
import { CLIENT_NAMESPACE } from '../acp/namespaces.js';

export interface AcpBackendListItem {
  id: string;
  title: string;
  source: 'cli';
  origin: 'acp';
  backendId: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface AcpBackendMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** ContentBlock → plain text(구조적 타입 — SDK import 커플링 회피). 비-text 블록은 `[<type>]`. */
function blockText(b: unknown): string {
  const bb = b as { type?: unknown; text?: unknown } | null;
  if (bb && typeof bb === 'object' && bb.type === 'text' && typeof bb.text === 'string') return bb.text;
  const t = bb && typeof bb === 'object' ? bb.type : undefined;
  return typeof t === 'string' ? `[${t}]` : '';
}

function deriveTitle(s: PersistedAcpSession): string {
  for (const b of s.history) {
    const t = blockText(b).replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 60);
  }
  return `[${s.backendId}] (빈 세션)`;
}

function toListItem(s: PersistedAcpSession): AcpBackendListItem {
  return {
    id: s.sessionId,
    title: deriveTitle(s),
    source: 'cli',
    origin: 'acp',
    backendId: s.backendId,
    cwd: s.cwd,
    createdAt: s.createdAt,
    updatedAt: s.lastSeenAt,
    messageCount: s.history.length,
  };
}

/** 백엔드 위임 세션 id 형태(`acp-cli:…` / `acp-cli_…`) 판정 — doShow 라우팅용.
 *
 *  ⛔⭐⭐ **두 형태를 «손으로» 적지 않는다**(17차 `[F]` · 자가 이 자리를 희소성 상위로 올렸다):
 *  ⓐ 접두는 잎(`acp/namespaces.ts`)이 갖는다 — `dual-role-manager` 를 import 하면
 *    이 모듈이 스스로 못 박은 «read-only·가벼움»이 깨진다.
 *  ⓑ 언더스코어 변종은 ***파생시킨다.*** 그것은 파일명 살균(`sanitizeForFilename`)이
 *    `:` 를 `_` 로 바꾼 결과이고(저장 경로 `~/.monad/acp-sessions/acp-cli_claude_s-1.json`),
 *    ***살균 규칙이 바뀌면 이 판정도 같이 따라가야 한다.***
 *  🔑 베끼면 두 값이 «각자» 늙는다. 파생시키면 한 값만 늙는다. */
export function isAcpBackendSessionId(id: string): boolean {
  return id.startsWith(CLIENT_NAMESPACE) || id.startsWith(sanitizeForFilename(CLIENT_NAMESPACE));
}

/** S2 전 세션을 SessionMeta 호환 목록으로. read-only·fail-soft. */
export function listAcpBackendSessions(
  persistence: AcpSessionPersistence = globalAcpSessionPersistence(),
): AcpBackendListItem[] {
  try {
    return persistence.list().map(toListItem);
  } catch {
    return [];
  }
}

/** id(정확·prefix)로 S2 세션 1건 로드 → 교대추론 role 전사. 없으면 null. */
export function loadAcpBackendSession(
  rawId: string,
  persistence: AcpSessionPersistence = globalAcpSessionPersistence(),
): { meta: AcpBackendListItem; messages: AcpBackendMessage[] } | null {
  try {
    let s = persistence.load(rawId);
    if (!s) {
      // prefix 매칭(사용자가 짧은 접두 입력) — 유일 후보만 채택.
      const matches = persistence.list().filter((x) => x.sessionId.startsWith(rawId));
      if (matches.length === 1) s = matches[0];
    }
    if (!s) return null;
    const messages: AcpBackendMessage[] = s.history
      .map((b, i): AcpBackendMessage => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: blockText(b) }))
      .filter((m) => m.content.length > 0);
    return { meta: toListItem(s), messages };
  } catch {
    return null;
  }
}

/** query(소문자 부분일치)로 S2 세션 내용검색 → 매치 세션 + 스니펫. read-only·fail-soft. */
export function searchAcpBackendSessions(
  query: string,
  persistence: AcpSessionPersistence = globalAcpSessionPersistence(),
): Array<{ meta: AcpBackendListItem; matchCount: number; snippets: Array<{ role: 'user' | 'assistant'; text: string }> }> {
  const q = query.toLowerCase();
  if (!q) return [];
  const out: Array<{ meta: AcpBackendListItem; matchCount: number; snippets: Array<{ role: 'user' | 'assistant'; text: string }> }> = [];
  try {
    for (const s of persistence.list()) {
      const msgs: AcpBackendMessage[] = s.history
        .map((b, i): AcpBackendMessage => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: blockText(b) }))
        .filter((m) => m.content.toLowerCase().includes(q));
      if (msgs.length === 0) continue;
      out.push({
        meta: toListItem(s),
        matchCount: msgs.length,
        snippets: msgs.slice(0, 3).map((m) => ({ role: m.role, text: m.content.slice(0, 160) })),
      });
    }
  } catch {
    return out;
  }
  return out;
}
