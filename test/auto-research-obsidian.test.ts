// ── PFC-S3 P1: Obsidian bridge ──

import { describe, test, expect, beforeEach } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverObsidianVault,
  readNote,
  writeNote,
  appendNote,
  parseFrontmatter,
  listNotesByTag,
  type ObsidianVault,
} from '../src/auto-research/obsidian-bridge';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'obsidian-test-'));
}

describe('PFC-S3 P1 — discoverObsidianVault', () => {
  test('env override wins', () => {
    const dir = scratch();
    const custom = join(dir, 'custom-vault');
    const v = discoverObsidianVault({
      env: { ELANOUS_OBSIDIAN_VAULT: custom },
      cwd: dir,
    });
    expect(v.root).toBe(custom);
    expect(v.isSimulated).toBe(false);
    expect(existsSync(custom)).toBe(true);   // auto-created
  });

  test('fallback .elanous/research/ when Obsidian directories missing', () => {
    const dir = scratch();
    // Point home to a directory without Obsidian → will fall to simulated.
    const fakeHome = join(dir, 'nohome');
    mkdirSync(fakeHome, { recursive: true });
    const v = discoverObsidianVault({ env: {}, cwd: dir, home: fakeHome });
    expect(v.isSimulated).toBe(true);
    expect(v.root).toBe(join(dir, '.elanous', 'research'));
  });
});

describe('PFC-S3 P1 — read / write / append', () => {
  let vault: ObsidianVault;
  beforeEach(() => {
    const dir = scratch();
    vault = { root: dir, isSimulated: true, label: 'test' };
  });

  test('readNote returns null for missing path', () => {
    expect(readNote(vault, 'nowhere.md')).toBeNull();
  });

  test('writeNote then readNote round-trip', () => {
    writeNote(vault, 'goals/abc/ACTIVE.md', 'hello world');
    expect(readNote(vault, 'goals/abc/ACTIVE.md')).toBe('hello world');
  });

  test('writeNote prepends frontmatter when provided', () => {
    writeNote(vault, 'x.md', 'body text', { title: 'Sample', step: 3 });
    const content = readNote(vault, 'x.md')!;
    expect(content.startsWith('---')).toBe(true);
    expect(content).toContain('title: Sample');
    expect(content).toContain('step: 3');
    expect(content).toContain('body text');
  });

  test('appendNote keeps existing content and appends', () => {
    writeNote(vault, 'log.md', 'first');
    appendNote(vault, 'log.md', 'second');
    const content = readNote(vault, 'log.md')!;
    expect(content).toContain('first');
    expect(content).toContain('second');
    expect(content.indexOf('first')).toBeLessThan(content.indexOf('second'));
  });

  test('appendNote inserts newline when prior lacks one', () => {
    writeNote(vault, 'log.md', 'alpha');
    appendNote(vault, 'log.md', 'beta');
    expect(readNote(vault, 'log.md')).toContain('alpha\nbeta');
  });
});

describe('PFC-S3 P1 — parseFrontmatter', () => {
  test('returns empty frontmatter when no --- block', () => {
    const { frontmatter, body } = parseFrontmatter('just body');
    expect(frontmatter).toEqual({});
    expect(body).toBe('just body');
  });

  test('parses string / int / boolean / inline-array / block-list', () => {
    const raw = `---
title: Sample
step: 3
autostart: true
tags: [a, b, c]
sources:
  - first
  - second
---
body here`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe('Sample');
    expect(frontmatter.step).toBe(3);
    expect(frontmatter.autostart).toBe(true);
    expect(frontmatter.tags).toEqual(['a', 'b', 'c']);
    expect(frontmatter.sources).toEqual(['first', 'second']);
    expect(body).toBe('body here');
  });

  test('quoted values strip quotes', () => {
    const { frontmatter } = parseFrontmatter(`---\nlabel: "quoted"\n---\n`);
    expect(frontmatter.label).toBe('quoted');
  });
});

describe('PFC-S3 P1 — listNotesByTag', () => {
  test('returns files whose frontmatter tags include the given tag', () => {
    const dir = scratch();
    const vault: ObsidianVault = { root: dir, isSimulated: true, label: 't' };
    writeNote(vault, 'a.md', 'a', { tags: ['research', 'samsung'] });
    writeNote(vault, 'b.md', 'b', { tags: ['research'] });
    writeNote(vault, 'c.md', 'c', { tags: ['other'] });
    const matches = listNotesByTag(vault, 'research');
    expect(matches.length).toBe(2);
  });
});
