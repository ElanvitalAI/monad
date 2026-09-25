/**
 * 렌더 로그 무음 게이트 직교성 — OH9(2026-07-24).
 *
 * `_renderSuppressed` 는 진단 강도 축(`debug.enabled` = mirror||verbose||diag||
 * keytrace)과 **직교**하다: 렌더 카테고리만 무음화하고 비렌더(llm.* 등)는 그대로
 * 흐른다. 진리표를 실제 log() 경로로 검증(캡처 싱크로 관측).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { debug } from './log.js';
import type { LogSink } from '../mss/logging/sink.js';

function captureSink(): { sink: LogSink; cats: string[] } {
  const cats: string[] = [];
  return {
    cats,
    sink: { name: 'test-capture', emit: (rec) => { cats.push(rec.category); } },
  };
}

describe('render-mute — 발화 게이트 직교성', () => {
  afterEach(() => {
    debug.setRenderSuppressed(false);
  });

  it('_renderSuppressed=true → 렌더 카테고리 억제 · 비렌더(llm.*)는 통과(diag 살아있음)', () => {
    const { sink, cats } = captureSink();
    const off = debug.registerSink(sink);
    try {
      debug.setRenderSuppressed(true);
      debug.log('dashboard.draw', 'frame');
      debug.log('key.route', 'dispatch');
      debug.log('llm.router', 'pick');        // 비렌더 — 통과해야
      debug.log('goal.loop', 'iterate');      // 비렌더 — 통과해야
      expect(cats).not.toContain('dashboard.draw');
      expect(cats).not.toContain('key.route');
      expect(cats).toContain('llm.router');
      expect(cats).toContain('goal.loop');
    } finally { off(); }
  });

  it('_renderSuppressed=false → 렌더 카테고리도 전부 통과', () => {
    const { sink, cats } = captureSink();
    const off = debug.registerSink(sink);
    try {
      debug.setRenderSuppressed(false);
      debug.log('dashboard.draw', 'frame');
      debug.log('llm.router', 'pick');
      expect(cats).toContain('dashboard.draw');
      expect(cats).toContain('llm.router');
    } finally { off(); }
  });

  it('억제 플래그는 debug.enabled/level 과 완전 독립 — 레벨 게이트를 안 건드린다', () => {
    debug.setLevel('diag');
    const before = { enabled: debug.enabled, level: debug.level(), diag: debug.isDiagEnabled() };
    debug.setRenderSuppressed(true);
    expect(debug.enabled).toBe(before.enabled);
    expect(debug.level()).toBe(before.level);
    expect(debug.isDiagEnabled()).toBe(before.diag);
    expect(debug.isRenderSuppressed()).toBe(true);
    debug.setRenderSuppressed(false);
    expect(debug.isRenderSuppressed()).toBe(false);
  });
});
