import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';
import { ReadFileStateStore, hashContent } from '../../src/code-edit/index.js';

describe('ReadFileStateStore', () => {
  test('recordRead + verifyBeforeEdit round-trip with absolute paths', () => {
    const s = new ReadFileStateStore();
    s.recordRead('/tmp/a.ts', { content: 'hello' });
    const e = s.verifyBeforeEdit('/tmp/a.ts');
    expect(e).not.toBeNull();
    expect(e!.path).toBe('/tmp/a.ts');
    expect(e!.partialView).toBe(false);
    expect(e!.contentHash).toBe(hashContent('hello'));
    expect(typeof e!.ts).toBe('number');
  });

  test('relative paths canonicalise to absolute via cwd', () => {
    const s = new ReadFileStateStore();
    s.recordRead('./rel.ts', { content: 'x' });
    const abs = resolve(process.cwd(), 'rel.ts');
    expect(s.verifyBeforeEdit('./rel.ts')?.path).toBe(abs);
    expect(s.verifyBeforeEdit(abs)?.path).toBe(abs);
  });

  test('partialView flag preserved; hash omitted for partial reads', () => {
    const s = new ReadFileStateStore();
    s.recordRead('/tmp/big.ts', { partialView: true });
    const e = s.verifyBeforeEdit('/tmp/big.ts')!;
    expect(e.partialView).toBe(true);
    expect(e.contentHash).toBeUndefined();
  });

  test('verifyBeforeEdit returns null when file was never read', () => {
    const s = new ReadFileStateStore();
    expect(s.verifyBeforeEdit('/tmp/never.ts')).toBeNull();
  });

  test('invalidate forces next verify to miss', () => {
    const s = new ReadFileStateStore();
    s.recordRead('/tmp/a.ts', { content: 'x' });
    expect(s.verifyBeforeEdit('/tmp/a.ts')).not.toBeNull();
    s.invalidate('/tmp/a.ts');
    expect(s.verifyBeforeEdit('/tmp/a.ts')).toBeNull();
  });

  test('clear wipes everything', () => {
    const s = new ReadFileStateStore();
    s.recordRead('/tmp/a.ts', { content: 'x' });
    s.recordRead('/tmp/b.ts', { content: 'y' });
    expect(s.size()).toBe(2);
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.entries()).toEqual([]);
  });

  test('re-recording the same path overwrites ts + hash', async () => {
    const s = new ReadFileStateStore();
    s.recordRead('/tmp/a.ts', { content: 'v1' });
    const t1 = s.verifyBeforeEdit('/tmp/a.ts')!.ts;
    const h1 = s.verifyBeforeEdit('/tmp/a.ts')!.contentHash;
    await new Promise((r) => setTimeout(r, 2));
    s.recordRead('/tmp/a.ts', { content: 'v2' });
    const e2 = s.verifyBeforeEdit('/tmp/a.ts')!;
    expect(e2.ts).toBeGreaterThan(t1);
    expect(e2.contentHash).not.toBe(h1);
  });

  test('hashContent is stable and differs by content', () => {
    expect(hashContent('a')).toBe(hashContent('a'));
    expect(hashContent('a')).not.toBe(hashContent('b'));
    // Sanity: SHA-256 hex = 64 chars.
    expect(hashContent('anything').length).toBe(64);
  });
});
