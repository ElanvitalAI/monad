// ── Skill view state tests (Phase S3) ──

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createSkillViewState,
  refreshSkills,
  refreshSkillFiles,
  skillToggleSelection,
  skillToggleSelectAll,
  skillAttachTargets,
  skillFocusedFile,
  skillFocusedSkill,
  SKILL_FILE_EXTS,
} from '../src/skills/view.js';

let root: string;
let skillA: string;
let skillB: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-view-'));
  skillA = join(root, 'alpha');
  skillB = join(root, 'beta');
  mkdirSync(skillA);
  mkdirSync(skillB);
  // Canonical manifest (uppercase variant should match too).
  writeFileSync(join(skillA, 'SKILL.md'), '# alpha');
  writeFileSync(join(skillA, 'README.md'), '# readme');
  mkdirSync(join(skillA, 'src'));
  writeFileSync(join(skillA, 'src', 'index.ts'), 'export const x = 1;');
  writeFileSync(join(skillA, 'src', 'helper.py'), 'print(1)');
  mkdirSync(join(skillA, 'node_modules'));
  writeFileSync(join(skillA, 'node_modules', 'IGNORED.ts'), '');
  writeFileSync(join(skillA, 'package.json'), '{}'); // not whitelisted
  writeFileSync(join(skillA, '.hidden'), 'nope');

  writeFileSync(join(skillB, 'skill.md'), '# beta');      // lowercase variant
  writeFileSync(join(skillB, 'run.sh'), '#!/bin/sh\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SKILL_FILE_EXTS', () => {
  test('includes core doc + scripting extensions', () => {
    for (const e of ['md', 'js', 'ts', 'py', 'sh']) {
      expect(SKILL_FILE_EXTS.has(e)).toBe(true);
    }
  });
  test('excludes bundler/data extensions', () => {
    for (const e of ['json', 'yaml', 'toml', 'lock']) {
      expect(SKILL_FILE_EXTS.has(e)).toBe(false);
    }
  });
});

describe('refreshSkills', () => {
  test('lists top-level skill dirs alphabetically', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    expect(s.skills.map(x => x.name)).toEqual(['alpha', 'beta']);
  });

  test('preserves skillCursor across refresh when the name survives', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    s.skillCursor = 1; // beta
    refreshSkills(s);
    expect(s.skills[s.skillCursor]?.name).toBe('beta');
  });

  test('ignores dotfiles and non-directories', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    expect(s.skills.find(x => x.name.startsWith('.'))).toBeUndefined();
  });

  test('handles a missing skills root without throwing', () => {
    const s = createSkillViewState('/no/such/skills-root');
    expect(() => refreshSkills(s)).not.toThrow();
    expect(s.skills).toEqual([]);
  });
});

describe('refreshSkillFiles', () => {
  test('lists SKILL.md first, then whitelisted files', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    s.skillCursor = s.skills.findIndex(x => x.name === 'alpha');
    refreshSkillFiles(s);
    const names = s.files.map(f => f.name);
    expect(names[0]).toBe('SKILL.md');
    expect(names).toContain('README.md');
    expect(names).toContain('index.ts');
    expect(names).toContain('helper.py');
  });

  test('matches lowercase skill.md as the manifest', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    s.skillCursor = s.skills.findIndex(x => x.name === 'beta');
    refreshSkillFiles(s);
    expect(s.files[0]?.name).toBe('skill.md');
    expect(s.files[0]?.isManifest).toBe(true);
  });

  test('skips node_modules and dotfiles', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    s.skillCursor = s.skills.findIndex(x => x.name === 'alpha');
    refreshSkillFiles(s);
    expect(s.files.find(f => f.name === 'IGNORED.ts')).toBeUndefined();
    expect(s.files.find(f => f.name === '.hidden')).toBeUndefined();
  });

  test('skips non-whitelisted extensions (e.g. package.json)', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    s.skillCursor = s.skills.findIndex(x => x.name === 'alpha');
    refreshSkillFiles(s);
    expect(s.files.find(f => f.name === 'package.json')).toBeUndefined();
  });

  test('relPath stays short for nested files', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    s.skillCursor = s.skills.findIndex(x => x.name === 'alpha');
    refreshSkillFiles(s);
    const idx = s.files.find(f => f.name === 'index.ts');
    expect(idx?.relPath).toBe('src/index.ts');
  });
});

describe('selection + focus helpers', () => {
  test('toggleSelection adds / removes a file', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    refreshSkillFiles(s);
    skillToggleSelection(s, 0);
    expect(s.selected.size).toBe(1);
    skillToggleSelection(s, 0);
    expect(s.selected.size).toBe(0);
  });

  test('toggleSelectAll picks up every file and clears on re-toggle', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    refreshSkillFiles(s);
    skillToggleSelectAll(s);
    expect(s.selected.size).toBe(s.files.length);
    skillToggleSelectAll(s);
    expect(s.selected.size).toBe(0);
  });

  test('attachTargets returns selection or falls back to cursor', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    refreshSkillFiles(s);
    expect(skillAttachTargets(s)).toEqual([s.files[0]!.absPath]);
    skillToggleSelection(s, 0);
    expect(skillAttachTargets(s)).toEqual([s.files[0]!.absPath]);
  });

  test('skillFocusedSkill/File return null past the end', () => {
    const s = createSkillViewState(root);
    refreshSkills(s);
    refreshSkillFiles(s);
    expect(skillFocusedSkill(s)?.name).toBe('alpha');
    expect(skillFocusedFile(s)?.name).toBe('SKILL.md');
    s.fileCursor = 999;
    expect(skillFocusedFile(s)).toBeNull();
  });
});
