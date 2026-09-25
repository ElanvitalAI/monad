// Phase 4 (PLAN-config-unification-monad-root-2026-05-10):
//   getUserConfig()'s in-process cache invalidates when the on-disk file
//   has been rewritten by another module / process — NEXUS daemon's
//   patchUserConfig (Path B writer) is the canonical example.
//
// Strategy: write file → getUserConfig (caches) → rewrite + bump mtime
// via utimesSync (avoids fs mtime granularity flakes) → getUserConfig
// again must return the post-rewrite shape.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync, rmSync, statSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getUserConfig, reloadUserConfig, resetUserConfig, saveUserConfig,
} from '../src/user-config';

let root: string;
let cfgPath: string;

function writeRaw(json: unknown): void {
  writeFileSync(cfgPath, JSON.stringify(json));
}
function bumpMtimeForward(path: string, secondsAhead = 5): void {
  const next = (Date.now() / 1000) + secondsAhead;
  utimesSync(path, next, next);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'p4-cache-'));
  cfgPath = join(root, 'config.json');
  resetUserConfig();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetUserConfig();
});

describe('Phase 4 · getUserConfig cache invalidation by mtime', () => {
  test('repeated read with no on-disk change returns cached instance', () => {
    writeRaw({ llm: { provider: 'anthropic' } });
    const a = getUserConfig(cfgPath);
    const b = getUserConfig(cfgPath);
    // Same identity — no rebuild because mtime unchanged.
    expect(a).toBe(b);
    expect(a.llm.provider).toBe('anthropic');
  });

  test('external rewrite (mtime advance) → cache reloads on next read', () => {
    writeRaw({ llm: { provider: 'anthropic' } });
    const first = getUserConfig(cfgPath);
    expect(first.llm.provider).toBe('anthropic');

    // Simulate NEXUS daemon's patchUserConfig writing the same file
    // with different content; bump mtime to defeat sub-ms timing.
    writeRaw({ llm: { provider: 'gemini' } });
    bumpMtimeForward(cfgPath);

    const second = getUserConfig(cfgPath);
    expect(second).not.toBe(first); // rebuilt
    expect(second.llm.provider).toBe('gemini');
  });

  test('NEXUS schema mutation in external write surfaces on next read', () => {
    writeRaw({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'disabled' } } },
      tabs: {},
    });
    const first = getUserConfig(cfgPath);
    expect((first.global as Record<string, Record<string, Record<string, unknown>>>)
      .nexus.pwa.shareTailnet).toBe('disabled');

    // External writer flips the switch.
    writeRaw({
      version: 1,
      global: { nexus: { pwa: { shareTailnet: 'enabled' } } },
      tabs: {},
    });
    bumpMtimeForward(cfgPath);

    const second = getUserConfig(cfgPath);
    expect((second.global as Record<string, Record<string, Record<string, unknown>>>)
      .nexus.pwa.shareTailnet).toBe('enabled');
  });

  test('saveUserConfig refreshes cachedMtime so subsequent reads are cached', () => {
    writeRaw({ llm: { provider: 'anthropic' } });
    const cfg = getUserConfig(cfgPath);

    // Mutate via setter and save — cache should remain valid (no rebuild)
    // because saveUserConfig captures the post-write mtime.
    cfg.llm.provider = 'gemini';
    saveUserConfig(cfg, cfgPath);

    const after = getUserConfig(cfgPath);
    // Same instance — saveUserConfig also assigns cache = cfg.
    expect(after).toBe(cfg);
    expect(after.llm.provider).toBe('gemini');
  });

  test('file deletion between reads → buildUserConfig falls back to defaults', () => {
    writeRaw({ llm: { provider: 'anthropic' } });
    const first = getUserConfig(cfgPath);
    expect(first.llm.provider).toBe('anthropic');

    rmSync(cfgPath);

    const second = getUserConfig(cfgPath);
    // mtime null after deletion → cache invalidated → build defaults.
    expect(second).not.toBe(first);
    expect(second.llm.provider).toBe('auto'); // LLM_DEFAULTS
  });

  test('reloadUserConfig forcibly rebuilds and updates mtime baseline', () => {
    writeRaw({ llm: { provider: 'anthropic' } });
    const first = reloadUserConfig(cfgPath);
    expect(first.llm.provider).toBe('anthropic');

    // mtime baseline now matches the just-loaded file → next read is cached.
    const cached = getUserConfig(cfgPath);
    expect(cached).toBe(first);

    // External rewrite + bump → reloadUserConfig still rebuilds.
    writeRaw({ llm: { provider: 'gemini' } });
    bumpMtimeForward(cfgPath);
    const reloaded = reloadUserConfig(cfgPath);
    expect(reloaded).not.toBe(first);
    expect(reloaded.llm.provider).toBe('gemini');
  });

  test('cache survives concurrent stat-only operations (no fs writes)', () => {
    writeRaw({ llm: { provider: 'anthropic' } });
    const a = getUserConfig(cfgPath);

    // Touching stat without modifying content should leave mtime alone.
    const before = statSync(cfgPath).mtimeMs;
    expect(before).toBeGreaterThan(0);

    const b = getUserConfig(cfgPath);
    expect(b).toBe(a);
  });
});
