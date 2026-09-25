// ── V4 registry event-bus tests ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  startPty, onPtyEvent, emitPtyEvent, unregisterPty, killNonDetached,
  setPtyAdapterForTesting, resetForTesting, type PtyEvent,
} from '../src/pty-shell/registry';

type FakePty = {
  pid: number;
  write: (s: string) => void;
  kill: (signal?: string) => void;
  onData: (cb: (d: string) => void) => { dispose: () => void };
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void };
  _emit: (chunk: string) => void;
  _exit: (code: number, sig?: number) => void;
};

function installFakeAdapter(): () => FakePty[] {
  const handles: FakePty[] = [];
  setPtyAdapterForTesting(() => {
    let onData: ((d: string) => void) | null = null;
    let onExit: ((e: { exitCode: number; signal?: number }) => void) | null = null;
    const fake: FakePty = {
      pid: Math.floor(Math.random() * 1e6),
      write: () => {},
      kill: () => { onExit?.({ exitCode: 0 }); },
      onData(cb) { onData = cb; return { dispose: () => { onData = null; } }; },
      onExit(cb) { onExit = cb; return { dispose: () => { onExit = null; } }; },
      _emit: (c) => onData?.(c),
      _exit: (code, sig) => onExit?.({ exitCode: code, signal: sig }),
    };
    handles.push(fake);
    return fake;
  });
  return () => handles;
}

describe('PTY registry event bus (V4)', () => {
  let adapters: () => FakePty[];

  beforeEach(() => {
    resetForTesting();
    adapters = installFakeAdapter();
  });

  afterEach(() => {
    resetForTesting();
    setPtyAdapterForTesting(null);
  });

  test('spawned emitted on startPty', () => {
    const events: PtyEvent[] = [];
    onPtyEvent(ev => events.push(ev));
    const h = startPty({ cmd: 'true' });
    expect(events.find(e => e.type === 'spawned' && e.id === h.id)).toBeTruthy();
  });

  test('accepts a canonical preallocated id only for its requested kind', () => {
    expect(startPty({ cmd: 'true', kind: 'codex', id: 'codex_deadbeef' }).id).toBe('codex_deadbeef');
    expect(() => startPty({ cmd: 'true', kind: 'codex', id: 'codex_not-hex' })).toThrow('invalid preallocated PTY id');
    expect(() => startPty({ cmd: 'true', kind: 'codex', id: 'self_deadbeef' })).toThrow('invalid preallocated PTY id');
  });

  test('keeps the unspecified id path as the historical generated-id flow', () => {
    const first = startPty({ cmd: 'true', kind: 'codex' });
    const second = startPty({ cmd: 'true', kind: 'codex' });
    expect(first.id).toMatch(/^codex_[0-9a-f]{8}$/);
    expect(second.id).toMatch(/^codex_[0-9a-f]{8}$/);
    expect(second.id).not.toBe(first.id);
  });

  test('output emitted with chunk bytes', () => {
    const chunks: string[] = [];
    onPtyEvent(ev => { if (ev.type === 'output') chunks.push(ev.chunk); });
    const h = startPty({ cmd: 'cat' });
    const fake = adapters()[0]!;
    fake._emit('hello');
    fake._emit('!\n');
    expect(chunks).toEqual(['hello', '!\n']);
    // Snapshot also captured the output.
    expect(h.snapshot()).toBe('hello!\n');
  });

  test('exit event carries exitCode + signal', () => {
    const exits: Array<{ id: string; exitCode: number; signal?: number }> = [];
    onPtyEvent(ev => {
      if (ev.type === 'exit') exits.push({ id: ev.id, exitCode: ev.exitCode, signal: ev.signal });
    });
    const h = startPty({ cmd: 'true' });
    adapters()[0]!._exit(42, 15);
    expect(exits).toHaveLength(1);
    expect(exits[0]!.id).toBe(h.id);
    expect(exits[0]!.exitCode).toBe(42);
    expect(exits[0]!.signal).toBe(15);
  });

  test('unregistered emits when unregisterPty drops the handle', () => {
    const events: PtyEvent[] = [];
    onPtyEvent(ev => events.push(ev));
    const h = startPty({ cmd: 'true' });
    unregisterPty(h.id);
    expect(events.find(e => e.type === 'unregistered' && e.id === h.id)).toBeTruthy();
  });

  test('unregistered NOT emitted when id was already gone', () => {
    const events: PtyEvent[] = [];
    onPtyEvent(ev => events.push(ev));
    unregisterPty('pty_nope');
    expect(events).toHaveLength(0);
  });

  test('killNonDetached emits unregistered per killed handle', () => {
    const events: PtyEvent[] = [];
    onPtyEvent(ev => { if (ev.type === 'unregistered') events.push(ev); });
    const h1 = startPty({ cmd: 'sleep 99' });
    const h2 = startPty({ cmd: 'sleep 99', detach: true });
    killNonDetached();
    const ids = events.map(e => (e as { id: string }).id);
    expect(ids).toContain(h1.id);
    expect(ids).not.toContain(h2.id);
  });

  test('unsubscribe stops delivery', () => {
    const events: PtyEvent[] = [];
    const unsub = onPtyEvent(ev => events.push(ev));
    unsub();
    startPty({ cmd: 'true' });
    expect(events).toHaveLength(0);
  });

  test('throwing listener does not break the emit loop', () => {
    const delivered: string[] = [];
    onPtyEvent(() => { throw new Error('boom'); });
    onPtyEvent(ev => { if (ev.type === 'spawned') delivered.push(ev.id); });
    const h = startPty({ cmd: 'true' });
    expect(delivered).toEqual([h.id]);
  });

  test('emitPtyEvent is exported for V5 watchdog callers', () => {
    const events: PtyEvent[] = [];
    onPtyEvent(ev => events.push(ev));
    emitPtyEvent({ type: 'stalled', id: 'pty_fake', silentMs: 60000 });
    expect(events).toEqual([{ type: 'stalled', id: 'pty_fake', silentMs: 60000 }]);
  });

  test('resetForTesting clears listeners', () => {
    const events: PtyEvent[] = [];
    onPtyEvent(ev => events.push(ev));
    resetForTesting();
    startPty({ cmd: 'true' });
    expect(events).toHaveLength(0);
  });
});
