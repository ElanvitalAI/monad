// NEXUS · UserConfig + SwitchRegistry + env-derive + apply tests (Phase N-3 PR μ)

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TabRegistry } from '../src/nexus/state/tab-registry.js';
import { createNexusState } from '../src/nexus/state/state.js';
import {
  readUserConfig,
  writeUserConfig,
  patchUserConfig,
  readSwitchValue,
  writeSwitchValue,
} from '../src/nexus/config/user-config.js';
import {
  readSecrets,
  setSecret,
  deleteSecret,
  getSecret,
  listSecretIds,
} from '../src/nexus/config/secrets.js';
import {
  registerSwitch,
  getSwitch,
  listSwitches,
  clearSwitchRegistry,
  expandTabSwitchId,
} from '../src/nexus/config/switch-registry.js';
import { reloadAllBuiltins, GLOBAL_SWITCHES, CHANNEL_SWITCHES } from '../src/nexus/config/builtins/index.js';
import { deriveChildEnv } from '../src/nexus/config/env-derive.js';
import { migrateLegacyEnvToConfig } from '../src/nexus/config/env-migrate.js';
import { applySwitchChange } from '../src/nexus/config/apply.js';
import { isSecretRef, makeSecretRef, USER_CONFIG_VERSION } from '../src/nexus/config/types.js';
import { userConfigPath, secretsPath } from '../src/nexus/config/paths.js';
import { createDaemonTabSpec } from '../src/nexus/kinds/daemon.js';
import { createChannelBotTabSpec } from '../src/nexus/kinds/channel-bot.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../src/elanous-config-dir.js';
import { DEFAULT_REGISTRY_THEME, THEME_REGISTRY } from '../src/themes/index.js';

let tmpRoot: string;
let prevTg: string | undefined;
let prevDc: string | undefined;
let prevTools: string | undefined;
let prevDebug: string | undefined;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-nexus-n3-cfg-'));
  prevTg = process.env.ELANOUS_TELEGRAM_BOT_TOKEN;
  prevDc = process.env.ELANOUS_DISCORD_BOT_TOKEN;
  prevTools = process.env.ELANOUS_TOOLS;
  prevDebug = process.env.ELANOUS_DEBUG;
  setElanousConfigDir(tmpRoot);
  delete process.env.ELANOUS_TELEGRAM_BOT_TOKEN;
  delete process.env.ELANOUS_DISCORD_BOT_TOKEN;
  delete process.env.ELANOUS_TOOLS;
  delete process.env.ELANOUS_DEBUG;
  clearSwitchRegistry();
  reloadAllBuiltins();
});
afterEach(() => {
  resetElanousConfigDir();
  if (prevTg === undefined) delete process.env.ELANOUS_TELEGRAM_BOT_TOKEN;
  else process.env.ELANOUS_TELEGRAM_BOT_TOKEN = prevTg;
  if (prevDc === undefined) delete process.env.ELANOUS_DISCORD_BOT_TOKEN;
  else process.env.ELANOUS_DISCORD_BOT_TOKEN = prevDc;
  if (prevTools === undefined) delete process.env.ELANOUS_TOOLS;
  else process.env.ELANOUS_TOOLS = prevTools;
  if (prevDebug === undefined) delete process.env.ELANOUS_DEBUG;
  else process.env.ELANOUS_DEBUG = prevDebug;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  clearSwitchRegistry();
});

// ---------------------------------------------------------------------------
// User config primitives
// ---------------------------------------------------------------------------

describe('readUserConfig / writeUserConfig', () => {
  test('missing file → defaults', () => {
    const cfg = readUserConfig();
    expect(cfg.version).toBe(USER_CONFIG_VERSION);
    expect(cfg.global).toEqual({});
    expect(cfg.tabs).toEqual({});
  });

  test('round-trip', () => {
    writeUserConfig({
      version: USER_CONFIG_VERSION,
      global: { tools: 'webterm', debug: { enabled: true } },
      tabs: { 'daemon:1': { enabled: true } },
    });
    const cfg = readUserConfig();
    expect(cfg.global.tools).toBe('webterm');
    expect(cfg.global.debug?.enabled).toBe(true);
    expect(cfg.tabs['daemon:1'].enabled).toBe(true);
    // file mode 0o600
    const stats = require('node:fs').statSync(userConfigPath());
    expect(stats.mode & 0o777).toBe(0o600);
  });

  test('wrong version → defaults', () => {
    require('node:fs').mkdirSync(tmpRoot, { recursive: true });
    require('node:fs').writeFileSync(userConfigPath(), JSON.stringify({ version: 99, global: { tools: 'all' }, tabs: {} }));
    const cfg = readUserConfig();
    expect(cfg.version).toBe(USER_CONFIG_VERSION);
    expect(cfg.global).toEqual({});
  });

  test('readSwitchValue / writeSwitchValue · global', () => {
    const cfg = patchUserConfig((c) => writeSwitchValue(c, 'global.tools', 'readonly'));
    expect(readSwitchValue(cfg, 'global.tools')).toBe('readonly');
  });

  test('readSwitchValue / writeSwitchValue · tab nested', () => {
    const cfg = patchUserConfig((c) => writeSwitchValue(c, 'tabs.daemon:1.httpPort', 41000));
    expect(readSwitchValue(cfg, 'tabs.daemon:1.httpPort')).toBe(41000);
  });

  test('writeSwitchValue invalid id throws', () => {
    expect(() => patchUserConfig((c) => writeSwitchValue(c, 'unknown', 'x'))).toThrow();
    expect(() => patchUserConfig((c) => writeSwitchValue(c, 'session.x', 'y'))).toThrow();
  });
});

