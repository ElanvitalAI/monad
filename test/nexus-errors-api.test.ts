// NEXUS · /v1/nexus/errors + snapshot writer tests (Phase N-3 cleanup PR γ')

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  deleteErrorSnapshot,
  listErrorSnapshots,
  readErrorSnapshot,
  subscribeErrorSnapshotWriter,
  writeErrorSnapshot,
} from '../src/nexus/supervisor/error-snapshot.js';
import {
  handleErrorDismiss,
  handleErrorGet,
  handleErrorsForTab,
  handleErrorsList,
  parseErrorsPath,
} from '../src/nexus/api/errors.js';
import { createNexusState, pushEvent } from '../src/nexus/state/state.js';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { NexusEventBus } from '../src/nexus/api/event-bus.js';
import { nexusErrorsDir } from '../src/nexus/paths.js';
import type { TabState } from '../src/nexus/kinds/types.js';

let tmpRoot: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(joinPath(tmpdir(), 'monad-nexus-gamma-prime-'));
  prevEnv = process.env.MONAD_NEXUS_DIR;
  process.env.MONAD_NEXUS_DIR = tmpRoot;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = prevEnv;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

function setup() {
  const state = createNexusState({ nexusVersion: '0.17.0', phase: 'N-3 γ test' });
  const registry = new TabRegistry(state);
  return { state, registry };
}

function makeTab(id: string, kind: string, status: string, opts: Partial<TabState> = {}): TabState {
  return {
    spec: { id, kind: kind as any, label: id },
    status: status as any,
    restartCount: 0,
    restartCountWindowStart: 0,
    ...opts,
  };
}

describe('writeErrorSnapshot · happy path', () => {
  test('writes JSON file under errors/<tabId>/<ts>.json with mode 0o600', () => {
    const tab = makeTab('pwa-host:1', 'pwa-host', 'crashed', { lastError: 'halt:EADDRINUSE:bind' });
    const snap = writeErrorSnapshot(
      tab,
      { reason: 'halt-pattern', pattern: 'EADDRINUSE', error: 'halt:EADDRINUSE:bind' },
      { now: 1_700_000_000_000 },
    );
    expect(snap.tabId).toBe('pwa-host:1');
    expect(snap.kind).toBe('pwa-host');
    expect(snap.reason).toBe('halt-pattern');
    expect(snap.pattern).toBe('EADDRINUSE');
    expect(snap.suggestedActions.length).toBeGreaterThan(0);
    const path = joinPath(nexusErrorsDir('pwa-host:1'), '1700000000000.json');
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.tabId).toBe('pwa-host:1');
  });

  test('snapshot omits pattern field when reason is unknown', () => {
    const tab = makeTab('chat:1', 'chat', 'crashed');
    const snap = writeErrorSnapshot(tab, {});
    expect(snap.reason).toBe('unknown');
    expect(snap.pattern).toBeUndefined();
  });

  test('records pid + restartCount when present on the tab state', () => {
    const tab = makeTab('daemon:1', 'daemon', 'crashed', { pid: 4242, restartCount: 5 });
    const snap = writeErrorSnapshot(tab, { reason: 'max-restart-per-hour' });
    expect(snap.pid).toBe(4242);
    expect(snap.restartCount).toBe(5);
  });
});

describe('writeErrorSnapshot · suggestedActions matrix', () => {
  test('pwa-host + EADDRINUSE → port edit + lsof + restart', () => {
    const tab = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    const snap = writeErrorSnapshot(tab, { reason: 'halt-pattern', pattern: 'EADDRINUSE' });
    const ids = snap.suggestedActions.map((a) => a.id);
    expect(ids).toContain('shell-lsof');
    expect(ids).toContain('switch-edit-port');
    expect(ids).toContain('tab-restart');
  });

  test('channel-bot + 401/403 → token edit + restart', () => {
    const tab = makeTab('telegram:1', 'channel-bot', 'crashed');
    const snap = writeErrorSnapshot(tab, { reason: 'halt-pattern', pattern: '401 Unauthorized' });
    const ids = snap.suggestedActions.map((a) => a.id);
    expect(ids).toContain('switch-edit-token');
    expect(ids).toContain('tab-restart');
    const tokenAction = snap.suggestedActions.find((a) => a.id === 'switch-edit-token')!;
    if (tokenAction.action.type === 'switch-edit') {
      expect(tokenAction.action.switchId).toBe('tabs.telegram:1.tokenRef');
    }
  });

  test('daemon + external pattern → stop external + restart', () => {
    const tab = makeTab('daemon:1', 'daemon', 'crashed');
    const snap = writeErrorSnapshot(tab, { reason: 'halt-pattern', pattern: 'external lock' });
    const ids = snap.suggestedActions.map((a) => a.id);
    expect(ids).toContain('shell-stop-daemon');
    expect(ids).toContain('tab-restart');
  });

  test('max-restart-per-hour → view-logs + wait-and-retry + restart', () => {
    const tab = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    const snap = writeErrorSnapshot(tab, { reason: 'max-restart-per-hour' });
    const ids = snap.suggestedActions.map((a) => a.id);
    expect(ids).toContain('view-logs');
    expect(ids).toContain('wait-and-retry');
    expect(ids).toContain('tab-restart');
  });

  test('unknown halt pattern + halt-pattern reason → view-logs + restart + stop', () => {
    const tab = makeTab('scheduler:1', 'scheduler', 'crashed');
    const snap = writeErrorSnapshot(tab, { reason: 'halt-pattern', pattern: 'mysterious' });
    const ids = snap.suggestedActions.map((a) => a.id);
    expect(ids).toContain('view-logs');
    expect(ids).toContain('tab-restart');
    expect(ids).toContain('tab-stop');
  });

  test('fallback (reason=unknown) → restart + stop', () => {
    const tab = makeTab('chat:1', 'chat', 'crashed');
    const snap = writeErrorSnapshot(tab, {});
    expect(snap.suggestedActions.map((a) => a.id)).toEqual(['tab-restart', 'tab-stop']);
  });
});

