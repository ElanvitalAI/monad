// ── clipboard tests ──
//
// The osascript path depends on a real macOS clipboard — we can't exercise
// it deterministically in unit tests. We cover:
//   - isClipboardSupported platform gating
//   - pruneOldPastes TTL sweeping in an isolated directory
//   - grabClipboardImage returns null on non-macOS (platform guard)
//
// Live clipboard verification is done manually (see M3 e2e script).

import { describe, test, expect, afterAll } from 'bun:test';
import {
  writeFileSync, mkdirSync, rmSync, mkdtempSync, readdirSync, utimesSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  pruneOldPastes,
  isClipboardSupported,
  grabClipboardImage,
  PASTE_FILENAME_PREFIX,
} from '../src/clipboard/index';

const tmpRoot = mkdtempSync(join(tmpdir(), 'elanous-clip-'));

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('isClipboardSupported', () => {
  test('matches process.platform', () => {
    expect(isClipboardSupported()).toBe(process.platform === 'darwin');
  });
});

describe('pruneOldPastes', () => {
  test('removes files older than TTL, keeps fresh ones', () => {
    const dir = join(tmpRoot, 'prune');
    mkdirSync(dir, { recursive: true });

    const stale = join(dir, `${PASTE_FILENAME_PREFIX}old.png`);
    const fresh = join(dir, `${PASTE_FILENAME_PREFIX}new.png`);
    const unrelated = join(dir, 'other-file.png');

    writeFileSync(stale, 'x');
    writeFileSync(fresh, 'y');
    writeFileSync(unrelated, 'z');

    // Backdate `stale` by 48h so a 24h TTL sweeps it.
    const past = Date.now() / 1000 - 48 * 60 * 60;
    utimesSync(stale, past, past);

    const removed = pruneOldPastes(24 * 60 * 60 * 1000, dir);
    expect(removed).toBe(1);

    const survivors = readdirSync(dir).sort();
    expect(survivors).toContain(`${PASTE_FILENAME_PREFIX}new.png`);
    expect(survivors).toContain('other-file.png');
    expect(survivors).not.toContain(`${PASTE_FILENAME_PREFIX}old.png`);
  });

  test('ignores non-prefixed files even when stale', () => {
    const dir = join(tmpRoot, 'prefix-only');
    mkdirSync(dir, { recursive: true });
    const keep = join(dir, 'screenshot.png');
    writeFileSync(keep, 'x');
    const past = Date.now() / 1000 - 48 * 60 * 60;
    utimesSync(keep, past, past);

    const removed = pruneOldPastes(24 * 60 * 60 * 1000, dir);
    expect(removed).toBe(0);
    expect(readdirSync(dir)).toContain('screenshot.png');
  });

  test('returns 0 for non-existent directory', () => {
    expect(pruneOldPastes(1000, join(tmpRoot, 'does-not-exist'))).toBe(0);
  });
});

describe('grabClipboardImage (platform gate)', () => {
  test('returns null on non-macOS platforms', async () => {
    if (process.platform === 'darwin') {
      // Can't assert null without clearing the clipboard; skip on macOS
      // (we test the success path manually in the M3 e2e verification).
      return;
    }
    expect(await grabClipboardImage()).toBeNull();
  });
});