describe('secrets store', () => {
  test('missing file → empty', () => {
    expect(readSecrets().secrets).toEqual({});
  });

  test('setSecret / getSecret / listSecretIds / deleteSecret', () => {
    setSecret('tg', 'TOKEN-A');
    setSecret('dc', 'TOKEN-B');
    expect(getSecret('tg')).toBe('TOKEN-A');
    expect(listSecretIds().sort()).toEqual(['dc', 'tg']);
    expect(deleteSecret('tg')).toBe(true);
    expect(getSecret('tg')).toBeUndefined();
    expect(deleteSecret('tg')).toBe(false);
    // file mode 0o600
    const stats = require('node:fs').statSync(secretsPath());
    expect(stats.mode & 0o777).toBe(0o600);
  });
});

// ---------------------------------------------------------------------------
// SwitchRegistry
// ---------------------------------------------------------------------------

describe('SwitchRegistry', () => {
  test('built-ins loaded', () => {
    const ids = listSwitches().map((s) => s.id);
    expect(ids).toContain('global.tools');
    expect(ids).toContain('global.debug.enabled');
    expect(ids).toContain('tabs.telegram:1.tokenRef');
    expect(ids).toContain('tabs.discord:1.tokenRef');
  });

  test('GLOBAL_SWITCHES + CHANNEL_SWITCHES are registered', () => {
    expect(GLOBAL_SWITCHES.length).toBeGreaterThan(0);
    expect(CHANNEL_SWITCHES).toHaveLength(2);
  });

  test('registerSwitch + getSwitch', () => {
    registerSwitch({
      id: 'test.x',
      scope: 'global',
      kind: 'string',
      label: 'X',
      description: '',
      default: '',
      hotApplicable: true,
    });
    expect(getSwitch('test.x')?.label).toBe('X');
  });

  test('expandTabSwitchId replaces <id> placeholder', () => {
    expect(expandTabSwitchId('tabs.<id>.tokenRef', 'telegram:1')).toBe('tabs.telegram:1.tokenRef');
  });

  test('global.tools validate enforces enum', () => {
    const sw = getSwitch('global.tools')!;
    expect(sw.validate?.('webterm')).toBeNull();
    expect(sw.validate?.('mystery')).not.toBeNull();
  });

  test('dashboard.theme.active is a hot global enum derived from the theme registry', () => {
    const sw = getSwitch('dashboard.theme.active');
    const themeNames = THEME_REGISTRY.map((theme) => theme.name);

    expect(sw).toBeDefined();
    expect(GLOBAL_SWITCHES).toContain(sw!);
    expect(sw?.enumValues).toBeDefined();
    expect(sw?.enumValues?.length).toBeGreaterThan(0);
    expect(sw?.enumValues?.map((option) => option.value)).toEqual(themeNames);
    expect(sw?.default).toBe(DEFAULT_REGISTRY_THEME.name);
    expect(sw?.hotApplicable).toBe(true);
    expect(sw?.restartTabs).toEqual([]);
    expect(sw?.validate?.(themeNames[0])).toBeNull();
    expect(sw?.validate?.('unknown-theme')).toBe('must be a registered theme name');
  });
});

// ---------------------------------------------------------------------------
// env-derive
// ---------------------------------------------------------------------------

