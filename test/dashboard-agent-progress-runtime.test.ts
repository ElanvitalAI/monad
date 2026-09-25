import { beforeEach, describe, expect, test } from 'bun:test';
import { createAgentProgressRuntime } from '../src/dashboard/agent-progress-runtime.js';
import type { DashboardAgentUpdateEvent } from '../src/dashboard/agent-roster-runtime.js';

interface Harness {
  chatLines: string[];
  pinCalls: number;
  drawCalls: number;
  runtime: ReturnType<typeof createAgentProgressRuntime>;
}

function makeHarness(seed: string[] = [], maxDisplay?: number): Harness {
  const chatLines: string[] = [...seed];
  let pinCalls = 0;
  let drawCalls = 0;
  const runtime = createAgentProgressRuntime({
    chatLines,
    pinChatTail: () => { pinCalls++; },
    draw: () => { drawCalls++; },
    ...(maxDisplay !== undefined ? { maxDisplay } : {}),
  });
  return {
    chatLines,
    get pinCalls() { return pinCalls; },
    get drawCalls() { return drawCalls; },
    runtime,
  } as Harness;
}

function update(
  id: string,
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled',
  toolCount = 0,
  name = id,
  summary?: string,
  currentTool?: string,
  error?: string,
  elapsedMs = 0,
  background = false,
): DashboardAgentUpdateEvent {
  return {
    type: 'agent:update',
    id,
    status,
    payload: {
      name,
      definitionName: name,
      toolCount,
      elapsedMs,
      background,
      ...(summary !== undefined ? { summary } : {}),
      ...(currentTool !== undefined ? { currentTool } : {}),
      ...(error !== undefined ? { error } : {}),
    },
  };
}

function removed(id: string): DashboardAgentUpdateEvent {
  return { type: 'agent:update', id, status: 'removed' };
}

