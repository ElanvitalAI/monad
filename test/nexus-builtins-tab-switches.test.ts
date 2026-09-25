// NEXUS · tab built-in switch packs (Phase N-3.5 PR φ)
// Classification: removed — d63e92fba3c84b280d56c4bd416e6303bd2406b7
// refactor: V2.2-8 — src/scheduler/** 17 파일 물리 삭제 + NEXUS scheduler kind retire (#2306)
// scheduler has no replacement kind; retain active builtin-pack contracts because Bun
// executes this file directly.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GLOBAL_SWITCHES,
  CHANNEL_SWITCHES,
  DAEMON_SWITCHES,
  PWA_HOST_SWITCHES,
  reloadAllBuiltins,
} from '../src/nexus/config/builtins/index.js';
import {
  PUSHCUT_ENABLED_SWITCH_ID,
  PUSHCUT_WEBHOOK_SECRET_SWITCH_ID,
  PUSHCUT_WEBHOOK_PATH_SWITCH_ID,
} from '../src/nexus/config/builtins/tab-daemon.js';
import {
  clearSwitchRegistry,
  getSwitch,
  listSwitches,
} from '../src/nexus/config/switch-registry.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'monad-nexus-n35-builtins-'));
  setMonadConfigDir(tmpRoot);
  clearSwitchRegistry();
  reloadAllBuiltins();
});
afterEach(() => {
  resetMonadConfigDir();
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  clearSwitchRegistry();
});

describe('Built-in switch pack registration', () => {
  test('all 5 packs registered in singleton', () => {
    const ids = new Set(listSwitches().map((s) => s.id));
    // global (PR μ + σ + υ)
    expect(ids.has('global.tools')).toBe(true);
    expect(ids.has('global.secrets.backend')).toBe(true);
    // channel-bot (PR μ)
    expect(ids.has('tabs.telegram:1.tokenRef')).toBe(true);
    expect(ids.has('tabs.discord:1.tokenRef')).toBe(true);
    // daemon (PR φ)
    expect(ids.has('tabs.daemon:1.tools')).toBe(true);
    expect(ids.has(PUSHCUT_ENABLED_SWITCH_ID)).toBe(true);
    expect(ids.has(PUSHCUT_WEBHOOK_SECRET_SWITCH_ID)).toBe(true);
    expect(ids.has(PUSHCUT_WEBHOOK_PATH_SWITCH_ID)).toBe(true);
    // pwa-host (PR φ)
    expect(ids.has('tabs.pwa-host:1.port')).toBe(true);
    expect(ids.has('tabs.pwa-host:1.host')).toBe(true);
  });

  test('exported pack arrays match registered counts', () => {
    expect(DAEMON_SWITCHES.length).toBeGreaterThanOrEqual(5);
    expect(PWA_HOST_SWITCHES.length).toBeGreaterThanOrEqual(4);
    // sanity: global + channel imports still present
    expect(GLOBAL_SWITCHES.length).toBeGreaterThan(0);
    expect(CHANNEL_SWITCHES.length).toBe(2);
  });
});

describe('DAEMON_SWITCHES · Pushcut absorption (WT-N-3 D1/D2/D4)', () => {
  test('pushcut.enabled is hot-applicable + default false', () => {
    const sw = getSwitch(PUSHCUT_ENABLED_SWITCH_ID)!;
    expect(sw.kind).toBe('bool');
    expect(sw.default).toBe(false);
    expect(sw.hotApplicable).toBe(true); // 보안 incident 시 즉시 disable
  });

  test('pushcut.webhookSecretRef is secret-ref + redactInLogs + pwaPreferred', () => {
    const sw = getSwitch(PUSHCUT_WEBHOOK_SECRET_SWITCH_ID)!;
    expect(sw.kind).toBe('secret-ref');
    expect(sw.redactInLogs).toBe(true);
    expect(sw.pwaPreferred).toBe(true);
    expect(sw.envName).toBe('MONAD_PUSHCUT_WEBHOOK_SECRET');
    expect(sw.legacyEnvName).toBe('MONAD_PUSHCUT_WEBHOOK_SECRET');
  });

  test('pushcut.webhookPath default = /v1/pushcut + restartTabs daemon:1', () => {
    const sw = getSwitch(PUSHCUT_WEBHOOK_PATH_SWITCH_ID)!;
    expect(sw.default).toBe('/v1/pushcut');
    expect(sw.restartTabs).toEqual(['daemon:1']);
    expect(sw.hotApplicable).toBe(false);
  });

  test('per-instance daemon tools override carries envName MONAD_TOOLS', () => {
    const sw = getSwitch('tabs.daemon:1.tools')!;
    expect(sw.envName).toBe('MONAD_TOOLS');
    expect(sw.kind).toBe('enum');
    expect(sw.appliesTo).toEqual(['daemon']);
    // empty default = "use global.tools"
    expect(sw.default).toBe('');
  });

  test('per-instance historyDir override', () => {
    const sw = getSwitch('tabs.daemon:1.historyDir')!;
    expect(sw.envName).toBe('MONAD_HISTORY_DIR');
    expect(sw.kind).toBe('path');
  });
});

describe('PWA_HOST_SWITCHES', () => {
  test('port: number · validate range 1024-65535', () => {
    const sw = getSwitch('tabs.pwa-host:1.port')!;
    expect(sw.default).toBe(3210);
    expect(sw.validate?.(80)).not.toBeNull();
    expect(sw.validate?.(3000)).toBeNull();
    expect(sw.validate?.(70000)).not.toBeNull();
    expect(sw.envName).toBe('PORT');
    expect(sw.restartTabs).toEqual(['pwa-host:1']);
  });

  test('host validate accepts 0.0.0.0 + 127.0.0.1 + tailscale-host', () => {
    const sw = getSwitch('tabs.pwa-host:1.host')!;
    expect(sw.validate?.('127.0.0.1')).toBeNull();
    expect(sw.validate?.('0.0.0.0')).toBeNull();
    expect(sw.validate?.('tailscale-host-name')).toBeNull();
    expect(sw.validate?.('has space')).not.toBeNull();
  });

  test('healthzPath default + devCommand default', () => {
    expect(getSwitch('tabs.pwa-host:1.healthzPath')!.default).toBe('/healthz');
    expect(getSwitch('tabs.pwa-host:1.devCommand')!.default).toBe('bun run dev');
  });
});

describe('Switch envName collision check', () => {
  test('per-instance MONAD_TOOLS override does not break global switch lookup', () => {
    // Both global.tools and tabs.daemon:1.tools declare envName=MONAD_TOOLS.
    // env-derive resolves per-tab switch first, so the override wins for
    // the daemon tab; the global one applies elsewhere.
    expect(getSwitch('global.tools')!.envName).toBe('MONAD_TOOLS');
    expect(getSwitch('tabs.daemon:1.tools')!.envName).toBe('MONAD_TOOLS');
    // Both registered (last write wins per id, but ids differ so both exist)
    const ids = listSwitches().map((s) => s.id);
    expect(ids.filter((id) => id.endsWith('.tools') || id === 'global.tools')).toEqual(['global.tools', 'tabs.daemon:1.tools']);
  });
});
