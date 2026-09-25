import { beforeEach, describe, expect, test } from 'bun:test';
import { createBackgroundPillRuntime } from '../src/dashboard/background-pill-runtime.js';
import { createAgentProgressRuntime } from '../src/dashboard/agent-progress-runtime.js';
import type { DashboardAgentUpdateEvent } from '../src/dashboard/agent-roster-runtime.js';

interface Counts { shell: number; agent: number; workflow: number; scheduler: number; }

interface Harness {
  chatLines: string[];
  counts: Counts;
  drawCalls: number;
  pinCalls: number;
  runtime: ReturnType<typeof createBackgroundPillRuntime>;
}

function makeHarness(seed: string[] = []): Harness {
  const chatLines: string[] = [...seed];
  const counts: Counts = { shell: 0, agent: 0, workflow: 0, scheduler: 0 };
  let drawCalls = 0;
  let pinCalls = 0;
  const runtime = createBackgroundPillRuntime({
    chatLines,
    pinChatTail: () => { pinCalls++; },
    draw: () => { drawCalls++; },
    countShell: () => counts.shell,
    countAgent: () => counts.agent,
    countWorkflow: () => counts.workflow,
    countScheduler: () => counts.scheduler,
  });
  return {
    chatLines,
    counts,
    get drawCalls() { return drawCalls; },
    get pinCalls() { return pinCalls; },
    runtime,
  } as Harness;
}

