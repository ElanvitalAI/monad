// NEXUS N-1.5 PR e — runtime-not-wired meta-API endpoint stubs.
//
// PR e exposes the v6 cutover surface for intake / sessions /
// control-signals / simulations / tools / screenshot / recordings.
// Until PR i/j wires intakeStore + history + toolSurface, every route
// returns `503 meta-api-runtime-not-wired` so PWA cutover (PR a) sees
// a stable error rather than 404. These tests pin the routing
// contract.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { createChatTabSpec } from '../src/nexus/kinds/chat.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-nexus-runtime-stubs-'));
  prevEnv = process.env.ELANOUS_NEXUS_DIR;
  process.env.ELANOUS_NEXUS_DIR = tmpRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ELANOUS_NEXUS_DIR;
  else process.env.ELANOUS_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeFixture(): {
  state: ReturnType<typeof createNexusState>;
  registry: TabRegistry;
  bus: NexusEventBus;
} {
  const bus = new NexusEventBus();
  const state = createNexusState({ nexusVersion: '0.4.0', phase: 'N-1.5 PR e' });
  state.bus = bus;
  const registry = new TabRegistry(state);
  registry.register(createChatTabSpec({ id: 'chat:1' }));
  return { state, registry, bus };
}

function uniquePort(): number {
  return 47000 + Math.floor(Math.random() * 2000);
}

describe('NEXUS meta-API runtime stubs (PR e)', () => {
  test('GET /v1/simulations returns 503 not-wired', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/simulations`);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('meta-api-runtime-not-wired');
    } finally { srv.stop(); }
  });

  test('GET /v1/tools returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/tools`);
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('POST /v1/intake returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/intake`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'test' }),
      });
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('GET /v1/intake list returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/intake`);
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('POST /v1/sessions/external returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/sessions/external`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('GET /v1/sessions returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/sessions`);
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('GET /v1/control-signals returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/control-signals`);
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('POST /v1/control-signals returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/control-signals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('GET /v1/turns/last/screenshot returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/turns/last/screenshot`);
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('GET /v1/recordings/foo.mp4 returns 503', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/recordings/foo.mp4`);
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });

  test('PR f · POST /v1/prompt returns 503 not-wired', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userText: 'hi' }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('meta-api-runtime-not-wired');
    } finally { srv.stop(); }
  });

  test('PR h · POST /v1/hitl/callback/:id returns 503 not-wired', async () => {
    const fix = makeFixture();
    const port = uniquePort();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: port });
    try {
      const res = await fetch(`${srv.url}/v1/hitl/callback/req-abc123`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: true }),
      });
      expect(res.status).toBe(503);
    } finally { srv.stop(); }
  });
});
