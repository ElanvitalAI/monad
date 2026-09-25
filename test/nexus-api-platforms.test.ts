// BACKLOG #2 — verify GET /v1/platforms reports the right
// connected/not-configured shape per integration channel.
//
// We isolate the test from the user's actual UserConfig + secret
// store by pointing MONAD_NEXUS_DIR at a tmp dir, loading the
// SwitchRegistry built-ins, and writing fixture switches /
// secrets via the public APIs.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildPlatformList,
  type PlatformEntry,
} from '../src/nexus/api/platforms.js';
import {
  writeSwitchValue,
  patchUserConfig,
} from '../src/nexus/config/user-config.js';
import { setSecret, deleteSecret } from '../src/nexus/config/secrets/index.js';
import { loadAllBuiltins } from '../src/nexus/config/builtins/index.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'platforms-test-'));
  setMonadConfigDir(tmpDir);
  mkdirSync(tmpDir, { recursive: true });
  loadAllBuiltins();
});

afterEach(() => {
  resetMonadConfigDir();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function entry(list: PlatformEntry[], id: PlatformEntry['id']): PlatformEntry {
  const e = list.find((p) => p.id === id);
  if (!e) throw new Error(`platform '${id}' missing from list`);
  return e;
}

describe('buildPlatformList — disconnected baseline', () => {
  it('reports all five platforms as not-configured on a clean install', () => {
    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    expect(list.length).toBe(5);
    expect(list.map((p) => p.id)).toEqual(['discord', 'telegram', 'pushcut', 'acp', 'tailscale']);
    for (const e of list) {
      expect(e.status).toBe('not-configured');
      expect(e.label.length).toBeGreaterThan(0);
      expect(typeof e.detail).toBe('string');
      expect(typeof e.hint === 'string' || e.hint === undefined).toBe(true);
    }
  });
});

describe('buildPlatformList — Discord/Telegram secret-ref path', () => {
  it('marks Discord connected when the switch points at an existing secret', () => {
    setSecret('secret://discord/bot-token', 'fake-token-value');
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'tabs.discord:1.tokenRef', 'secret://discord/bot-token'));

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    expect(entry(list, 'discord').status).toBe('connected');
    expect(entry(list, 'discord').detail).toContain('secret-ref');
  });

  it('marks Discord not-configured when the switch references a missing secret', () => {
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'tabs.discord:1.tokenRef', 'secret://discord/missing'));

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    const d = entry(list, 'discord');
    expect(d.status).toBe('not-configured');
    expect(d.detail).toContain('missing secret');
  });

  it('marks Telegram connected when the switch points at an existing secret', () => {
    setSecret('secret://telegram/bot-token', 'fake-tg-token');
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'tabs.telegram:1.tokenRef', 'secret://telegram/bot-token'));

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    expect(entry(list, 'telegram').status).toBe('connected');
  });
});

describe('buildPlatformList — Pushcut webhook', () => {
  it('reports off when pushcut.enabled switch is false', () => {
    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    const p = entry(list, 'pushcut');
    expect(p.status).toBe('not-configured');
    expect(p.detail).toContain('switch off');
  });

  it('reports connected when enabled + secret stored', () => {
    setSecret('secret://pushcut/webhook', 'fake-webhook-secret');
    patchUserConfig((cfg) => {
      writeSwitchValue(cfg, 'tabs.daemon:1.pushcut.enabled', true);
      writeSwitchValue(cfg, 'tabs.daemon:1.pushcut.webhookSecretRef', 'secret://pushcut/webhook');
    });

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    const p = entry(list, 'pushcut');
    expect(p.status).toBe('connected');
    expect(p.detail).toContain('webhook secret');
  });

  it('reports enabled-but-no-secret as not-configured with explanatory detail', () => {
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'tabs.daemon:1.pushcut.enabled', true));

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    const p = entry(list, 'pushcut');
    expect(p.status).toBe('not-configured');
    expect(p.detail.length).toBeGreaterThan(0);
  });
});

describe('buildPlatformList — ACP token file', () => {
  it('reports connected when the acp-token file exists', () => {
    const tokenPath = join(tmpDir, 'acp-token');
    writeFileSync(tokenPath, 'bearer-xyz', 'utf-8');

    const list = buildPlatformList({ acpTokenPath: tokenPath });
    const a = entry(list, 'acp');
    expect(a.status).toBe('connected');
    expect(a.detail).toContain('present');
  });

  it('reports not-configured when the acp-token file is missing', () => {
    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-such-file') });
    const a = entry(list, 'acp');
    expect(a.status).toBe('not-configured');
  });
});

describe('buildPlatformList — Tailscale share', () => {
  it('reports connected when shareTailnet switch is true', () => {
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'global.nexus.pwa.shareTailnet', true));

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    const t = entry(list, 'tailscale');
    expect(t.status).toBe('connected');
  });

  it('reports not-configured when shareTailnet switch is false / unset', () => {
    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    const t = entry(list, 'tailscale');
    expect(t.status).toBe('not-configured');
  });
});

describe('buildPlatformList — never leaks secret values', () => {
  it('detail strings do not contain the literal secret value', () => {
    const SECRET_VALUE = 'super-secret-bot-token-XYZ-DO-NOT-LEAK';
    setSecret('secret://discord/bot-token', SECRET_VALUE);
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'tabs.discord:1.tokenRef', 'secret://discord/bot-token'));

    const list = buildPlatformList({ acpTokenPath: join(tmpDir, 'no-acp-token') });
    for (const e of list) {
      expect(e.detail).not.toContain(SECRET_VALUE);
      if (e.hint) expect(e.hint).not.toContain(SECRET_VALUE);
    }
  });
});

// Defensive cleanup so a follow-up test doesn't see leaked state.
afterEach(() => {
  for (const id of [
    'secret://discord/bot-token',
    'secret://telegram/bot-token',
    'secret://pushcut/webhook',
    'secret://discord/missing',
  ]) {
    try { deleteSecret(id); } catch { /* ignore */ }
  }
});
