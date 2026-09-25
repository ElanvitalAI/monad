// Q4 (substrate Occam refactor, 2026-05-03) — central key alias table.
// Verifies built-in Korean 2-set jamo→latin lookup, user-config
// override layering, and graceful handling of missing config files.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetKeyAliasesForTests,
  isKeyAlias,
  loadUserKeyAliasesFromFile,
  resolveKeyAlias,
  setUserKeyAliases,
} from '../src/input-core/key-alias-table.js';

afterEach(() => {
  __resetKeyAliasesForTests();
});

describe('Korean 2-set built-in aliases', () => {
  test('top-row jamo resolve to latin equivalents', () => {
    expect(resolveKeyAlias('ㅂ')).toBe('q');
    expect(resolveKeyAlias('ㅈ')).toBe('w');
    expect(resolveKeyAlias('ㅔ')).toBe('p');
  });

  test('home-row jamo resolve to latin equivalents', () => {
    expect(resolveKeyAlias('ㅁ')).toBe('a');
    expect(resolveKeyAlias('ㅏ')).toBe('k');
    expect(resolveKeyAlias('ㅣ')).toBe('l');
  });

  test('bottom-row jamo resolve to latin equivalents', () => {
    expect(resolveKeyAlias('ㅋ')).toBe('z');
    expect(resolveKeyAlias('ㅡ')).toBe('m');
    expect(resolveKeyAlias('ㅊ')).toBe('c');
  });

  test('latin keys pass through unchanged', () => {
    expect(resolveKeyAlias('a')).toBe('a');
    expect(resolveKeyAlias('k')).toBe('k');
    expect(resolveKeyAlias('escape')).toBe('escape');
  });

  test('case-insensitive lookup', () => {
    expect(resolveKeyAlias('K')).toBe('k');
  });

  test('empty / undefined name returns empty string', () => {
    expect(resolveKeyAlias('')).toBe('');
    expect(resolveKeyAlias(undefined)).toBe('');
  });

  test('isKeyAlias returns true only for registered alternates', () => {
    expect(isKeyAlias('ㅏ')).toBe(true);
    expect(isKeyAlias('k')).toBe(false);
    expect(isKeyAlias('escape')).toBe(false);
  });
});

describe('User-config overrides', () => {
  test('user mapping wins over built-in', () => {
    // Pretend Dvorak user wants alt-K to be the same as alt-T.
    setUserKeyAliases(new Map([['ㅏ', 't']]));
    expect(resolveKeyAlias('ㅏ')).toBe('t');
    expect(resolveKeyAlias('k')).toBe('k'); // latin still passes through
  });

  test('clearing user overrides restores built-in', () => {
    setUserKeyAliases(new Map([['ㅏ', 'z']]));
    expect(resolveKeyAlias('ㅏ')).toBe('z');
    setUserKeyAliases(new Map());
    expect(resolveKeyAlias('ㅏ')).toBe('k'); // back to Korean built-in
  });

  test('user can add a new alias not in built-in', () => {
    // Imaginary user mapping a custom char to a key.
    setUserKeyAliases(new Map([['§', 'escape']]));
    expect(resolveKeyAlias('§')).toBe('escape');
  });
});

describe('User-config file loader', () => {
  test('missing file returns false (silent no-op)', async () => {
    const ok = await loadUserKeyAliasesFromFile('/nonexistent/path/key-aliases.json');
    expect(ok).toBe(false);
    // Built-ins still work.
    expect(resolveKeyAlias('ㅏ')).toBe('k');
  });

  test('valid file loads aliases', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'key-alias-test-'));
    const file = join(dir, 'key-aliases.json');
    await writeFile(file, JSON.stringify({
      aliases: { 'ㅏ': 'enter' },
    }));
    const ok = await loadUserKeyAliasesFromFile(file);
    expect(ok).toBe(true);
    expect(resolveKeyAlias('ㅏ')).toBe('enter');
  });

  test('malformed JSON returns false (silent)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'key-alias-test-'));
    const file = join(dir, 'key-aliases.json');
    await writeFile(file, 'not valid json {{');
    const ok = await loadUserKeyAliasesFromFile(file);
    expect(ok).toBe(false);
    // Built-ins still functional.
    expect(resolveKeyAlias('ㅏ')).toBe('k');
  });

  test('file with no aliases field is a valid no-op', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'key-alias-test-'));
    const file = join(dir, 'key-aliases.json');
    await writeFile(file, JSON.stringify({}));
    const ok = await loadUserKeyAliasesFromFile(file);
    expect(ok).toBe(true);
    expect(resolveKeyAlias('ㅏ')).toBe('k');
  });

  test('non-string entries are skipped (defensive parse)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'key-alias-test-'));
    const file = join(dir, 'key-aliases.json');
    await writeFile(file, JSON.stringify({
      aliases: {
        'ㅏ': 'enter',     // valid
        'ㅔ': 42,          // skipped — not a string
        'ㅅ': null,        // skipped
      },
    }));
    const ok = await loadUserKeyAliasesFromFile(file);
    expect(ok).toBe(true);
    expect(resolveKeyAlias('ㅏ')).toBe('enter');
    // Skipped entries — built-in still applies (was 't'/'p' for ㅔ/ㅅ).
    expect(resolveKeyAlias('ㅔ')).toBe('p');
    expect(resolveKeyAlias('ㅅ')).toBe('t');
  });
});
