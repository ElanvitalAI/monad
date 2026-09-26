import { describe, expect, test } from 'bun:test';

import { registerMcpClients } from './register-mcp-clients.js';

const stdioServer = (id: string, handshakeTimeoutMs?: number) => ({
  id,
  transport: 'stdio' as const,
  command: ['fake'],
  ...(handshakeTimeoutMs === undefined ? {} : { handshakeTimeoutMs }),
});

const successfulClient = () => ({
  start: async () => {},
  listTools: async () => [],
  callTool: async () => ({ content: [] }),
  dispose: async () => {},
});

describe('registerMcpClients handshake timeout configuration', () => {
  test('uses server override, then global value, then the unchanged 8000ms default', async () => {
    const observed: number[] = [];
    const handle = await registerMcpClients({
      servers: [stdioServer('default'), stdioServer('global'), stdioServer('server', 13)],
      handshakeTimeoutMs: 7,
      createClient: successfulClient,
      logger: { info: () => {}, warn: () => {} },
      setTimeoutFn: (callback, ms) => {
        observed.push(ms);
        return setTimeout(callback, ms);
      },
      clearTimeoutFn: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });

    expect(observed).toEqual([7, 7, 7, 7, 13, 13]);
    await handle.shutdown();

    const defaults: number[] = [];
    const defaultHandle = await registerMcpClients({
      servers: [stdioServer('default')],
      createClient: successfulClient,
      logger: { info: () => {}, warn: () => {} },
      setTimeoutFn: (callback, ms) => {
        defaults.push(ms);
        return setTimeout(callback, ms);
      },
      clearTimeoutFn: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
    expect(defaults).toEqual([8000, 8000]);
    await defaultHandle.shutdown();
  });

  test('skips a timed-out server, registers a healthy peer, and tells the user how to recover', async () => {
    const warnings: string[] = [];
    const handle = await registerMcpClients({
      servers: [stdioServer('slow', 1), stdioServer('healthy')],
      createClient: (spec) => spec.id === 'slow'
        ? {
            start: () => new Promise<void>(() => {}),
            listTools: async () => [],
            callTool: async () => ({ content: [] }),
            dispose: async () => {},
          }
        : successfulClient(),
      logger: { info: () => {}, warn: (line) => warnings.push(line) },
    });

    expect(handle.perServer.slow).toMatchObject({ status: 'failed' });
    expect(handle.perServer.healthy).toEqual({ status: 'ready', toolCount: 0 });
    expect(warnings).toContainEqual(expect.stringContaining('slow was excluded after its 1ms handshake timeout'));
    expect(warnings).toContainEqual(expect.stringContaining('raise mcp.handshakeTimeoutMs or mcp.servers[].handshakeTimeoutMs, then run elanous mcp reload'));
    await handle.shutdown();
  });
});
