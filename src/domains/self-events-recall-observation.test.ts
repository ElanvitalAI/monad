import { describe, expect, test } from 'bun:test';
import { debug } from '../debug/log.js';
import { recallSelfEvents } from './self-awareness.js';
import { openSurfaceEventsDb, recordEvent } from './surface-events.js';

function capture<T>(fn: () => T): { result: T; events: Array<{ event: string; data: Record<string, unknown> }> } {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const original = (debug as { log: typeof debug.log }).log;
  (debug as { log: typeof debug.log }).log = ((_c, event, data) => {
    events.push({ event, data: (data ?? {}) as Record<string, unknown> });
  }) as typeof debug.log;
  try { return { result: fn(), events }; } finally { (debug as { log: typeof debug.log }).log = original; }
}

/**
 * ⛔⭐⭐ 이 자리에 관측이 «하나도» 없었다 — 그런데 부르는 자리 넷 중 둘이
 * ***1급 CLI(`elanous self recall`)*** 와 ***자식의 기억 컨텍스트***였다(`F12`).
 * ⇒ 「자식이 기억을 갖나」의 진짜 경로가 정확히 안 보이는 쪽에 있었다.
 */
describe('recallSelfEvents 가 「몇 건 받았나」를 남긴다', () => {
  test('⛔ 기억이 비면 0건이 «남는다» — 침묵하지 않는다', () => {
    const db = openSurfaceEventsDb(':memory:');
    const { result, events } = capture(() => recallSelfEvents(db, '아무 질의'));
    expect(result).toEqual([]);
    const observed = events.find((e) => e.event === 'recall-result');
    expect(observed).toBeDefined();
    expect(observed!.data).toMatchObject({ kind: 'self-events', hits: 0 });
    // ⭐ 창을 «같이» 남긴다 — 0건이 「기억이 없어서」인지 「창이 좁아서」인지 갈린다
    expect(observed!.data.sinceHours).toBe(720);
    expect(observed!.data.limit).toBe(8);
    db.close();
  });

  test('⭐ 찾으면 그 수가 남는다 ⊕ 좁힌 창이 값으로 보인다', () => {
    const db = openSurfaceEventsDb(':memory:');
    recordEvent(db, { domain: 'elanous', surface: 'test', kind: 'impl', direction: 'outbound', text: '하니스 관측 계측을 붙였다' });
    const { result, events } = capture(() => recallSelfEvents(db, '하니스 관측', { limit: 3, sinceHours: 24 }));
    const observed = events.find((e) => e.event === 'recall-result');
    expect(observed!.data.hits).toBe(result.length);
    expect(observed!.data).toMatchObject({ limit: 3, sinceHours: 24 });
    db.close();
  });

  test('observer 제외는 requested limit을 보상하고 필터 전후 후보 수를 각각 남긴다', () => {
    const db = openSurfaceEventsDb(':memory:');
    for (const text of [
      '<task-notification>\n<summary>observer recall counts</summary>',
      'observer recall counts pty_a4c9f0: capture',
    ]) {
      recordEvent(db, { domain: 'elanous', surface: 'test', kind: 'utterance', direction: 'outbound', text, importance: 10 });
    }
    for (const text of ['intentional recall counts one', 'intentional recall counts two', 'intentional recall counts three', 'intentional recall counts four']) {
      recordEvent(db, { domain: 'elanous', surface: 'test', kind: 'impl', direction: 'outbound', text, importance: 1 });
    }

    const { result, events } = capture(() => recallSelfEvents(db, 'recall counts', { limit: 2, excludeObserverOutput: true }));
    const observed = events.find((e) => e.event === 'recall-result');

    expect(result).toHaveLength(2);
    expect(result.every((hit) => hit.text.startsWith('intentional recall counts'))).toBe(true);
    expect(observed!.data).toMatchObject({
      hits: 2,
      limit: 2,
      preFilterHits: 6,
      postFilterHits: 4,
      excludedObserverOutput: 2,
    });
    db.close();
  });
});
