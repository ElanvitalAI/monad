// PLAN-ipad-notes-obsidian-typora §5 Phase O3·3 (2026-05-17) —
// Tests for the daemon-side Templates enumerator.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findTemplates } from '../src/acp/obsidian-templates';

let vault = '';

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'monad-tpl-test-'));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe('findTemplates', () => {
  test('returns empty when no Templates folder exists', async () => {
    writeFileSync(join(vault, 'Untitled.md'), '# note\n');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.error).toBeUndefined();
    expect(result.templates).toEqual([]);
    expect(result.folder).toBeUndefined();
  });

  test('lists `.md` files in Templates/ folder', async () => {
    mkdirSync(join(vault, 'Templates'));
    writeFileSync(join(vault, 'Templates', 'Daily.md'), '# {{date}}\n');
    writeFileSync(join(vault, 'Templates', 'Meeting.md'), '# Meeting notes\n');
    writeFileSync(join(vault, 'Templates', 'Project.md'), '# Project\n');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.error).toBeUndefined();
    expect(result.folder).toBe('Templates');
    expect(result.templates.map((t) => t.name)).toEqual(['Daily', 'Meeting', 'Project']);
    expect(result.templates[0]?.relPath).toBe('Templates/Daily.md');
  });

  test('filters out non-md files', async () => {
    mkdirSync(join(vault, 'Templates'));
    writeFileSync(join(vault, 'Templates', 'Daily.md'), '');
    writeFileSync(join(vault, 'Templates', 'README.txt'), '');
    writeFileSync(join(vault, 'Templates', 'logo.png'), '');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.templates.map((t) => t.name)).toEqual(['Daily']);
  });

  test('filters out subdirectories', async () => {
    mkdirSync(join(vault, 'Templates'));
    mkdirSync(join(vault, 'Templates', 'archive'));
    writeFileSync(join(vault, 'Templates', 'A.md'), '');
    writeFileSync(join(vault, 'Templates', 'archive', 'Old.md'), '');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.templates.map((t) => t.name)).toEqual(['A']);
  });

  test('fallback to _templates when Templates missing', async () => {
    mkdirSync(join(vault, '_templates'));
    writeFileSync(join(vault, '_templates', 'Foo.md'), '');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.folder).toBe('_templates');
    expect(result.templates.map((t) => t.name)).toEqual(['Foo']);
  });

  test('fallback to lowercase templates folder', async () => {
    // macOS's case-insensitive default filesystem matches 'Templates'
    // against a lowercase 'templates' dir on existsSync, so we only
    // verify that *some* folder match returns the entries — exact case
    // depends on filesystem semantics. On case-sensitive linux runners
    // the lowercase fallback fires and `result.folder === 'templates'`.
    mkdirSync(join(vault, 'templates'));
    writeFileSync(join(vault, 'templates', 'B.md'), '');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.templates.map((t) => t.name)).toEqual(['B']);
    expect(result.folder).toBeDefined();
  });

  test('honors custom folder candidates', async () => {
    mkdirSync(join(vault, 'CustomTemplates'));
    writeFileSync(join(vault, 'CustomTemplates', 'Custom.md'), '');
    const result = await findTemplates({
      vaultRoot: vault,
      folderCandidates: ['CustomTemplates'],
    });
    expect(result.folder).toBe('CustomTemplates');
    expect(result.templates.map((t) => t.name)).toEqual(['Custom']);
  });

  test('Templates over _templates (priority order)', async () => {
    mkdirSync(join(vault, 'Templates'));
    mkdirSync(join(vault, '_templates'));
    writeFileSync(join(vault, 'Templates', 'Wins.md'), '');
    writeFileSync(join(vault, '_templates', 'Loses.md'), '');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.folder).toBe('Templates');
    expect(result.templates.map((t) => t.name)).toEqual(['Wins']);
  });

  test('alphabetic sort within folder', async () => {
    mkdirSync(join(vault, 'Templates'));
    for (const n of ['Charlie', 'Alpha', 'Bravo']) {
      writeFileSync(join(vault, 'Templates', `${n}.md`), '');
    }
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.templates.map((t) => t.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  test('upper-case .MD extension also accepted', async () => {
    mkdirSync(join(vault, 'Templates'));
    writeFileSync(join(vault, 'Templates', 'Upper.MD'), '');
    writeFileSync(join(vault, 'Templates', 'mixed.Md'), '');
    const result = await findTemplates({ vaultRoot: vault });
    expect(result.templates.map((t) => t.name).sort()).toEqual(['Upper', 'mixed']);
  });
});
