import { afterEach, describe, expect, test } from 'bun:test';
import { wireToxForDashboard } from '../src/task-orchestrator/boot.ts';
import {
  getToxRuntimeDeps,
  resetToxRuntimeDepsForTest,
} from '../src/task-orchestrator/runtime-deps.ts';
import { TaskGraph } from '../src/task-orchestrator/graph.ts';
import { TaskEventBus } from '../src/task-orchestrator/events.ts';
import { dispatchTaskCreate } from '../src/task-orchestrator/runtimes/create.ts';
import type { TaskSurface } from '../src/task-orchestrator/types.ts';
import { TaskStore } from '../src/task-orchestrator/store.ts';
import type { SurfaceAdapterDeps } from '../src/task-orchestrator/surfaces/index.ts';
import type {
  AndonSignalLike,
  AndonSubscriberKind,
} from '../src/task-orchestrator/andon-bridge.ts';

const surfaceLlm: TaskSurface = { kind: 'llm-direct', prompt: 'p' };

const minimalSurfaces: SurfaceAdapterDeps = {
  llmDirect: async () => ({ text: 'ok' }),
};

afterEach(() => {
  resetToxRuntimeDepsForTest();
});

describe('wireToxForDashboard', () => {
  test('B1: minimal boot returns full handle', () => {
    const tox = wireToxForDashboard();
    expect(tox.graph).toBeDefined();
    expect(tox.bus).toBeDefined();
    expect(tox.dispatcher).toBeDefined();
    expect(tox.loop).toBeDefined();
    expect(tox.retry).toBeDefined();
    expect(tox.generator).toBeNull();
    expect(tox.registeredSurfaceKinds).toEqual([]);
    tox.dispose();
  });

  test('B2: dispose stops loop + retry + andon + resets deps', () => {
    let andonDisposed = false;
    const tox = wireToxForDashboard({
      andon: {
        subscribe: () => () => {
          andonDisposed = true;
        },
      },
    });
    expect(tox.loop.stats().paused).toBe(false);
    tox.dispose();
    expect(andonDisposed).toBe(true);
    // After dispose, runtime deps are reset.
    expect(getToxRuntimeDeps().getGraph()).toBeNull();
  });

  test('B3: partial surface subset registers correctly', () => {
    const tox = wireToxForDashboard({
      surfaces: {
        llmDirect: minimalSurfaces.llmDirect,
        skill: async () => ({ stdout: '', exitCode: 0, durationMs: 0 }),
      },
    });
    expect(tox.registeredSurfaceKinds).toEqual(['skill', 'llm-direct']);
    tox.dispose();
  });

  test('B4: decompose callable → generator handle present', () => {
    const tox = wireToxForDashboard({
      decompose: async () => ({ text: '{}' }),
    });
    expect(tox.generator).not.toBeNull();
    tox.dispose();
  });

  test('B5: no decompose → generator null', () => {
    const tox = wireToxForDashboard();
    expect(tox.generator).toBeNull();
    tox.dispose();
  });

  test('B6: startFeedbackLoop=false → loop has no subscription', () => {
    const tox = wireToxForDashboard({ startFeedbackLoop: false });
    // Emitting task-completed should not cause any side effects on stats
    tox.bus.emit({ kind: 'task-completed', taskId: 'task:none', executionId: 'exec:x' });
    expect(tox.loop.stats().completedTotal).toBe(0);
    tox.dispose();
  });

  test('B7: startRetryPolicy=false → retry not subscribed', () => {
    const tox = wireToxForDashboard({ startRetryPolicy: false });
    tox.bus.emit({
      kind: 'task-failed',
      taskId: 'task:x',
      executionId: 'exec:x',
      errorCode: 'X',
      errorMessage: 'x',
      willRetry: false,
      attempt: 0,
    });
    expect(tox.retry.pendingCount()).toBe(0);
    tox.dispose();
  });

  test('B8: andon subscribe wired → emit CRITICAL pauses loop', () => {
    let handler: ((s: AndonSignalLike, k: AndonSubscriberKind) => void) | null = null;
    const subscribe = (fn: typeof handler) => {
      handler = fn;
      return () => {
        handler = null;
      };
    };
    const tox = wireToxForDashboard({
      andon: { subscribe: subscribe as never },
    });
    expect(handler).not.toBeNull();
    handler!({ severity: 'CRITICAL' }, 'emit');
    expect(tox.loop.isPaused()).toBe(true);
    tox.dispose();
  });

  test('B9: no andon → disposeAndon is a no-op', () => {
    const tox = wireToxForDashboard();
    expect(() => tox.disposeAndon()).not.toThrow();
    tox.dispose();
  });

  test('B10: external graph honored', () => {
    const graph = new TaskGraph();
    const tox = wireToxForDashboard({ graph });
    expect(tox.graph).toBe(graph);
    tox.dispose();
  });

  test('B11: external bus honored', () => {
    const bus = new TaskEventBus();
    const tox = wireToxForDashboard({ bus });
    expect(tox.bus).toBe(bus);
    tox.dispose();
  });

  test('B12: setToxRuntimeDeps runs — getGraph returns handle.graph', () => {
    const tox = wireToxForDashboard();
    expect(getToxRuntimeDeps().getGraph()).toBe(tox.graph);
    tox.dispose();
  });

  test('B13: TaskCreate runtime adds to the wired graph', async () => {
    const tox = wireToxForDashboard();
    const r = await dispatchTaskCreate({ title: 'boot-add', surface: surfaceLlm });
    expect(r.taskId).toBeTruthy();
    expect(tox.graph.hasTask(r.taskId!)).toBe(true);
    tox.dispose();
  });

  test('B14: repeat boot returns independent handles', () => {
    const a = wireToxForDashboard();
    const b = wireToxForDashboard();
    expect(a.graph).not.toBe(b.graph);
    // Second boot rewired deps — getGraph now points at b.graph.
    expect(getToxRuntimeDeps().getGraph()).toBe(b.graph);
    a.dispose();
    b.dispose();
  });

  test('B15: log callback receives boot + dispose lines', () => {
    const lines: string[] = [];
    const tox = wireToxForDashboard({ log: (l) => lines.push(l) });
    tox.dispose();
    expect(lines.some((l) => l.includes('[tox-boot]'))).toBe(true);
    expect(lines.some((l) => l.includes('disposed'))).toBe(true);
  });

  test('B16: optional store is exposed through runtime deps', () => {
    const store = new TaskStore({ path: ':memory:', noWal: true });
    const tox = wireToxForDashboard({ store });
    expect(getToxRuntimeDeps().getStore?.()).toBe(store);
    tox.dispose();
    store.close();
  });
});
