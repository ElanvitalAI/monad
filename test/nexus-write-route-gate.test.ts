// POST write/execute routes bearer gate — wiring, not handler unit.
//
// The four mutation POSTs used to reach handlers before auth (400 invalid-json
// or an unconditional discovery run). The gate lives in http-server.ts, same
// one-liner as mint-token / SESSION_TURN_CONTROL_PATH / publish/markdown.

import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import * as templates from '../src/nexus/api/templates.js';
import * as config from '../src/nexus/api/config.js';
import * as discovery from '../src/nexus/api/registry-discovery.js';
import * as autopilot from '../src/nexus/api/autopilot-handler.js';

const WRITE_PATHS = [
  '/v1/autopilot/run',
  '/v1/nexus/templates',
  '/v1/config/secrets',
  '/v1/registry/discovery',
] as const;

const CONNECT_INFO_PATH = '/v1/nexus/connect-info';
const APP_PATH = '/app/';
const BEARER = 'write-gate-test-token';
const STUB_BODY = { gated: true };

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
      acpTokenOverride: 'unused-acp-token',
    },
    startPort: 58000 + Math.floor(Math.random() * 1000),
  };
}

function stubHandlers() {
  const stub = () => Promise.resolve(Response.json(STUB_BODY, { status: 200 }));
  return {
    templates: spyOn(templates, 'handleTemplateSave').mockImplementation(stub),
    secrets: spyOn(config, 'handleSecretPost').mockImplementation(stub),
    discovery: spyOn(discovery, 'handleDiscoveryRun').mockImplementation(stub),
    autopilot: spyOn(autopilot, 'handleAutopilotRun').mockImplementation(stub),
  };
}

afterEach(() => {
  mock.restore();
});

describe('POST write routes — bearer gate', () => {
  test.each([...WRITE_PATHS])('Authorization header 없이 %s 를 POST 하면 401', async (path) => {
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}${path}`, {
        method: 'POST',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    } finally {
      server.stop();
    }
  });

  test('인증 실패 시 핸들러가 불리지 않는다', async () => {
    const spies = stubHandlers();
    const server = startNexusHttpServer(serverFixture());
    try {
      for (const path of WRITE_PATHS) {
        const res = await fetch(`${server.url}${path}`, {
          method: 'POST',
          headers: { 'sec-fetch-site': 'cross-site' },
        });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'unauthorized' });
      }
      expect(spies.templates).toHaveBeenCalledTimes(0);
      expect(spies.secrets).toHaveBeenCalledTimes(0);
      expect(spies.discovery).toHaveBeenCalledTimes(0);
      expect(spies.autopilot).toHaveBeenCalledTimes(0);
    } finally {
      server.stop();
    }
  });

  test('유효한 bearer 로 부르면 401 이 아니고 핸들러에 도달한다', async () => {
    const spies = stubHandlers();
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}/v1/nexus/templates`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${BEARER}`,
          'sec-fetch-site': 'cross-site',
        },
      });
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(STUB_BODY);
      expect(spies.templates).toHaveBeenCalledTimes(1);
      expect(spies.secrets).toHaveBeenCalledTimes(0);
      expect(spies.discovery).toHaveBeenCalledTimes(0);
      expect(spies.autopilot).toHaveBeenCalledTimes(0);
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

  test('GET /app/ 는 새 관문으로 차단되지 않는다', async () => {
    const server = startNexusHttpServer(serverFixture());
    try {
      const res = await fetch(`${server.url}${APP_PATH}`, {
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status).not.toBe(401);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'static-not-wired' });
    } finally {
      server.stop();
    }
  });
});
