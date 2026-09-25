import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { loadMissionBlueprint } from '../../src/mission-blueprints/loader.js';
import { createMorningMarketReportBlueprint, type MorningReportReaders } from '../../src/mission-blueprints/req-v1-cb22a01a981af431.js';
import type { CapabilityProvider } from '../../src/mission-capabilities/registry.js';

const requestId = 'req:v1:cb22a01a981af431';
const authorityRoot = resolve(import.meta.dir, '../..');
const ids = ['market.quotes.multi', 'market.sector.moves', 'market.surge.list', 'news.resolution.scaled', 'analysis.valuechain', 'report.trafficlight'];
const providers = new Map(ids.map(id => [id, { id, probe: async () => ({ ok: true }) } satisfies CapabilityProvider]));
const baseIndexes = () => [{ symbol: '^GSPC', region: 'US', date: '2026-08-31', close: 6500, return1d: 1.25 }, { symbol: '^IXIC', region: 'US', date: '2026-08-31', close: 22000, return1d: 0.5 }, { symbol: 'EWY', region: 'KR', date: '2026-08-31', close: 80, return1d: -0.5 }, { symbol: 'EWJ', region: 'JP', date: '2026-08-31', close: 70, return1d: 0.75 }, { symbol: 'FXI', region: 'CN', date: '2026-08-31', close: 35, return1d: 2 }];
const readers = (overrides: Partial<MorningReportReaders> = {}): MorningReportReaders => ({
  indexes: baseIndexes,
  sectors: () => [{ market: 'KR', window: 'daily', chain: '반도체', mom: 0, breadth: 0, score: 8.5, n: 3, rank: 1 }, { market: 'US', window: 'daily', chain: 'Energy', mom: 0, breadth: 0, score: 4.25, n: 2, rank: 2 }],
  surges: () => [{ symbol: 'THREEDAY', days: 3, cumulativePct: 12.5 }, { symbol: 'TWODAY', days: 2, cumulativePct: 5 }],
  valuechain: () => ({ chainName: '반도체', memberCount: 2, supplies: [{ upName: '웨이퍼', downName: 'HBM' }], propagation: [] }),
  news: () => [{ item: { id: 'signal:high', topic: '고강도 신호', sector: 'semis', score: 9 }, plan: { mode: 'deep', label: 'deep(다각도+풀스크랩+커뮤니티)' } }, { item: { id: 'pulse:NEWS', topic: '종목 펄스', sector: 'semis', score: 4 }, plan: { engine: 'ddg,firecrawl', depth: 'advanced', label: 'ddg+firecrawl' } }],
  ...overrides,
});
async function execute(blueprint = createMorningMarketReportBlueprint(readers())) { return blueprint.run({ authorityRoot, capabilities: providers, signal: new AbortController().signal }); }

describe('req:v1:cb22a01a981af431 blueprint', () => {
  test('the loader-returned default blueprint executes the value-bearing report path', async () => {
    const loaded = await loadMissionBlueprint({ authorityRoot, requestId, requestRequires: ids.map(id => ({ id })), catalog: [...providers.values()] });
    expect(loaded.status).toBe('ready');
    if (loaded.status !== 'ready') throw new Error('loader did not return the default blueprint');
    expect(loaded.blueprint.id).toBe(requestId);
    // The loader validates the default module without running configured store readers.
    // Runtime report assertions below always inject every reader through the factory.
    const result = await execute(createMorningMarketReportBlueprint(readers()));
    expect(result.body).toContain('# Morning market report'); expect(result.body).toContain('## 지역 지수 변동'); expect(result.body).toContain('| 미국 | ^GSPC |'); expect(result.body).toContain('| 미국 | ^IXIC |'); expect(result.body).toContain('| 한국 | EWY |'); expect(result.body).toContain('| 일본 | EWJ |'); expect(result.body).toContain('| 중국 | FXI |');
    expect(result.body).toContain('## 주요 섹터 무브먼트'); expect(result.body).toContain('## 급등주 리스트'); expect(result.body).toContain('## 밸류체인 분석'); expect(result.body).toContain('## 해상도 조절형 뉴스 분석'); expect(result.body).toContain('## 신호등 요약'); expect(result.body).not.toContain('readiness');
  });
  test('renders seeded values and follows a changed stored index value rather than a hardcoded report value', async () => {
    const before = await execute(); const after = await execute(createMorningMarketReportBlueprint(readers({ indexes: () => [{ symbol: '^GSPC', region: 'US', date: '2026-08-31', close: 7777, return1d: -3 }] })));
    expect(before.body).toContain('6500'); expect(before.body).toContain('22000'); expect(before.body.indexOf('반도체')).toBeLessThan(before.body.indexOf('Energy')); expect(before.body).toContain('상류 웨이퍼 → 하류 HBM'); expect(before.body).toContain('deep(다각도+풀스크랩+커뮤니티)');
    expect(after.body).toContain('7777'); expect(after.body).not.toContain('6500'); expect(after.body).toContain('| 미국 | ^IXIC | 판정 불가 | 판정 불가 |');
  });
  test('uses the two-trading-day boundary for per-surge deep news plans', async () => {
    const result = await execute(createMorningMarketReportBlueprint(readers({ surges: () => [{ symbol: 'ONE', days: 1, cumulativePct: 9 }, { symbol: 'TWO', days: 2, cumulativePct: 9 }, { symbol: 'THREE', days: 3, cumulativePct: 9 }] })));
    expect(result.body).toContain('| ONE | 1일 | 9% | 일반 관찰 |'); expect(result.body).toContain('| TWO | 2일 | 9% | ddg+firecrawl (advanced) |'); expect(result.body).toContain('| THREE | 3일 | 9% | ddg+firecrawl (advanced) |'); expect(result.body).toContain('2거래일 이상 종목의 심층 뉴스 분석 우선');
  });
  test('does not treat a mismatched region or missing return as usable index evidence', async () => {
    const result = await execute(createMorningMarketReportBlueprint(readers({ indexes: () => baseIndexes().map(move => move.symbol === 'FXI' ? { ...move, region: 'US' } : move.symbol === 'EWY' ? { ...move, return1d: null } : move) })));
    expect(result.body).toContain('| 중국 | FXI | 판정 불가 | 판정 불가 |'); expect(result.body).toContain('| 한국 | EWY | 80 | 판정 불가 |'); expect(result.body).toContain('필수 5개 지수·섹터 근거 판정 불가');
  });
  test('renders actionable 판정 불가 sections rather than readiness when all stores are empty', async () => {
    const result = await execute(createMorningMarketReportBlueprint(readers({ indexes: () => [], sectors: () => [], surges: () => [], valuechain: () => null, news: () => [] })));
    expect(result.body).not.toContain('readiness'); expect(result.body).toContain('판정 불가'); expect(result.body).toContain('sector-store.ts'); expect(result.body).toContain('dig-engine.ts'); expect(result.body).toContain('필수 5개 지수·섹터 근거 판정 불가'); expect(result.body).not.toBe('');
  });
});
