// ── IUL Phase R §3.2 · B-10-α — ShellRegistry → SurfaceRegistry wiring test ──
//
// Covers:
//   1. register(bgHandle) propagates to SurfaceRegistry as kind='bg'
//   2. unregister(id) removes the SurfaceRegistry entry
//   3. filterModes default (['bg']) ignores inline/modal/vw
//   4. custom filterModes (['bg','inline']) mirrors both
//   5. dispose() drops every owned entry + stops receiving events
//   6. duplicate register → idempotent · owned.size stays 1

import { describe, expect, test } from 'bun:test';

import { createShellRegistry } from '../src/shell-runner/registry.js';
import { wireShellRunnerSurface } from '../src/surface/adapters/shell-runner-wiring.js';
import { createSurfaceRegistry } from '../src/surface/registry.js';
import type {
  ShellHandle,
  ShellMode,
  ShellRegistry,
} from '../src/shell-runner/types.js';

function makeFakeHandle(
  id: string,
  mode: Exclude<ShellMode, 'auto'> = 'bg',
): ShellHandle {
  return {
    id,
    mode,
    status: 'running',
    bookmark: { row: 0, col: 0, ts: 0, bytes: 0 },
    kill: () => {},
    background: () => false,
    promote: () => false,
    write: () => {},
    resize: () => {},
    onChunk: () => () => {},
    onBoundary: () => () => {},
    onStatus: () => () => {},
    result: Promise.resolve({
      stdout: { text: '' },
      stderr: { text: '' },
      aggregated: { text: '' },
      durationMs: 0,
      timedOut: false,
      interrupted: false,
      truncated: false,
      outcome: 'exit',
    }),
  };
}

function setup(): { shellRegistry: ShellRegistry; surfaceRegistry: ReturnType<typeof createSurfaceRegistry> } {
  return {
    shellRegistry: createShellRegistry({
      // Disable auto-bg + bg-ttl timers so the fake handle doesn't
      // trigger setTimeout side-effects during the test.
      backgroundAfterMs: 10_000_000,
      bgTtlMs: 10_000_000,
      scheduler: {
        setTimeout: () => 0,
        clearTimeout: () => {},
      },
    }),
    surfaceRegistry: createSurfaceRegistry(),
  };
}

describe('B-10-α · ShellRegistry → SurfaceRegistry wiring', () => {
  test('register(bgHandle) mirrors as kind:"bg" entry', () => {
    const { shellRegistry, surfaceRegistry } = setup();
    const bind = wireShellRunnerSurface({ shellRegistry, surfaceRegistry });
    const handle = makeFakeHandle('bg-1', 'bg');
    shellRegistry.register(handle);
    const desc = surfaceRegistry.get({ kind: 'bg', bgId: 'bg-1' });
    expect(desc).toBeDefined();
    expect(desc!.kindTag).toBe('shell-bg');
    expect(desc!.visible).toBe(true);
    expect(bind.size()).toBe(1);
  });

  test('unregister(id) removes the mirrored entry', () => {
    const { shellRegistry, surfaceRegistry } = setup();
    const bind = wireShellRunnerSurface({ shellRegistry, surfaceRegistry });
    shellRegistry.register(makeFakeHandle('bg-2', 'bg'));
    expect(bind.size()).toBe(1);
    shellRegistry.unregister('bg-2');
    expect(surfaceRegistry.get({ kind: 'bg', bgId: 'bg-2' })).toBeUndefined();
    expect(bind.size()).toBe(0);
  });

  test('default filterModes ignores inline/modal/vw handles', () => {
    const { shellRegistry, surfaceRegistry } = setup();
    const bind = wireShellRunnerSurface({ shellRegistry, surfaceRegistry });
    shellRegistry.register(makeFakeHandle('in-1', 'inline'));
    shellRegistry.register(makeFakeHandle('md-1', 'modal'));
    shellRegistry.register(makeFakeHandle('vw-1', 'vw'));
    expect(bind.size()).toBe(0);
    expect(surfaceRegistry.listByKind('bg')).toHaveLength(0);
  });

  test('custom filterModes mirrors the listed modes', () => {
    const { shellRegistry, surfaceRegistry } = setup();
    const bind = wireShellRunnerSurface({
      shellRegistry,
      surfaceRegistry,
      filterModes: ['bg', 'inline'],
    });
    shellRegistry.register(makeFakeHandle('bg-3', 'bg'));
    shellRegistry.register(makeFakeHandle('in-2', 'inline'));
    shellRegistry.register(makeFakeHandle('vw-2', 'vw'));
    expect(bind.size()).toBe(2);
    expect(surfaceRegistry.listByKind('bg')).toHaveLength(2);
  });

  test('dispose() drops owned entries + stops receiving events', () => {
    const { shellRegistry, surfaceRegistry } = setup();
    const bind = wireShellRunnerSurface({ shellRegistry, surfaceRegistry });
    shellRegistry.register(makeFakeHandle('bg-4', 'bg'));
    expect(bind.size()).toBe(1);
    bind.dispose();
    expect(bind.size()).toBe(0);
    expect(surfaceRegistry.get({ kind: 'bg', bgId: 'bg-4' })).toBeUndefined();
    // Event after dispose must not re-register.
    shellRegistry.register(makeFakeHandle('bg-5', 'bg'));
    expect(bind.size()).toBe(0);
    expect(surfaceRegistry.get({ kind: 'bg', bgId: 'bg-5' })).toBeUndefined();
  });

  test('duplicate register is idempotent — owned.size stays 1', () => {
    const { shellRegistry, surfaceRegistry } = setup();
    const bind = wireShellRunnerSurface({ shellRegistry, surfaceRegistry });
    const h = makeFakeHandle('bg-6', 'bg');
    shellRegistry.register(h);
    // ShellRegistry.register is itself idempotent (entries.has check),
    // so the second call doesn't emit again. Still — assert the bridge
    // doesn't double-register if it ever did.
    shellRegistry.register(h);
    expect(bind.size()).toBe(1);
    expect(surfaceRegistry.listByKind('bg')).toHaveLength(1);
  });
});
