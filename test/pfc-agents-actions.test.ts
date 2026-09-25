// ── PFC-S2 P1: agent roster actions (abort / detach / attach) ──
//
// Covers registry.markBackground / markForeground + the existing
// registry.abort contract the `x` key on agent-roster relies on.
// Dashboard wiring itself is not exercised here (the roster key
// handler is a thin switch that invokes these registry calls
// unconditionally on the cursored task) — smoke-tested during
// manual verification instead.

import { describe, test, expect, beforeEach } from 'bun:test';
import { AgentRegistry } from '../src/agent/registry';
import type { AgentDefinition } from '../src/agent/types';

function def(name = 'explore'): AgentDefinition {
  return { name, systemPrompt: 'test' };
}

function seed(registry: AgentRegistry, opts?: { background?: boolean }) {
  const task = registry.register(def(), 'hi');
  task.state = 'running';
  task.startedAt = Date.now();
  if (opts?.background) task.background = true;
  return task;
}

describe('PFC-S2 P1 — agent roster actions', () => {
  let reg: AgentRegistry;
  beforeEach(() => {
    reg = new AgentRegistry();
  });

  test('abort — cursored running task → aborted signal', () => {
    const t = seed(reg);
    expect(reg.abort(t.id)).toBe(true);
    // registry.abort signals via controller; state flip to 'aborted'
    // happens in the runner catch. Here we just verify the signal
    // returns true and the controller is aborted.
    expect(t.controller.signal.aborted).toBe(true);
  });

  test('abort — already-done task → no-op (returns false)', () => {
    const t = seed(reg);
    t.state = 'done';
    t.finishedAt = Date.now();
    expect(reg.abort(t.id)).toBe(false);
  });

  test('abort — unknown id → false', () => {
    expect(reg.abort('not-a-real-id')).toBe(false);
  });

  test('markBackground — foreground running → background=true', () => {
    const t = seed(reg);
    expect(t.background).toBeFalsy();
    expect(reg.markBackground(t.id)).toBe(true);
    expect(t.background).toBe(true);
  });

  test('markBackground — already background → no-op (returns false)', () => {
    const t = seed(reg, { background: true });
    expect(reg.markBackground(t.id)).toBe(false);
    expect(t.background).toBe(true);
  });

  test('markBackground — terminal task rejected', () => {
    const t = seed(reg);
    t.state = 'done';
    t.finishedAt = Date.now();
    expect(reg.markBackground(t.id)).toBe(false);
    expect(t.background).toBeFalsy();
  });

  test('markForeground — background running → background=false', () => {
    const t = seed(reg, { background: true });
    expect(reg.markForeground(t.id)).toBe(true);
    expect(t.background).toBe(false);
  });

  test('markForeground — terminal task remains rejected for manual callers', () => {
    const t = seed(reg, { background: true });
    t.state = 'done';
    t.finishedAt = Date.now();
    expect(reg.markForeground(t.id)).toBe(false);
    expect(t.background).toBe(true);
  });

  test('markForeground — completion observer may restore terminal task routing', () => {
    const t = seed(reg, { background: true });
    t.state = 'done';
    t.finishedAt = Date.now();
    expect(reg.markForeground(t.id, { allowTerminal: true })).toBe(true);
    expect(t.background).toBe(false);
  });

  test('markForeground — already foreground → no-op', () => {
    const t = seed(reg);
    expect(reg.markForeground(t.id)).toBe(false);
  });
});


// ⛔⭐⭐⭐ `R4a`(2026-08-19) — 턴이 죽어도 자식이 «고아»가 되지 않는다.
//   `R1` 이후 ESC 는 자식을 살린다. 그런데 `task-notification` 은 ***background 만*** 실어 나른다
//   (`if (!task.background) return;`) — 포그라운드인 채 살아남으면 결과를 받을 자가 «없다».
describe('markBackgroundAllRunning — 턴 중단 시 고아 방지', () => {
  let reg: AgentRegistry;
  beforeEach(() => { reg = new AgentRegistry(); });

  test('⭐ 도는 포그라운드 태스크를 전부 백그라운드로 넘기고 넘긴 id 를 낸다', () => {
    const a = seed(reg);
    const b = seed(reg);
    const moved = reg.markBackgroundAllRunning();
    expect(moved.slice().sort()).toEqual([a.id, b.id].sort());
    expect(a.background).toBe(true);
    expect(b.background).toBe(true);
  });

  test('이미 백그라운드인 것은 «다시» 세지 않는다 (멱등)', () => {
    const t = seed(reg);
    expect(reg.markBackgroundAllRunning()).toEqual([t.id]);
    expect(reg.markBackgroundAllRunning()).toEqual([]);
  });

  test('⛔ 종료된 태스크는 넘기지 않는다 — 라우팅할 것이 없다', () => {
    const t = seed(reg);
    t.state = 'done';
    t.finishedAt = Date.now();
    expect(reg.markBackgroundAllRunning()).toEqual([]);
    expect(t.background).toBeFalsy();
  });

  test('빈 레지스트리는 빈 목록 — 「없음」을 「했음」으로 꾸미지 않는다', () => {
    expect(new AgentRegistry().markBackgroundAllRunning()).toEqual([]);
  });
});
