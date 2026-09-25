// RFC #2161 FU · 2026-05-11 — user-config resolver for discovery wiring.
//
// Verifies the priority chain: user-config (`registry.discovery.*`)
// wins over legacy env (`MONAD_DISCOVERY_CRON_INTERVAL_MS` /
// `FIRECRAWL_API_KEY`), env wins over default. The omni-crawl bridge
// branch was removed in A6-real P4 alongside its source. See
// `feedback_user_config_over_env.md` for the policy.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getDiscoveryCronConfig,
  getFirecrawlConfig,
} from '../src/registry/discovery/config.js';
import { resetUserConfig } from '../src/user-config.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmpDir: string;
const ENV_KEYS = [
  'MONAD_DISCOVERY_CRON_INTERVAL_MS',
  'FIRECRAWL_API_KEY',
];

function writeConfig(payload: Record<string, unknown>): void {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(
    join(tmpDir, 'config.json'),
    JSON.stringify(payload, null, 2),
    'utf-8',
  );
  // Force cache rebuild because successive tests may all write under
  // a different inode but the same path — mtime alone is not enough
  // when bun runs tests in <1ms windows on fast filesystems.
  resetUserConfig();
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'discovery-config-'));
  setMonadConfigDir(tmpDir);
  for (const k of ENV_KEYS) delete process.env[k];
  resetUserConfig();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  resetMonadConfigDir();
  for (const k of ENV_KEYS) delete process.env[k];
  resetUserConfig();
});

describe('getFirecrawlConfig', () => {
  test('returns empty when neither user-config nor env set', () => {
    const resolved = getFirecrawlConfig();
    expect(resolved.apiKey).toBe('');
  });

  test('falls back to env when user-config absent', () => {
    process.env.FIRECRAWL_API_KEY = 'env-key';
    const resolved = getFirecrawlConfig();
    expect(resolved.apiKey).toBe('env-key');
  });

  test('user-config apiKey wins over env', () => {
    writeConfig({
      registry: { discovery: { firecrawl: { apiKey: 'config-key' } } },
    });
    process.env.FIRECRAWL_API_KEY = 'env-key';
    const resolved = getFirecrawlConfig();
    expect(resolved.apiKey).toBe('config-key');
  });

  test('whitespace-only user-config falls through to env', () => {
    writeConfig({
      registry: { discovery: { firecrawl: { apiKey: '   ' } } },
    });
    process.env.FIRECRAWL_API_KEY = 'env-key';
    const resolved = getFirecrawlConfig();
    expect(resolved.apiKey).toBe('env-key');
  });
});

describe('getDiscoveryCronConfig', () => {
  test('returns 0 (dormant) when neither set', () => {
    expect(getDiscoveryCronConfig().intervalMs).toBe(0);
  });

  test('falls back to env when user-config absent', () => {
    process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS = '120000';
    expect(getDiscoveryCronConfig().intervalMs).toBe(120000);
  });

  test('user-config intervalMs wins over env', () => {
    writeConfig({
      registry: { discovery: { cron: { intervalMs: 300_000 } } },
    });
    process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS = '120000';
    expect(getDiscoveryCronConfig().intervalMs).toBe(300_000);
  });

  test('clamps user-config value below 60s up to 60s', () => {
    writeConfig({
      registry: { discovery: { cron: { intervalMs: 1000 } } },
    });
    expect(getDiscoveryCronConfig().intervalMs).toBe(60_000);
  });

  test('clamps user-config value above 24h down to 24h', () => {
    writeConfig({
      registry: { discovery: { cron: { intervalMs: 999_999_999_999 } } },
    });
    expect(getDiscoveryCronConfig().intervalMs).toBe(86_400_000);
  });

  test('clamps env value below 60s up to 60s', () => {
    process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS = '500';
    expect(getDiscoveryCronConfig().intervalMs).toBe(60_000);
  });

  test('rejects non-numeric env (treats as dormant)', () => {
    process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS = 'not-a-number';
    expect(getDiscoveryCronConfig().intervalMs).toBe(0);
  });

  test('rejects negative user-config value (falls back to env or dormant)', () => {
    writeConfig({
      registry: { discovery: { cron: { intervalMs: -1 } } },
    });
    process.env.MONAD_DISCOVERY_CRON_INTERVAL_MS = '90000';
    expect(getDiscoveryCronConfig().intervalMs).toBe(90_000);
  });
});

describe('user-config schema parsing', () => {
  test('missing registry block defaults to empty cron/firecrawl', () => {
    writeConfig({ skillRouter: { autoRoute: false } });
    expect(getDiscoveryCronConfig().intervalMs).toBe(0);
    expect(getFirecrawlConfig().apiKey).toBe('');
  });

  test('malformed registry block (non-object) defaults to empty', () => {
    writeConfig({ registry: 'not-an-object' });
    expect(getDiscoveryCronConfig().intervalMs).toBe(0);
    expect(getFirecrawlConfig().apiKey).toBe('');
  });

  test('malformed firecrawl block (array) defaults to empty', () => {
    writeConfig({ registry: { discovery: { firecrawl: [1, 2] } } });
    expect(getFirecrawlConfig().apiKey).toBe('');
  });
});
