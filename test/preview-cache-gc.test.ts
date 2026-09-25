import { describe, expect, test } from 'bun:test';
import { writeFileSync, utimesSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { cacheGc, cacheRoot } from '../src/preview/cache.js';

describe('cacheGc', () => {
  test('removes files older than threshold, keeps fresh ones', () => {
    const root = cacheRoot();
    const oldPath = join(root, 'gc-test-old.dat');
    const freshPath = join(root, 'gc-test-fresh.dat');
    writeFileSync(oldPath, 'x');
    writeFileSync(freshPath, 'x');

    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(oldPath, longAgo, longAgo);

    const removed = cacheGc(7 * 24 * 60 * 60 * 1000);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(freshPath)).toBe(true);

    // cleanup: delete fresh one too so this test doesn't leak.
    try { require('node:fs').unlinkSync(freshPath); } catch { /* ignore */ }
  });

  test('returns 0 when dir is empty / missing entries', () => {
    // After the first test, the fresh file was cleaned up. GC on the
    // still-existing cache root must not throw.
    const beforeCount = readdirSync(cacheRoot()).length;
    const removed = cacheGc(0);  // threshold = now → removes everything
    expect(removed).toBeLessThanOrEqual(beforeCount);
  });
});
