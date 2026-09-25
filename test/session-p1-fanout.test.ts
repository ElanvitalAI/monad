// P1 (2026-07-16) — 통합 세션 fan-out. 구독자 집합 → 서피스 sink 단일 배달 경로.
// 재시도·per-surface degraded·fail-soft(다른 구독자 무중단) + 관측.

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SurfaceSink, SessionOutputEvent } from '../src/session/session-fanout.js';
import type { SessionSurface } from '../src/session/index.js';

const ORIG_SESS = process.env.MONAD_SESSION_ROOT;
let tmp: string;

type FanoutObservation = { event: string; refs: Record<string, unknown> };

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-p1-'));
  process.env.MONAD_SESSION_ROOT = tmp;
  const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
  const { _clearSurfaceSinksForTest } = await import('../src/session/session-fanout.js');
  _clearSubscriberIndexForTest();
  _clearSurfaceSinksForTest();
});
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG_SESS === undefined) delete process.env.MONAD_SESSION_ROOT; else process.env.MONAD_SESSION_ROOT = ORIG_SESS;
});

function collectSink(log: Array<[string, string]>, surface: string, fail = false): SurfaceSink {
  return { deliver: async (endpoint: string, ev: SessionOutputEvent) => {
    if (fail) throw new Error(`${surface} down`);
    log.push([surface, `${endpoint}:${ev.text ?? ''}`]);
  } };
}

function captureObservation(): { observations: FanoutObservation[]; observationSinks: { logSink: (category: string, event: string, data: unknown) => void } } {
  const observations: FanoutObservation[] = [];
  return {
    observations,
    observationSinks: {
      logSink: (category, event, data) => {
        if (category !== 'session.fanout') return;
        observations.push({ event, refs: (data as { refs: Record<string, unknown> }).refs });
      },
    },
  };
}

function expectFanoutObservation(
  observations: FanoutObservation[],
  event: string,
  refs: Record<string, unknown>,
): void {
  expect(observations).toHaveLength(1);
  expect(observations[0]!.event).toBe(event);
  expect(observations[0]!.refs).toEqual(refs);
}

