// RFC #2161 Phase 5 — LiveStore unit tests.
//
// Verifies apiKey-availability computation, manual-disable persistence,
// subscriber notification, and snapshot round-trip — all without
// touching the real `~/.elanous/registry.json`.

import { getCatalog } from '../src/registry/loader';
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetElanousConfigDir, setElanousConfigDir } from '../src/elanous-config-dir.js';
import {
  getLiveStore,
  __resetLiveStoreForTests,
  type LiveStoreEvent,
} from '../src/registry/live-store.js';

let tmpHome: string;
const ANTHROPIC_KEY = 'ANTHROPIC_API_KEY';
const OPENAI_KEY = 'OPENAI_API_KEY';
const GROK_KEY = 'XAI_API_KEY';
const GEMINI_KEY = 'GEMINI_API_KEY';
const ALL_KEYS = [ANTHROPIC_KEY, OPENAI_KEY, GROK_KEY, GEMINI_KEY];

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'live-store-'));
  process.env.ELANOUS_TEST_HOME = tmpHome;
  for (const k of ALL_KEYS) delete process.env[k];
  __resetLiveStoreForTests();
});

afterEach(() => {
  resetElanousConfigDir();
  rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.ELANOUS_TEST_HOME;
  for (const k of ALL_KEYS) delete process.env[k];
});

describe('LiveStore · apiKey availability', () => {
  test('reports no-api-key when env var absent', () => {
    const store = getLiveStore();
    const ant = store.get('anthropic');
    expect(ant?.availability).toBe('no-api-key');
    expect(ant?.apiKeyEnvSet).toBe(false);
  });

  test('reports available when env var set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret';
    __resetLiveStoreForTests();
    const ant = getLiveStore().get('anthropic');
    expect(ant?.availability).toBe('available');
    expect(ant?.apiKeyEnvSet).toBe(true);
  });

  test('local provider falls back to no-api-key when LOCAL_LLM_API_KEY unset', () => {
    // local advertises an apiKeyEnv (LOCAL_LLM_API_KEY) so the live
    // store treats it the same as cloud providers — set the env to
    // promote, leave unset to demote. "unknown" is reserved for catalog
    // entries that don't declare an apiKeyEnv at all.
    const local = getLiveStore().get('local');
    expect(local?.availability).toBe('no-api-key');
  });

  test('list() returns providers sorted by id', () => {
    const ids = getLiveStore().list().map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
    // ⛔ 오늘의 수(5)를 박지 않는다 — provider YAML 이 늘면(2026-09-23 openrouter) «개선이 빨강»이 된다.
    //   불변식 = 라이브 스토어가 카탈로그의 provider 를 «전부» 싣는다.
    expect(ids.length).toBe(getCatalog().providers.size);
  });
});

describe('LiveStore · manual disable', () => {
  test('marks the provider disabled regardless of apiKey', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    __resetLiveStoreForTests();
    const store = getLiveStore();
    const next = store.setManualDisabled('anthropic', true);
    expect(next?.availability).toBe('disabled');
    expect(next?.manualDisabled).toBe(true);
  });

  test('persists manualDisabled across reload', () => {
    const store = getLiveStore();
    store.setManualDisabled('openai', true);
    __resetLiveStoreForTests();
    const fresh = getLiveStore().get('openai');
    expect(fresh?.manualDisabled).toBe(true);
    expect(fresh?.availability).toBe('disabled');
  });

  test('returns null for unknown provider', () => {
    expect(getLiveStore().setManualDisabled('mistral', true)).toBe(null);
  });

  test('no-op when state already matches', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'live-store-noop-config-'));
    setElanousConfigDir(configDir);
    __resetLiveStoreForTests();
    const store = getLiveStore();
    const events: LiveStoreEvent[] = [];
    store.subscribe((ev) => events.push(ev));
    store.setManualDisabled('anthropic', false); // already false
    expect(events.length).toBe(0);
    expect(existsSync(join(configDir, 'registry.json'))).toBe(false);
    expect(existsSync(join(tmpHome, '.elanous', 'registry.json'))).toBe(false);
    rmSync(configDir, { recursive: true, force: true });
  });
});

