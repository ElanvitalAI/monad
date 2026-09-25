import { describe, expect, test } from 'bun:test';
import { writeFileSync, mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cachePathFor, cacheRoot } from '../src/preview/cache.js';

describe('preview cache', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'preview-cache-'));

  test('cacheRoot is stable and under HOME/.cache (or XDG)', () => {
    const r = cacheRoot();
    expect(r.endsWith('monad-agent/preview')).toBe(true);
  });

  test('same file + skip → same cache path', () => {
    const f = join(tmp, 'a.pdf');
    writeFileSync(f, 'hello');
    const p1 = cachePathFor(f, 0);
    const p2 = cachePathFor(f, 0);
    expect(p1).toBe(p2);
  });

  test('different skip → different cache path', () => {
    const f = join(tmp, 'b.pdf');
    writeFileSync(f, 'hello');
    expect(cachePathFor(f, 0)).not.toBe(cachePathFor(f, 1));
  });

  test('changed mtime → different cache path', () => {
    const f = join(tmp, 'c.pdf');
    writeFileSync(f, 'hello');
    const p1 = cachePathFor(f, 0);
    const past = new Date(Date.now() - 60_000);
    utimesSync(f, past, past);
    const p2 = cachePathFor(f, 0);
    expect(p1).not.toBe(p2);
  });

  test('extension is configurable', () => {
    const f = join(tmp, 'd.pdf');
    writeFileSync(f, 'hello');
    expect(cachePathFor(f, 0, '.png').endsWith('.png')).toBe(true);
    expect(cachePathFor(f, 0, 'webp').endsWith('.webp')).toBe(true);
  });
});
