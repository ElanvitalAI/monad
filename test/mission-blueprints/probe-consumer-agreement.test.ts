import { describe, expect, test } from 'bun:test';
import { probeValuechain } from '../../src/mission-capabilities/analysis/valuechain.js';
import { createMorningMarketReportBlueprint, type MorningReportReaders } from '../../src/mission-blueprints/req-v1-cb22a01a981af431.js';
import type { CapabilityProvider } from '../../src/mission-capabilities/registry.js';
import type { SemisView } from '../../src/domains/kg-semis.js';

const ids = ['market.quotes.multi', 'market.sector.moves', 'market.surge.list', 'news.resolution.scaled', 'analysis.valuechain', 'report.trafficlight'];
const providers = new Map(ids.map(id => [id, { id, probe: async () => ({ ok: true }) } satisfies CapabilityProvider]));
const readers = (valuechain: () => SemisView | null): MorningReportReaders => ({
  indexes: () => [],
  sectors: () => [],
  surges: () => [],
  valuechain,
  news: () => [],
});

async function render(valuechain: () => SemisView | null): Promise<string> {
  const blueprint = createMorningMarketReportBlueprint(readers(valuechain));
  const result = await blueprint.run({ authorityRoot: import.meta.dir, capabilities: providers, signal: new AbortController().signal });
  return result.body;
}

describe('analysis.valuechain probe and morning-report consumer agreement', () => {
  test('renders a value-bearing section whenever the probe is ready, including a view without supplies', async () => {
    const views: SemisView[] = [
      { chainName: '반도체', memberCount: 2, supplies: [{ upName: '웨이퍼', downName: 'HBM' }], propagation: [] },
      { chainName: '반도체', memberCount: 44, supplies: [], propagation: [] },
    ];

    for (const view of views) {
      expect(probeValuechain(() => view)).toEqual({ ok: true });
      const body = await render(() => view);
      expect(body).toContain(`체인: ${view.chainName} (${view.memberCount}개)`);
      expect(body).not.toContain('## 밸류체인 분석\n\n판정 불가 — 저장된 값이 없습니다');
    }
  });

  test('reports only the missing relationship as indeterminate for a partial view', async () => {
    const view: SemisView = { chainName: '반도체', memberCount: 44, supplies: [], propagation: [] };

    expect(probeValuechain(() => view)).toEqual({ ok: true });
    expect(await render(() => view)).toContain('상류→하류 관계: 판정 불가');
  });

  test('reports an unavailable section and repair route when no view exists', async () => {
    const result = probeValuechain(() => null);

    expect(result.ok).toBe(false);
    expect(await render(() => null)).toContain('판정 불가 — 저장된 값이 없습니다. src/domains/kg-semis.ts의 반도체 그래프를 채우세요.');
  });
});
