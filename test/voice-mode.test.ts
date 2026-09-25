// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Voice mode state
// machine tests.
//
// Tested invariants:
//   1. State transitions: idle → active → recording → processing → active
//      → idle on Esc.
//   2. enter() is no-op when not in idle (no double-enter).
//   3. pressSpace only fires startCapture when in `active`.
//   4. releaseSpace only fires from `recording`.
//   5. transcribe completes → onTranscript fired → return to active.
//   6. Empty PCM (0 bytes) skips transcribe and returns to active.
//   7. Inactivity timer fires `exit('timeout')` from `active` only.
//   8. Esc from any non-idle state exits.
//   9. Capture failure surfaces via onError + falls back to active.
//  10. Kitty toggle: voice on enter, normal on exit.
//  11. installKittyCrashSafety installs handlers and the returned
//      cleanup uninstalls them.

import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  createVoiceMode,
  installKittyCrashSafety,
  type VoiceModeDeps,
} from '../src/voice/voice-mode.js';

// ── Test harness ────────────────────────────────────────────────────

interface Harness {
  startCapture: ReturnType<typeof mock>;
  stopCapture: ReturnType<typeof mock>;
  transcribe: ReturnType<typeof mock>;
  onTranscript: ReturnType<typeof mock>;
  onIndicator: ReturnType<typeof mock>;
  writeKitty: ReturnType<typeof mock>;
  onError: ReturnType<typeof mock>;
  pendingTimers: Array<{ cb: () => void; ms: number; id: number }>;
  fireTimer: (id: number) => void;
  fireAllTimers: () => void;
}

function makeHarness(): { deps: VoiceModeDeps; h: Harness } {
  let nextTimerId = 1;
  const pending: Harness['pendingTimers'] = [];
  // Default startCapture: invoke onData with a fake chunk and resolve true.
  const startCapture = mock(async (onData: (c: Buffer) => void, _onEnd: () => void) => {
    onData(Buffer.from([0x01, 0x02, 0x03, 0x04]));
    return true;
  });
  const stopCapture = mock(() => {});
  const transcribe = mock(async (_pcm: Buffer) => ({ text: 'hello world' }));
  const onTranscript = mock(async (_t: string) => {});
  const onIndicator = mock(() => {});
  const writeKitty = mock(() => {});
  const onError = mock(() => {});

  const setTimer = (cb: () => void, ms: number): number => {
    const id = nextTimerId++;
    pending.push({ cb, ms, id });
    return id;
  };
  const clearTimer = (id: unknown) => {
    const idx = pending.findIndex(p => p.id === id);
    if (idx >= 0) pending.splice(idx, 1);
  };

  const deps: VoiceModeDeps = {
    startCapture,
    stopCapture,
    transcribe,
    onTranscript,
    onIndicator,
    writeKitty,
    onError,
    inactivityMs: 1000,
    setTimer,
    clearTimer,
  };

  const h: Harness = {
    startCapture,
    stopCapture,
    transcribe,
    onTranscript,
    onIndicator,
    writeKitty,
    onError,
    pendingTimers: pending,
    fireTimer: id => {
      const idx = pending.findIndex(p => p.id === id);
      if (idx < 0) throw new Error(`timer ${id} not pending`);
      const { cb } = pending[idx]!;
      pending.splice(idx, 1);
      cb();
    },
    fireAllTimers: () => {
      while (pending.length) {
        const { cb } = pending.shift()!;
        cb();
      }
    },
  };

  return { deps, h };
}

// ── Wait for microtasks (transcribe is async) ───────────────────────

async function flush(): Promise<void> {
  // Two ticks: one for the await chain inside flushAndTranscribe,
  // one for the onTranscript callback.
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));
}

// ── Tests ───────────────────────────────────────────────────────────

