import { describe, expect, test } from 'bun:test';

import { registerMcpClients } from '../src/nexus/boot/register-mcp-clients.js';

interface CapturedLogger {
  info(line: string): void;
  warn(line: string): void;
  infos: string[];
  warns: string[];
}

function makeLogger(): CapturedLogger {
  const infos: string[] = [];
  const warns: string[] = [];
  return {
    info: (s) => infos.push(s),
    warn: (s) => warns.push(s),
    infos,
    warns,
  };
}

function syncTimer(): {
  setTimeoutFn: (cb: () => void, ms: number) => { unref?(): void };
  clearTimeoutFn: (h: { unref?(): void }) => void;
  fire: () => void;
} {
  const pending: Array<() => void> = [];
  return {
    setTimeoutFn: (cb) => {
      pending.push(cb);
      return { unref: () => {} };
    },
    clearTimeoutFn: () => { pending.length = 0; },
    fire: () => {
      for (const cb of pending.splice(0)) cb();
    },
  };
}

describe('registerMcpClients — handshake timeout guard', () => {
  test('start() hangs → timeout fires → status "failed" + reason carries label', async () => {
    const logger = makeLogger();
    const timer = syncTimer();
    let disposed = false;
    const p = registerMcpClients({
      servers: [{ id: 'hung-server', transport: 'stdio', command: ['fake'] }],
      logger,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      registerRuntime: () => {},
      createClient: () => ({
        start: () => new Promise(() => { /* never resolves */ }),
        listTools: async () => [],
        callTool: async () => ({ content: [] }),
        dispose: async () => { disposed = true; },
      }),
    });
    // Let registerMcpClients enter `await withTimeout(...)` and arm
    // the synthetic timer, then fire it.
    await new Promise<void>((r) => setTimeout(r, 5));
    timer.fire();
    const handle = await p;
    expect(handle.perServer['hung-server']!.status).toBe('failed');
    expect(handle.perServer['hung-server']!.reason).toContain('timeout');
    expect(logger.warns.some((w) => w.includes('failed to start: hung-server'))).toBe(true);
    expect(disposed).toBe(true); // hung child was disposed
  });

  test('listTools() hangs → timeout fires after start() succeeds', async () => {
    const logger = makeLogger();
    const timer = syncTimer();
    const p = registerMcpClients({
      servers: [{ id: 'slow-list', transport: 'stdio', command: ['fake'] }],
      logger,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      registerRuntime: () => {},
      createClient: () => ({
        start: async () => { /* fast handshake */ },
        listTools: () => new Promise(() => { /* never resolves */ }),
        callTool: async () => ({ content: [] }),
        dispose: async () => {},
      }),
    });
    await new Promise<void>((r) => setTimeout(r, 5));
    timer.fire();
    const handle = await p;
    expect(handle.perServer['slow-list']!.status).toBe('failed');
    expect(handle.perServer['slow-list']!.reason).toContain('listTools-timeout');
  });

  test('healthy server with no hang → status "ready", timeout never fires', async () => {
    const logger = makeLogger();
    let timeoutCleared = false;
    const handle = await registerMcpClients({
      servers: [{ id: 'fast-server', transport: 'stdio', command: ['fake'] }],
      logger,
      setTimeoutFn: () => {
        // The healthy path never fires this — we just track that the
        // success-side `clearTimeoutFn` is invoked.
        return { unref: () => {} };
      },
      clearTimeoutFn: () => { timeoutCleared = true; },
      registerRuntime: () => {},
      createClient: () => ({
        start: async () => {},
        listTools: async () => [
          { name: 'foo', description: 'd', inputSchema: { type: 'object' } },
        ],
        callTool: async () => ({ content: [] }),
        dispose: async () => {},
      }),
    });
    expect(handle.perServer['fast-server']!.status).toBe('ready');
    expect(handle.registered).toBe(1);
    expect(timeoutCleared).toBe(true); // cleared on success path
  });

  test('one server hangs, another is fast → daemon still gets the healthy tools', async () => {
    const logger = makeLogger();
    const timer = syncTimer();
    let registeredCount = 0;
    const p = registerMcpClients({
      servers: [
        { id: 'hangs', transport: 'stdio', command: ['hangs'] },
        { id: 'works', transport: 'stdio', command: ['works'] },
      ],
      logger,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      registerRuntime: () => { registeredCount += 1; },
      createClient: (spec) => spec.id === 'hangs'
        ? {
          start: () => new Promise(() => {}),
          listTools: async () => [],
          callTool: async () => ({ content: [] }),
          dispose: async () => {},
        }
        : {
          start: async () => {},
          listTools: async () => [
            { name: 'tool-a', description: 'a', inputSchema: { type: 'object' } },
          ],
          callTool: async () => ({ content: [] }),
          dispose: async () => {},
        },
    });
    // Hung server first — let registerMcpClients arm the timer, then
    // fire it so the catch runs and the loop advances to 'works'.
    await new Promise<void>((r) => setTimeout(r, 5));
    timer.fire();
    const handle = await p;
    expect(handle.perServer['hangs']!.status).toBe('failed');
    expect(handle.perServer['works']!.status).toBe('ready');
    expect(registeredCount).toBe(1);
  });

  test('http transport reaches createClient with url and registers tools', async () => {
    const logger = makeLogger();
    const seen: string[] = [];
    const handle = await registerMcpClients({
      servers: [{ id: 'remote', transport: 'http', url: 'https://mcp.example.com' }],
      logger,
      handshakeTimeoutMs: 0,
      registerRuntime: () => {},
      createClient: (spec) => {
        seen.push(spec.transport === 'http' ? spec.url : spec.id);
        return {
          start: async () => {},
          listTools: async () => [
            { name: 'remote-tool', description: 'r', inputSchema: { type: 'object' } },
          ],
          callTool: async () => ({ content: [] }),
          dispose: async () => {},
        };
      },
    });
    expect(seen).toEqual(['https://mcp.example.com']);
    expect(handle.perServer['remote']!.status).toBe('ready');
    expect(handle.perServer['remote']!.toolCount).toBe(1);
    expect(handle.registered).toBe(1);
  });

  test('http next to stdio: both reach createClient and come up ready', async () => {
    const logger = makeLogger();
    const spawned: string[] = [];
    const handle = await registerMcpClients({
      servers: [
        { id: 'remote', transport: 'http', url: 'https://mcp.example.com' },
        { id: 'local', transport: 'stdio', command: ['fake'] },
      ],
      logger,
      handshakeTimeoutMs: 0,
      registerRuntime: () => {},
      createClient: (spec) => {
        spawned.push(spec.id);
        return {
          start: async () => {},
          listTools: async () => [
            { name: 'tool-a', description: 'a', inputSchema: { type: 'object' } },
          ],
          callTool: async () => ({ content: [] }),
          dispose: async () => {},
        };
      },
    });
    expect(spawned).toEqual(['remote', 'local']);
    expect(handle.perServer['remote']!.status).toBe('ready');
    expect(handle.perServer['local']!.status).toBe('ready');
    expect(handle.registered).toBe(2);
  });

  test('disabled http is skipped without a spawn attempt', async () => {
    let spawnAttempts = 0;
    const handle = await registerMcpClients({
      servers: [{
        id: 'remote',
        transport: 'http',
        url: 'https://mcp.example.com',
        enabled: false,
      }],
      logger: makeLogger(),
      handshakeTimeoutMs: 0,
      registerRuntime: () => {},
      createClient: () => {
        spawnAttempts += 1;
        return {
          start: async () => {},
          listTools: async () => [],
          callTool: async () => ({ content: [] }),
          dispose: async () => {},
        };
      },
    });
    expect(spawnAttempts).toBe(0);
    expect(handle.perServer['remote']!.status).toBe('disabled');
  });

  test('handshakeTimeoutMs=0 disables the bound (returns whatever start() does)', async () => {
    const logger = makeLogger();
    const handle = await registerMcpClients({
      servers: [{ id: 'no-bound', transport: 'stdio', command: ['fake'] }],
      logger,
      handshakeTimeoutMs: 0,
      registerRuntime: () => {},
      createClient: () => ({
        start: async () => {},
        listTools: async () => [],
        callTool: async () => ({ content: [] }),
        dispose: async () => {},
      }),
    });
    expect(handle.perServer['no-bound']!.status).toBe('ready');
  });
});
