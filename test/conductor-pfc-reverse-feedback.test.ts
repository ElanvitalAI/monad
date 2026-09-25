// ── T1 (Phase 1) — pfc-reverse-feedback orchestrator tests ──

import { describe, expect, test } from 'bun:test';
import {
  createPfcReverseFeedback,
  type PfcReverseFeedbackNotification,
} from '../src/conductor/pfc-reverse-feedback';
import type { PfcShellDeathSignal } from '../src/conductor/pfc-shell-watcher';
import type { ShellHandle, ShellResult } from '../src/shell-runner/types';
import type { TerminalExposureSnapshot } from '../src/terminal/posture';

function exposure(
  userExposure: TerminalExposureSnapshot['userExposure'],
  agentInteractive = true,
): TerminalExposureSnapshot {
  return { userExposure, agentInteractive };
}

function fakeHandle(result: ShellResult | null): ShellHandle {
  return {
    id: 's1',
    mode: 'vw',
    result: result ? Promise.resolve(result) : new Promise(() => { /* never resolves */ }),
  } as unknown as ShellHandle;
}

function failure(opts: {
  exitCode?: number;
  text?: string;
  outcome?: ShellResult['outcome'];
  timedOut?: boolean;
  interrupted?: boolean;
}): ShellResult {
  return {
    exitCode: opts.exitCode,
    stdout: { text: '' },
    stderr: { text: '' },
    aggregated: { text: opts.text ?? '' },
    durationMs: 100,
    timedOut: opts.timedOut ?? false,
    interrupted: opts.interrupted ?? false,
    truncated: false,
    outcome: opts.outcome ?? 'exit',
  };
}

function deathSignal(opts: {
  shellId?: string;
  prev?: TerminalExposureSnapshot;
  handle?: ShellHandle | null;
} = {}): PfcShellDeathSignal {
  return {
    shellId: opts.shellId ?? 's1',
    prev: opts.prev ?? exposure('user-interactive'),
    next: exposure('unavailable', false),
    handle: opts.handle === undefined ? null : opts.handle,
    observedAt: 1000,
  };
}

async function flushMicrotasks(): Promise<void> {
  // Two trips ensure result.then → research → sink chain settles.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createPfcReverseFeedback — false-positive guard', () => {
  test('exit 0 → no notification fires', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({
      handle: fakeHandle(failure({ exitCode: 0, text: 'all good' })),
    }));
    await flushMicrotasks();

    expect(sink).toHaveLength(0);
    expect(orch.inFlight()).toEqual([]);
  });

  test('handle missing → unknown → no notification', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
      resultTimeoutMs: 50,
    });

    orch.start(deathSignal({ handle: null }));
    await flushMicrotasks();
    // resultTimeoutMs still pending — sink not yet called.
    await new Promise((r) => setTimeout(r, 80));
    expect(sink).toHaveLength(0);
  });
});

describe('createPfcReverseFeedback — failure cases', () => {
  test('exit 1 with AssertionError → notification fires', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({
      handle: fakeHandle(failure({
        exitCode: 1,
        text: 'AssertionError: expected 5 got 3',
      })),
    }));
    await flushMicrotasks();

    expect(sink).toHaveLength(1);
    expect(sink[0]!.research.classification.clazz).toBe('error-with-trace');
    expect(sink[0]!.research.classification.errorMarker).toBe('AssertionError');
    expect(sink[0]!.summary).toContain('AssertionError');
    expect(sink[0]!.summary).toContain('exit 1');
  });

  test('exit 1 with grep-style silent failure → silent-nonzero notification', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({
      handle: fakeHandle(failure({ exitCode: 1, text: '' })),
    }));
    await flushMicrotasks();

    expect(sink).toHaveLength(1);
    expect(sink[0]!.research.classification.clazz).toBe('silent-nonzero');
  });

  test('timeout outcome → timeout classification', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({
      handle: fakeHandle(failure({
        exitCode: undefined,
        outcome: 'timeout',
        timedOut: true,
        text: 'still running…',
      })),
    }));
    await flushMicrotasks();

    expect(sink).toHaveLength(1);
    expect(sink[0]!.research.classification.clazz).toBe('timeout');
  });
});

describe('createPfcReverseFeedback — capability gate', () => {
  test('canWrite + agentInteractive → canApply true', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({
      prev: exposure('user-interactive', true),
      handle: fakeHandle(failure({ exitCode: 1, text: 'Error: foo' })),
    }));
    await flushMicrotasks();

    expect(sink[0]!.canApply).toBe(true);
    expect(sink[0]!.summary).toContain('Apply');
  });

  test('observe-only → canWrite=false → canApply false (suggestion-only)', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({
      prev: exposure('observe-only', true),
      handle: fakeHandle(failure({ exitCode: 1, text: 'Error: foo' })),
    }));
    await flushMicrotasks();

    expect(sink[0]!.canApply).toBe(false);
    expect(sink[0]!.summary).toContain('제안만');
  });
});

describe('createPfcReverseFeedback — cancel + concurrency', () => {
  test('cancel before result settles → no notification', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    let resolve: ((r: ShellResult) => void) | null = null;
    const handle = {
      id: 's1',
      mode: 'vw',
      result: new Promise<ShellResult>((r) => { resolve = r; }),
    } as unknown as ShellHandle;

    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({ handle }));
    expect(orch.inFlight()).toEqual(['s1']);
    orch.cancel('s1');
    expect(orch.inFlight()).toEqual([]);

    resolve!(failure({ exitCode: 1, text: 'Error: foo' }));
    await flushMicrotasks();
    expect(sink).toHaveLength(0);
  });

  test('second start replaces the first in-flight task for same shell', async () => {
    const sink: PfcReverseFeedbackNotification[] = [];
    let resolve1: ((r: ShellResult) => void) | null = null;
    const handle1 = {
      id: 's1',
      mode: 'vw',
      result: new Promise<ShellResult>((r) => { resolve1 = r; }),
    } as unknown as ShellHandle;

    const orch = createPfcReverseFeedback({
      sink: (n) => { sink.push(n); },
    });

    orch.start(deathSignal({ handle: handle1 }));
    expect(orch.inFlight()).toEqual(['s1']);
    orch.start(deathSignal({
      handle: fakeHandle(failure({ exitCode: 1, text: 'Error: second' })),
    }));
    await flushMicrotasks();

    // Second task should land — first should be cancelled.
    expect(sink).toHaveLength(1);
    expect(sink[0]!.summary).toContain('Error');
    resolve1!(failure({ exitCode: 1, text: 'Error: first' }));
    await flushMicrotasks();
    expect(sink).toHaveLength(1); // first never delivered.
  });
});
