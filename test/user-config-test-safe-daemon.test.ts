// buildTestSafeDaemonConfig — the config transform that lets `nexus run
// --test` run an isolated daemon that can NEVER poll/post to production
// telegram/discord. Config otherwise stays the prod config (in sync); only
// the surfaces that reach live chats are neutralized.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildUserConfig, buildTestSafeDaemonConfig,
  setUserConfigOverlay, getUserConfig, resetUserConfig,
} from '../src/user-config';

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  setUserConfigOverlay(null);
  resetUserConfig();
});

function cfgFrom(telegram: Record<string, unknown>, discord: Record<string, unknown> = {}) {
  dir = mkdtempSync(join(tmpdir(), 'tsd-'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify({ telegram, discord }), 'utf-8');
  return { path: p, cfg: buildUserConfig(p) };
}

describe('buildTestSafeDaemonConfig · pure', () => {
  test('with a test token → swaps to it, drops prod outbound routes, disables discord', () => {
    const { cfg } = cfgFrom(
      {
        enabled: true, botToken: '8799:PROD', allowedUsers: [1],
        homeChannel: 42, reportChannel: { chatId: 7, botToken: 'REP:tok' },
        channels: [{ name: 'trade', botToken: 'CH:tok', roles: ['qna'] }],
        testChannel: { botToken: '8724:TEST', allowedUsers: [1301607555] },
      },
      { enabled: true, botToken: 'DISCORD:tok' },
    );
    const safe = buildTestSafeDaemonConfig(cfg);
    expect(safe.telegram.enabled).toBe(true);
    expect(safe.telegram.botToken).toBe('8724:TEST');        // test token, not prod
    expect(safe.telegram.allowedUsers).toEqual([1301607555]); // testChannel allowlist
    expect(safe.telegram.reportChannel).toBeUndefined();      // no prod report posting
    expect(safe.telegram.homeChannel).toBeUndefined();
    expect(safe.telegram.channels).toBeUndefined();
    expect(safe.discord.enabled).toBe(false);                 // discord off (no test concept)
  });

  test('without a test token → disables telegram entirely (never touches prod)', () => {
    const { cfg } = cfgFrom(
      { enabled: true, botToken: '8799:PROD', allowedUsers: [1], reportChannel: { chatId: 7 } },
      { enabled: true, botToken: 'D:tok' },
    );
    const safe = buildTestSafeDaemonConfig(cfg);
    expect(safe.telegram.enabled).toBe(false);                // prod token never polled
    expect(safe.telegram.reportChannel).toBeUndefined();
    expect(safe.discord.enabled).toBe(false);
  });

  test('does not mutate the input config', () => {
    const { cfg } = cfgFrom({ enabled: true, botToken: '8799:PROD', allowedUsers: [1], testChannel: { botToken: 'T:tok' } });
    buildTestSafeDaemonConfig(cfg);
    expect(cfg.telegram.botToken).toBe('8799:PROD');          // original untouched
  });
});

describe('setUserConfigOverlay · applies to every getUserConfig', () => {
  test('installed overlay makes getUserConfig return the transform result', () => {
    const { path } = cfgFrom({
      enabled: true, botToken: '8799:PROD', allowedUsers: [1],
      reportChannel: { chatId: 7 }, testChannel: { botToken: '8724:TEST' },
    }, { enabled: true, botToken: 'D:tok' });

    // Baseline — no overlay → prod config verbatim.
    expect(getUserConfig(path).telegram.botToken).toBe('8799:PROD');

    setUserConfigOverlay(buildTestSafeDaemonConfig);
    const c = getUserConfig(path);
    expect(c.telegram.botToken).toBe('8724:TEST');
    expect(c.telegram.reportChannel).toBeUndefined();
    expect(c.discord.enabled).toBe(false);

    // Clearing restores prod resolution.
    setUserConfigOverlay(null);
    expect(getUserConfig(path).telegram.botToken).toBe('8799:PROD');
  });
});
