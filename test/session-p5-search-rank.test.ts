// P5 (2026-07-16) — 세션 검색 관련도 랭킹(trigram FTS5·CJK) + origin 필터.
// in-memory trigram BM25 랭킹 · 최소 3자 폴백 · dispatchSessionQuery rank/origin 통합.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('rankByTrigramFts — trigram BM25(CJK)', () => {
  test('한국어 3자+ 질의를 관련도순 랭킹', async () => {
    const { rankByTrigramFts } = await import('../src/session/search-index.js');
    const docs = [
      { sessionId: 'a', content: 'SK하이닉스 메모리 이야기만 잔뜩' },
      { sessionId: 'b', content: '삼성전자 반도체 실적 발표 삼성전자 또 삼성전자' },
      { sessionId: 'c', content: '삼성전자 한 번 언급' },
    ];
    const ranked = rankByTrigramFts('삼성전자', docs)!;
    expect(ranked).not.toBeNull();
    const ids = ranked.map(r => r.sessionId);
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).not.toContain('a');        // '삼성전자' 없음
    // 더 자주 언급한 b 가 c 보다 관련도 높음(bm25 낮음=앞).
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
  });

  test('3자 미만 질의는 null(호출자 substring 폴백 신호)', async () => {
    const { rankByTrigramFts, isTrigramRankable } = await import('../src/session/search-index.js');
    expect(isTrigramRankable('삼성')).toBe(false);
    expect(rankByTrigramFts('삼성', [{ sessionId: 'a', content: '삼성 삼성' }])).toBeNull();
  });

  test('특수문자 질의도 안전(phrase 이스케이프)', async () => {
    const { rankByTrigramFts } = await import('../src/session/search-index.js');
    expect(() => rankByTrigramFts('a"b* OR', [{ sessionId: 'a', content: 'x' }])).not.toThrow();
  });
});

describe('dispatchSessionQuery search — rank + origin', () => {
  const ORIG = process.env.MONAD_SESSION_ROOT;
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'sess-p5-')); process.env.MONAD_SESSION_ROOT = tmp; });
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (ORIG === undefined) delete process.env.MONAD_SESSION_ROOT; else process.env.MONAD_SESSION_ROOT = ORIG;
  });

  test('rank=true → 관련도순(ranked 플래그) · 기본 최신순', async () => {
    const S = await import('../src/session/index.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const older = S.createSession({ source: 'cli', title: 'older' }, tmp);
    S.appendMessage(older.id, { role: 'user', content: '반도체 반도체 반도체 시황 정리', ts: '2026-07-16T00:00:00Z' }, tmp);
    const newer = S.createSession({ source: 'cli', title: 'newer' }, tmp);
    S.appendMessage(newer.id, { role: 'user', content: '반도체 한 번', ts: '2026-07-16T05:00:00Z' }, tmp);

    // 기본(최신순): newer 먼저.
    const plain = await dispatchSessionQuery({ action: 'search', query: '반도체' }, { root: tmp }) as { ranked?: boolean; hits: Array<{ sessionId: string }> };
    expect(plain.ranked).toBeFalsy();
    expect(plain.hits[0].sessionId).toBe(newer.id);

    // rank: 관련도순 → older(자주 언급) 먼저.
    const ranked = await dispatchSessionQuery({ action: 'search', query: '반도체', rank: true }, { root: tmp }) as { ranked?: boolean; hits: Array<{ sessionId: string; score?: number }> };
    expect(ranked.ranked).toBe(true);
    expect(ranked.hits[0].sessionId).toBe(older.id);
    expect(typeof ranked.hits[0].score).toBe('number');
  });

  test('origin 필터 — pwa 세션만', async () => {
    const S = await import('../src/session/index.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const cli = S.createSession({ source: 'cli', title: 'c', origin: 'cli' }, tmp);
    S.appendMessage(cli.id, { role: 'user', content: '공통키워드 하나', ts: '2026-07-16T00:00:00Z' }, tmp);
    const pwa = S.createSession({ source: 'cli', title: 'p', origin: 'pwa' }, tmp);
    S.appendMessage(pwa.id, { role: 'user', content: '공통키워드 둘', ts: '2026-07-16T01:00:00Z' }, tmp);

    const res = await dispatchSessionQuery({ action: 'search', query: '공통키워드', origin: 'pwa' }, { root: tmp }) as { hits: Array<{ sessionId: string }> };
    expect(res.hits.length).toBe(1);
    expect(res.hits[0].sessionId).toBe(pwa.id);
  });

  test('rank 이지만 <3자 질의 → 폴백(최신순·ranked=false)', async () => {
    const S = await import('../src/session/index.js');
    const { dispatchSessionQuery } = await import('../src/domains/session-query-tool.js');
    const a = S.createSession({ source: 'cli' }, tmp);
    S.appendMessage(a.id, { role: 'user', content: 'AI 관련', ts: '2026-07-16T00:00:00Z' }, tmp);
    const res = await dispatchSessionQuery({ action: 'search', query: 'AI', rank: true }, { root: tmp }) as { ranked?: boolean; hits: unknown[] };
    expect(res.ranked).toBeFalsy();       // 2자 → trigram 불가 → 폴백
    expect(res.hits.length).toBe(1);
  });
});