describe('deriveChildEnv', () => {
  function setupTabs() {
    const state = createNexusState({ nexusVersion: '0.12.0', phase: 'test' });
    const registry = new TabRegistry(state);
    registry.register(createDaemonTabSpec({ id: 'daemon:1' }));
    registry.register(createChannelBotTabSpec({ platform: 'telegram', id: 'telegram:1' }));
    return { state, registry };
  }

  test('global switch with envName populates env on every tab', () => {
    patchUserConfig((c) => writeSwitchValue(c, 'global.tools', 'all'));
    const { registry } = setupTabs();
    const env = deriveChildEnv({
      tab: registry.get('daemon:1')!,
      config: readUserConfig(),
      secrets: readSecrets(),
    });
    expect(env.ELANOUS_TOOLS).toBe('all');
  });

  test('tab-scope secret-ref expanded from secrets store', () => {
    setSecret('tg-token', 'SECRET-XYZ');
    patchUserConfig((c) => writeSwitchValue(c, 'tabs.telegram:1.tokenRef', makeSecretRef('tg-token')));
    const { registry } = setupTabs();
    const env = deriveChildEnv({
      tab: registry.get('telegram:1')!,
      config: readUserConfig(),
      secrets: readSecrets(),
    });
    expect(env.ELANOUS_TELEGRAM_BOT_TOKEN).toBe('SECRET-XYZ');
  });

  test('legacy env fallback honored when switch unset', () => {
    process.env.ELANOUS_TOOLS = 'readonly';
    const { registry } = setupTabs();
    const env = deriveChildEnv({
      tab: registry.get('daemon:1')!,
      config: readUserConfig(),
      secrets: readSecrets(),
    });
    expect(env.ELANOUS_TOOLS).toBe('readonly');
  });

  test('legacy env fallback disabled → switch unset → no env entry', () => {
    process.env.ELANOUS_TOOLS = 'readonly';
    const { registry } = setupTabs();
    const env = deriveChildEnv({
      tab: registry.get('daemon:1')!,
      config: readUserConfig(),
      secrets: readSecrets(),
      legacyEnvFallback: false,
    });
    expect(env.ELANOUS_TOOLS).toBeUndefined();
  });

  test('switch value beats legacy env', () => {
    process.env.ELANOUS_TOOLS = 'none';
    patchUserConfig((c) => writeSwitchValue(c, 'global.tools', 'webterm'));
    const { registry } = setupTabs();
    const env = deriveChildEnv({
      tab: registry.get('daemon:1')!,
      config: readUserConfig(),
      secrets: readSecrets(),
    });
    expect(env.ELANOUS_TOOLS).toBe('webterm');
  });

  test('appliesTo narrows tab-scope switches', () => {
    setSecret('tg-token', 'SECRET');
    patchUserConfig((c) => writeSwitchValue(c, 'tabs.telegram:1.tokenRef', makeSecretRef('tg-token')));
    const { registry } = setupTabs();
    // daemon should NOT receive ELANOUS_TELEGRAM_BOT_TOKEN
    const env = deriveChildEnv({
      tab: registry.get('daemon:1')!,
      config: readUserConfig(),
      secrets: readSecrets(),
    });
    expect(env.ELANOUS_TELEGRAM_BOT_TOKEN).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// env-migrate
// ---------------------------------------------------------------------------

describe('migrateLegacyEnvToConfig', () => {
  test('global env value migrates into UserConfig', () => {
    const state = createNexusState({ nexusVersion: '0.12.0', phase: 'test' });
    const registry = new TabRegistry(state);
    const result = migrateLegacyEnvToConfig({
      state,
      tabs: registry.list(),
      envSource: { ELANOUS_TOOLS: 'all' } as NodeJS.ProcessEnv,
    });
    expect(result.migrated).toContainEqual({ switchId: 'global.tools', legacyEnvName: 'ELANOUS_TOOLS' });
    expect(readSwitchValue(readUserConfig(), 'global.tools')).toBe('all');
  });

  test('telegram token env migrates → secret + ref', () => {
    const state = createNexusState({ nexusVersion: '0.12.0', phase: 'test' });
    const registry = new TabRegistry(state);
    registry.register(createChannelBotTabSpec({ platform: 'telegram', id: 'telegram:1' }));
    const result = migrateLegacyEnvToConfig({
      state,
      tabs: registry.list(),
      envSource: { ELANOUS_TELEGRAM_BOT_TOKEN: 'TG-FROM-ENV' } as NodeJS.ProcessEnv,
    });
    const m = result.migrated.find((x) => x.switchId === 'tabs.telegram:1.tokenRef');
    expect(m).toBeDefined();
    expect(m?.storedAsSecretId).toBeDefined();
    const ref = readSwitchValue(readUserConfig(), 'tabs.telegram:1.tokenRef');
    expect(isSecretRef(ref)).toBe(true);
    // Secret value preserved
    expect(getSecret(m!.storedAsSecretId!)).toBe('TG-FROM-ENV');
  });

  test('already-set switch is not overwritten', () => {
    patchUserConfig((c) => writeSwitchValue(c, 'global.tools', 'readonly'));
    const state = createNexusState({ nexusVersion: '0.12.0', phase: 'test' });
    const registry = new TabRegistry(state);
    const result = migrateLegacyEnvToConfig({
      state,
      tabs: registry.list(),
      envSource: { ELANOUS_TOOLS: 'all' } as NodeJS.ProcessEnv,
    });
    expect(result.migrated.find((x) => x.switchId === 'global.tools')).toBeUndefined();
    expect(result.skipped.find((s) => s.switchId === 'global.tools')?.reason).toBe('already-set');
    expect(readSwitchValue(readUserConfig(), 'global.tools')).toBe('readonly');
  });

  test('emits config.changed event with deprecation note', () => {
    const state = createNexusState({ nexusVersion: '0.12.0', phase: 'test' });
    const registry = new TabRegistry(state);
    migrateLegacyEnvToConfig({
      state,
      tabs: registry.list(),
      envSource: { ELANOUS_TOOLS: 'all' } as NodeJS.ProcessEnv,
    });
    const ev = state.events.find((e) => e.kind === 'config.changed');
    expect(ev).toBeDefined();
    expect((ev?.detail as { deprecation?: string })?.deprecation).toContain('ELANOUS_*');
  });
});

// ---------------------------------------------------------------------------
// applySwitchChange — hot vs restart dispatch
// ---------------------------------------------------------------------------

describe('applySwitchChange', () => {
  function setupRegistry() {
    const state = createNexusState({ nexusVersion: '0.12.0', phase: 'test' });
    const registry = new TabRegistry(state);
    registry.register(createDaemonTabSpec({ id: 'daemon:1' }));
    return { state, registry };
  }

  test('unknown switch → outcome=unknown-switch', async () => {
    const { state, registry } = setupRegistry();
    const r = await applySwitchChange({ state, registry, switchId: 'global.bogus', value: 'x' });
    expect(r.outcome).toBe('unknown-switch');
  });

  test('invalid value → outcome=invalid + validationError', async () => {
    const { state, registry } = setupRegistry();
    const r = await applySwitchChange({ state, registry, switchId: 'global.tools', value: 'bogus' });
    expect(r.outcome).toBe('invalid');
    expect(r.validationError).toBeDefined();
  });

  test('hot switch → outcome=hot, calls hotApplyHandler, persists', async () => {
    const { state, registry } = setupRegistry();
    let handlerCalls: { id: string; v: unknown }[] = [];
    const r = await applySwitchChange({
      state, registry, switchId: 'global.debug.enabled', value: true,
      hotApplyHandler: (id, v) => handlerCalls.push({ id, v }),
    });
    expect(r.outcome).toBe('hot');
    expect(handlerCalls).toEqual([{ id: 'global.debug.enabled', v: true }]);
    expect(readSwitchValue(readUserConfig(), 'global.debug.enabled')).toBe(true);
    expect(state.events.find((e) => e.kind === 'config.changed')).toBeDefined();
  });

  test('non-hot switch with no supervisor → outcome=no-op (still persists)', async () => {
    const { state, registry } = setupRegistry();
    const r = await applySwitchChange({
      state, registry, switchId: 'global.tools', value: 'readonly',
    });
    expect(r.outcome).toBe('no-op');
    expect(readSwitchValue(readUserConfig(), 'global.tools')).toBe('readonly');
  });

  test('non-hot switch with supervisor → outcome=restart, restartedTabs populated', async () => {
    const { state, registry } = setupRegistry();
    const restarted: string[] = [];
    const fakeSupervisor = {
      reclaim: () => [],
      managedIds: () => [],
      shutdown: async () => {},
      stopTab: async (id: string) => { restarted.push(`stop:${id}`); },
      startTab: async (id: string) => { restarted.push(`start:${id}`); },
    } as const;
    const r = await applySwitchChange({
      state, registry,
      supervisor: fakeSupervisor as never,
      switchId: 'global.tools', value: 'readonly',
    });
    expect(r.outcome).toBe('restart');
    expect(r.restartedTabs).toEqual(['daemon:1']);
    expect(restarted).toEqual(['stop:daemon:1', 'start:daemon:1']);
  });

  test('config.changed event is redacted for secret-ref switches', async () => {
    const { state, registry } = setupRegistry();
    registry.register(createChannelBotTabSpec({ platform: 'telegram', id: 'telegram:1' }));
    setSecret('tg-token', 'TOKEN-VAL');
    await applySwitchChange({
      state, registry, switchId: 'tabs.telegram:1.tokenRef', value: makeSecretRef('tg-token'),
    });
    const ev = state.events.find((e) => e.kind === 'config.changed');
    expect((ev?.detail as { redacted?: boolean })?.redacted).toBe(true);
    expect((ev?.detail as { value?: unknown })?.value).toBeUndefined();
  });
});

describe('paths', () => {
  test('userConfigPath / secretsPath honor setElanousConfigDir override', () => {
    expect(userConfigPath()).toBe(join(tmpRoot, 'config.json'));
    expect(secretsPath()).toBe(join(tmpRoot, 'secrets.json'));
  });
});
