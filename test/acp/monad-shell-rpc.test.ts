// ── A1 (Phase 2 Bundle 3) — monad-shell-rpc tests ──

import { describe, expect, test } from 'bun:test';
import {
  createMonadShellRpcHandlers,
  ShellRpcDeniedError,
  ShellRpcNotFoundError,
  MONAD_SHELL_RPC_METHODS,
} from '../../src/acp/monad-shell-rpc';
import type {
  ShellHandle,
  ShellRegistry,
  ShellRequest,
  ShellResult,
} from '../../src/shell-runner/types';

function fakeHandle(opts: {
  id?: string;
  status?: 'running' | 'completed' | 'killed' | 'backgrounded';
  result?: ShellResult | Promise<ShellResult>;
  onWrite?: (bytes: string) => void;
  onKill?: (sig?: 'SIGTERM' | 'SIGKILL') => void;
} = {}): ShellHandle {
  return {
    id: opts.id ?? 's1',
    mode: 'vw',
    status: opts.status ?? 'running',
    result: opts.result instanceof Promise
      ? opts.result
      : opts.result
        ? Promise.resolve(opts.result)
        : new Promise(() => {}),
    write: (bytes: string) => opts.onWrite?.(bytes),
    kill: (sig?: 'SIGTERM' | 'SIGKILL') => opts.onKill?.(sig),
  } as unknown as ShellHandle;
}

function fakeRegistry(handles: Record<string, ShellHandle> = {}): ShellRegistry {
  return {
    register: () => {},
    unregister: () => {},
    get: (id: string) => handles[id] ?? null,
    list: () => [],
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => {},
    attachSurface: () => () => {},
    describePosture: () => null,
    listWithPosture: () => [],
    subscribePosture: () => () => {},
  } as unknown as ShellRegistry;
}

describe('METHODS constants', () => {
  test('exports namespaced JSON-RPC method names', () => {
    expect(MONAD_SHELL_RPC_METHODS).toEqual({
      spawn: 'monad/shell.spawn',
      write: 'monad/shell.write',
      read: 'monad/shell.read',
      close: 'monad/shell.close',
    });
  });
});

describe('spawn', () => {
  test('vw + non-interactive → allowed by default policy', async () => {
    let captured: ShellRequest | null = null;
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async (req) => {
        captured = req;
        return fakeHandle({ id: 'newshell' });
      },
    });
    const out = await h.spawn({ command: 'pwd' });
    expect(out.shellId).toBe('newshell');
    expect(captured!.command).toBe('pwd');
    expect(captured!.mode).toBe('vw');
  });

  test('interactive → denied by default policy', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle(),
    });
    await expect(h.spawn({ command: 'vim', interactive: true })).rejects.toBeInstanceOf(ShellRpcDeniedError);
  });

  test('mode=modal → denied by default policy', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle(),
    });
    await expect(h.spawn({ command: 'top', mode: 'modal' })).rejects.toBeInstanceOf(ShellRpcDeniedError);
  });

  test('custom policy can grant write + interactive', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle({ id: 'i1' }),
      policyGate: () => true,
    });
    const out = await h.spawn({ command: 'vim', interactive: true });
    expect(out.shellId).toBe('i1');
  });

  test('clientReqId echoes back', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => fakeHandle({ id: 's' }),
    });
    const out = await h.spawn({ command: 'pwd', clientReqId: 'req-123' });
    expect(out.clientReqId).toBe('req-123');
  });

  test('null spawn result → throws', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
    });
    await expect(h.spawn({ command: 'pwd' })).rejects.toThrow(/spawn failed/);
  });
});

describe('write', () => {
  test('default policy denies write', async () => {
    const handle = fakeHandle({ id: 's1' });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
    });
    await expect(h.write({ shellId: 's1', bytes: 'abc' })).rejects.toBeInstanceOf(ShellRpcDeniedError);
  });

  test('granted write forwards to handle.write', async () => {
    let written = '';
    const handle = fakeHandle({ id: 's1', onWrite: (b) => { written = b; } });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
      policyGate: () => true,
    });
    const out = await h.write({ shellId: 's1', bytes: 'hello' });
    expect(written).toBe('hello');
    expect(out.written).toBe(5);
  });

  test('unknown shell → ShellRpcNotFoundError', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      policyGate: () => true,
    });
    await expect(h.write({ shellId: 'gone', bytes: 'x' })).rejects.toBeInstanceOf(ShellRpcNotFoundError);
  });
});

describe('read', () => {
  test('settled result returns aggregated + result fields', async () => {
    const handle = fakeHandle({
      id: 's1',
      status: 'completed',
      result: {
        exitCode: 0,
        stdout: { text: '' },
        stderr: { text: '' },
        aggregated: { text: 'hello world' },
        durationMs: 50,
        timedOut: false,
        interrupted: false,
        truncated: false,
        outcome: 'exit',
      } as ShellResult,
    });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
    });
    const out = await h.read({ shellId: 's1' });
    expect(out.status).toBe('completed');
    expect(out.aggregated).toBe('hello world');
    expect(out.truncated).toBe(false);
    expect(out.result?.exitCode).toBe(0);
    expect(out.result?.outcome).toBe('exit');
  });

  test('large output trimmed with head + tail', async () => {
    const long = 'x'.repeat(100);
    const handle = fakeHandle({
      id: 's1',
      status: 'completed',
      result: {
        stdout: { text: '' },
        stderr: { text: '' },
        aggregated: { text: long },
        durationMs: 0,
        timedOut: false,
        interrupted: false,
        truncated: false,
        outcome: 'exit',
      } as ShellResult,
    });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
    });
    const out = await h.read({ shellId: 's1', maxBytes: 20 });
    expect(out.truncated).toBe(true);
    expect(out.aggregated).toContain('…');
  });

  test('unknown shell → ShellRpcNotFoundError', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
    });
    await expect(h.read({ shellId: 'gone' })).rejects.toBeInstanceOf(ShellRpcNotFoundError);
  });
});

describe('close', () => {
  test('default policy denies close', async () => {
    const handle = fakeHandle({ id: 's1' });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
    });
    await expect(h.close({ shellId: 's1' })).rejects.toBeInstanceOf(ShellRpcDeniedError);
  });

  test('granted close forwards kill signal', async () => {
    let killed: 'SIGTERM' | 'SIGKILL' | undefined = undefined;
    const handle = fakeHandle({ id: 's1', onKill: (sig) => { killed = sig; } });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
      policyGate: () => true,
    });
    const out = await h.close({ shellId: 's1', signal: 'SIGKILL' });
    expect(out.closed).toBe(true);
    expect(killed).toBe('SIGKILL');
  });

  test('default kill signal is SIGTERM', async () => {
    let killed: 'SIGTERM' | 'SIGKILL' | undefined = undefined;
    const handle = fakeHandle({ id: 's1', onKill: (sig) => { killed = sig; } });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
      policyGate: () => true,
    });
    await h.close({ shellId: 's1' });
    expect(killed).toBe('SIGTERM');
  });

  test('unknown shell → returns closed=false (not throw)', async () => {
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      policyGate: () => true,
    });
    const out = await h.close({ shellId: 'gone' });
    expect(out.closed).toBe(false);
  });

  test('handle.kill throws → returns closed=false (graceful)', async () => {
    const handle = fakeHandle({ id: 's1', onKill: () => { throw new Error('boom'); } });
    const h = createMonadShellRpcHandlers({
      registry: fakeRegistry({ s1: handle }),
      spawnShell: async () => null,
      policyGate: () => true,
    });
    const out = await h.close({ shellId: 's1' });
    expect(out.closed).toBe(false);
  });
});
