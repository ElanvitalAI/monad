import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runNexus } from '../src/nexus/index.js';
import type { NexusHttpServerOpts } from '../src/nexus/api/http-server.js';
import type { McpClientsHandle } from '../src/nexus/boot/register-mcp-clients.js';
import { setTestStateRoot } from '../src/nexus/paths.js';

let stateRoot: string;

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), 'elanous-nexus-mcp-reload-'));
  setTestStateRoot(stateRoot);
});

afterEach(() => {
  setTestStateRoot(null);
  rmSync(stateRoot, { recursive: true, force: true });
});

test('runNexus wires MCP reload through config reload, shutdown, and re-registration', async () => {
  const events: string[] = [];
  const initial: McpClientsHandle = {
    clients: [], registered: 1, perServer: { initial: { status: 'ready', toolCount: 1 } },
    shutdown: async () => { events.push('shutdown:initial'); },
  };
  const firstReload: McpClientsHandle = {
    clients: [], registered: 2, perServer: { first: { status: 'ready', toolCount: 2 } },
    shutdown: async () => { events.push('shutdown:first'); },
  };
  const secondReload: McpClientsHandle = {
    clients: [], registered: 3, perServer: { second: { status: 'failed', toolCount: 0, reason: 'offline' } },
    shutdown: async () => { events.push('shutdown:second'); },
  };
  const configs = [
    {
      mcp: {
        handshakeTimeoutMs: 8_000,
        servers: [{ id: 'initial', transport: 'stdio', command: ['initial'], handshakeTimeoutMs: 500 }],
      },
    },
    {
      mcp: {
        handshakeTimeoutMs: 6_000,
        servers: [{ id: 'first', transport: 'http', url: 'https://first.example.test', handshakeTimeoutMs: 750 }],
      },
    },
    {
      mcp: {
        handshakeTimeoutMs: 4_000,
        servers: [{ id: 'second', transport: 'stdio', command: ['second'], handshakeTimeoutMs: 1_000 }],
      },
    },
  ];
  let reloadConfigIndex = 1;
  let captured: NexusHttpServerOpts | undefined;
  const registered: Array<{ servers: unknown[]; handshakeTimeoutMs: number | undefined }> = [];
  const handles = [initial, firstReload, secondReload];

  const nexus = await runNexus({
    detachForTesting: true,
    skipHttpServer: false,
    skipSupervisor: true,
    skipRuntimeApi: true,
    skipPushcutChannel: true,
    skipPwaChannel: true,
    skipTelegramChannel: true,
    skipTerminalChannel: true,
    skipDiscordChannel: true,
    skipIntentPrediction: true,
    skipEnvMigration: true,
    skipRestoreFromPending: true,
    registerDaemonTab: false,
    registerSettingsTab: false,
    startNexusHttpServerFn: ((opts: NexusHttpServerOpts) => {
      captured = opts;
      return { port: 31415, stop: () => {} } as never;
    }) as typeof import('../src/nexus/api/http-server.js').startNexusHttpServer,
    getMcpUserConfigForTesting: () => configs[0] as never,
    reloadUserConfigForTesting: () => {
      events.push('reload-config');
      return configs[reloadConfigIndex++] as never;
    },
    registerMcpClientsFn: async ({ servers, handshakeTimeoutMs }) => {
      events.push(`register:${servers[0]?.id}`);
      registered.push({ servers, handshakeTimeoutMs });
      return handles.shift()!;
    },
  });

  try {
    expect(captured?.reloadMcpClients).toBeDefined();
    expect(events).toEqual(['register:initial']);
    const first = await captured!.reloadMcpClients!();
    expect(events).toEqual(['register:initial', 'reload-config', 'shutdown:initial', 'register:first']);
    expect(registered).toEqual([
      {
        servers: [{ id: 'initial', transport: 'stdio', command: ['initial'], handshakeTimeoutMs: 500 }],
        handshakeTimeoutMs: 8_000,
      },
      {
        servers: [{ id: 'first', transport: 'http', url: 'https://first.example.test', handshakeTimeoutMs: 750 }],
        handshakeTimeoutMs: 6_000,
      },
    ]);
    expect(first).toEqual({
      reloaded: true,
      registered: 2,
      perServer: { first: { status: 'ready', toolCount: 2 } },
    });

    const second = await captured!.reloadMcpClients!();
    expect(events).toEqual([
      'register:initial', 'reload-config', 'shutdown:initial', 'register:first',
      'reload-config', 'shutdown:first', 'register:second',
    ]);
    expect(registered).toEqual([
      {
        servers: [{ id: 'initial', transport: 'stdio', command: ['initial'], handshakeTimeoutMs: 500 }],
        handshakeTimeoutMs: 8_000,
      },
      {
        servers: [{ id: 'first', transport: 'http', url: 'https://first.example.test', handshakeTimeoutMs: 750 }],
        handshakeTimeoutMs: 6_000,
      },
      {
        servers: [{ id: 'second', transport: 'stdio', command: ['second'], handshakeTimeoutMs: 1_000 }],
        handshakeTimeoutMs: 4_000,
      },
    ]);
    expect(second).toEqual({
      reloaded: true,
      registered: 3,
      perServer: { second: { status: 'failed', toolCount: 0, reason: 'offline' } },
    });
  } finally {
    await nexus?.release();
  }
});