describe('fanOutSessionOutput', () => {
  test('구독자가 아예 없으면 no-target 관측을 남긴다', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    const { observations, observationSinks } = captureObservation();

    const res = await fanOutSessionOutput(m.id, { kind: 'message', text: 'x' }, {
      sinks: new Map(), root: tmp, observationSinks,
    });

    expect(res).toEqual({ targeted: 0, delivered: 0, failed: 0, skipped: 0, degraded: false, failedKeys: [] });
    expectFanoutObservation(observations, 'no-target', {
      eligible: 0, excluded: 0, routable: 0, delivered: 0, failed: 0, sinkless: 0, registeredSurfaces: [],
    });
  });

  test('전부 shadow exclude되면 no-routable-target 관측을 남긴다', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '100' }, {}, tmp);
    const { observations, observationSinks } = captureObservation();

    const res = await fanOutSessionOutput(m.id, { kind: 'message', text: 'x' }, {
      sinks: new Map([['telegram', collectSink([], 'telegram')]]),
      root: tmp,
      excludeKeys: [S.subscriberKey('telegram', '100')],
      observationSinks,
    });

    expect(res).toEqual({ targeted: 0, delivered: 0, failed: 0, skipped: 0, degraded: false, failedKeys: [] });
    expectFanoutObservation(observations, 'no-routable-target', {
      eligible: 1, excluded: 1, routable: 0, delivered: 0, failed: 0, sinkless: 0, registeredSurfaces: ['telegram'],
    });
  });

  test('sink 없는 구독자는 no-routable-target 관측을 남긴다', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'voice', endpoint: 'v' }, {}, tmp);
    const { observations, observationSinks } = captureObservation();

    const res = await fanOutSessionOutput(m.id, { kind: 'message', text: 'x' }, {
      sinks: new Map(), root: tmp, observationSinks,
    });

    expect(res).toEqual({ targeted: 0, delivered: 0, failed: 0, skipped: 1, degraded: false, failedKeys: [] });
    expectFanoutObservation(observations, 'no-routable-target', {
      eligible: 1, excluded: 0, routable: 0, delivered: 0, failed: 0, sinkless: 1, registeredSurfaces: [],
    });
  });

  // ⭐ 복원(무인 리뷰 should-fix · 2026-07-28) — 관측 테스트로 갈아엎으면서 사라졌는데,
  //    `left` 구독자 제외를 재는 항이 **0** 이 됐다(grep -c left = 0). 관측 5종은 exclude·
  //    sinkless·delivered·degraded 를 덮지만 **presence==='left'** 는 어느 것도 안 덮는다.
  test('전 구독자에 단일 fan-out — active 만, left 제외', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '1' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'p' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'discord', endpoint: 'd' }, {}, tmp);
    S.setSubscriberPresence(m.id, S.subscriberKey('discord', 'd'), 'left', tmp); // 이탈 → 제외

    const log: Array<[string, string]> = [];
    const sinks = new Map<SessionSurface, SurfaceSink>([
      ['telegram', collectSink(log, 'telegram')],
      ['pwa', collectSink(log, 'pwa')],
      ['discord', collectSink(log, 'discord')],
    ]);
    const res = await fanOutSessionOutput(m.id, { kind: 'message', text: 'hi' }, { sinks, root: tmp });
    expect(res.delivered).toBe(2);       // tg + pwa (discord left 제외)
    expect(res.failed).toBe(0);
    expect(res.degraded).toBe(false);
    expect(log.map(l => l[0]).sort()).toEqual(['pwa', 'telegram']);
  });

  test('전부 배달되면 delivered 관측과 산술 불변식을 남긴다', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '1' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'p' }, {}, tmp);
    const log: Array<[string, string]> = [];
    const { observations, observationSinks } = captureObservation();

    const res = await fanOutSessionOutput(m.id, { kind: 'message', text: 'hi' }, {
      sinks: new Map<SessionSurface, SurfaceSink>([
        ['telegram', collectSink(log, 'telegram')], ['pwa', collectSink(log, 'pwa')],
      ]),
      root: tmp,
      observationSinks,
    });

    expect(res).toEqual({ targeted: 2, delivered: 2, failed: 0, skipped: 0, degraded: false, failedKeys: [] });
    expect(log.map(([surface]) => surface).sort()).toEqual(['pwa', 'telegram']);
    const refs = { eligible: 2, excluded: 0, routable: 2, delivered: 2, failed: 0, sinkless: 0, registeredSurfaces: ['pwa', 'telegram'] };
    expectFanoutObservation(observations, 'delivered', refs);
    expect(refs.eligible).toBe(refs.excluded + refs.routable + refs.sinkless);
    expect(refs.routable).toBe(refs.delivered + refs.failed);
  });

  test('일부 실패하면 degraded 관측과 산술 불변식을 남긴다', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '1' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'p' }, {}, tmp);
    const log: Array<[string, string]> = [];
    const { observations, observationSinks } = captureObservation();

    const res = await fanOutSessionOutput(m.id, { kind: 'message', text: 'x' }, {
      sinks: new Map<SessionSurface, SurfaceSink>([
        ['telegram', collectSink(log, 'telegram', true)], ['pwa', collectSink(log, 'pwa')],
      ]),
      root: tmp,
      retries: 1,
      observationSinks,
    });

    expect(res).toEqual({ targeted: 2, delivered: 1, failed: 1, skipped: 0, degraded: true, failedKeys: [S.subscriberKey('telegram', '1')] });
    expect(log).toEqual([['pwa', 'p:x']]);
    const refs = {
      eligible: 2, excluded: 0, routable: 2, delivered: 1, failed: 1, sinkless: 0,
      registeredSurfaces: ['pwa', 'telegram'], failedKeys: [S.subscriberKey('telegram', '1')],
    };
    expectFanoutObservation(observations, 'degraded', refs);
    expect(refs.eligible).toBe(refs.excluded + refs.routable + refs.sinkless);
    expect(refs.routable).toBe(refs.delivered + refs.failed);
  });

  test('C4 — deliver 에 ctx.sessionId 전달(pwa sink 가 session.output 태깅)', async () => {
    const S = await import('../src/session/index.js');
    const { fanOutSessionOutput } = await import('../src/session/session-fanout.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'client-a' }, {}, tmp);
    const seen: Array<{ endpoint: string; sessionId: string; role?: string; text?: string }> = [];
    const sinks = new Map<SessionSurface, SurfaceSink>([
      ['pwa', { deliver: async (endpoint, ev, ctx) => {
        seen.push({ endpoint, sessionId: ctx.sessionId, ...(ev.role ? { role: ev.role } : {}), ...(ev.text ? { text: ev.text } : {}) });
      } }],
    ]);
    const res = await fanOutSessionOutput(m.id, { kind: 'message', role: 'assistant', text: 'yo' }, { sinks, root: tmp });
    expect(res.delivered).toBe(1);
    expect(seen).toEqual([{ endpoint: 'client-a', sessionId: m.id, role: 'assistant', text: 'yo' }]);
  });

  test('registerSurfaceSink 등록/해제', async () => {
    const { registerSurfaceSink, registeredSinkSurfaces } = await import('../src/session/session-fanout.js');
    const off = registerSurfaceSink('telegram', { deliver: async () => {} });
    expect(registeredSinkSurfaces()).toContain('telegram');
    off();
    expect(registeredSinkSurfaces()).not.toContain('telegram');
  });

  test('C2/C3 shadowExcludeKeys — primary 서피스만 exclude 에서 제외(fan-out 배달)', async () => {
    const { shadowExcludeKeys } = await import('../src/session/session-fanout.js');
    const old = ['telegram:tg␟default␟_␟42␟0', 'discord:dc␟default␟_␟chan', 'cli:local'];
    expect(shadowExcludeKeys(old, []).sort()).toEqual([...old].sort());
    expect(shadowExcludeKeys(old, ['telegram']).sort()).toEqual(['discord:dc␟default␟_␟chan', 'cli:local'].sort());
    expect(shadowExcludeKeys(old, ['telegram', 'discord'])).toEqual(['cli:local']);
  });
});
