// P0 (2026-07-16) — 세션 구독자 모델 + 제1원칙 코어 2개.
// 동시 구독(1세션=N 구독자)·leave·양방향 인덱스·presence + recordSessionObservation
// (mission-observation 자매·3박자)·buildSessionContext(mission-incident-context 자매).

import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIG_SESS = process.env.ELANOUS_SESSION_ROOT;
let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'sess-p0-'));
  process.env.ELANOUS_SESSION_ROOT = tmp;
  const { _clearSubscriberIndexForTest } = await import('../src/session/index.js');
  _clearSubscriberIndexForTest();
});
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (ORIG_SESS === undefined) delete process.env.ELANOUS_SESSION_ROOT; else process.env.ELANOUS_SESSION_ROOT = ORIG_SESS;
});

describe('subscriber primitives', () => {
  test('subscribe join + dedup rejoin (같은 키는 갱신·중복 안 됨)', async () => {
    const S = await import('../src/session/index.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '123' }, { now: '2026-07-16T00:00:00Z' }, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'peer-a' }, {}, tmp);
    expect(S.listSubscribers(m.id, {}, tmp).length).toBe(2);
    // 같은 tg 키 재구독 → dedup(2개 유지) + lastSeenAt 갱신, joinedAt 보존.
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '123' }, { now: '2026-07-16T01:00:00Z' }, tmp);
    const subs = S.listSubscribers(m.id, {}, tmp);
    expect(subs.length).toBe(2);
    const tg = subs.find(s => s.surface === 'telegram')!;
    expect(tg.joinedAt).toBe('2026-07-16T00:00:00Z');
    expect(tg.lastSeenAt).toBe('2026-07-16T01:00:00Z');
  });

  test('unsubscribe = leave (나만 제거·남은 구독자 유지)', async () => {
    const S = await import('../src/session/index.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '123' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'discord', endpoint: 'ch-9' }, {}, tmp);
    const left = S.unsubscribeSession(m.id, S.subscriberKey('telegram', '123'), tmp);
    expect(left).not.toBeNull();
    const remaining = S.listSubscribers(m.id, {}, tmp);
    expect(remaining.length).toBe(1);
    expect(remaining[0].surface).toBe('discord');
    // 구독 아닌 키 leave = no-op(null).
    expect(S.unsubscribeSession(m.id, S.subscriberKey('pwa', 'nope'), tmp)).toBeNull();
  });

  test('양방향 역인덱스 — sessionsForSubscriber(key) 로 세션 회수', async () => {
    const S = await import('../src/session/index.js');
    const a = S.createSession({ source: 'cli', title: 'A' }, tmp);
    const b = S.createSession({ source: 'cli', title: 'B' }, tmp);
    const key = S.subscriberKey('pwa', 'peer-x');
    S.subscribeSession(a.id, { surface: 'pwa', endpoint: 'peer-x' }, {}, tmp);
    S.subscribeSession(b.id, { surface: 'pwa', endpoint: 'peer-x' }, {}, tmp);
    expect(S.sessionsForSubscriber(key).sort()).toEqual([a.id, b.id].sort());
    // leave a → 역인덱스에서 a 만 빠짐.
    S.unsubscribeSession(a.id, key, tmp);
    expect(S.sessionsForSubscriber(key)).toEqual([b.id]);
  });

  test('presence 전이 + listSubscribers presence 필터', async () => {
    const S = await import('../src/session/index.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    const key = S.subscriberKey('telegram', '77');
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '77' }, {}, tmp);
    expect(S.listSubscribers(m.id, { presence: 'active' }, tmp).length).toBe(1);
    S.setSubscriberPresence(m.id, key, 'grace', tmp);
    expect(S.listSubscribers(m.id, { presence: 'active' }, tmp).length).toBe(0);
    expect(S.listSubscribers(m.id, { presence: 'grace' }, tmp).length).toBe(1);
    // left → 역인덱스에서도 빠짐(fan-out 제외).
    S.setSubscriberPresence(m.id, key, 'left', tmp);
    expect(S.sessionsForSubscriber(key)).toEqual([]);
  });

  test('구독자 모델 이전 세션(subscribers 부재)은 tolerant — 빈 배열', async () => {
    const S = await import('../src/session/index.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    expect(S.listSubscribers(m.id, {}, tmp)).toEqual([]);
  });
});

describe('recordSessionObservation — 3박자 팬아웃(자매 패턴)', () => {
  test('로그는 항상 · self-memory 는 importance>=6 · ops 는 stateful 만', async () => {
    const { recordSessionObservation } = await import('../src/session/session-observation.js');
    const logs: Array<[string, string]> = [];
    const mems: unknown[] = [];
    const ops: unknown[] = [];
    const sinks = {
      logSink: (c: string, e: string) => { logs.push([c, e]); },
      memorySink: (i: unknown) => { mems.push(i); },
      opsSink: (i: unknown) => { ops.push(i); },
    };
    // render(importance 2·비stateful) → 로그만.
    recordSessionObservation({ sessionId: 's1', subsystem: 'render', event: 'converted' }, sinks);
    // handoff(importance 6·stateful) → 로그+memory+ops.
    recordSessionObservation({ sessionId: 's1', subsystem: 'handoff', event: 'moved', stateful: true }, sinks);
    expect(logs).toEqual([['session.render', 'converted'], ['session.handoff', 'moved']]);
    expect(mems.length).toBe(1);      // handoff 만(≥6)
    expect(ops.length).toBe(1);       // handoff 만(stateful)
  });

  test('sink 가 던져도 관문은 안 던진다(fail-soft)', async () => {
    const { recordSessionObservation } = await import('../src/session/session-observation.js');
    expect(() => recordSessionObservation(
      { sessionId: 's', subsystem: 'fanout', event: 'x', importance: 9, stateful: true },
      { logSink: () => { throw new Error('boom'); }, memorySink: () => { throw new Error('boom'); }, opsSink: () => { throw new Error('boom'); } },
    )).not.toThrow();
  });
});

describe('buildSessionContext — 결정론 read-model(자매)', () => {
  test('found=true · 구독자·presence·bindings 조립', async () => {
    const S = await import('../src/session/index.js');
    const { buildSessionContext } = await import('../src/session/session-context.js');
    const m = S.createSession({ source: 'cli' }, tmp);
    S.subscribeSession(m.id, { surface: 'telegram', endpoint: '5' }, {}, tmp);
    S.subscribeSession(m.id, { surface: 'pwa', endpoint: 'p' }, {}, tmp);
    const ctx = buildSessionContext(m.id, { load: (id) => S.loadSession(id, tmp), now: () => '2026-07-16T02:00:00Z' });
    expect(ctx.found).toBe(true);
    expect(ctx.subscribers.length).toBe(2);
    expect(ctx.presence.active).toBe(2);
    expect(ctx.asOf).toBe('2026-07-16T02:00:00Z');
  });

  test('found=false → anti-confabulation 문자열(추측 금지)', async () => {
    const { buildSessionContext, formatSessionContext } = await import('../src/session/session-context.js');
    const ctx = buildSessionContext('ghost', { load: () => null });
    expect(ctx.found).toBe(false);
    const s = formatSessionContext(ctx);
    expect(s).toContain('기록');
    expect(s).toContain('추측');   // "추측·유사 과거 세션 회수 금지"
  });

  test('load 던지면 degraded=true(fail-soft)', async () => {
    const { buildSessionContext } = await import('../src/session/session-context.js');
    const ctx = buildSessionContext('x', { load: () => { throw new Error('io'); } });
    expect(ctx.found).toBe(false);
    expect(ctx.degraded).toBe(true);
  });
});
