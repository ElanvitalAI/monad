// PLAN-ipad-notes-obsidian-typora §5 Phase O2 — PR Q (2026-05-17) —
// Tests for the daemon-side recursive vault `.md` enumerator used by
// the iPad CodeMirror editor's `[[wikilink]]` autocomplete.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNotes } from '../src/acp/obsidian-notes';

let vault = '';

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'elanous-notes-test-'));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe('findNotes', () => {
  test('returns empty for empty vault', async () => {
    const result = await findNotes({ vaultRoot: vault });
    expect(result.error).toBeUndefined();
    expect(result.notes).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test('lists `.md` files at vault root', async () => {
    writeFileSync(join(vault, 'Beta.md'), '# beta');
    writeFileSync(join(vault, 'Alpha.md'), '# alpha');
    writeFileSync(join(vault, 'Gamma.md'), '# gamma');
    const result = await findNotes({ vaultRoot: vault });
    expect(result.notes.map((n) => n.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(result.notes[0]?.relPath).toBe('Alpha.md');
  });

  test('recurses into subdirectories', async () => {
    mkdirSync(join(vault, 'Daily'));
    mkdirSync(join(vault, 'Projects'));
    writeFileSync(join(vault, 'Daily', '2026-05-17.md'), '');
    writeFileSync(join(vault, 'Projects', 'Elanous.md'), '');
    writeFileSync(join(vault, 'README.md'), '');
    const result = await findNotes({ vaultRoot: vault });
    expect(result.notes.map((n) => n.relPath).sort()).toEqual([
      'Daily/2026-05-17.md',
      'Projects/Elanous.md',
      'README.md',
    ]);
  });

  test('skips hidden + node_modules + .obsidian + .git', async () => {
    writeFileSync(join(vault, 'Visible.md'), '');
    mkdirSync(join(vault, '.obsidian'));
    writeFileSync(join(vault, '.obsidian', 'config.md'), '');
    mkdirSync(join(vault, '.git'));
    writeFileSync(join(vault, '.git', 'leak.md'), '');
    mkdirSync(join(vault, 'node_modules'));
    writeFileSync(join(vault, 'node_modules', 'pkg.md'), '');
    mkdirSync(join(vault, '.hidden-dir'));
    writeFileSync(join(vault, '.hidden-dir', 'leak.md'), '');
    writeFileSync(join(vault, '.dotfile.md'), '');
    const result = await findNotes({ vaultRoot: vault });
    expect(result.notes.map((n) => n.name)).toEqual(['Visible']);
  });

  test('ignores non-md files', async () => {
    writeFileSync(join(vault, 'Note.md'), '');
    writeFileSync(join(vault, 'image.png'), '');
    writeFileSync(join(vault, 'doc.pdf'), '');
    writeFileSync(join(vault, 'README.txt'), '');
    const result = await findNotes({ vaultRoot: vault });
    expect(result.notes.map((n) => n.name)).toEqual(['Note']);
  });

  test('filters by query against basename', async () => {
    writeFileSync(join(vault, 'Apple.md'), '');
    writeFileSync(join(vault, 'Banana.md'), '');
    writeFileSync(join(vault, 'Pineapple.md'), '');
    const result = await findNotes({ vaultRoot: vault, query: 'apple' });
    expect(result.notes.map((n) => n.name)).toEqual(['Apple', 'Pineapple']);
  });

  test('filters by query against relPath', async () => {
    mkdirSync(join(vault, 'Daily'));
    writeFileSync(join(vault, 'Daily', 'Friday.md'), '');
    writeFileSync(join(vault, 'Monday.md'), '');
    const result = await findNotes({ vaultRoot: vault, query: 'daily' });
    expect(result.notes.map((n) => n.relPath)).toEqual(['Daily/Friday.md']);
  });

  test('respects limit + reports truncated', async () => {
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(vault, `note-${i}.md`), '');
    }
    const result = await findNotes({ vaultRoot: vault, limit: 5 });
    expect(result.notes.length).toBe(5);
    expect(result.truncated).toBe(true);
  });

  test('clamps limit to MAX_LIMIT', async () => {
    writeFileSync(join(vault, 'Solo.md'), '');
    const result = await findNotes({ vaultRoot: vault, limit: 9999 });
    expect(result.notes.length).toBe(1);
    expect(result.truncated).toBe(false);
  });

  test('returns error on unreadable root', async () => {
    const result = await findNotes({ vaultRoot: join(vault, 'missing-dir') });
    expect(result.error).toBeDefined();
    expect(result.notes).toEqual([]);
  });

  test('skips unreadable subdirectories without aborting', async () => {
    writeFileSync(join(vault, 'Top.md'), '');
    mkdirSync(join(vault, 'Sub'));
    writeFileSync(join(vault, 'Sub', 'Child.md'), '');
    // Pre-existing missing/broken symlink should not crash the walk.
    symlinkSync('/nonexistent-target', join(vault, 'broken-link'));
    const result = await findNotes({ vaultRoot: vault });
    expect(result.error).toBeUndefined();
    expect(result.notes.map((n) => n.name).sort()).toEqual(['Child', 'Top']);
  });
});
