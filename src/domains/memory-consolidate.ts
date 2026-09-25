// ── M3 consolidation — 에피소드 → 의미 umbrella 압축 (수면 공고화 · 2026-07-08) ──
//
// 사람 뇌의 해마→신피질 공고화: 흐린 에피소드(warm/cold) 다수를 의미 요약(umbrella)
// 1건으로 압축해 knowledge.db(kind='memory')에 벡터 영속한다. 원본 에피소드는
// consolidated=1 마킹 → 이후 decay/archive(M1/M2)로 자연 정리된다. N개 산발 기억이
// 1개 의미로 응축 = compaction. "무한 누적" 갭 해소.
//
// ★ 결정론 우선(무비용): domain×kind 그룹의 summary 를 bullet 로 응축. opt-in LLM
//   umbrella(비용 게이트·deps.summarize)는 더 매끄러운 요약이 필요할 때만.
// 배선: knowledge-ingest 크론(매일) 또는 replay 루프. READ-ONLY 정리·매매 격리.

import { Database } from 'bun:sqlite';
import { ingestText, type EmbedFn } from './knowledge.js';
import { recordEvent } from './surface-events.js';

export interface ConsolidateDeps {
  embed?: EmbedFn;
  /** opt-in LLM umbrella 요약(미주입 시 결정론 bullet). */
  summarize?: (bullets: string[], key: string) => Promise<string>;
  now?: () => string;
  /** 그룹 최소 크기(이 미만은 압축 안 함·기본 5). */
  minGroup?: number;
  /** 그룹당 최대 반영 건수(기본 30). */
  maxPerGroup?: number;
}

export interface ConsolidateResult { groups: number; consolidated: number; skipped: number }

/** ★ M3 — 흐린 에피소드(warm/cold·미consolidated)를 domain×kind 로 묶어 umbrella 압축.
 *  각 그룹(≥minGroup)을 knowledge.db kind='memory' 로 영속 + 원본 consolidated=1 마킹.
 *  임베딩 실패 그룹은 skip(다음 주기 재시도·원본 미마킹). S3/네트워크 fail-soft. */
export async function consolidateEpisodes(
  sdb: Database,
  kdb: Database,
  deps: ConsolidateDeps = {},
): Promise<ConsolidateResult> {
  const now = deps.now?.() ?? new Date().toISOString();
  const minGroup = deps.minGroup ?? 5;
  const maxPer = deps.maxPerGroup ?? 30;
  const rows = sdb.prepare(
    `SELECT id, ts, kind, summary, text, domain FROM events
     WHERE (consolidated IS NULL OR consolidated = 0) AND tier IN ('warm','cold')
     ORDER BY ts ASC`,
  ).all() as Array<{ id: string; ts: string; kind: string | null; summary: string | null; text: string; domain: string | null }>;

  // domain×kind 그룹핑.
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.domain ?? 'general'}|${r.kind ?? 'event'}`;
    const g = groups.get(key) ?? [];
    g.push(r); groups.set(key, g);
  }

  const out: ConsolidateResult = { groups: 0, consolidated: 0, skipped: 0 };
  const markStmt = sdb.prepare(`UPDATE events SET consolidated = 1 WHERE id = ?`);

  for (const [key, items] of groups) {
    if (items.length < minGroup) continue;
    const use = items.slice(0, maxPer);
    const [domain, kind] = key.split('|');
    const bullets = use.map(i => `- ${(i.summary && i.summary.trim()) ? i.summary.trim() : i.text.replace(/\s+/g, ' ').trim().slice(0, 90)}`);
    // 결정론 umbrella(기본) 또는 opt-in LLM.
    let umbrella: string;
    try {
      umbrella = deps.summarize
        ? await deps.summarize(bullets, key)
        : `[기억 요약 · ${domain}/${kind} · ${use.length}건 (${use[0]!.ts.slice(0, 10)}~${use[use.length - 1]!.ts.slice(0, 10)})]\n${bullets.join('\n')}`;
    } catch { out.skipped++; continue; }

    const id = `memory:${key}:${use[use.length - 1]!.ts}`;
    try {
      const inserted = await ingestText(kdb, { id, ts: now, kind: 'memory', text: umbrella, ...(domain ? { domain } : {}) }, deps.embed);
      // umbrella 가 knowledge 에 존재하면(신규 insert OR 멱등 기존) 원본을 consolidated 마킹.
      sdb.transaction(() => { for (const i of use) markStmt.run(i.id); })();
      if (inserted) out.groups++;
      out.consolidated += use.length;
    } catch { out.skipped++; } // 임베딩 실패 → skip(원본 미마킹·재시도)
  }
  return out;
}

export interface RecapResult { sessions: number; promoted: number }

/** ★ M4 세션 연계 — 세션(session_id)의 흐린 대화 턴(qna·warm/cold) 다수를 세션 요약
 *  (kind='session-recap') 에피소드 1건으로 승격 + 원본 턴 consolidated 마킹. 개별 턴은
 *  저현저(prune 대상)이나 세션 요약은 중현저(회상 잔류) — "그 세션에 무슨 대화·결정을
 *  했나"가 남는다. surface_events 내 승격(knowledge 아님·에피소드 유지). 결정론(질의 응축). */
export function promoteSessionRecaps(sdb: Database, opts: { minTurns?: number; now?: () => string } = {}): RecapResult {
  const now = opts.now?.() ?? new Date().toISOString();
  const minTurns = opts.minTurns ?? 4;
  const rows = sdb.prepare(
    `SELECT id, ts, summary, text, session_id, domain FROM events
     WHERE kind='qna' AND session_id IS NOT NULL AND (consolidated IS NULL OR consolidated=0) AND tier IN ('warm','cold')
     ORDER BY ts ASC`,
  ).all() as Array<{ id: string; ts: string; summary: string | null; text: string; session_id: string; domain: string | null }>;

  const bySession = new Map<string, typeof rows>();
  for (const r of rows) { const g = bySession.get(r.session_id) ?? []; g.push(r); bySession.set(r.session_id, g); }

  const out: RecapResult = { sessions: 0, promoted: 0 };
  const markStmt = sdb.prepare(`UPDATE events SET consolidated = 1 WHERE id = ?`);
  for (const [sid, turns] of bySession) {
    if (turns.length < minTurns) continue;
    const bullets = turns.slice(0, 30).map(t => `- ${(t.summary && t.summary.trim()) ? t.summary.trim() : t.text.replace(/\s+/g, ' ').slice(0, 80)}`);
    const recap = `[세션 요약 · ${sid.slice(0, 8)} · ${turns.length}턴 (${turns[0]!.ts.slice(0, 10)}~${turns[turns.length - 1]!.ts.slice(0, 10)})]\n${bullets.join('\n')}`;
    recordEvent(sdb, {
      surface: 'session', direction: 'inbound', kind: 'session-recap',
      text: recap, summary: recap.slice(0, 150), importance: 5,
      sessionId: sid, ...(turns[0]!.domain ? { domain: turns[0]!.domain } : {}), ts: now,
    });
    sdb.transaction(() => { for (const t of turns.slice(0, 30)) markStmt.run(t.id); })();
    out.sessions++; out.promoted += Math.min(turns.length, 30);
  }
  return out;
}
