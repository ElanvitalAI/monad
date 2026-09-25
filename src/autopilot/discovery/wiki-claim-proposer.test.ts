import { describe, it, expect } from 'bun:test';
import { assertCurationProposal } from './doc-curation.js';
import {
  extractClaims, defaultDetectConflict, proposeWikiClaimItems,
  buildWikiClaimProposal, proposeWikiClaimsFromHandoff, type WikiClaimDeps,
} from './wiki-claim-proposer.js';

const HANDOFF = `# HANDOFF 테스트
- monad 의 아크 검증은 grounded 실독으로만 PASS 한다.
- 적응형 grounding 은 skim→read→git→verify→external 로 디깅한다.
짧다
- \`code line\` 무시 대상은 아니지만 코드백틱만
https://example.com
**강조된 생존 지식 진술은 claim 으로 추출된다**
`;

describe('extractClaims', () => {
  it('불릿·강조 진술을 claim 으로(전체 요약 아님)·provenance 포함', () => {
    const claims = extractClaims(HANDOFF, 'docs/HANDOFF-x.md', '2026-07-14');
    expect(claims.length).toBeGreaterThanOrEqual(3);
    expect(claims[0]!.sourcePath).toBe('docs/HANDOFF-x.md');
    expect(claims[0]!.lastVerified).toBe('2026-07-14');
    expect(claims[0]!.text).toContain('grounded');
    expect(claims.some((c) => c.text.includes('강조된 생존 지식'))).toBe(true);
  });
  it('URL·너무 짧은 라인 제외', () => {
    const claims = extractClaims(HANDOFF, 'docs/x.md', '2026-07-14');
    expect(claims.some((c) => c.text.includes('http'))).toBe(false);
    expect(claims.some((c) => c.text === '짧다')).toBe(false);
  });
});

describe('defaultDetectConflict', () => {
  it('주제어 겹치고 부정 신호면 충돌', () => {
    const c = { text: 'STT 기본값은 이제 whisper 가 아니다', sourceQuote: '', sourcePath: '', lastVerified: '' };
    expect(defaultDetectConflict(c, 'STT 기본값은 whisper 이다')).toBe(true);
  });
  it('부정 신호 없으면 충돌 아님(보수)', () => {
    const c = { text: 'STT 기본값은 whisper 이다', sourceQuote: '', sourcePath: '', lastVerified: '' };
    expect(defaultDetectConflict(c, 'STT 기본값은 whisper 이다')).toBe(false);
  });
});

const deps = (over: Partial<WikiClaimDeps> = {}): WikiClaimDeps => ({
  findWikiPage: () => 'docs/wiki/WIKI-grounding.md',
  readWikiPage: () => '기존 위키 본문',
  ...over,
});

