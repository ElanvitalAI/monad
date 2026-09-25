// W7-후속 (2026-05-12) — UserConfig.notifications.apns sparse parse.
//
// `notifications.apns` requires all 4 of keyId / teamId / bundleId /
// keyPath. Missing any single one → parser returns undefined → daemon
// boots the ios-push channel with transport=undefined (loud, not
// silent · `transport-not-configured` on attempted send).

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildUserConfig } from '../src/user-config.js';

let root: string;
let cfgPath: string;

function writeFile(json: unknown): void {
  writeFileSync(cfgPath, JSON.stringify(json));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'w7-notifications-'));
  cfgPath = join(root, 'config.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('UserConfig.notifications sparse parse', () => {
  test('absent → undefined (not empty object)', () => {
    writeFile({ llm: { provider: 'anthropic' } });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications).toBeUndefined();
  });

  test('empty notifications object → undefined', () => {
    writeFile({ notifications: {} });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications).toBeUndefined();
  });

  test('empty apns object → undefined (no required leaf fields)', () => {
    writeFile({ notifications: { apns: {} } });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications).toBeUndefined();
  });

  test('partial apns (missing keyPath) → undefined', () => {
    writeFile({
      notifications: {
        apns: { keyId: 'KID', teamId: 'TID', bundleId: 'com.x.y' },
      },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications).toBeUndefined();
  });

  test('all required fields → apns populated · environment defaults to undefined', () => {
    writeFile({
      notifications: {
        apns: {
          keyId: 'KID1234567',
          teamId: 'TID1234567',
          bundleId: 'com.monad.app',
          keyPath: '~/.monad/apns.p8',
        },
      },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications?.apns?.keyId).toBe('KID1234567');
    expect(cfg.notifications?.apns?.teamId).toBe('TID1234567');
    expect(cfg.notifications?.apns?.bundleId).toBe('com.monad.app');
    expect(cfg.notifications?.apns?.keyPath).toBe('~/.monad/apns.p8');
    expect(cfg.notifications?.apns?.environment).toBeUndefined();
  });

  test('environment=sandbox / production accepted', () => {
    writeFile({
      notifications: {
        apns: {
          keyId: 'K', teamId: 'T', bundleId: 'b', keyPath: 'p',
          environment: 'sandbox',
        },
      },
    });
    expect(buildUserConfig(cfgPath).notifications?.apns?.environment).toBe('sandbox');

    writeFile({
      notifications: {
        apns: {
          keyId: 'K', teamId: 'T', bundleId: 'b', keyPath: 'p',
          environment: 'production',
        },
      },
    });
    expect(buildUserConfig(cfgPath).notifications?.apns?.environment).toBe('production');
  });

  test('environment with invalid value → undefined (but apns still valid)', () => {
    writeFile({
      notifications: {
        apns: {
          keyId: 'K', teamId: 'T', bundleId: 'b', keyPath: 'p',
          environment: 'staging',
        },
      },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications?.apns).toBeDefined();
    expect(cfg.notifications?.apns?.environment).toBeUndefined();
  });

  test('blank / whitespace strings rejected', () => {
    writeFile({
      notifications: {
        apns: {
          keyId: '   ', teamId: 'T', bundleId: 'b', keyPath: 'p',
        },
      },
    });
    expect(buildUserConfig(cfgPath).notifications).toBeUndefined();
  });

  test('trims whitespace around populated fields', () => {
    writeFile({
      notifications: {
        apns: {
          keyId: '  KID  ', teamId: ' TID ', bundleId: 'b', keyPath: 'p',
        },
      },
    });
    const apns = buildUserConfig(cfgPath).notifications?.apns;
    expect(apns?.keyId).toBe('KID');
    expect(apns?.teamId).toBe('TID');
  });
});
