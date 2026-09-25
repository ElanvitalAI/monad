// ── @-mention prefix splitter (Phase 6) ──
// Pure helper tests for splitAtPrefix — the dashboard `@`-picker
// callback uses this to decide what dir to readdir + how to filter.
// Anchoring expectations here so subtle precedence regressions
// (trailing slash, abs vs rel, ~) get caught without a TUI run.

import { describe, test, expect } from 'bun:test';
import { splitAtPrefix } from '../src/working-dir/index.js';
import { homedir } from 'os';

describe('splitAtPrefix', () => {
  const CWD = '/tmp/proj';

  test('empty prefix lists cwd', () => {
    const r = splitAtPrefix('', CWD);
    expect(r.dir).toBe('/tmp/proj');
    expect(r.partial).toBe('');
  });

  test('bare basename → dir=cwd, partial=basename', () => {
    const r = splitAtPrefix('sr', CWD);
    expect(r.dir).toBe('/tmp/proj');
    expect(r.partial).toBe('sr');
  });

  test('trailing slash means descend (partial empty)', () => {
    const r = splitAtPrefix('src/', CWD);
    expect(r.dir).toBe('/tmp/proj/src');
    expect(r.partial).toBe('');
  });

  test('subdir + partial filter', () => {
    const r = splitAtPrefix('src/da', CWD);
    expect(r.dir).toBe('/tmp/proj/src');
    expect(r.partial).toBe('da');
  });

  test('absolute path with partial', () => {
    const r = splitAtPrefix('/etc/host', CWD);
    expect(r.dir).toBe('/etc');
    expect(r.partial).toBe('host');
  });

  test('absolute path with trailing slash lists that dir', () => {
    const r = splitAtPrefix('/etc/', CWD);
    expect(r.dir).toBe('/etc');
    expect(r.partial).toBe('');
  });

  test('home-prefix expansion', () => {
    const r = splitAtPrefix('~/.config/', CWD);
    expect(r.dir).toBe(`${homedir()}/.config`);
    expect(r.partial).toBe('');
  });

  test('relative ascent', () => {
    const r = splitAtPrefix('../l', '/tmp/proj/src');
    expect(r.dir).toBe('/tmp/proj');
    expect(r.partial).toBe('l');
  });

  test('absolute root + partial', () => {
    const r = splitAtPrefix('/etc', CWD);
    expect(r.dir).toBe('/');
    expect(r.partial).toBe('etc');
  });
});
