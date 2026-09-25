import { describe, expect, test } from 'bun:test';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';

const RELOAD_PATH = '/v1/nexus/admin/mcp-reload';
const BEARER = 'mcp-reload-test-token';

function fixture(reloadMcpClients?: () => Promise<{ reloaded: boolean; registered: number; perServer: Record<string, { status: 'ready'; toolCount: number }> }>) {
  const state = createNexusState({ nexusVersion: 'test', phase: 'mcp-reload-contract' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  return {
    state,
    eventBus,
    registry: new TabRegistry(state),
    metaApi: { bearerToken: BEARER, noAuth: false },
    ...(reloadMcpClients ? { reloadMcpClients } : {}),
    startPort: 58000 + Math.floor(Math.random() * 1000),
  };
}

describe('POST /v1/nexus/admin/mcp-reload', () => {
  test('rejects an unauthenticated request without invoking the reload callback', async () => {
    let calls = 0;
    const server = startNexusHttpServer(fixture(async () => {
      calls += 1;
      return { reloaded: true, registered: 1, perServer: { test: { status: 'ready', toolCount: 1 } } };
    }));
    try {
      const response = await fetch(`${server.url}${RELOAD_PATH}`, { method: 'POST' });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'unauthorized' });
      expect(calls).toBe(0);
    } finally {
      server.stop();
    }
  });

  test('invokes the injected callback and returns its outcome for an authenticated POST', async () => {
    const outcome = {
      reloaded: true,
      registered: 2,
      perServer: { alpha: { status: 'ready' as const, toolCount: 2 } },
    };
    let calls = 0;
    const server = startNexusHttpServer(fixture(async () => {
      calls += 1;
      return outcome;
    }));
    try {
      const response = await fetch(`${server.url}${RELOAD_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${BEARER}` },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(outcome);
      expect(calls).toBe(1);
    } finally {
      server.stop();
    }
  });

  test('reports a wired-but-unavailable reload seam as 503 after authentication', async () => {
    const server = startNexusHttpServer(fixture());
    try {
      const response = await fetch(`${server.url}${RELOAD_PATH}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${BEARER}` },
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({ error: 'mcp-reload-not-wired' });
    } finally {
      server.stop();
    }
  });
});
