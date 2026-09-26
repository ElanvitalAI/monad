// user-config: `notifications.apns` read path · `global.<...>` precedence
//
// `elanous nexus config set notifications.apns ...` is rejected (`use
// global.<...> or tabs.<id>.<...>`), so any APNs config the CLI writes
// lands under `global.notifications.apns`. Before this fix the parser
// only read top-level `rawObj.notifications`, so daemon boot logged
// `apns-config-absent` even when the CLI reported a successful write.
//
// The parser now reads from `rawObj.global.notifications` first and
// falls back to the legacy top-level slot.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildUserConfig,
  resetUserConfig,
} from '../src/user-config';

let root: string;
let cfgPath: string;

const APNS_FIXTURE = {
  keyId: 'ABCDEFGHIJ',
  teamId: 'ZZZZ123456',
  bundleId: 'com.elanvitalai.elanous.ios',
  keyPath: '/Users/test/.elanous/apns.p8',
};

function write(json: unknown): void {
  writeFileSync(cfgPath, JSON.stringify(json));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'user-config-notifications-'));
  cfgPath = join(root, 'config.json');
  resetUserConfig();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetUserConfig();
});

describe('user-config notifications.apns global layout', () => {
  test('missing notifications → undefined', () => {
    write({});
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications).toBeUndefined();
  });

  test('legacy top-level notifications.apns still parses', () => {
    write({ notifications: { apns: APNS_FIXTURE } });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications?.apns).toEqual(APNS_FIXTURE);
  });

  test('global.notifications.apns (RFC #2161 layout) parses', () => {
    write({ global: { notifications: { apns: APNS_FIXTURE } } });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications?.apns).toEqual(APNS_FIXTURE);
  });

  test('global wins when both present (CLI write is canonical)', () => {
    const stale = { ...APNS_FIXTURE, keyId: 'STALE12345' };
    write({
      notifications: { apns: stale },
      global: { notifications: { apns: APNS_FIXTURE } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications?.apns?.keyId).toBe(APNS_FIXTURE.keyId);
  });

  test('global.notifications absent but other global slots present → falls back', () => {
    write({
      notifications: { apns: APNS_FIXTURE },
      global: { nexus: { template: 'demo' } },
    });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications?.apns).toEqual(APNS_FIXTURE);
  });

  test('sparse APNs (missing keyId) drops the whole notifications entry', () => {
    const incomplete = { teamId: APNS_FIXTURE.teamId, bundleId: APNS_FIXTURE.bundleId, keyPath: APNS_FIXTURE.keyPath };
    write({ global: { notifications: { apns: incomplete } } });
    const cfg = buildUserConfig(cfgPath);
    expect(cfg.notifications).toBeUndefined();
  });
});
