// ── 세션 최신-스코프 빠른 회수 (hermes get_messages_around 패턴 · 2026-07-10) ──
//
// 대표 지적: 세션 대화 중 "최신 내역만" 빠르게 검색돼야 하고, 타임스탬프가 있어야 한다.
// 메이저 에이전트(hermes-agent) 패턴 = 활성 세션 컨텍스트는 메시지 배열(이미 in-RAM)에서
// 슬라이딩 윈도/최신-우선 스캔으로 회수(전 코퍼스 검색 불필요). 벤치마크상 SQLite 회상도
// 12us 라 in-memory store 는 불필요(데몬 재잦은재시작→기억상실 리스크). durable 저장을
// SoT 로 두고, 이 순수 함수들이 로드된 메시지에서 빠르게 최신/윈도/최신-우선 검색한다.
//
// 전부 순수 — SerializedMessage[](role·content·ts) 입력. ts(ISO)는 이미 메시지에 있음.

export interface RecentMessage {
  index: number;      // 세션 내 위치(0-based)
  role: string;
  content: string;
  ts: string;         // ISO 타임스탬프(이미 존재)
  toolName?: string;
}

interface MsgLike { role: string; content: string; ts?: string; toolName?: string }

function toRecent(m: MsgLike, index: number): RecentMessage {
  return { index, role: m.role, content: m.content, ts: m.ts ?? '', ...(m.toolName ? { toolName: m.toolName } : {}) };
}

export interface RecentOpts {
  limit?: number;            // 최대 반환(기본 20)
  includeTool?: boolean;     // tool 메시지 포함(기본 false — 대화만)
  beforeTs?: string;         // 이 시각 이전만(ISO·페이지네이션/스크롤백)
  sinceTs?: string;          // 이 시각 이후만(ISO·"최근 N분")
}

/** 최신 N개 대화 메시지(끝에서부터·타임스탬프 스코프). 시간순(오래된→최신) 반환.
 *  전 코퍼스 스캔 없이 배열 끝에서 역방향으로 limit 만큼만 수집(빠름). */
export function getRecentMessages(messages: MsgLike[], opts: RecentOpts = {}): RecentMessage[] {
  const limit = opts.limit ?? 20;
  const includeTool = opts.includeTool ?? false;
  const out: RecentMessage[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i]!;
    if (!includeTool && m.role === 'tool') continue;
    const ts = m.ts ?? '';
    if (opts.beforeTs && ts && ts >= opts.beforeTs) continue;
    if (opts.sinceTs && ts && ts < opts.sinceTs) continue;
    out.push(toRecent(m, i));
  }
  return out.reverse(); // 시간순
}

/** 앵커 index 주변 ±radius 윈도(hermes get_messages_around). 스크롤백/문맥 확장용.
 *  검색 매치 위치를 받아 그 주변 대화를 빠르게 회수(FTS 불필요). */
export function getMessagesAround(messages: MsgLike[], anchorIndex: number, radius = 5): RecentMessage[] {
  if (anchorIndex < 0 || anchorIndex >= messages.length) return [];
  const from = Math.max(0, anchorIndex - radius);
  const to = Math.min(messages.length - 1, anchorIndex + radius);
  const out: RecentMessage[] = [];
  for (let i = from; i <= to; i++) out.push(toRecent(messages[i]!, i));
  return out;
}

export interface RecentMatch extends RecentMessage { }

/** 최신-우선 검색 — 배열 끝(최신)에서 역방향 스캔, limit 도달 시 조기종료(전체 스캔 회피).
 *  "최신 내역만 빠르게" 대응: 오래된 히스토리까지 안 뒤지고 최근부터 limit 개만. 최신순 반환. */
export function findRecentMatches(messages: MsgLike[], query: string, opts: { limit?: number; includeTool?: boolean } = {}): RecentMatch[] {
  const limit = opts.limit ?? 10;
  const includeTool = opts.includeTool ?? false;
  const q = query.toLowerCase();
  if (!q) return [];
  const out: RecentMatch[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i]!;
    if (!includeTool && m.role === 'tool') continue;
    if (typeof m.content === 'string' && m.content.toLowerCase().includes(q)) out.push(toRecent(m, i));
  }
  return out; // 최신순(끝→앞)
}