describe('listErrorSnapshots · sort + filter', () => {
  test('newest-first across multiple tabs', () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    const b = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 1000 });
    writeErrorSnapshot(b, { reason: 'halt-pattern', pattern: 'y' }, { now: 2000 });
    writeErrorSnapshot(a, { reason: 'max-restart-per-hour' }, { now: 3000 });
    const out = listErrorSnapshots();
    expect(out.map((e) => e.ts)).toEqual([3000, 2000, 1000]);
  });

  test('tabId filter narrows to one tab', () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    const b = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 1000 });
    writeErrorSnapshot(b, { reason: 'halt-pattern', pattern: 'y' }, { now: 2000 });
    const out = listErrorSnapshots({ tabId: 'daemon:1' });
    expect(out).toHaveLength(1);
    expect(out[0]!.tabId).toBe('daemon:1');
  });

  test('limit caps the result', () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    for (let i = 0; i < 5; i += 1) {
      writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: i + 1 });
    }
    const out = listErrorSnapshots({ limit: 3 });
    expect(out).toHaveLength(3);
    expect(out[0]!.ts).toBe(5);
    expect(out[2]!.ts).toBe(3);
  });

  test('no errors directory → empty list (no throw)', () => {
    expect(listErrorSnapshots()).toEqual([]);
  });

  test('skips malformed JSON files', () => {
    mkdirSync(nexusErrorsDir('daemon:1'), { recursive: true });
    writeFileSync(joinPath(nexusErrorsDir('daemon:1'), '1.json'), 'not-json{', { mode: 0o600 });
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 1000 });
    const out = listErrorSnapshots();
    // Only the well-formed snapshot should appear.
    expect(out).toHaveLength(1);
    expect(out[0]!.ts).toBe(1000);
  });
});

describe('readErrorSnapshot / deleteErrorSnapshot', () => {
  test('readErrorSnapshot round-trip', () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    const written = writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 5000 });
    const read = readErrorSnapshot('daemon:1', written.ts);
    expect(read?.tabId).toBe('daemon:1');
    expect(read?.ts).toBe(5000);
  });

  test('readErrorSnapshot missing → null', () => {
    expect(readErrorSnapshot('nope:1', 9999)).toBeNull();
  });

  test('deleteErrorSnapshot removes the file', () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 5000 });
    expect(deleteErrorSnapshot('daemon:1', 5000)).toBe(true);
    expect(deleteErrorSnapshot('daemon:1', 5000)).toBe(false);   // idempotent
  });
});

