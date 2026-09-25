// M4-4 (2026-05-12) — workflow pin data: unit + e2e.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearWorkflowPins,
  listWorkflowPins,
  setWorkflowPin,
} from '../src/workflow-runtime/pin-data.ts';
import { startNexusHttpServer } from '../src/nexus/api/http-server.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { createNexusState } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

// ──────────────────── In-memory fs seam ─────────────────────────────

function makeMemoryFs(): {
  files: Map<string, string>;
  readFile: (p: string) => string;
  writeFile: (p: string, c: string) => void;
  unlinkFile: (p: string) => void;
  resolveDir: () => string;
  now: () => number;
} {
  const files = new Map<string, string>();
  let nowMs = 1_700_000_000_000;
  return {
    files,
    readFile: (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`no such file: ${p}`);
      return v;
    },
    writeFile: (p: string, c: string) => { files.set(p, c); },
    unlinkFile: (p: string) => { files.delete(p); },
    resolveDir: () => '/fake/workflows',
    now: () => { nowMs += 1_000; return nowMs; },
  };
}

// ──────────────────── Unit tests ────────────────────────────────────

describe('setWorkflowPin', () => {
  test('rejects invalid workflow name (path traversal)', () => {
    const fs = makeMemoryFs();
    const r = setWorkflowPin('../escape', 'node-1', 'val', {}, fs);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('invalid_workflow_name');
  });

  test('rejects empty nodeId', () => {
    const fs = makeMemoryFs();
    const r = setWorkflowPin('foo', '', 'val', {}, fs);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_node_id');
  });

  test('stores pin + listWorkflowPins reads back', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', 'hello world', { note: 'test' }, fs);
    const pins = listWorkflowPins('foo', fs);
    expect(pins['node-1']).toBeDefined();
    expect(pins['node-1']!.value).toBe('hello world');
    expect(pins['node-1']!.note).toBe('test');
    expect(pins['node-1']!.updatedAt).toBeTruthy();
  });

  test('updates existing pin (later updatedAt)', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', 'v1', {}, fs);
    const first = listWorkflowPins('foo', fs)['node-1']!.updatedAt;
    setWorkflowPin('foo', 'node-1', 'v2', {}, fs);
    const second = listWorkflowPins('foo', fs)['node-1']!.updatedAt;
    expect(second).not.toBe(first);
    expect(listWorkflowPins('foo', fs)['node-1']!.value).toBe('v2');
  });

  test('stores structured value (object / array)', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', { ok: true, items: [1, 2, 3] }, {}, fs);
    const e = listWorkflowPins('foo', fs)['node-1']!;
    expect(e.value).toEqual({ ok: true, items: [1, 2, 3] });
  });
});

describe('clearWorkflowPins', () => {
  test('returns 0 when file missing', () => {
    const fs = makeMemoryFs();
    expect(clearWorkflowPins('foo', undefined, fs)).toBe(0);
  });

  test('returns 0 when nodeId not present', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', 'v', {}, fs);
    expect(clearWorkflowPins('foo', 'node-x', fs)).toBe(0);
  });

  test('removes one entry by nodeId', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', 'v1', {}, fs);
    setWorkflowPin('foo', 'node-2', 'v2', {}, fs);
    expect(clearWorkflowPins('foo', 'node-1', fs)).toBe(1);
    const pins = listWorkflowPins('foo', fs);
    expect(pins['node-1']).toBeUndefined();
    expect(pins['node-2']!.value).toBe('v2');
  });

  test('wipes all pins when nodeId undefined → file unlinked', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', 'v1', {}, fs);
    setWorkflowPin('foo', 'node-2', 'v2', {}, fs);
    expect(clearWorkflowPins('foo', undefined, fs)).toBe(2);
    expect(listWorkflowPins('foo', fs)).toEqual({});
  });

  test('removing the last entry unlinks the file', () => {
    const fs = makeMemoryFs();
    setWorkflowPin('foo', 'node-1', 'v', {}, fs);
    expect(clearWorkflowPins('foo', 'node-1', fs)).toBe(1);
    // listWorkflowPins should return {} (no file lookup succeeds).
    expect(listWorkflowPins('foo', fs)).toEqual({});
  });
});