describe('createBackgroundPillRuntime', () => {
  let h: Harness;
  beforeEach(() => { h = makeHarness(); });

  test('all-zero counts → no block, no draw on refresh', () => {
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._lineForTest()).toBeNull();
    expect(h.drawCalls).toBe(0);
  });

  test('first non-zero refresh appends a single pill line', () => {
    h.counts.agent = 2;
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(1);
    expect(h.chatLines[0]).toContain('2 agents');
    expect(h.runtime._lineForTest()).toBe(h.chatLines[0]!);
    expect(h.drawCalls).toBe(1);
    expect(h.pinCalls).toBe(1);
  });

  test('idempotent — same counts on second refresh draws no extra frame', () => {
    h.counts.shell = 1;
    h.runtime.refresh();
    const drawsAfterFirst = h.drawCalls;
    h.runtime.refresh();
    expect(h.drawCalls).toBe(drawsAfterFirst);
    expect(h.chatLines.length).toBe(1);
  });

  test('count change replaces the line in place (no growth)', () => {
    h.counts.agent = 1;
    h.runtime.refresh();
    h.counts.shell = 2;
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(1);
    expect(h.chatLines[0]).toContain('1 agent');
    expect(h.chatLines[0]).toContain('2 shells');
  });

  test('counts return to zero → pill removed', () => {
    h.counts.agent = 2;
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(1);
    h.counts.agent = 0;
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._lineForTest()).toBeNull();
  });

  test('preserves chat content before the pill block', () => {
    const seed = ['user: hi', 'assistant: working...'];
    h = makeHarness(seed);
    h.counts.agent = 1;
    h.runtime.refresh();
    expect(h.chatLines[0]).toBe(seed[0]);
    expect(h.chatLines[1]).toBe(seed[1]);
    expect(h.chatLines[2]).toContain('1 agent');
    h.counts.agent = 0;
    h.runtime.refresh();
    expect(h.chatLines).toEqual(seed);
  });

  test('reset() drops the pill if present', () => {
    h.counts.agent = 1;
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(1);
    h.runtime.reset();
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._lineForTest()).toBeNull();
  });

  test('reset() is no-op when pill absent', () => {
    h.runtime.reset();
    expect(h.drawCalls).toBe(0);
    expect(h.chatLines.length).toBe(0);
  });

  test('negative count from source is clamped to 0', () => {
    h.counts.agent = -5;
    h.runtime.refresh();
    expect(h.chatLines.length).toBe(0);
    expect(h.runtime._lineForTest()).toBeNull();
  });

  // ── Wave C — pill row exposure ──────────────────────────────
  test('getPillRow() is null when no pill is rendered', () => {
    expect(h.runtime.getPillRow()).toBeNull();
  });

  test('getPillRow() returns absolute index when pill is appended', () => {
    h.counts.agent = 1;
    h.runtime.refresh();
    expect(h.runtime.getPillRow()).toBe(0);
  });

  test('getPillRow() reflects seeded chatLines length', () => {
    const harness = makeHarness(['line a', 'line b', 'line c']);
    harness.counts.workflow = 1;
    harness.runtime.refresh();
    expect(harness.runtime.getPillRow()).toBe(3);
  });

  test('getPillRow() resets to null after counts drop to zero', () => {
    h.counts.shell = 1;
    h.runtime.refresh();
    expect(h.runtime.getPillRow()).toBe(0);
    h.counts.shell = 0;
    h.runtime.refresh();
    expect(h.runtime.getPillRow()).toBeNull();
  });

  test('removes a shifted pill after the real progress runtime grows its block', () => {
    const chatLines: string[] = [];
    const counts: Counts = { shell: 0, agent: 3, workflow: 0, scheduler: 0 };
    const pill = createBackgroundPillRuntime({
      chatLines,
      pinChatTail: () => {},
      draw: () => {},
      countShell: () => counts.shell,
      countAgent: () => counts.agent,
      countWorkflow: () => counts.workflow,
    });
    const progress = createAgentProgressRuntime({ chatLines, pinChatTail: () => {}, draw: () => {} });
    const update = (id: string, status: 'running' | 'done', summary?: string): DashboardAgentUpdateEvent => ({
      type: 'agent:update', id, status,
      payload: { name: `worker-${id}`, definitionName: `worker-${id}`, toolCount: 0, elapsedMs: 0,
        ...(summary ? { summary } : {}) },
    });

    progress.onAgentUpdate(update('1', 'running'));
    progress.onAgentUpdate(update('2', 'running'));
    progress.onAgentUpdate(update('3', 'running'));
    pill.refresh();
    progress.onAgentUpdate(update('3', 'done', 'completed summary'));
    counts.agent = 0;
    pill.refresh();

    expect(chatLines.some((line) => line.includes('◇'))).toBe(false);
    expect(chatLines.some((line) => line.includes('● worker-3'))).toBe(false);
    expect(chatLines.some((line) => line.includes('completed summary'))).toBe(true);
    expect(chatLines.filter((line) => line.includes('Agents')).length).toBe(1);
    expect(chatLines.some((line) => line.includes('worker-1'))).toBe(true);
    expect(chatLines.some((line) => line.includes('worker-2'))).toBe(true);
  });

  test('re-resolves the pill row after external insertion and discards a deleted handle', () => {
    h.counts.agent = 1;
    h.runtime.refresh();
    const formerPill = h.chatLines[0]!;
    h.chatLines.unshift('chat line A');
    expect(h.runtime.getPillRow()).toBe(1);
    h.chatLines.splice(1, 1);
    expect(h.runtime.getPillRow()).toBeNull();
    h.chatLines.push(formerPill);
    expect(h.runtime.getPillRow()).toBeNull();
  });

  test('appends a fresh pill when its previous line was externally deleted', () => {
    h.counts.agent = 1;
    h.runtime.refresh();
    h.chatLines.length = 0;
    h.runtime.refresh();
    expect(h.chatLines).toHaveLength(1);
    expect(h.chatLines[0]).toContain('1 agent');
  });

  test('reset does not delete unrelated lines after its pill was externally removed', () => {
    h = makeHarness(['chat line A']);
    h.counts.agent = 1;
    h.runtime.refresh();
    h.chatLines.splice(1, 1);
    h.runtime.reset();
    expect(h.chatLines).toEqual(['chat line A']);
  });

  test('options() callback forwarded — attention CTA', () => {
    let attention = false;
    const chatLines: string[] = [];
    const counts: Counts = { shell: 0, agent: 1, workflow: 0, scheduler: 0 };
    const runtime = createBackgroundPillRuntime({
      chatLines,
      pinChatTail: () => {},
      draw: () => {},
      countShell: () => counts.shell,
      countAgent: () => counts.agent,
      countWorkflow: () => counts.workflow,
      countScheduler: () => counts.scheduler,
      options: () => ({ attention }),
    });
    runtime.refresh();
    expect(chatLines[0]).not.toContain('↓');
    attention = true;
    runtime.refresh();
    expect(chatLines[0]).toContain('↓ to view');
  });
});
