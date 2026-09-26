// fact_check 캐스케이드 단위테스트 — 내부/외부 seam 주입(무네트워크·무DB).
import { describe, test, expect } from 'bun:test';
import { factCheck, decideVerdict, significantTokens, relevanceOk, type InternalResult } from './fact-check.js';

function internal(hits: Array<{ score: number; text?: string }>): InternalResult {
  return {
    hits: hits.map((h, i) => ({
      when: `2026-07-0${i + 1}T09:00`, surface: 'outbound', kind: 'report',
      text: h.text ?? `hit ${i}`, importance: 7, score: h.score,
    })),
    archived: [],
  };
}

describe('관련성 게이트 — 거짓 내부확인 방지(라이브 실증 버그)', () => {
  test('일반/시스템 토큰은 유의 토큰에서 제거', () => {
    // "SpaceX Starship latest test flight outcome" → spacex/starship/flight 만 유의
    expect(significantTokens('SpaceX Starship latest test flight outcome')).toEqual(['spacex', 'starship', 'flight']);
  });
  test('무관 히트(elanous 자기 로그)는 관련성 탈락', () => {
    // 실제 오판 사례: backtest/delegate 로그가 test/outcome 로 매칭됐었음
    const toks = significantTokens('SpaceX Starship test flight outcome');
    expect(relevanceOk('[backtest] 가설 4 · tested 4 · outcome: aggressive', toks)).toBe(false);
    expect(relevanceOk('SpaceX Starship 4호기 궤도 도달 성공', toks)).toBe(true);
  });
  test('한국어 prefix substring 매칭 — "삼성"⊂"삼성전자"', () => {
    const toks = significantTokens('삼성 감산');
    expect(relevanceOk('삼성전자 감산 돌입 검토', toks)).toBe(true);
    expect(relevanceOk('삼성전자 주가 +3%', toks)).toBe(false); // 감산 없음 → 탈락(정밀도)
  });
  test('유의 토큰 없으면(전부 불용어) 통과', () => {
    expect(relevanceOk('아무거나', significantTokens('오늘 뉴스 확인'))).toBe(true);
  });
});

describe('decideVerdict — 순수 판정', () => {
  test('내부 top >= 임계 → found-internal', () => {
    expect(decideVerdict(0.5, 0, 0.35)).toBe('found-internal');
  });
  test('내부 약함 + 외부 히트 → found-external', () => {
    expect(decideVerdict(0.1, 3, 0.35)).toBe('found-external');
  });
  test('내부 약함 + 외부 0 → not-found', () => {
    expect(decideVerdict(0.1, 0, 0.35)).toBe('not-found');
  });
  test('외부 null(미검색) + 내부 약함 → not-found', () => {
    expect(decideVerdict(0.1, null, 0.35)).toBe('not-found');
  });
});

describe('factCheck — 캐스케이드', () => {
  test('내부에서 확인되면 외부 검색을 안 한다(비용 절약)', async () => {
    let externalCalled = false;
    const r = await factCheck(
      { query: '삼성 감산' },
      {
        recallInternal: () => internal([{ score: 0.6 }, { score: 0.3 }]),
        searchExternal: async () => { externalCalled = true; return { output: 'x', totalHits: 5 }; },
      },
    );
    expect(r.verdict).toBe('found-internal');
    expect(externalCalled).toBe(false);
    expect(r.internal.length).toBe(2);
  });

  test('내부 약하면 외부로 에스컬레이션 → found-external', async () => {
    const r = await factCheck(
      { query: '엔비디아 실적 서프라이즈' },
      {
        recallInternal: () => internal([{ score: 0.1 }]),
        searchExternal: async () => ({ output: 'reddit/x hits...', totalHits: 4 }),
      },
    );
    expect(r.verdict).toBe('found-external');
    expect(r.external?.totalHits).toBe(4);
    expect(r.internal.length).toBe(1); // 약신호도 참고로 반환
  });

  test('내부·외부 모두 없음 → not-found', async () => {
    const r = await factCheck(
      { query: '있지도 않은 뉴스' },
      {
        recallInternal: () => internal([]),
        searchExternal: async () => ({ output: 'no hits', totalHits: 0 }),
      },
    );
    expect(r.verdict).toBe('not-found');
  });

  test('external=false 면 외부 미검색·내부만', async () => {
    let externalCalled = false;
    const r = await factCheck(
      { query: 'x', external: false },
      {
        recallInternal: () => internal([{ score: 0.1 }]),
        searchExternal: async () => { externalCalled = true; return { output: '', totalHits: 9 }; },
      },
    );
    expect(externalCalled).toBe(false);
    expect(r.verdict).toBe('not-found');
    expect(r.external).toBeNull();
  });

  test('minInternalScore 조정 — 낮추면 약한 내부도 확인 처리', async () => {
    const r = await factCheck(
      { query: 'x', minInternalScore: 0.05 },
      { recallInternal: () => internal([{ score: 0.1 }]), searchExternal: async () => ({ output: '', totalHits: 0 }), searchCommunity: () => [] },
    );
    expect(r.verdict).toBe('found-internal');
  });
});

describe('펨코 인기글 — 별도 신호(verdict 미영향·대표 지적)', () => {
  const commHit = { when: '2026-07-10T00:00', surface: 'community-popular', kind: 'buzz', text: '[👍42] 삼성 감산설', importance: 5, score: 0.7 };
  test('펨코만 있고 내부/외부 없음 → verdict not-found(펨코가 확인 안 시킴)·community 별도', async () => {
    const r = await factCheck(
      { query: '삼성 감산' },
      { recallInternal: () => internal([]), searchExternal: async () => ({ output: '', totalHits: 0 }), searchCommunity: () => [commHit] },
    );
    expect(r.verdict).toBe('not-found');        // 펨코가 있어도 확인 아님
    expect(r.community?.length).toBe(1);         // 별도 신호로 노출
    expect(r.note).toContain('선행 신호');        // 미검증 선행
  });
  test('외부 뉴스 확인 + 펨코 회자 동반 → found-external·community 병기', async () => {
    const r = await factCheck(
      { query: '삼성 감산' },
      { recallInternal: () => internal([]), searchExternal: async () => ({ output: 'news', totalHits: 3 }), searchCommunity: () => [commHit] },
    );
    expect(r.verdict).toBe('found-external');
    expect(r.community?.length).toBe(1);
    expect(r.note).toContain('펨코 인기글');
  });
});
