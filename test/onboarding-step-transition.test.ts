// PR-Δ24 (Sprint 17 · 2026-04-30 · F11) — step transition animation tests.
//
// stepTransition prints a one-line "Step N → N+1" hint and pauses
// briefly so the user's eye latches onto the boundary. Auto-disables
// on mono profile, when the caller explicitly opts out, when the
// fadeMs is zero, or when MONAD_SETUP_TRANSITION_MS=0 in the env.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { stepTransition } from '../src/onboarding/transition';
import { scriptedIO } from '../src/onboarding';

function recordingSleep() {
  const calls: number[] = [];
  return {
    calls,
    sleep: async (ms: number) => { calls.push(ms); },
  };
}

// Tests pin MONAD_SETUP_TRANSITION_MS so a CI / local override (e.g.
// MONAD_SETUP_TRANSITION_MS=0 used by other suites to suppress the
// 60ms-per-step pause) doesn't flip the default-fade assertion.
let savedTransitionMs: string | undefined;
beforeEach(() => {
  savedTransitionMs = process.env.MONAD_SETUP_TRANSITION_MS;
  delete process.env.MONAD_SETUP_TRANSITION_MS;
});
afterEach(() => {
  if (savedTransitionMs === undefined) delete process.env.MONAD_SETUP_TRANSITION_MS;
  else process.env.MONAD_SETUP_TRANSITION_MS = savedTransitionMs;
});

describe('Δ24 · stepTransition', () => {
  test('prints transition hint + sleeps when on truecolor profile', async () => {
    const io = scriptedIO([]);
    const sleep = recordingSleep();
    await stepTransition(io, 1, 2, { profile: 'truecolor', sleep: sleep.sleep });
    const out = io.outputs.join('\n');
    expect(out).toContain('Step 1');
    expect(out).toContain('Step 2');
    expect(out).toContain('→');
    expect(sleep.calls).toEqual([60]);    // default fadeMs
  });

  test('mono profile auto-skips — no print, no sleep', async () => {
    const io = scriptedIO([]);
    const sleep = recordingSleep();
    await stepTransition(io, 1, 2, { profile: 'mono', sleep: sleep.sleep });
    expect(io.outputs).toEqual([]);
    expect(sleep.calls).toEqual([]);
  });

  test('opts.disable short-circuits even with valid profile', async () => {
    const io = scriptedIO([]);
    const sleep = recordingSleep();
    await stepTransition(io, 1, 2, { profile: 'truecolor', disable: true, sleep: sleep.sleep });
    expect(io.outputs).toEqual([]);
    expect(sleep.calls).toEqual([]);
  });

  test('fadeMs=0 skips entirely (no print, no sleep)', async () => {
    const io = scriptedIO([]);
    const sleep = recordingSleep();
    await stepTransition(io, 1, 2, { profile: 'truecolor', fadeMs: 0, sleep: sleep.sleep });
    expect(io.outputs).toEqual([]);
    expect(sleep.calls).toEqual([]);
  });

  test('fadeMs is clamped to [0, 1000]', async () => {
    const io = scriptedIO([]);
    const sleep = recordingSleep();
    await stepTransition(io, 1, 2, { profile: 'truecolor', fadeMs: 99999, sleep: sleep.sleep });
    expect(sleep.calls).toEqual([1000]);
  });

  test('explicit fadeMs overrides default', async () => {
    const io = scriptedIO([]);
    const sleep = recordingSleep();
    await stepTransition(io, 1, 2, { profile: 'truecolor', fadeMs: 200, sleep: sleep.sleep });
    expect(sleep.calls).toEqual([200]);
  });

  test('MONAD_SETUP_TRANSITION_MS env override is honored when fadeMs not set', async () => {
    const saved = process.env.MONAD_SETUP_TRANSITION_MS;
    process.env.MONAD_SETUP_TRANSITION_MS = '120';
    try {
      const io = scriptedIO([]);
      const sleep = recordingSleep();
      await stepTransition(io, 1, 2, { profile: 'truecolor', sleep: sleep.sleep });
      expect(sleep.calls).toEqual([120]);
    } finally {
      if (saved === undefined) delete process.env.MONAD_SETUP_TRANSITION_MS;
      else process.env.MONAD_SETUP_TRANSITION_MS = saved;
    }
  });

  test('explicit opts.fadeMs takes precedence over env', async () => {
    const saved = process.env.MONAD_SETUP_TRANSITION_MS;
    process.env.MONAD_SETUP_TRANSITION_MS = '500';
    try {
      const io = scriptedIO([]);
      const sleep = recordingSleep();
      await stepTransition(io, 1, 2, { profile: 'truecolor', fadeMs: 30, sleep: sleep.sleep });
      expect(sleep.calls).toEqual([30]);
    } finally {
      if (saved === undefined) delete process.env.MONAD_SETUP_TRANSITION_MS;
      else process.env.MONAD_SETUP_TRANSITION_MS = saved;
    }
  });
});
