// Self-Evolution SE1 roadmap-scan 단위테스트 — 순수 랭킹(무네트워크).
import { describe, test, expect } from 'bun:test';
import { rankUnimplemented, filterAlreadyImplemented, renderUnimplementedReport, countStrongTopicMatches } from './roadmap-scan.js';
import type { DocEntry } from './doc-inventory.js';

const now = Date.parse('2026-07-09');
const E = (over: Partial<DocEntry>): DocEntry => ({
  path: 'docs/x.md', filename: 'x.md', prefix: 'ROADMAP', topic: 't', date: '2026-07-01',
  sizeBytes: 2048, openBoxes: 5, doneBoxes: 0, subdir: '', ...over,
});

describe('rankUnimplemented', () => {
  test('minOpen 미만·비-plan 제외', () => {
    const r = rankUnimplemented([
      E({ openBoxes: 2 }),                              // 컷
      E({ prefix: 'HANDOFF', openBoxes: 10 }),          // 비-plan 컷
      E({ prefix: 'PLAN', openBoxes: 5 }),              // 포함
    ], { nowMs: now });
    expect(r.length).toBe(1);
  });

  test('north-star 주제 가산 · deprioritized 감점', () => {
    const r = rankUnimplemented([
      E({ filename: 'ROADMAP-autopilot-2026-07-08.md', topic: 'autopilot', openBoxes: 8, date: '2026-07-08' }),
      E({ filename: 'PLAN-tui-border-2026-04-20.md', topic: 'tui-border', openBoxes: 8, date: '2026-04-20' }),
    ], { nowMs: now });
    // autopilot(north-star·최근) 이 tui(deprioritized·오래됨) 보다 위.
    expect(r[0]!.topic).toBe('autopilot');
    expect(r[0]!.priorityScore).toBeGreaterThan(r[1]!.priorityScore);
    expect(r[0]!.reasons.some(x => x.includes('north-star'))).toBe(true);
    expect(r[1]!.reasons.some(x => x.includes('deprioritized'))).toBe(true);
  });

  test('부분 진행 가산', () => {
    const r = rankUnimplemented([E({ topic: 'memory', openBoxes: 5, doneBoxes: 5, date: '2026-07-08' })], { nowMs: now });
    expect(r[0]!.completionRatio).toBe(0.5);
    expect(r[0]!.reasons.some(x => x.includes('부분 진행'))).toBe(true);
  });
});

describe('filterAlreadyImplemented', () => {
  test('recall 미주입 → 전부 live', async () => {
    const plans = rankUnimplemented([E({ topic: 'memory', openBoxes: 5 })], { nowMs: now });
    const { live, likelyDone } = await filterAlreadyImplemented(plans);
    expect(live.length).toBe(1);
    expect(likelyDone.length).toBe(0);
  });
  test('recall hits>=3 → likelyDone 강등', async () => {
    const plans = rankUnimplemented([
      E({ topic: 'autopilot', openBoxes: 8 }),
      E({ topic: 'fresh-idea', openBoxes: 8 }),
    ], { nowMs: now });
    const recall = async (q: string) => ({ hits: q.includes('autopilot') ? 5 : 0 });
    const { live, likelyDone } = await filterAlreadyImplemented(plans, recall);
    expect(likelyDone.some(p => p.topic === 'autopilot')).toBe(true);
    expect(live.some(p => p.topic === 'fresh-idea')).toBe(true);
  });
});

describe('countStrongTopicMatches (SE0.3 정밀 카운트)', () => {
  test('모든 토큰 동시 등장(AND)만 카운트 — OR 오탐 방지', () => {
    const rows = [
      { summary: 'self evolution 엔진 SE0 구현' },          // 둘 다 O
      { summary: 'evolution 관련 리팩토링' },                // 'self' 없음 → X
      { text: 'self awareness 회상 배선' },                  // 'evolution' 없음 → X
      { summary: 'self-evolution 야간 러너 격리' },          // 하이픈이지만 substring O
    ];
    expect(countStrongTopicMatches(rows, 'self evolution')).toBe(2);
  });
  test('단일 흔한 토큰 — text/summary 없어도 안전', () => {
    const rows = [{ summary: null, text: null }, { summary: 'loop 루프 강화' }];
    expect(countStrongTopicMatches(rows, 'loop')).toBe(1);
  });
  test('짧은 토큰(<=2자) 필터 → 매치 없음', () => {
    expect(countStrongTopicMatches([{ summary: 'ab cd' }], 'ab')).toBe(0);
  });
});

describe('renderUnimplementedReport', () => {
  test('상위 N 표', () => {
    const plans = rankUnimplemented([E({ filename: 'ROADMAP-memory.md', topic: 'memory', openBoxes: 10 })], { nowMs: now });
    const md = renderUnimplementedReport(plans, 5);
    expect(md).toContain('미구현 로드맵 발굴');
    expect(md).toContain('ROADMAP-memory.md');
  });
});