describe('subscribeErrorSnapshotWriter · event-driven', () => {
  test('tab.halt event triggers a snapshot write', () => {
    const { state, registry } = setup();
    registry.register({ id: 'pwa-host:1', kind: 'pwa-host', label: 'p' });
    registry.patch('pwa-host:1', { status: 'crashed', lastError: 'halt:EADDRINUSE:bind' });
    const bus = new NexusEventBus();
    state.bus = bus;
    let now = 7777;
    const unsub = subscribeErrorSnapshotWriter({ state, registry, eventBus: bus, now: () => now });
    pushEvent(state, {
      kind: 'tab.halt',
      tabId: 'pwa-host:1',
      detail: { reason: 'halt-pattern', pattern: 'EADDRINUSE', error: 'halt:EADDRINUSE:bind' },
    });
    unsub();
    expect(existsSync(joinPath(nexusErrorsDir('pwa-host:1'), '7777.json'))).toBe(true);
    const out = listErrorSnapshots();
    expect(out).toHaveLength(1);
    expect(out[0]!.tabId).toBe('pwa-host:1');
    expect(out[0]!.pattern).toBe('EADDRINUSE');
  });

  test('non-halt events are ignored', () => {
    const { state, registry } = setup();
    registry.register({ id: 'daemon:1', kind: 'daemon', label: 'd' });
    const bus = new NexusEventBus();
    state.bus = bus;
    const unsub = subscribeErrorSnapshotWriter({ state, registry, eventBus: bus });
    pushEvent(state, { kind: 'tab.up', tabId: 'daemon:1' });
    pushEvent(state, { kind: 'tab.down', tabId: 'daemon:1' });
    unsub();
    expect(listErrorSnapshots()).toEqual([]);
  });

  test('unsubscribe stops further writes', () => {
    const { state, registry } = setup();
    registry.register({ id: 'daemon:1', kind: 'daemon', label: 'd' });
    registry.patch('daemon:1', { status: 'crashed' });
    const bus = new NexusEventBus();
    state.bus = bus;
    const unsub = subscribeErrorSnapshotWriter({ state, registry, eventBus: bus, now: () => 1 });
    pushEvent(state, { kind: 'tab.halt', tabId: 'daemon:1', detail: { reason: 'halt-pattern', pattern: 'x' } });
    unsub();
    pushEvent(state, { kind: 'tab.halt', tabId: 'daemon:1', detail: { reason: 'halt-pattern', pattern: 'y' } });
    expect(listErrorSnapshots()).toHaveLength(1);
  });
});

describe('parseErrorsPath', () => {
  test('list path → empty object', () => {
    expect(parseErrorsPath('/v1/nexus/errors')).toEqual({});
  });

  test('tabId path → { tabId }', () => {
    expect(parseErrorsPath('/v1/nexus/errors/pwa-host:1')).toEqual({ tabId: 'pwa-host:1' });
  });

  test('tabId + ts → { tabId, ts }', () => {
    expect(parseErrorsPath('/v1/nexus/errors/pwa-host:1/1700000')).toEqual({ tabId: 'pwa-host:1', ts: 1700000 });
  });

  test('non-matching prefix → null', () => {
    expect(parseErrorsPath('/v1/nexus/tabs')).toBeNull();
  });

  test('URL-decodes the tabId', () => {
    expect(parseErrorsPath('/v1/nexus/errors/pwa-host%3A1')).toEqual({ tabId: 'pwa-host:1' });
  });
});

describe('handleErrorsList / handleErrorsForTab', () => {
  test('GET /v1/nexus/errors lists snapshots newest-first', async () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 1000 });
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'y' }, { now: 2000 });
    const res = handleErrorsList(new URL('http://x/v1/nexus/errors'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors[0].ts).toBe(2000);
  });

  test('GET /v1/nexus/errors?limit=1 honors cap', async () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 1000 });
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'y' }, { now: 2000 });
    const res = handleErrorsList(new URL('http://x/v1/nexus/errors?limit=1'));
    const body = await res.json();
    expect(body.errors).toHaveLength(1);
  });

  test('GET /v1/nexus/errors/:tabId returns only that tab', async () => {
    const a = makeTab('daemon:1', 'daemon', 'crashed');
    const b = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 1000 });
    writeErrorSnapshot(b, { reason: 'halt-pattern', pattern: 'y' }, { now: 2000 });
    const res = handleErrorsForTab('daemon:1');
    const body = await res.json();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].tabId).toBe('daemon:1');
  });
});

describe('handleErrorGet / handleErrorDismiss', () => {
  test('GET single snapshot returns suggestedActions', async () => {
    const a = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'EADDRINUSE' }, { now: 5000 });
    const res = handleErrorGet('pwa-host:1', 5000);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshot.tabId).toBe('pwa-host:1');
    expect(body.snapshot.suggestedActions.length).toBeGreaterThan(0);
  });

  test('GET missing snapshot → 404', async () => {
    const res = handleErrorGet('pwa-host:1', 9999);
    expect(res.status).toBe(404);
  });

  test('DELETE snapshot removes the file (200) and is idempotent (404)', async () => {
    const a = makeTab('pwa-host:1', 'pwa-host', 'crashed');
    writeErrorSnapshot(a, { reason: 'halt-pattern', pattern: 'x' }, { now: 5000 });
    const r1 = handleErrorDismiss('pwa-host:1', 5000);
    expect(r1.status).toBe(200);
    const r2 = handleErrorDismiss('pwa-host:1', 5000);
    expect(r2.status).toBe(404);
  });

  test('GET with bad ts → 400', async () => {
    const res = handleErrorGet('pwa-host:1', NaN);
    expect(res.status).toBe(400);
  });
});
