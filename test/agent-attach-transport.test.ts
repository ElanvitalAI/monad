// H5 Phase 1 Step F · attachTransports tests (hybrid multi-transport).

import { describe, test, expect, mock } from 'bun:test';
import { attachTransports } from '../src/agent/attach-transport.js';
import type { EmbodiedAgentSession } from '../src/agent/embodiment.js';

function makeBaseSession(): EmbodiedAgentSession {
  const fn = {
    send: mock(async () => {}),
    interrupt: mock(async () => {}),
    snapshot: mock(async () => 'snap'),
    dispose: mock(async () => {}),
  };
  return {
    id: 'sess-base',
    launchSpec: { brand: 'codex-app-server', mode: 'pty-direct' },
    transports: Object.freeze([
      Object.freeze({ kind: 'pty' as const, id: 'pty-xyz', label: 'codex-pty' }),
    ]),
    state: () => ({ status: 'running', startedAt: 0 }),
    send: fn.send,
    interrupt: fn.interrupt,
    snapshot: fn.snapshot,
    dispose: fn.dispose,
  };
}

describe('attachTransports', () => {
  test('no additions · returns original session reference', () => {
    const base = makeBaseSession();
    expect(attachTransports(base, [])).toBe(base);
  });

  test('appends additional transports after originals', () => {
    const base = makeBaseSession();
    const merged = attachTransports(base, [
      { kind: 'acp', id: 'acp-1', label: 'codex-sdk' },
      { kind: 'rpc', id: 'rpc-1', label: 'codex-app-server' },
    ]);
    expect(merged.transports.length).toBe(3);
    expect(merged.transports.map((t) => t.kind)).toEqual(['pty', 'acp', 'rpc']);
    expect(merged.transports[0]!.id).toBe('pty-xyz');
    expect(merged.transports[1]!.id).toBe('acp-1');
    expect(merged.transports[2]!.id).toBe('rpc-1');
  });

  test('preserves id + launchSpec + does NOT mutate base transports', () => {
    const base = makeBaseSession();
    const merged = attachTransports(base, [{ kind: 'socket', id: 's-1' }]);
    expect(merged.id).toBe(base.id);
    expect(merged.launchSpec).toEqual(base.launchSpec);
    // base stayed at 1
    expect(base.transports.length).toBe(1);
    expect(merged.transports.length).toBe(2);
  });

  test('lifecycle methods forward to base', async () => {
    const base = makeBaseSession();
    const merged = attachTransports(base, [{ kind: 'acp', id: 'a' }]);
    await merged.send('hello');
    await merged.interrupt('ctrl_c');
    const snap = await merged.snapshot();
    await merged.dispose();
    expect((base.send as ReturnType<typeof mock>).mock.calls[0]).toEqual(['hello']);
    expect((base.interrupt as ReturnType<typeof mock>).mock.calls[0]).toEqual(['ctrl_c']);
    expect(snap).toBe('snap');
    expect((base.dispose as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  test('state() forwards to base on each call', () => {
    const base = makeBaseSession();
    const merged = attachTransports(base, [{ kind: 'api', id: 'x' }]);
    expect(merged.state().status).toBe('running');
  });

  test('merged transports[] is frozen', () => {
    const base = makeBaseSession();
    const merged = attachTransports(base, [{ kind: 'rpc', id: 'r' }]);
    expect(Object.isFrozen(merged.transports)).toBe(true);
    expect(Object.isFrozen(merged.transports[1])).toBe(true);
  });

  test('hybrid smoke · PTY + ACP + RPC on same session', () => {
    // The canonical use: codex-app-server session with PTY (user-facing),
    // ACP (claude-code-acp / gemini), RPC (codex app-server).
    const base = makeBaseSession();
    const hybrid = attachTransports(base, [
      { kind: 'acp', id: 'acp-hybrid' },
      { kind: 'rpc', id: 'rpc-hybrid' },
    ]);
    const kinds = hybrid.transports.map((t) => t.kind);
    expect(kinds).toEqual(['pty', 'acp', 'rpc']);
  });
});
