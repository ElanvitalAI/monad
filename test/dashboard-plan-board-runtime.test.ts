import { beforeEach, describe, expect, test } from 'bun:test';
import { createPlanBoardRuntime } from '../src/dashboard/plan-board-runtime.js';
import type { PlanState } from '../src/code-edit/plan-tool.js';

interface Harness {
  chatLines: string[];
  drawCalls: number;
  pinCalls: number;
  runtime: ReturnType<typeof createPlanBoardRuntime>;
}

function makeHarness(seed: string[] = []): Harness {
  const chatLines: string[] = [...seed];
  let drawCalls = 0;
  let pinCalls = 0;
  const runtime = createPlanBoardRuntime({
    chatLines,
    pinChatTail: () => { pinCalls++; },
    draw: () => { drawCalls++; },
    noColor: true,
  });
  return {
    chatLines,
    get drawCalls() { return drawCalls; },
    get pinCalls() { return pinCalls; },
    runtime,
  } as Harness;
}

function planState(steps: { step: string; status: 'pending' | 'in_progress' | 'completed' }[], explanation?: string): PlanState {
  return {
    steps: [...steps],
    updatedAt: 0,
    version: 0,
    ...(explanation !== undefined ? { lastExplanation: explanation } : {}),
  };
}

describe('createPlanBoardRuntime', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  test('first non-empty apply pushes block onto chatLines', () => {
    expect(h.chatLines.length).toBe(0);
    h.runtime.apply(planState([
      { step: 'A', status: 'completed' },
      { step: 'B', status: 'in_progress' },
      { step: 'C', status: 'pending' },
    ]));
    expect(h.chatLines.length).toBeGreaterThan(0);
    expect(h.chatLines.some((l) => l.includes('Plan'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('A'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('B'))).toBe(true);
    expect(h.chatLines.some((l) => l.includes('C'))).toBe(true);
    expect(h.drawCalls).toBe(1);
    expect(h.pinCalls).toBe(1);
  });

  test('second apply with different state replaces block in place', () => {
    h.runtime.apply(planState([
      { step: 'A', status: 'in_progress' },
    ]));
    const sizeAfterFirst = h.chatLines.length;
    h.runtime.apply(planState([
      { step: 'A', status: 'completed' },
      { step: 'B', status: 'in_progress' },
    ]));
    // Block grew from 1 step to 2; replaced (not appended).
    const planTitleCount = h.chatLines.filter((l) => l.includes('Plan')).length;
    expect(planTitleCount).toBe(1);
    expect(h.chatLines.some((l) => l.includes('B'))).toBe(true);
    expect(h.chatLines.length).toBeGreaterThanOrEqual(sizeAfterFirst);
  });

  test('idempotent — same state on second apply triggers no redraw', () => {
    const s = planState([{ step: 'A', status: 'completed' }]);
    h.runtime.apply(s);
    const drawsAfterFirst = h.drawCalls;
    h.runtime.apply(s);
    expect(h.drawCalls).toBe(drawsAfterFirst);
  });

  test('empty plan → block removed', () => {
    h.runtime.apply(planState([{ step: 'A', status: 'in_progress' }]));
    expect(h.chatLines.length).toBeGreaterThan(0);
    h.runtime.apply(planState([]));
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._linesForTest()).toBeNull();
  });

  test('preserves chat content before the block', () => {
    const seed = ['user: hi', 'assistant: working...'];
    h = makeHarness(seed);
    h.runtime.apply(planState([
      { step: 'A', status: 'in_progress' },
    ]));
    expect(h.chatLines[0]).toBe(seed[0]);
    expect(h.chatLines[1]).toBe(seed[1]);
    expect(h.chatLines.slice(2).some((l) => l.includes('Plan'))).toBe(true);
    h.runtime.apply(planState([]));
    expect(h.chatLines).toEqual(seed);
  });

  test('reset() drops the block and forgets snapshot', () => {
    h.runtime.apply(planState([{ step: 'A', status: 'completed' }]));
    expect(h.chatLines.length).toBeGreaterThan(0);
    h.runtime.reset();
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._linesForTest()).toBeNull();
  });

  test('reset() is no-op when block absent (no draw)', () => {
    h.runtime.reset();
    expect(h.drawCalls).toBe(0);
  });

  test('apply with empty plan when no block exists is a no-op', () => {
    h.runtime.apply(planState([]));
    expect(h.drawCalls).toBe(0);
    expect(h.chatLines.length).toBe(0);
  });

  test('lastExplanation surfaces in the title row', () => {
    h.runtime.apply(planState(
      [{ step: 'A', status: 'completed' }],
      'cleanup pass before merge',
    ));
    expect(h.chatLines.some((l) => l.includes('cleanup pass'))).toBe(true);
  });

  test('status changes propagate (replace, no growth)', () => {
    h.runtime.apply(planState([
      { step: 'A', status: 'pending' },
      { step: 'B', status: 'pending' },
    ]));
    const sizeBefore = h.chatLines.length;
    h.runtime.apply(planState([
      { step: 'A', status: 'in_progress' },
      { step: 'B', status: 'pending' },
    ]));
    expect(h.chatLines.length).toBe(sizeBefore);
    expect(h.runtime._linesForTest()).not.toBeNull();
  });
});