describe('createAgentProgressRuntime', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  test('first update appends a new block to chatLines', () => {
    expect(h.chatLines.length).toBe(0);
    h.runtime.onAgentUpdate(update('a', 'running', 2, 'explore'));
    // Header + agent line.
    expect(h.chatLines.length).toBeGreaterThan(0);
    expect(h.chatLines[0]).toContain('Agents');
    expect(h.chatLines.some((l) => l.includes('explore'))).toBe(true);
    expect(h.pinCalls).toBe(1);
    expect(h.drawCalls).toBe(1);
    expect(h.runtime._entriesForTest().length).toBe(1);
  });

  test('subsequent update replaces the block in place (no growth past block)', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 2, 'explore'));
    const sizeAfterFirst = h.chatLines.length;
    h.runtime.onAgentUpdate(update('b', 'running', 5, 'plan'));
    // Block grew (now 2 agents) but was replaced in place; chatLines
    // should not have left a stale 'explore'-only header.
    const headerCount = h.chatLines.filter((l) => l.includes('Agents')).length;
    expect(headerCount).toBe(1);
    expect(h.chatLines.some((l) => l.includes('explore'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('plan'))).toBe(true);
    expect(h.chatLines.length).toBeGreaterThanOrEqual(sizeAfterFirst);
  });

  test('preserves chat content before the block when block grows', () => {
    const seed = ['user: hi', 'assistant: working...'];
    h = makeHarness(seed);
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.runtime.onAgentUpdate(update('b', 'running', 2, 'plan'));
    h.runtime.onAgentUpdate(update('c', 'running', 3, 'verify'));
    // Seed lines must remain untouched at the start.
    expect(h.chatLines[0]).toBe(seed[0]);
    expect(h.chatLines[1]).toBe(seed[1]);
    // The block follows.
    expect(h.chatLines.slice(2).some((l) => l.includes('Agents'))).toBe(true);
  });

  test('removed event drops only that entry; block re-renders', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.runtime.onAgentUpdate(update('b', 'running', 2, 'plan'));
    expect(h.runtime._entriesForTest().length).toBe(2);
    h.runtime.onAgentUpdate(removed('a'));
    expect(h.runtime._entriesForTest().length).toBe(1);
    expect(h.chatLines.some((l) => l.includes('explore'))).toBe(false);
    expect(h.chatLines.some((l) => l.includes('plan'))).toBe(true);
  });

  test('removing the last entry deletes the block from chatLines', () => {
    const seed = ['user: hi'];
    h = makeHarness(seed);
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    expect(h.chatLines.length).toBeGreaterThan(seed.length);
    h.runtime.onAgentUpdate(removed('a'));
    expect(h.chatLines).toEqual(seed);
    expect(h.runtime._entriesForTest().length).toBe(0);
  });

  test('removed event for unknown id is a no-op (no draw, no chatLines change)', () => {
    h.runtime.onAgentUpdate(removed('ghost'));
    expect(h.chatLines.length).toBe(0);
    expect(h.drawCalls).toBe(0);
  });

  test('event without payload is ignored', () => {
    h.runtime.onAgentUpdate({ type: 'agent:update', id: 'a', status: 'running' });
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._entriesForTest().length).toBe(0);
  });

  test('reset() drops the block and forgets entries', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.runtime.onAgentUpdate(update('b', 'running', 2, 'plan'));
    expect(h.chatLines.length).toBeGreaterThan(0);
    h.runtime.reset();
    expect(h.chatLines).toEqual([]);
    expect(h.runtime._entriesForTest().length).toBe(0);
  });

  test('re-resolves a moved block without replacing an unrelated line at its old index', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.chatLines.unshift('unrelated at stale progress index');
    h.runtime.onAgentUpdate(update('a', 'done', 1, 'explore', 'completed summary'));
    expect(h.chatLines).toEqual([
      'unrelated at stale progress index',
      expect.stringContaining('Agents'),
      expect.stringContaining('explore'),
      '   completed summary',
    ]);
    expect(h.chatLines.some((line) => line.includes('● explore'))).toBe(false);
  });

  test('appends a fresh block after an external chatLines clear', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.chatLines.length = 0;
    h.runtime.onAgentUpdate(update('a', 'done', 1, 'explore', 'completed summary'));
    expect(h.chatLines.length).toBeGreaterThan(0);
    expect(h.chatLines.some((line) => line.includes('completed summary'))).toBe(true);
    expect(h.chatLines.filter((line) => line.includes('Agents')).length).toBe(1);
  });

  test('reset preserves unrelated lines placed at its old index after the block was externally deleted', () => {
    h = makeHarness(['chat line A']);
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.chatLines.splice(1);
    h.chatLines.push('unrelated at stale progress index');
    h.runtime.reset();
    expect(h.chatLines).toEqual(['chat line A', 'unrelated at stale progress index']);
  });

  test('running entries render current tool and elapsed time instead of summary', () => {
    h.runtime.onAgentUpdate(update(
      'a', 'running', 3, 'explore', 'finished result', 'Bash {"command":"bun test"}', undefined, 65000,
    ));
    expect(h.chatLines.some((l) => l.includes('Bash {"command":"bun test"}'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('1m 5s'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('finished result'))).toBe(false);
  });

  test('terminal entries render summary or error fallback as lastToolText', () => {
    h.runtime.onAgentUpdate(update('done', 'done', 3, 'done-agent', 'completed summary'));
    h.runtime.onAgentUpdate(update('error', 'error', 1, 'error-agent', undefined, undefined, 'failed detail'));
    expect(h.chatLines.some((l) => l.includes('completed summary'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('failed detail'))).toBe(true);
  });

  test('orders error, running, queued, cancelled, then done stably', () => {
    h = makeHarness([], 6);
    h.runtime.onAgentUpdate(update('done', 'done', 0, 'done-first'));
    h.runtime.onAgentUpdate(update('queued-1', 'queued', 0, 'queued-first'));
    h.runtime.onAgentUpdate(update('running', 'running', 0, 'running-middle'));
    h.runtime.onAgentUpdate(update('error', 'error', 0, 'error-last'));
    h.runtime.onAgentUpdate(update('queued-2', 'queued', 0, 'queued-second'));
    h.runtime.onAgentUpdate(update('cancelled', 'cancelled', 0, 'cancelled-last'));
    const positions = ['error-last', 'running-middle', 'queued-first', 'queued-second', 'cancelled-last', 'done-first']
      .map((name) => h.chatLines.findIndex((line) => line.includes(name)));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test('definitionName fallback when name is empty', () => {
    h.runtime.onAgentUpdate({
      type: 'agent:update',
      id: 'a',
      status: 'running',
      payload: { name: '', definitionName: 'verifier-agent', toolCount: 1, elapsedMs: 0 },
    });
    expect(h.chatLines.some((l) => l.includes('verifier-agent'))).toBe(true);
  });

  test('appends one tail notification for a background completion without including it in the block', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore', undefined, undefined, undefined, 0, true));
    h.runtime.onAgentUpdate(update('a', 'done', 1, 'explore', 'ok', undefined, undefined, 65000, true));
    h.runtime.onAgentUpdate(update('a', 'done', 1, 'explore', 'ok', undefined, undefined, 65000, true));

    expect(h.chatLines.at(-1)).toBe('  ✓ explore 끝남 · 1m 5s — 결과는 다음 턴에 이어집니다');
    expect(h.chatLines.filter((line) => line.includes('끝남')).length).toBe(1);
    expect(h.chatLines.filter((line) => line.includes('Agents')).length).toBe(1);
  });

  test('notifies when a background task completes after its payload becomes foreground', () => {
    h.runtime.onAgentUpdate(update('worker-1', 'running', 0, 'worker-1', undefined, undefined, undefined, 0, true));
    h.runtime.onAgentUpdate(update('worker-1', 'done', 0, 'worker-1', 'ok', undefined, undefined, 9000));

    expect(h.chatLines.at(-1)).toBe('  ✓ worker-1 끝남 · 9s — 결과는 다음 턴에 이어집니다');
  });

  test('removed events and reset discard background history', () => {
    h.runtime.onAgentUpdate(update('removed', 'running', 0, 'removed', undefined, undefined, undefined, 0, true));
    h.runtime.onAgentUpdate(removed('removed'));
    h.runtime.onAgentUpdate(update('removed', 'running'));
    h.runtime.onAgentUpdate(update('removed', 'done', 0, 'removed', 'ok'));
    expect(h.chatLines.some((line) => line.includes('removed 끝남'))).toBe(false);

    h.runtime.onAgentUpdate(update('reset', 'running', 0, 'reset', undefined, undefined, undefined, 0, true));
    h.runtime.reset();
    h.runtime.onAgentUpdate(update('reset', 'running'));
    h.runtime.onAgentUpdate(update('reset', 'done', 0, 'reset', 'ok'));
    expect(h.chatLines.some((line) => line.includes('reset 끝남'))).toBe(false);
  });

  test('appends terminal error and cancellation notifications for background entries', () => {
    const longError = `${'x'.repeat(61)}\nignored second line`;
    h.runtime.onAgentUpdate(update('error', 'queued', 0, 'error-agent', undefined, undefined, undefined, 0, true));
    h.runtime.onAgentUpdate(update('error', 'error', 0, 'error-agent', undefined, undefined, longError, 0, true));
    h.runtime.onAgentUpdate(update('cancel', 'running', 0, 'cancel-agent', undefined, undefined, undefined, 0, true));
    h.runtime.onAgentUpdate(update('cancel', 'cancelled', 0, 'cancel-agent', undefined, undefined, undefined, 0, true));

    expect(h.chatLines).toContain(`  ✗ error-agent 실패 · ${'x'.repeat(60)}`);
    expect(h.chatLines).toContain('  ⏹ cancel-agent 중단됨');
  });

  test('does not append a terminal notification for foreground entries', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    h.runtime.onAgentUpdate(update('a', 'done', 1, 'explore', 'ok', undefined, undefined, 65000));

    expect(h.chatLines.some((line) => line.includes('끝남'))).toBe(false);
    expect(h.chatLines.some((line) => line.includes('실패'))).toBe(false);
    expect(h.chatLines.some((line) => line.includes('중단됨'))).toBe(false);
  });

  test('status changes propagate to the rendered block', () => {
    h.runtime.onAgentUpdate(update('a', 'running', 1, 'explore'));
    // Snapshot pre-completion line set.
    const beforeDone = [...h.chatLines];
    h.runtime.onAgentUpdate(update('a', 'done', 4, 'explore'));
    // After 'done', summary line should reflect a non-running fleet.
    const headerLine = h.chatLines.find((l) => l.includes('Agents'));
    expect(headerLine).toBeDefined();
    expect(headerLine!).toContain('1 done');
    // Block size matches previous (single agent) — replace, not append.
    expect(h.chatLines.length).toBe(beforeDone.length);
  });
});