// ──────────────────── e2e endpoint tests ────────────────────────────

let tmpRoot: string;
let tmpHome: string;
let prevNexus: string | undefined;
let prevHome: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'm4-4-nexus-'));
  tmpHome = mkdtempSync(join(tmpdir(), 'm4-4-home-'));
  prevNexus = process.env.MONAD_NEXUS_DIR;
  prevHome = process.env.HOME;
  process.env.MONAD_NEXUS_DIR = tmpRoot;
  process.env.HOME = tmpHome;
  setMonadConfigDir(join(tmpHome, '.monad'));
});

afterEach(() => {
  const restore = (key: string, prev: string | undefined): void => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  };
  restore('MONAD_NEXUS_DIR', prevNexus);
  restore('HOME', prevHome);
  resetMonadConfigDir();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeFixture() {
  const bus = new NexusEventBus();
  const state = createNexusState({ nexusVersion: '0.4.0', phase: 'M4-4' });
  state.bus = bus;
  const registry = new TabRegistry(state);
  return { state, registry, bus };
}

async function uniquePort(): Promise<number> {
  return 56000 + Math.floor(Math.random() * 2000);
}

describe('M4-4 workflow pins endpoint', () => {
  test('GET /pins returns empty pins when no file exists', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: await uniquePort(),
      metaApi: { noAuth: true },
    });
    try {
      const res = await fetch(`${srv.url}/v1/workflows/foo/pins`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pins).toEqual({});
    } finally { srv.stop(); }
  });

  test('PUT /pins/:nodeId stores + GET reads back', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: await uniquePort(),
      metaApi: { noAuth: true },
    });
    try {
      const put = await fetch(`${srv.url}/v1/workflows/foo/pins/node-1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'pinned answer', note: 'why' }),
      });
      expect(put.status).toBe(200);
      const putBody = await put.json();
      expect(putBody.pin.value).toBe('pinned answer');
      expect(putBody.pin.note).toBe('why');
      const get = await fetch(`${srv.url}/v1/workflows/foo/pins/node-1`);
      const getBody = await get.json();
      expect(getBody.pin.value).toBe('pinned answer');
    } finally { srv.stop(); }
  });

  test('PUT 400 when value missing', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: await uniquePort(),
      metaApi: { noAuth: true },
    });
    try {
      const res = await fetch(`${srv.url}/v1/workflows/foo/pins/node-1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    } finally { srv.stop(); }
  });

  test('GET 404 on unknown nodeId', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: await uniquePort(),
      metaApi: { noAuth: true },
    });
    try {
      const res = await fetch(`${srv.url}/v1/workflows/foo/pins/missing`);
      expect(res.status).toBe(404);
    } finally { srv.stop(); }
  });

  test('DELETE /pins/:nodeId removes one entry', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: await uniquePort(),
      metaApi: { noAuth: true },
    });
    try {
      await fetch(`${srv.url}/v1/workflows/foo/pins/node-1`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'a' }),
      });
      const del = await fetch(`${srv.url}/v1/workflows/foo/pins/node-1`, { method: 'DELETE' });
      const delBody = await del.json();
      expect(delBody.removed).toBe(1);
    } finally { srv.stop(); }
  });

  test('DELETE /pins wipes everything', async () => {
    const fix = makeFixture();
    const srv = startNexusHttpServer({
      ...fix,
      eventBus: fix.bus,
      startPort: await uniquePort(),
      metaApi: { noAuth: true },
    });
    try {
      await fetch(`${srv.url}/v1/workflows/foo/pins/a`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 1 }),
      });
      await fetch(`${srv.url}/v1/workflows/foo/pins/b`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 2 }),
      });
      const del = await fetch(`${srv.url}/v1/workflows/foo/pins`, { method: 'DELETE' });
      const delBody = await del.json();
      expect(delBody.removed).toBe(2);
      const get = await fetch(`${srv.url}/v1/workflows/foo/pins`);
      const getBody = await get.json();
      expect(getBody.pins).toEqual({});
    } finally { srv.stop(); }
  });
});
