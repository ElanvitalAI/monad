import { describe, expect, test } from 'bun:test';
import { writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { previewFile } from '../src/preview/index.js';

describe('previewFile dispatch', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'preview-index-'));

  test('text file returns lines with header + content', () => {
    const f = join(tmp, 'a.md');
    writeFileSync(f, '# Hello\nworld\n');
    const r = previewFile(f);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    // Header contains the basename somewhere.
    expect(r.lines.some(l => l.includes('a.md'))).toBe(true);
  });

  test('image file returns cachePath pointing at the original', () => {
    const f = join(tmp, 'a.png');
    writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const r = previewFile(f);
    expect(r.kind).toBe('image');
    if (r.kind !== 'image') throw new Error('unreachable');
    expect(r.cachePath).toBe(f);
  });

  test('unknown extension returns fallback lines', () => {
    const f = join(tmp, 'a.unknownxyz');
    writeFileSync(f, 'junk');
    const r = previewFile(f);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    expect(r.lines.some(l => l.includes('no preview'))).toBe(true);
  });

  test('directory → folder handler (Phase C)', () => {
    const d = join(tmp, 'subdir');
    mkdirSync(d);
    writeFileSync(join(d, 'nested.txt'), 'hi');
    const r = previewFile(d);
    expect(r.kind).toBe('lines');
    if (r.kind !== 'lines') throw new Error('unreachable');
    // Folder handler (via eza or native fallback) must surface the
    // entry name somewhere — not the fallback "no preview" message.
    expect(r.lines.some(l => l.includes('nested.txt'))).toBe(true);
  });

  test('forceHandler overrides routing', () => {
    const f = join(tmp, 'a.unknownxyz');
    writeFileSync(f, 'junk');
    const r = previewFile(f, { forceHandler: 'text' });
    expect(r.kind).toBe('lines');
  });
});
