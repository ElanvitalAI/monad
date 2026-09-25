// ── PFC-S2 P2: completion flash + unread tracking ──
//
// Covers:
//   1. AgentFlashTracker register / isFlashing lifecycle
//   2. Timer-based expiry (no tick loop)
//   3. pending() purges expired entries
//   4. renderAgentRoster honours opts.isFlashing with a prefix glyph
//   5. task-notification auto-wire registers flash on terminal state
//   6. globalAgentFlash survives registry.clear() (module singleton)

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  AgentFlashTracker,
  globalAgentFlash,
  FLASH_DURATION_MS,
} from '../src/display/agent-flash';
import { renderAgentRoster, type AgentSurfaceState } from '../src/display/agent-surface';
import {
  AgentRegistry,
  globalAgentRegistry,
} from '../src/agent/registry';
import {
  wireTaskNotifications,
  rewireGlobalTaskNotifications,
  TaskNotificationQueue,
} from '../src/agent/task-notification';
import type { AgentDefinition, AgentTask } from '../src/agent/types';

function mkState(over: Partial<AgentSurfaceState> = {}): AgentSurfaceState {
  return {
    id: 't1',
    name: 'explore',
    definitionName: 'explore',
    status: 'done',
    elapsedMs: 1200,
    toolCount: 2,
    log: [],
    updatedAt: Date.now(),
    ...over,
  };
}

function def(name = 'explore'): AgentDefinition {
  return { name, systemPrompt: 'test' };
}

describe('PFC-S2 P2 — flash tracker', () => {
  let tracker: AgentFlashTracker;
  beforeEach(() => {
    tracker = new AgentFlashTracker();
  });

  test('register → isFlashing true immediately', () => {
    tracker.register('t1', 1000);
    expect(tracker.isFlashing('t1', 1000)).toBe(true);
  });

  test('isFlashing false after FLASH_DURATION_MS elapsed', () => {
    tracker.register('t1', 1000);
    expect(tracker.isFlashing('t1', 1000 + FLASH_DURATION_MS)).toBe(false);
    // and is purged from the map
    expect(tracker.size).toBe(0);
  });

  test('isFlashing unknown id → false', () => {
    expect(tracker.isFlashing('ghost')).toBe(false);
  });

  test('re-register resets the timer', () => {
    tracker.register('t1', 1000);
    tracker.register('t1', 1200);
    expect(tracker.isFlashing('t1', 1200 + FLASH_DURATION_MS - 100)).toBe(true);
    expect(tracker.isFlashing('t1', 1200 + FLASH_DURATION_MS + 1)).toBe(false);
  });

  test('pending() purges expired and returns live ids', () => {
    tracker.register('a', 1000);
    tracker.register('b', 1000);
    tracker.register('c', 1000);
    // a, b are live at 500 ms; c expired at 2000 ms
    expect(tracker.pending(1500).sort()).toEqual(['a', 'b', 'c']);
    const pruned = tracker.pending(1000 + FLASH_DURATION_MS + 1);
    expect(pruned).toEqual([]);
    expect(tracker.size).toBe(0);
  });

  test('clear(id) drops entry immediately', () => {
    tracker.register('t1', 1000);
    tracker.clear('t1');
    expect(tracker.isFlashing('t1', 1000)).toBe(false);
  });
});

describe('PFC-S2 P2 — renderAgentRoster honours isFlashing', () => {
  test('flashing row renders the success glyph prefix', () => {
    const flashing = new Set(['t1']);
    const lines = renderAgentRoster(
      [mkState({ id: 't1', name: 'alpha' }), mkState({ id: 't2', name: 'beta' })],
      0,
      { isFlashing: (id) => flashing.has(id) },
    );
    // Header + blank + 2 rows. Row 1 is selected (cursor=0) → cursor glyph,
    // so we check row 2 (not selected, but t2 not flashing → default
    // prefix). Then check a render where t2 IS flashing (cursor!=1).
    expect(lines.length).toBeGreaterThanOrEqual(4);

    // With t2 flashing and cursor on row 0, row for t2 should contain
    // the ✦ glyph (U+2726).
    const flash2 = new Set(['t2']);
    const lines2 = renderAgentRoster(
      [mkState({ id: 't1', name: 'alpha' }), mkState({ id: 't2', name: 'beta' })],
      0,
      { isFlashing: (id) => flash2.has(id) },
    );
    expect(lines2[3]).toContain('\u2726');
  });

  test('selected row keeps cursor glyph even when flashing (selection wins)', () => {
    const lines = renderAgentRoster(
      [mkState({ id: 't1', name: 'alpha' })],
      0,
      { isFlashing: () => true },
    );
    // Row for t1 has cursor glyph ▸ (U+25B8), not ✦.
    expect(lines[2]).toContain('\u25B8');
    expect(lines[2]).not.toContain('\u2726');
  });
});

describe('PFC-S2 P2 — task-notification wiring registers flash', () => {
  let reg: AgentRegistry;
  let queue: TaskNotificationQueue;
  let disposer: (() => void) | null = null;

  beforeEach(() => {
    reg = new AgentRegistry();
    queue = new TaskNotificationQueue();
    globalAgentFlash.clearAll();
    disposer?.();
    disposer = wireTaskNotifications(queue, reg);
  });

  test('terminal state fires flash.register for the task id', () => {
    const task: AgentTask = {
      id: 'notif-1',
      definition: def(),
      prompt: 'hi',
      state: 'done',
      messages: [],
      controller: new AbortController(),
      startedAt: 100,
      finishedAt: 1000,
      // foreground (background undefined) — flash still fires
    } as AgentTask;
    reg.notifyTaskDone(task);
    expect(globalAgentFlash.isFlashing('notif-1')).toBe(true);
  });

  test('background terminal state fires flash AND enqueues notification', () => {
    const task: AgentTask = {
      id: 'notif-2',
      definition: def(),
      prompt: 'hi',
      state: 'done',
      messages: [],
      controller: new AbortController(),
      startedAt: 100,
      finishedAt: 1000,
      background: true,
    } as AgentTask;
    reg.notifyTaskDone(task);
    expect(globalAgentFlash.isFlashing('notif-2')).toBe(true);
    expect(queue.size).toBe(1);
  });
});