describe('LiveStore · subscribers', () => {
  test('subscriber sees provider-changed on mutation', () => {
    const store = getLiveStore();
    const events: LiveStoreEvent[] = [];
    store.subscribe((ev) => events.push(ev));
    store.setManualDisabled('anthropic', true);
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('provider-changed');
    if (events[0]?.type === 'provider-changed') {
      expect(events[0].providerId).toBe('anthropic');
      expect(events[0].state.availability).toBe('disabled');
    }
  });

  test('unsubscribe stops events', () => {
    const store = getLiveStore();
    const events: LiveStoreEvent[] = [];
    const off = store.subscribe((ev) => events.push(ev));
    off();
    store.setManualDisabled('anthropic', true);
    expect(events.length).toBe(0);
  });

  test('reload() emits a single reload event', () => {
    const store = getLiveStore();
    const events: LiveStoreEvent[] = [];
    store.subscribe((ev) => events.push(ev));
    store.reload();
    expect(events.filter((e) => e.type === 'reload').length).toBe(1);
  });
});

describe('LiveStore · refreshFromEnv', () => {
  test('promotes no-api-key → available when env appears', () => {
    const store = getLiveStore();
    expect(store.get('anthropic')?.availability).toBe('no-api-key');
    process.env.ANTHROPIC_API_KEY = 'sk-rotated';
    const events: LiveStoreEvent[] = [];
    store.subscribe((ev) => events.push(ev));
    store.refreshFromEnv();
    expect(store.get('anthropic')?.availability).toBe('available');
    expect(events.find((e) =>
      e.type === 'provider-changed' && e.providerId === 'anthropic',
    )).toBeTruthy();
  });

  test('demotes available → no-api-key when env unset', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-temp';
    __resetLiveStoreForTests();
    const store = getLiveStore();
    expect(store.get('anthropic')?.availability).toBe('available');
    delete process.env.ANTHROPIC_API_KEY;
    store.refreshFromEnv();
    expect(store.get('anthropic')?.availability).toBe('no-api-key');
  });

  test('preserves manual disable across env refresh', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-set';
    __resetLiveStoreForTests();
    const store = getLiveStore();
    store.setManualDisabled('anthropic', true);
    delete process.env.ANTHROPIC_API_KEY;
    store.refreshFromEnv();
    // manual disable wins regardless of env state.
    expect(store.get('anthropic')?.manualDisabled).toBe(true);
    expect(store.get('anthropic')?.availability).toBe('disabled');
  });
});

describe('LiveStore · snapshot persistence', () => {
  test('writes ~/.elanous/registry.json on mutation', () => {
    getLiveStore().setManualDisabled('anthropic', true);
    const path = join(tmpHome, '.elanous', 'registry.json');
    const raw = readFileSync(path, 'utf-8');
    const snap = JSON.parse(raw) as {
      version: number;
      providers: Array<{ id: string; manualDisabled: boolean }>;
    };
    expect(snap.version).toBe(1);
    expect(snap.providers.find((p) => p.id === 'anthropic')?.manualDisabled).toBe(true);
  });

  test('explicit config-dir takes precedence over ELANOUS_TEST_HOME', () => {
    const configDir = mkdtempSync(join(tmpdir(), 'live-store-config-'));
    setElanousConfigDir(configDir);
    __resetLiveStoreForTests();
    getLiveStore().setManualDisabled('anthropic', true);
    expect(existsSync(join(configDir, 'registry.json'))).toBe(true);
    expect(existsSync(join(tmpHome, '.elanous', 'registry.json'))).toBe(false);
    rmSync(configDir, { recursive: true, force: true });
  });

  test('reads pre-existing snapshot on init', () => {
    const path = join(tmpHome, '.elanous', 'registry.json');
    // Pre-populate a snapshot before the store boots.
    const fs = require('node:fs') as { mkdirSync: typeof import('node:fs').mkdirSync };
    fs.mkdirSync(join(tmpHome, '.elanous'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      providers: [{ id: 'gemini', manualDisabled: true }],
    }), 'utf-8');
    __resetLiveStoreForTests();
    expect(getLiveStore().get('gemini')?.manualDisabled).toBe(true);
    expect(getLiveStore().get('gemini')?.availability).toBe('disabled');
  });

  test('corrupted snapshot is silently ignored', () => {
    const path = join(tmpHome, '.elanous', 'registry.json');
    const fs = require('node:fs') as { mkdirSync: typeof import('node:fs').mkdirSync };
    fs.mkdirSync(join(tmpHome, '.elanous'), { recursive: true });
    writeFileSync(path, '{broken json', 'utf-8');
    __resetLiveStoreForTests();
    // No throw — defaults to no manual override.
    expect(getLiveStore().get('anthropic')?.manualDisabled).toBe(false);
  });
});