describe('PR-S1V.4 · voice-mode state machine', () => {
  test('starts in idle', () => {
    const { deps } = makeHarness();
    const vm = createVoiceMode(deps);
    expect(vm.getState().kind).toBe('idle');
    vm.dispose();
  });

  test('enter() transitions idle → active + writes kitty voice + indicator on', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    expect(vm.getState().kind).toBe('active');
    expect(h.writeKitty).toHaveBeenCalledWith('voice');
    expect(h.onIndicator).toHaveBeenCalledWith(true, '🎙 Voice mode');
    vm.dispose();
  });

  test('double enter() is no-op', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    h.writeKitty.mockClear();
    vm.enter();
    expect(h.writeKitty).not.toHaveBeenCalled();
    vm.dispose();
  });

  test('pressSpace from active → recording + startCapture invoked', async () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    expect(vm.getState().kind).toBe('recording');
    expect(h.onIndicator).toHaveBeenLastCalledWith(true, '🔴 Recording');
    // startCapture is async but invoked synchronously.
    expect(h.startCapture).toHaveBeenCalledTimes(1);
    await flush();
    vm.dispose();
  });

  test('pressSpace ignored from idle', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.pressSpace();
    expect(vm.getState().kind).toBe('idle');
    expect(h.startCapture).not.toHaveBeenCalled();
    vm.dispose();
  });

  test('releaseSpace from recording → processing → active + onTranscript fired', async () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    await flush();
    vm.releaseSpace();
    expect(h.stopCapture).toHaveBeenCalledTimes(1);
    // After flush, transcribe completes and we return to active.
    await flush();
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    expect(h.onTranscript).toHaveBeenCalledWith('hello world');
    expect(vm.getState().kind).toBe('active');
    vm.dispose();
  });

  test('empty PCM (0 bytes captured) skips transcribe and returns to active', async () => {
    const { deps, h } = makeHarness();
    deps.startCapture = mock(async (_onData, _onEnd) => true); // no chunks emitted
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    await flush();
    vm.releaseSpace();
    await flush();
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(vm.getState().kind).toBe('active');
    vm.dispose();
  });

  test('Esc from active → idle + kitty normal restored', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    h.writeKitty.mockClear();
    vm.exit('esc');
    expect(vm.getState().kind).toBe('idle');
    expect(h.writeKitty).toHaveBeenCalledWith('normal');
    expect(h.onIndicator).toHaveBeenLastCalledWith(false);
    vm.dispose();
  });

  test('Esc during recording stops capture before exiting', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    h.stopCapture.mockClear();
    vm.exit('esc');
    expect(h.stopCapture).toHaveBeenCalledTimes(1);
    expect(vm.getState().kind).toBe('idle');
    vm.dispose();
  });

  test('inactivity timer fires only from active state', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    expect(h.pendingTimers.length).toBe(1);
    h.fireAllTimers();
    expect(vm.getState().kind).toBe('idle');
    vm.dispose();
  });

  test('inactivity timer does not fire while recording', async () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    await flush();
    // pressSpace clears the inactivity timer; the only remaining
    // pending timers (if any) are from setTimer outside our control.
    expect(vm.getState().kind).toBe('recording');
    expect(h.pendingTimers.length).toBe(0);
    vm.dispose();
  });

  test('capture failure surfaces via onError + falls back to active', async () => {
    const { deps, h } = makeHarness();
    deps.startCapture = mock(async () => false);
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    await flush();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(vm.getState().kind).toBe('active');
    vm.dispose();
  });

  test('transcribe error surfaces via onError + returns to active', async () => {
    const { deps, h } = makeHarness();
    deps.transcribe = mock(async () => {
      throw new Error('whisper down');
    });
    const vm = createVoiceMode(deps);
    vm.enter();
    vm.pressSpace();
    await flush();
    vm.releaseSpace();
    await flush();
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(vm.getState().kind).toBe('active');
    vm.dispose();
  });

  test('dispose is idempotent + restores kitty normal', () => {
    const { deps, h } = makeHarness();
    const vm = createVoiceMode(deps);
    vm.enter();
    h.writeKitty.mockClear();
    vm.dispose();
    expect(vm.getState().kind).toBe('idle');
    expect(h.writeKitty).toHaveBeenCalledWith('normal');
    vm.dispose(); // second call must not throw or re-invoke
    expect(h.writeKitty).toHaveBeenCalledTimes(1);
  });
});

describe('PR-S1V.4 · installKittyCrashSafety', () => {
  // Safe-guard: ensure no leaked listeners across tests.
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });

  test('install + uninstall via returned cleanup', () => {
    const writes: string[] = [];
    const writeKitty = (mode: 'normal' | 'voice') => {
      writes.push(mode);
    };
    const before = process.listenerCount('SIGINT');
    const uninstall = installKittyCrashSafety(writeKitty);
    cleanups.push(uninstall);
    const after = process.listenerCount('SIGINT');
    expect(after).toBe(before + 1);
    uninstall();
    cleanups.pop(); // already invoked
    expect(process.listenerCount('SIGINT')).toBe(before);
  });
});
