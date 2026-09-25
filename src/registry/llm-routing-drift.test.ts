import { describe, it, expect } from 'bun:test';
import { reloadCatalog } from './loader.js';
import {
  detectRoutingDrift, collectRoutingPins, buildRoutingDriftRecommendation, summarizeRoutingDrift,
} from './llm-routing-drift.js';

describe('llm-routing-drift — 라우팅 맵 drift 자기감지(2026-07-15)', () => {
  it('주입 deps 결정론 — missing/deprecated 구분', () => {
    const active = new Set(['grok-4.5', 'claude-opus-4-7']);
    const drift = detectRoutingDrift({
      aliases: { grok: 'grok-4.5', opus: 'claude-opus-4-7', stale: 'gpt-imaginary' },
      tierMap: {} as never, missionDefaults: {}, modelCatalog: [],
      activeIds: active, catalogHas: () => false,
    });
    expect(drift.map((d) => d.model)).toEqual(['gpt-imaginary']); // active 인 것 제외
    expect(drift[0]!.status).toBe('missing');
  });

  it('deprecated 판정 — catalog 엔 있으나 active 아님', () => {
    const drift = detectRoutingDrift({
      aliases: { x: 'grok-4-fast' }, tierMap: {} as never, missionDefaults: {}, modelCatalog: [],
      activeIds: new Set([]), catalogHas: (id) => id === 'grok-4-fast',
    });
    expect(drift[0]!.status).toBe('deprecated');
  });

  it('실 catalog — 정정 후 정합(gpt-5 codex제외·gemini/o1 catalog정정)', () => {
    reloadCatalog();
    const drift = detectRoutingDrift();
    const models = new Set(drift.map((d) => d.model));
    expect(models.has('gpt-5')).toBe(false);          // build=codex 라우팅 → 감사 제외
    expect(models.has('gemini-2.5-pro')).toBe(false); // catalog canonical 정정
    expect(models.has('o1')).toBe(false);             // catalog canonical 정정
    expect(models.has('gemini-3-pro')).toBe(false);   // mission-router 정정
    expect(models.has('grok-4.5')).toBe(false);       // catalog 정합
  });

  it('recommendation + summarize 문안', () => {
    const rec = buildRoutingDriftRecommendation({ source: 'mission-router', key: 'build', model: 'gpt-5', status: 'missing' });
    expect(rec).toContain('gpt-5');
    expect(rec).toContain('HITL');
    reloadCatalog();
    expect(summarizeRoutingDrift()).toContain('LLM 라우팅 drift');
  });

  it('collectRoutingPins — codex/local 제외(catalog-소유 provider만)', () => {
    reloadCatalog();
    const sources = new Set(collectRoutingPins().map((p) => p.source));
    expect([...sources].some((s) => s.startsWith('tier-map:openai-codex'))).toBe(false);
    expect([...sources].some((s) => s.startsWith('tier-map:local'))).toBe(false);
  });
});
