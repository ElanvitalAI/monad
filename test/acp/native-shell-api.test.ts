// ── B (H1) (Phase 4 Bundle 2) — native-shell-api tests ──

import { describe, expect, test } from 'bun:test';
import {
  createAcpNativeShellHandlers,
  bindAcpShellMethods,
  ACP_SHELL_RPC_METHODS,
} from '../../src/acp/native-shell-api';
import type { ShellHandle, ShellRegistry } from '../../src/shell-runner/types';

function fakeRegistry(handles: ShellHandle[] = []): ShellRegistry {
  return {
    register: () => {},
    unregister: () => {},
    get: (id: string) => handles.find((h) => h.id === id) ?? null,
    list: () => handles,
    findVwRunner: () => null,
    getVwLabel: () => null,
    subscribe: () => () => {},
    attachSurface: () => () => {},
    describePosture: () => null,
    listWithPosture: () => [],
    subscribePosture: () => () => {},
  } as unknown as ShellRegistry;
}

function fakeHandle(id: string, mode: 'vw' | 'inline' | 'bg' | 'modal' = 'vw'): ShellHandle {
  return { id, mode, status: 'running' } as unknown as ShellHandle;
}

describe('ACP_SHELL_RPC_METHODS namespace', () => {
  test('all methods use acp/shell prefix', () => {
    expect(ACP_SHELL_RPC_METHODS.spawn).toBe('acp/shell.spawn');
    expect(ACP_SHELL_RPC_METHODS.list).toBe('acp/shell.list');
    expect(ACP_SHELL_RPC_METHODS.capabilities).toBe('acp/shell.capabilities');
  });
});

describe('capabilities()', () => {
  test('returns server descriptor', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      serverName: 'elanous',
      serverVersion: '1.0.0',
    });
    const cap = await handlers.capabilities();
    expect(cap.serverName).toBe('elanous');
    expect(cap.serverVersion).toBe('1.0.0');
    expect(cap.supportedActions).toContain('spawn');
    expect(cap.supportedModes).toContain('vw');
    expect(cap.maxReadBytes).toBeGreaterThan(0);
  });

  test('defaultCapabilities override', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      serverName: 'elanous',
      defaultCapabilities: {
        supportedModes: ['vw'],
        streamingSupported: true,
        maxReadBytes: 64 * 1024,
      },
    });
    const cap = await handlers.capabilities();
    expect(cap.supportedModes).toEqual(['vw']);
    expect(cap.streamingSupported).toBe(true);
    expect(cap.maxReadBytes).toBe(65536);
  });
});

describe('list()', () => {
  test('lists all handles by default', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry([fakeHandle('a'), fakeHandle('b'), fakeHandle('c')]),
      spawnShell: async () => null,
      serverName: 'm',
    });
    const r = await handlers.list({});
    expect(r.entries.map((e) => e.shellId)).toEqual(['a', 'b', 'c']);
    expect(r.nextCursor).toBeUndefined();
  });

  test('limit + nextCursor pagination', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry([
        fakeHandle('a'), fakeHandle('b'), fakeHandle('c'), fakeHandle('d'), fakeHandle('e'),
      ]),
      spawnShell: async () => null,
      serverName: 'm',
    });
    const r1 = await handlers.list({ limit: 2 });
    expect(r1.entries.map((e) => e.shellId)).toEqual(['a', 'b']);
    expect(r1.nextCursor).toBe('2');
    const r2 = await handlers.list({ limit: 2, cursor: r1.nextCursor });
    expect(r2.entries.map((e) => e.shellId)).toEqual(['c', 'd']);
    expect(r2.nextCursor).toBe('4');
    const r3 = await handlers.list({ limit: 2, cursor: r2.nextCursor });
    expect(r3.entries.map((e) => e.shellId)).toEqual(['e']);
    expect(r3.nextCursor).toBeUndefined();
  });

  test('statusFilter excludes non-matching', async () => {
    const h1 = fakeHandle('a');
    const h2 = { ...fakeHandle('b'), status: 'completed' } as ShellHandle;
    const h3 = fakeHandle('c');
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry([h1, h2, h3]),
      spawnShell: async () => null,
      serverName: 'm',
    });
    const r = await handlers.list({ statusFilter: 'completed' });
    expect(r.entries.map((e) => e.shellId)).toEqual(['b']);
  });
});

describe('bindAcpShellMethods', () => {
  test('returns handler map keyed by method name', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      serverName: 'm',
    });
    const map = bindAcpShellMethods(handlers);
    expect(typeof map['acp/shell.spawn']).toBe('function');
    expect(typeof map['acp/shell.list']).toBe('function');
    expect(typeof map['acp/shell.capabilities']).toBe('function');
    // Capabilities call
    const cap = await map['acp/shell.capabilities']!({}) as { serverName: string };
    expect(cap.serverName).toBe('m');
  });

  test('list method dispatches to handlers.list', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry([fakeHandle('a')]),
      spawnShell: async () => null,
      serverName: 'm',
    });
    const map = bindAcpShellMethods(handlers);
    const r = await map['acp/shell.list']!({}) as { entries: { shellId: string }[] };
    expect(r.entries[0]!.shellId).toBe('a');
  });
});

describe('A1 method passthrough', () => {
  test('B handlers include A1 spawn/write/read/close', async () => {
    const handlers = createAcpNativeShellHandlers({
      registry: fakeRegistry(),
      spawnShell: async () => null,
      serverName: 'm',
      policyGate: () => true,  // allow all for test
    });
    expect(typeof handlers.spawn).toBe('function');
    expect(typeof handlers.write).toBe('function');
    expect(typeof handlers.read).toBe('function');
    expect(typeof handlers.close).toBe('function');
  });
});
