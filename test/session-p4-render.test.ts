// P4 (2026-07-16) — 표현법 정책. Stage A(원본 방출·identity) + Stage C 서피스 렌더러
// + 변환실패→원본 폴백. fan-out 통합.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionSurface } from '../src/session/index.js';
import type { SurfaceSink, SessionOutputEvent } from '../src/session/session-fanout.js';
import type { SurfaceRenderer } from '../src/session/session-render.js';

describe('renderForSurface — 표현 단계', () => {
  test('Stage A = 원본 identity(전 서피스 동일)', async () => {
    const { renderForSurface } = await import('../src/session/session-render.js');
    const ev: SessionOutputEvent = { kind: 'message', text: '**굵게** 원본' };
    expect(renderForSurface('telegram', ev, { stage: 'A' }).text).toBe('**굵게** 원본');
    expect(renderForSurface('pwa', ev, { stage: 'A' }).text).toBe('**굵게** 원본');
  });

  test('Stage C = 서피스 렌더러 적용', async () => {
    const { renderForSurface } = await import('../src/session/session-render.js');
    const renderers = new Map<SessionSurface, SurfaceRenderer>([
      ['voice', { render: (e) => `[TTS] ${e.text}` }],
    ]);
    const r = renderForSurface('voice', { kind: 'message', text: '안녕' }, { stage: 'C' }, renderers);
    expect(r.text).toBe('[TTS] 안녕');
    expect(r.stage).toBe('C');
  });

  test('Stage C 렌더러 throw → 원본 폴백(degraded·방출 계속)', async () => {
    const { renderForSurface } = await import('../src/session/session-render.js');
    const renderers = new Map<SessionSurface, SurfaceRenderer>([
      ['telegram', { render: () => { throw new Error('render boom'); } }],
    ]);
    const r = renderForSurface('telegram', { kind: 'message', text: '원본살아있음' }, { stage: 'C' }, renderers, 'sess-1');
    expect(r.text).toBe('원본살아있음');
    expect(r.degraded).toBe(true);
  });
});

describe('fan-out 표현법 통합', () => {
  const ORIG = process.env.MONAD_SESSION_ROOT;
  let tmp: string;
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sess-p4-'));
    process.env.MONAD_SESSION_ROOT = tmp;
    const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
    _clearSubscriberIndexForTest();
  });
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    if (ORIG === undefined) delete process.env.MONAD_SESSION_ROOT; else process.env.MONAD_SESSION_ROOT = ORIG;
  });

  test('Stage C 렌더러가 서피스별로 다르게 배달(같은 스냅샷)', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'voice', endpoint: 'v' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'p' }, {}, tmp);

    const got: Record<string, string> = {};
    const sinks = new Map<SessionSurface, SurfaceSink>([
      ['voice', { deliver: async (_e, ev) => { got.voice = ev.text ?? ''; } }],
      ['pwa', { deliver: async (_e, ev) => { got.pwa = ev.text ?? ''; } }],
    ]);
    const renderers = new Map<SessionSurface, SurfaceRenderer>([
      ['voice', { render: (e) => `[TTS] ${e.text}` }],
    ]);
    await fanOutSessionOutput(m.id, { kind: 'message', text: '결과' }, { sinks, renderers, root: tmp, policy: { stage: 'C' } });
    expect(got.voice).toBe('[TTS] 결과');  // voice 렌더러 적용
    expect(got.pwa).toBe('결과');          // pwa 렌더러 없음 → 원본
  });

  test('기본(Stage A) — 전 서피스 원본 그대로', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: 't' }, {}, tmp);
    let got = '';
    const sinks = new Map<SessionSurface, SurfaceSink>([['telegram', { deliver: async (_e, ev) => { got = ev.text ?? ''; } }]]);
    await fanOutSessionOutput(m.id, { kind: 'message', text: '**원본**' }, { sinks, root: tmp });
    expect(got).toBe('**원본**');
  });
});
