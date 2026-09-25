// ── T1 (Phase 1) — pfc-shell-watcher tests ──

import { describe, expect, test } from 'bun:test';
import {
  createPfcShellWatcher,
  postureDeath,
  type PfcShellDeathSignal,
} from '../src/conductor/pfc-shell-watcher';
import type {
  ShellHandle,
  ShellPostureEvent,
  ShellPostureSubscriber,
  ShellRegistry,
  Unsubscribe,
} from '../src/shell-runner/types';
import type { TerminalExposureSnapshot } from '../src/terminal/posture';

// ── Helpers ─────────────────────────────────────────────────────────

function exposure(
  userExposure: TerminalExposureSnapshot['userExposure'],
  agentInteractive = true,
): TerminalExposureSnapshot {
  return { userExposure, agentInteractive };
}

interface FakeRegistry {
  registry: ShellRegistry;
  emit: (event: ShellPostureEvent) => void;
  setHandle: (id: string, handle: ShellHandle | null) => void;
  unsubscribed: () => boolean;
}

function fakeRegistry(): FakeRegistry {
  const subs = new Set<ShellPostureSubscriber>();
  const handles = new Map<string, ShellHandle | null>();
  let didUnsubscribe = false;

  const registry: ShellRegistry = {
    register: () => { /* noop */ },
    unregister: () => { /* noop */ },
    get: (id: string) => handles.get(id) ?? null,
    list: () => [],
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => { /* noop */ },
    attachSurface: () => () => { /* noop */ },
    describePosture: () => null,
    listWithPosture: () => [],
    subscribePosture(cb: ShellPostureSubscriber): Unsubscribe {
      subs.add(cb);
      return () => {
        subs.delete(cb);
        didUnsubscribe = true;
      };
    },
  } as unknown as ShellRegistry;

  return {
    registry,
    emit: (event) => {
      for (const cb of subs) cb(event);
    },
    setHandle: (id, h) => { handles.set(id, h); },
    unsubscribed: () => didUnsubscribe,
  };
}

// ── postureDeath ────────────────────────────────────────────────────

describe('postureDeath — death pattern classifier', () => {
  test('user-interactive → unavailable = death', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('user-interactive'),
      next: exposure('unavailable', false),
    })).toBe(true);
  });

  test('observe-only → unavailable = death', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('observe-only'),
      next: exposure('unavailable', false),
    })).toBe(true);
  });

  test('hidden → unavailable = death (bg shells)', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('hidden'),
      next: exposure('unavailable', false),
    })).toBe(true);
  });

  test('user-interactive → observe-only ≠ death (focus flip)', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('user-interactive'),
      next: exposure('observe-only'),
    })).toBe(false);
  });

  test('first-emit (prev=null) → not death', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: null,
      next: exposure('unavailable', false),
    })).toBe(false);
  });

  test('next=null → not death', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('user-interactive'),
      next: null,
    })).toBe(false);
  });

  test('unavailable → unavailable (idempotent emit) → not death', () => {
    expect(postureDeath({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('unavailable', false),
      next: exposure('unavailable', false),
    })).toBe(false);
  });
});

// ── watcher dispatch ─────────────────────────────────────────────────

describe('createPfcShellWatcher — dispatch', () => {
  test('forwards death signals with handle resolved from registry', () => {
    const fake = fakeRegistry();
    const fakeHandle = { id: 's1', mode: 'vw' } as unknown as ShellHandle;
    fake.setHandle('s1', fakeHandle);

    const seen: PfcShellDeathSignal[] = [];
    const watcher = createPfcShellWatcher({
      registry: fake.registry,
      onDeath: (signal) => { seen.push(signal); },
      now: () => 1000,
    });

    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('user-interactive'),
      next: exposure('unavailable', false),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.shellId).toBe('s1');
    expect(seen[0]!.handle).toBe(fakeHandle);
    expect(seen[0]!.observedAt).toBe(1000);

    watcher.stop();
  });

  test('drops non-death events without invoking listener', () => {
    const fake = fakeRegistry();
    const seen: PfcShellDeathSignal[] = [];
    createPfcShellWatcher({
      registry: fake.registry,
      onDeath: (signal) => { seen.push(signal); },
    });

    fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('user-interactive'),
      next: exposure('observe-only'),
    });

    expect(seen).toHaveLength(0);
  });

  test('handle is null when registry no longer knows the shell', () => {
    const fake = fakeRegistry();
    const seen: PfcShellDeathSignal[] = [];
    createPfcShellWatcher({
      registry: fake.registry,
      onDeath: (signal) => { seen.push(signal); },
    });

    fake.emit({
      kind: 'posture-changed',
      shellId: 'gone',
      prev: exposure('user-interactive'),
      next: exposure('unavailable', false),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.handle).toBeNull();
  });

  test('listener throws are isolated', () => {
    const fake = fakeRegistry();
    const watcher = createPfcShellWatcher({
      registry: fake.registry,
      onDeath: () => { throw new Error('boom'); },
    });

    // Must not throw out of emit.
    expect(() => fake.emit({
      kind: 'posture-changed',
      shellId: 's1',
      prev: exposure('user-interactive'),
      next: exposure('unavailable', false),
    })).not.toThrow();

    watcher.stop();
  });

  test('stop() unsubscribes from registry (idempotent)', () => {
    const fake = fakeRegistry();
    const watcher = createPfcShellWatcher({
      registry: fake.registry,
      onDeath: () => { /* noop */ },
    });

    expect(fake.unsubscribed()).toBe(false);
    watcher.stop();
    expect(fake.unsubscribed()).toBe(true);
    // Calling stop again is a no-op.
    expect(() => watcher.stop()).not.toThrow();
  });
});