describe('proposeWikiClaimItems', () => {
  const claim = { text: 'grounded 실독으로만 PASS', sourceQuote: '- grounded 실독', sourcePath: 'docs/H.md', lastVerified: '2026-07-14' };

  it('대상 페이지 없으면 스킵(자동 신규 생성 안 함)하고 폐기·관측 통계를 남긴다', () => {
    const observed: Array<{ category: string; event: string; data: unknown }> = [];
    const secret = 'claim-body-must-not-reach-observation';
    const skipped = { ...claim, text: secret, sourcePath: 'docs/unmatched.md' };
    const items = proposeWikiClaimItems([skipped], deps({
      findWikiPage: () => null,
      logSink: (category, event, data) => observed.push({ category, event, data }),
    }));
    expect(items).toHaveLength(0);
    expect(items.statistics).toEqual({
      receivedClaims: 1,
      proposedItems: 0,
      discardedClaims: 1,
      discarded: { reason: 'no-matching-wiki-page', sourcePaths: ['docs/unmatched.md'] },
    });
    expect(observed).toEqual([{
      category: 'autopilot.discovery', event: 'wiki-claim-proposal', data: items.statistics,
    }]);
    expect(JSON.stringify(observed)).not.toContain(secret);
  });

  it('통계는 기존 배열 열거와 객체 spread를 바꾸지 않는다', () => {
    const items = proposeWikiClaimItems([claim], deps());
    expect(Object.keys(items)).toEqual(['0']);
    const enumerated: string[] = [];
    for (const key in items) enumerated.push(key);
    expect(enumerated).toEqual(['0']);
    const spread = { ...items };
    expect('statistics' in spread).toBe(false);
    expect(spread[0]).toBe(items[0]);
    expect(items.statistics.proposedItems).toBe(1);
  });

  it('받은 claim 수는 제안과 폐기의 합이고 빈 입력과 전량 폐기가 구별된다', () => {
    const mixed = proposeWikiClaimItems([claim, { ...claim, sourcePath: 'docs/unmatched.md' }], deps({
      findWikiPage: (candidate) => candidate.sourcePath === 'docs/unmatched.md' ? null : 'docs/wiki/WIKI-grounding.md',
    }));
    const empty = proposeWikiClaimItems([], deps());
    expect(mixed.statistics).toMatchObject({ receivedClaims: 2, proposedItems: 1, discardedClaims: 1 });
    expect(mixed.statistics.receivedClaims).toBe(mixed.statistics.proposedItems + mixed.statistics.discardedClaims);
    expect(empty.statistics).toMatchObject({ receivedClaims: 0, proposedItems: 0, discardedClaims: 0 });
    expect(empty.statistics).not.toEqual(mixed.statistics);
  });

  it('신규 페이지 → add · provenance 포함 · 비파괴 diff', () => {
    const items = proposeWikiClaimItems([claim], deps({ readWikiPage: () => null }));
    expect(items).toHaveLength(1);
    expect(items[0]!.action).toBe('add');
    expect(items[0]!.evidenceQuote).toBe('- grounded 실독'); // 원문 구절 provenance
    expect(items[0]!.sourcePath).toBe('docs/H.md');
    expect(items[0]!.reason).toContain('verified 2026-07-14');
    expect(items[0]!.diff).toContain('비파괴');
  });

  it('기존 페이지 → update(append) · 원문 안 덮어씀', () => {
    const items = proposeWikiClaimItems([claim], deps());
    expect(items[0]!.action).toBe('update');
    expect(items[0]!.diff).toContain('append');
  });

  it('충돌 → contradiction 플래그 + 병렬 근거(비파괴)', () => {
    const conflictClaim = { text: 'STT 기본값은 이제 whisper 가 아니다', sourceQuote: 'q', sourcePath: 'docs/H.md', lastVerified: '2026-07-14' };
    const items = proposeWikiClaimItems([conflictClaim], deps({ readWikiPage: () => 'STT 기본값은 whisper 이다' }));
    expect(items[0]!.reason).toContain('CONTRADICTION');
    expect(items[0]!.diff).toContain('parallel-evidence');
    expect(items[0]!.diff).toContain('원문 보존');
  });
});

describe('buildWikiClaimProposal · end-to-end', () => {
  it('유효한 CurationProposal(멱등키·status proposed)로 봉투', () => {
    const p = proposeWikiClaimsFromHandoff(HANDOFF, 'docs/HANDOFF-x.md', deps({ readWikiPage: () => null }), { nowIso: '2026-07-14T00:00:00Z', nowDate: '2026-07-14' });
    expect(() => assertCurationProposal(p)).not.toThrow(); // 기존 계약 통과
    expect(p.status).toBe('proposed');
    expect(p.idempotencyKey.length).toBeGreaterThan(0);
    expect(p.wikiClaimStatistics).toMatchObject({ receivedClaims: p.items.length, proposedItems: p.items.length, discardedClaims: 0 });
    expect(p.items.every((i) => i.action !== 'archive')).toBe(true); // 자동 archive 없음
  });

  it('멱등 억제 — 같은 키 재실행이면 suppressed 빈 제안', () => {
    const first = proposeWikiClaimsFromHandoff(HANDOFF, 'docs/H.md', deps(), { nowIso: '2026-07-14T00:00:00Z', nowDate: '2026-07-14' });
    const again = proposeWikiClaimsFromHandoff(HANDOFF, 'docs/H.md', deps(), { nowIso: '2026-07-14T00:00:00Z', nowDate: '2026-07-14', existingIdempotencyKeys: new Set([first.idempotencyKey]) });
    expect(again.suppressed).toBe(true);
    expect(again.items).toHaveLength(0);
  });
});
