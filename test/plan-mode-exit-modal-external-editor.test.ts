import { describe, expect, test } from 'bun:test';
import { PlanExitDialog } from '../src/plan-mode/exit-modal.js';
import type { KeyEvent } from '../src/display/types.js';

function ctrlKey(name: string, sequence?: string): KeyEvent {
  return { name, sequence: sequence ?? `^${name}`, ctrl: true } as KeyEvent;
}

async function flushMicrotasks(): Promise<void> {
  // Two microtask ticks — the dialog kicks off an async IIFE that
  // awaits the callback then the setText path. Two awaits drains the
  // typical promise chain in unit tests.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('PlanExitDialog · A6-1 external editor handoff', () => {
  test('Ctrl-E without callback wired is ignored (graceful degradation)', async () => {
    let resolved: 'implement' | 'handoff' | 'cancel' | null = null;
    const d = new PlanExitDialog('title', 'plan body', (c) => { resolved = c; });

    const r = d.onEvent(ctrlKey('e'));
    // Without onRequestExternalEdit, Ctrl-E falls through (Ignored).
    // No resolution happens.
    void r;
    await flushMicrotasks();
    expect(resolved).toBeNull();
  });

  test('Ctrl-E invokes onRequestExternalEdit callback', async () => {
    const calls: number[] = [];
    const d = new PlanExitDialog(
      'title',
      'original',
      () => {},
      {
        onRequestExternalEdit: async () => {
          calls.push(1);
          return 'edited body';
        },
      },
    );
    d.onEvent(ctrlKey('e'));
    expect(calls.length).toBe(1);
    await flushMicrotasks();
  });

  test('callback returning a string forwards to onPlanBodyUpdated', async () => {
    const updates: string[] = [];
    const d = new PlanExitDialog(
      'title',
      'original',
      () => {},
      {
        onRequestExternalEdit: async () => 'edited body',
        onPlanBodyUpdated: (next) => { updates.push(next); },
      },
    );
    d.onEvent(ctrlKey('e'));
    await flushMicrotasks();
    expect(updates).toEqual(['edited body']);
  });

  test('callback returning null does NOT fire onPlanBodyUpdated', async () => {
    const updates: string[] = [];
    const d = new PlanExitDialog(
      'title',
      'original',
      () => {},
      {
        onRequestExternalEdit: async () => null,
        onPlanBodyUpdated: (next) => { updates.push(next); },
      },
    );
    d.onEvent(ctrlKey('e'));
    await flushMicrotasks();
    expect(updates).toEqual([]);
  });

  test('rapid double Ctrl-E only fires the callback once (re-entry guard)', async () => {
    let inflight = 0;
    let calls = 0;
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => { resolveFirst = r; });
    const d = new PlanExitDialog(
      'title',
      'original',
      () => {},
      {
        onRequestExternalEdit: async () => {
          inflight++;
          calls++;
          await firstDone;
          inflight--;
          return 'edited';
        },
      },
    );
    d.onEvent(ctrlKey('e'));
    expect(inflight).toBe(1);
    // Second Ctrl-E while the first is in flight — should be ignored.
    d.onEvent(ctrlKey('e'));
    expect(calls).toBe(1);
    resolveFirst();
    await flushMicrotasks();
    // After completion, a fresh Ctrl-E should fire again.
    d.onEvent(ctrlKey('e'));
    await flushMicrotasks();
    expect(calls).toBe(2);
  });

  test('Korean IME variant (Ctrl-ㄷ) maps to the Ctrl-E handler', async () => {
    const updates: string[] = [];
    const d = new PlanExitDialog(
      'title',
      'original',
      () => {},
      {
        onRequestExternalEdit: async () => 'via 한글',
        onPlanBodyUpdated: (next) => { updates.push(next); },
      },
    );
    d.onEvent({ name: 'ㄷ', sequence: '^ㄷ', ctrl: true } as KeyEvent);
    await flushMicrotasks();
    expect(updates).toEqual(['via 한글']);
  });

  test('callback that throws is swallowed (does not break modal)', async () => {
    const updates: string[] = [];
    let resolved: 'implement' | 'handoff' | 'cancel' | null = null;
    const d = new PlanExitDialog(
      'title',
      'original',
      (c) => { resolved = c; },
      {
        onRequestExternalEdit: async () => {
          throw new Error('boom');
        },
        onPlanBodyUpdated: (next) => { updates.push(next); },
      },
    );
    d.onEvent(ctrlKey('e'));
    await flushMicrotasks();
    // No update emitted.
    expect(updates).toEqual([]);
    // Modal resolution is still possible afterwards (non-destructive).
    void resolved;
  });

  test('non-Ctrl E keys are not consumed by the editor handler', async () => {
    const calls: number[] = [];
    const d = new PlanExitDialog(
      'title',
      'plan body',
      () => {},
      {
        onRequestExternalEdit: async () => {
          calls.push(1);
          return null;
        },
      },
    );
    // Plain 'e' (no ctrl) — must NOT trigger the editor.
    d.onEvent({ name: 'e', sequence: 'e' } as KeyEvent);
    await flushMicrotasks();
    expect(calls).toEqual([]);
  });
});
