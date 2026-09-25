import { describe, expect, it } from 'bun:test';
import { mergeDiscoverySnapshot } from './merge.js';
import type { DiscoverySnapshot } from './cache.js';

const meta = (source: string) => ({ source, lastSeen: 'x', autoFilled: true, confidence: 'high' }) as never;
const m = (id: string, provider: string, source: string) => ({ id, provider, partial: { id }, discoveryMeta: meta(source) });
const prev: DiscoverySnapshot = {
  version: 1, generatedAt: '2026-08-31T00:00:00Z',
  sources: [{ id: 'openai', ok: true, durationMs: 1, modelCount: 1 }, { id: 'openrouter', ok: true, durationMs: 1, modelCount: 1 }],
  models: [m('gpt-x', 'openai', 'auto-openai-api'), m('old/or', 'openrouter', 'auto-openrouter-api')],
};

describe('mergeDiscoverySnapshot', () => {
  it('성공한 소스의 모델만 교체하고 다른 소스는 그대로 둔다', () => {
    const out = mergeDiscoverySnapshot(prev, [{ source: 'openrouter', ok: true, durationMs: 5, models: [m('new/or', 'openrouter', 'auto-openrouter-api')] }], () => 0);
    expect(out.models.map((x) => x.id).sort()).toEqual(['gpt-x', 'new/or']);
    expect(out.sources.find((s) => s.id === 'openrouter')).toMatchObject({ ok: true, modelCount: 1, durationMs: 5 });
    expect(out.sources.find((s) => s.id === 'openai')).toBeDefined();
  });

  it('⛔ 실패한 소스는 옛 모델을 지우지 않는다', () => {
    const out = mergeDiscoverySnapshot(prev, [{ source: 'openrouter', ok: false, durationMs: 5, models: [], error: 'upstream-http-500' }], () => 0);
    expect(out.models.map((x) => x.id).sort()).toEqual(['gpt-x', 'old/or']);
    expect(out.sources.find((s) => s.id === 'openrouter')).toMatchObject({ ok: true, modelCount: 1 });
  });

  it('옛 스냅숏이 없으면 새로 만든다', () => {
    const out = mergeDiscoverySnapshot(null, [{ source: 'openrouter', ok: true, durationMs: 1, models: [m('a/b', 'openrouter', 'auto-openrouter-api')] }], () => 0);
    expect(out.models.map((x) => x.id)).toEqual(['a/b']);
  });
});
