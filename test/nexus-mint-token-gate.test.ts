// POST /v1/nexus/connect-info/mint-token bearer gate — wiring, not handler unit.
//
// connect-info.ts comments that http-server.ts's bearer gate guards mint.
// handleConnectTokenMint itself does not check, so a unit import of that
// handler would stay green even if the route line had no checkAuth.
// This boots startNexusHttpServer and fetches the real HTTP route.

import { describe, expect, test } from 'bun:test';

import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';

const MINT_PATH = '/v1/nexus/connect-info/mint-token';
const CONNECT_INFO_PATH = '/v1/nexus/connect-info';
const BEARER = 'mint-gate-test-token';
const MINTED = 'minted-acp-token';

function serverFixture() {
  const state = createNexusState({ nexusVersion: 'test', phase: 'test' });
  const eventBus = new NexusEventBus();
  state.bus = eventBus;
  return {
    state,
    eventBus,
    registry: new TabRegistry(state),
    metaApi: { bearerToken: BEARER, noAuth: false },
    connectInfo: {
      nexusVersion: 'test',
      acpTokenOverride: MINTED,
    },
    startPort: 57000 + Math.floor(Math.random() * 1000),
  };
}

describe('POST /v1/nexus/connect-info/mint-token — bearer gate', () => {
  test('Authorization header 없이 부르면 401 이고 토큰이 없다', async () => {
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}${MINT_PATH}`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: unknown; token?: unknown };
      expect(body).toEqual({ error: 'unauthorized' });
      expect(body).not.toHaveProperty('token');
      expect(JSON.stringify(body)).not.toContain(MINTED);
    } finally {
      server.stop();
    }
  });

  test('유효한 bearer 로 부르면 201 과 토큰이 돌아온다', async () => {
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}${MINT_PATH}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${BEARER}`,
          'sec-fetch-site': 'cross-site',
        },
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { token?: unknown };
      expect(body.token).toBe(MINTED);
    } finally {
      server.stop();
    }
  });

  test('GET /v1/nexus/connect-info 는 헤더 없이 열려 있다', async () => {
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}${CONNECT_INFO_PATH}`, {
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { auto_token?: unknown };
      expect(body).toHaveProperty('auto_token');
    } finally {
      server.stop();
    }
  });
});
