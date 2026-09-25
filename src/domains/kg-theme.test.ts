import { test, expect, describe } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ensureKgTables, getNode, getEdges } from './kg-store.js';
import { clusterByCorrelation, detectRotationThemes, recordThemeCandidate } from './kg-theme.js';
import type { PriceBar } from './kg-correlation.js';

function freshDb(): Database { const db = new Database(':memory:'); ensureKgTables(db); return db; }
function fromRets(rets: number[], start = 100): PriceBar[] {
  const c = [start]; for (const r of rets) c.push(c[c.length - 1]! * (1 + r / 100));
  return c.map((x, i) => ({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, close: x }));
}
const R = [2, -3, 1, -2, 3, -1, 2, -3, 1, -2, 2, -1];
const NEG_R = R.map(x => -x);
const R2 = [1, 1, -2, 2, -1, 1, 2, -2, 1, -1, 2, 1];   // 다른 패턴(무관)

describe('kg-theme — 상관 클러스터링(R1 동적발굴)', () => {
  test('동조 종목끼리 한 클러스터, 무관 종목 분리', () => {
    const prices = new Map<string, PriceBar[]>([
      ['A', fromRets(R)], ['B', fromRets(R)],       // A·B 동조
      ['C', fromRets(R2)],                          // 별개
    ]);
    const clusters = clusterByCorrelation(['A', 'B', 'C'], prices, { threshold: 0.6 });
    expect(clusters).toHaveLength(1);               // A·B (C는 minSize 미달·분리)
    expect(clusters[0]!.sort()).toEqual(['A', 'B']);
  });
  test('역관계는 묶지 않음(동조만·양의 상관)', () => {
    const prices = new Map<string, PriceBar[]>([['A', fromRets(R)], ['B', fromRets(NEG_R)]]);
    expect(clusterByCorrelation(['A', 'B'], prices, { threshold: 0.6 })).toHaveLength(0);
  });
});

describe('kg-theme — 로테이션 발굴(R7)', () => {
  test('★역관계 그룹 → rotation 테마(P7↔M7)', () => {
    const memberMap = new Map([['group:P7', ['MU', 'INTC']], ['group:M7', ['NVDA', 'AMZN']]]);
    const prices = new Map<string, PriceBar[]>([
      ['MU', fromRets(R)], ['INTC', fromRets(R)],
      ['NVDA', fromRets(NEG_R)], ['AMZN', fromRets(NEG_R)],
    ]);
    const themes = detectRotationThemes([['group:P7', 'group:M7']], memberMap, prices, { window: 20, threshold: 0.5 });
    expect(themes).toHaveLength(1);
    expect(themes[0]!.kind).toBe('rotation');
    expect(themes[0]!.corr).toBeLessThan(-0.5);
  });
  test('동조 그룹 → comove 테마', () => {
    const memberMap = new Map([['group:A', ['MU', 'INTC']], ['group:B', ['NVDA', 'AMZN']]]);
    const prices = new Map<string, PriceBar[]>([
      ['MU', fromRets(R)], ['INTC', fromRets(R)], ['NVDA', fromRets(R)], ['AMZN', fromRets(R)],
    ]);
    const themes = detectRotationThemes([['group:A', 'group:B']], memberMap, prices, { window: 20 });
    expect(themes[0]!.kind).toBe('comove');
  });
});

describe('kg-theme — 후보 큐 적재', () => {
  test('recordThemeCandidate → theme 노드(status=candidate) + 멤버 belongs_to', () => {
    const db = freshDb();
    const id = recordThemeCandidate(db, '2026-07-08', {
      key: 'ai-power', name: 'AI 전력 테마', members: ['051910', '015760'],
      evidence: { corr: 0.72 },
    });
    expect(id).toBe('theme:ai-power');
    const n = getNode(db, id)!;
    expect(n.kind).toBe('theme');
    expect(n.meta!.status).toBe('candidate');       // 자동 승격 안 함
    expect(n.meta!.corr).toBe(0.72);
    expect(getEdges(db, { dst: id, relation: 'belongs_to' })).toHaveLength(2);
  });
  test('멤버가 완전 id면 그대로, code면 company: 접두', () => {
    const db = freshDb();
    recordThemeCandidate(db, '2026-07-08', { key: 't', name: 't', members: ['005930', 'group:P7'] });
    const srcs = getEdges(db, { dst: 'theme:t', relation: 'belongs_to' }).map(e => e.src).sort();
    expect(srcs).toEqual(['company:005930', 'group:P7']);
  });
});
