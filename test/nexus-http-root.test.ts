// FU2 — root-level browser conveniences (/favicon.ico → 204 · / → /app/ 302).
//
// Origin: 2026-05-12 Dia CDP dogfood found every PWA load logged a noisy 404
// on `/favicon.ico` (the assets live under `/app/`, not the origin root),
// and visiting the bare origin returned a not-found JSON body instead of
// landing on the SPA. This test pins both conveniences in place.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-fu2-'));
  prevEnv = process.env.ELANOUS_NEXUS_DIR;
  process.env.ELANOUS_NEXUS_DIR = tmpRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ELANOUS_NEXUS_DIR;
  else process.env.ELANOUS_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeFixture() {
  const bus = new NexusEventBus();
  const state = createNexusState({ nexusVersion: '0.4.0', phase: 'FU2' });
  state.bus = bus;
  const registry = new TabRegistry(state);
  return { state, registry, bus };
}

async function uniquePort(): Promise<number> {
  return 43000 + Math.floor(Math.random() * 2000);
}

describe('FU2 root-level browser handlers', () => {
  test('GET /favicon.ico returns 204 No Content', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: await uniquePort() });
    try {
      const res = await fetch(`${srv.url}/favicon.ico`);
      expect(res.status).toBe(204);
      // Empty body — verify Content-Length absent or 0.
      const text = await res.text();
      expect(text.length).toBe(0);
    } finally { srv.stop(); }
  });

  test('GET / returns a 302 redirect to /app/', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: await uniquePort() });
    try {
      const res = await fetch(`${srv.url}/`, { redirect: 'manual' });
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/app/');
    } finally { srv.stop(); }
  });

  test('non-GET on /favicon.ico falls through to 405 (does not 204)', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({ ...fix, eventBus: fix.bus, startPort: await uniquePort() });
    try {
      const res = await fetch(`${srv.url}/favicon.ico`, { method: 'POST' });
      expect(res.status).toBe(405);
    } finally { srv.stop(); }
  });
});
