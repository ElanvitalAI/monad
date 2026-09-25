// market_posture 생산자 사이클 단위테스트 — [외부 구현·claude-code] 아크1 글루(2026-07-16).
// 순수 조립·dep 주입(regime/capstone/emergency/publish seam). 라이브 IO 없음.
import { test, expect, describe } from 'bun:test';
import type { RegimeVector } from '../src/domains/regime-synth.js';
import type { PublishResult } from '../src/domains/market-posture-store.js';
import {
  regimeToThreatDrivers, assembleMarketPostureInput, runMarketPostureCycle,
} from './market-posture-cycle.js';

const regime = (over: Partial<RegimeVector> = {}): RegimeVector => ({
  axes: [], composite: 0, regimeLabel: 'NEUTRAL', transition: false, transitionAxes: [],
  asOf: '2026-07-16T00:00:00.000Z', ...over,
});

describe('regimeToThreatDrivers — regime → 융합 threat drivers', () => {
  test('RISK_OFF 심도 = composite 음의 크기', () => {
    const d = regimeToThreatDrivers(regime({ composite: -0.5, regimeLabel: 'RISK_OFF' }));
    const riskOff = d.find((x) => x.key === 'regime_risk_off')!;
    expect(riskOff.contribution).toBeCloseTo(0.5, 5);
    expect(riskOff.weight).toBe(1);
  });
  test('RISK_ON(양의 composite)은 threat 0(기여 없음)', () => {
    const d = regimeToThreatDrivers(regime({ composite: 0.4, regimeLabel: 'RISK_ON' }));
    expect(d.find((x) => x.key === 'regime_risk_off')!.contribution).toBe(0);
  });
  test('전환·지정학 음의 방향이 driver 로 합류', () => {
    const d = regimeToThreatDrivers(regime({
      composite: -0.3, transition: true,
      axes: [{ axis: 'geopolitics', direction: -1, strength: 0.8, confidence: 1, note: '' }],
    }));
    expect(d.some((x) => x.key === 'regime_transition')).toBe(true);
    expect(d.some((x) => x.key === 'geopolitics')).toBe(true);
  });
});

describe('assembleMarketPostureInput — 입력 융합', () => {
  test('emergency 없으면 freshness UNKNOWN·tripwire 생략·정직 provenance', () => {
    const inp = assembleMarketPostureInput(regime({ composite: -0.4 }), { now: () => Date.parse('2026-07-16T01:00:00Z') });
    expect(inp.freshness.status).toBe('UNKNOWN');
    expect(inp.tripwire).toBeUndefined();
    expect(inp.provenance.sources).toContain('emergency:none');
    expect(inp.provenance.calculatedBy).toBe('market-posture-cycle');
    expect(inp.drivers!.length).toBeGreaterThan(0);
  });
  test('emergency(지수 -5%) 있으면 FRESH·tripwire 합류', () => {
    const inp = assembleMarketPostureInput(regime(), {
      readEmergency: () => ({ indices: [{ symbol: 'KOSPI', dayReturn: -0.05 }] }),
    });
    expect(inp.freshness.status).toBe('FRESH');
    expect(inp.tripwire?.indices?.[0]?.dayReturn).toBe(-0.05);
    expect(inp.provenance.sources).toContain('emergency');
  });
});

describe('runMarketPostureCycle — derive → publish', () => {
  test('regime 게시 성공 — DEFCON 산정·publish 호출', () => {
    let published: unknown = null;
    const r = runMarketPostureCycle({
      loadRegime: () => regime({ composite: -0.2 }),
      publish: (p): PublishResult => { published = p; return { ok: true }; },
    });
    expect(r.published).toBe(true);
    expect(r.defcon).toBeGreaterThanOrEqual(1);
    expect(r.defcon).toBeLessThanOrEqual(5);
    expect(published).not.toBeNull();
  });
  test('emergency 지수 -5% → tripwire DEFCON 2', () => {
    const r = runMarketPostureCycle({
      loadRegime: () => regime(),
      readEmergency: () => ({ indices: [{ symbol: 'KOSPI', dayReturn: -0.05 }] }),
      publish: (): PublishResult => ({ ok: true }),
    });
    expect(r.defcon).toBe(2);
  });
  test('regime 없으면 미게시(입력 결측·fail-soft)', () => {
    const r = runMarketPostureCycle({ loadRegime: () => null, publish: (): PublishResult => ({ ok: true }) });
    expect(r.published).toBe(false);
    expect(r.note).toContain('regime.db');
  });
});
