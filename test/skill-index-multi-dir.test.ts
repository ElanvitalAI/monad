// ── Multi-dir skill index (Phase 2, session 13) ──
//
// Verifies buildSkillIndex can scan several skill roots and dedupe by
// name (first-dir-wins). Caches on the full ordered dir list so
// swapping order forces a rescan.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySkillFilter,
  buildSkillIndex, getSkillIndex, reloadSkillIndex, resetSkillIndex,
  type SkillIndexEntry,
} from '../src/skills/index';

let root: string;
let dirA: string;
let dirB: string;

function writeSkill(baseDir: string, name: string, frontmatter: string): void {
  const d = join(baseDir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'SKILL.md'), `---\n${frontmatter}\n---\nbody\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-multi-'));
  dirA = join(root, 'dirA');
  dirB = join(root, 'dirB');
  mkdirSync(dirA);
  mkdirSync(dirB);
  resetSkillIndex();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetSkillIndex();
});

describe('buildSkillIndex multi-dir', () => {
  test('scans multiple dirs, merges results', () => {
    writeSkill(dirA, 'foo', 'name: foo\ndescription: from A');
    writeSkill(dirB, 'bar', 'name: bar\ndescription: from B');

    const entries = buildSkillIndex([dirA, dirB]);
    expect(entries.length).toBe(2);
    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(['bar', 'foo']);
    const fooEntry = entries.find(e => e.name === 'foo')!;
    const barEntry = entries.find(e => e.name === 'bar')!;
    expect(fooEntry.rootDir).toBe(dirA);
    expect(barEntry.rootDir).toBe(dirB);
  });

  test('first-dir-wins on name collision', () => {
    writeSkill(dirA, 'dup', 'name: dup\ndescription: A wins');
    writeSkill(dirB, 'dup', 'name: dup\ndescription: B loses');

    const entries = buildSkillIndex([dirA, dirB]);
    expect(entries.length).toBe(1);
    expect(entries[0].description).toBe('A wins');
    expect(entries[0].rootDir).toBe(dirA);
  });

  test('swapping dir order changes winner', () => {
    writeSkill(dirA, 'dup', 'name: dup\ndescription: A');
    writeSkill(dirB, 'dup', 'name: dup\ndescription: B');

    expect(buildSkillIndex([dirB, dirA])[0].description).toBe('B');
    expect(buildSkillIndex([dirA, dirB])[0].description).toBe('A');
  });

  test('non-existent dirs are silently skipped', () => {
    writeSkill(dirA, 'only', 'name: only\ndescription: x');
    const nonexistent = join(root, 'missing');

    const entries = buildSkillIndex([nonexistent, dirA]);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe('only');
  });

  test('single string baseDir still works (back-compat)', () => {
    writeSkill(dirA, 'single', 'name: single\ndescription: y');
    const entries = buildSkillIndex(dirA);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe('single');
  });

  test('getSkillIndex caches on ordered-dir key', () => {
    writeSkill(dirA, 'a', 'name: a\ndescription: a');
    writeSkill(dirB, 'b', 'name: b\ndescription: b');

    const first = getSkillIndex([dirA, dirB]);
    const second = getSkillIndex([dirA, dirB]);
    expect(second).toBe(first);

    // Different order → fresh build (different cache key).
    const third = getSkillIndex([dirB, dirA]);
    expect(third).not.toBe(first);
    expect(third.length).toBe(2);
  });

  test('reloadSkillIndex on multi-dir picks up new skill', () => {
    writeSkill(dirA, 'one', 'name: one\ndescription: x');
    expect(reloadSkillIndex([dirA, dirB])).toBe(1);
    writeSkill(dirB, 'two', 'name: two\ndescription: y');
    expect(reloadSkillIndex([dirA, dirB])).toBe(2);
  });

  test('each entry records its rootDir', () => {
    writeSkill(dirA, 'fromA', 'name: fromA\ndescription: a');
    writeSkill(dirB, 'fromB', 'name: fromB\ndescription: b');

    const entries = buildSkillIndex([dirA, dirB]);
    for (const e of entries) {
      expect(e.rootDir === dirA || e.rootDir === dirB).toBe(true);
      expect(e.skillDir.startsWith(e.rootDir)).toBe(true);
    }
  });
});

// Session 21 — cross-skill noisy-token suppression. When ≥3 skills
// carry the same auto-extracted keyword it stops discriminating and
// gets dropped from all of them. Explicit triggers are never pruned.
describe('buildSkillIndex — noisy extracted-token suppression', () => {
  // Forward-marker fixture: "Use when asks: A, B, C." → items [A, B, C].
  // Backward `시 사용` markers produce a single prefix segment that
  // doesn't exercise the dedup path cleanly, so we stick with forward.
  const commonDesc = 'Use when the user asks: 요약, 정리, 저장.';

  test('extracted trigger present in 3+ skills is dropped from all', () => {
    writeSkill(dirA, 's1', `name: s1\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's2', `name: s2\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's3', `name: s3\ndescription: ${commonDesc}`);
    const entries = buildSkillIndex(dirA);
    for (const e of entries) {
      expect(e.extractedTriggers).not.toContain('요약');
      expect(e.extractedTriggers).not.toContain('정리');
      expect(e.extractedTriggers).not.toContain('저장');
    }
  });

  test('extracted trigger shared by only 2 skills survives', () => {
    writeSkill(dirA, 's1', `name: s1\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's2', `name: s2\ndescription: ${commonDesc}`);
    const entries = buildSkillIndex(dirA);
    for (const e of entries) {
      expect(e.extractedTriggers).toContain('요약');
      expect(e.extractedTriggers).toContain('정리');
    }
  });

  test('explicit triggers are never suppressed even when they duplicate across many skills', () => {
    writeSkill(dirA, 's1', 'name: s1\ndescription: d\ntriggers:\n  - 요약');
    writeSkill(dirA, 's2', 'name: s2\ndescription: d\ntriggers:\n  - 요약');
    writeSkill(dirA, 's3', 'name: s3\ndescription: d\ntriggers:\n  - 요약');
    writeSkill(dirA, 's4', 'name: s4\ndescription: d\ntriggers:\n  - 요약');
    const entries = buildSkillIndex(dirA);
    for (const e of entries) expect(e.triggers).toContain('요약');
  });

  test('per-skill triggerSource downgrades when all extracted get suppressed', () => {
    // All extracted triggers are shared by ≥3 skills → all filtered.
    writeSkill(dirA, 's1', `name: s1\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's2', `name: s2\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's3', `name: s3\ndescription: ${commonDesc}`);
    const entries = buildSkillIndex(dirA);
    for (const e of entries) {
      expect(e.extractedTriggers).toEqual([]);
      expect(e.triggerSource).toBe('none');
    }
  });

  test('discovers skills nested one level under category dirs (session 21 taxonomy)', () => {
    // B5.7 layout: skills/digest/omni-digest/, skills/visual/diagram-master/
    const digestCat = join(dirA, 'digest');
    const visualCat = join(dirA, 'visual');
    mkdirSync(digestCat);
    mkdirSync(visualCat);
    const digSkill = join(digestCat, 'omni-digest');
    const visSkill = join(visualCat, 'diagram-master');
    mkdirSync(digSkill);
    mkdirSync(visSkill);
    writeFileSync(join(digSkill, 'SKILL.md'), '---\nname: omni-digest\ndescription: d\n---\nbody');
    writeFileSync(join(visSkill, 'SKILL.md'), '---\nname: diagram-master\ndescription: d\n---\nbody');
    // Also a legacy flat skill — should coexist.
    const flat = join(dirA, 'ast-grep');
    mkdirSync(flat);
    writeFileSync(join(flat, 'SKILL.md'), '---\nname: ast-grep\ndescription: d\n---\nbody');

    const entries = buildSkillIndex(dirA);
    const names = entries.map(e => e.name).sort();
    expect(names).toEqual(['ast-grep', 'diagram-master', 'omni-digest']);

    // Each entry's skillDir should reflect its actual location.
    expect(entries.find(e => e.name === 'omni-digest')!.skillDir).toBe(digSkill);
    expect(entries.find(e => e.name === 'diagram-master')!.skillDir).toBe(visSkill);
    expect(entries.find(e => e.name === 'ast-grep')!.skillDir).toBe(flat);
  });

  test('skips `_lib` and `.` prefixed category dirs', () => {
    // `_lib/` holds primitives (no SKILL.md). Even if it did, it shouldn't
    // appear in the index.
    const lib = join(dirA, '_lib');
    mkdirSync(lib);
    writeFileSync(join(lib, 'SKILL.md'), '---\nname: should-not-appear\ndescription: d\n---\n');
    const hidden = join(dirA, '.hidden');
    mkdirSync(hidden);
    writeFileSync(join(hidden, 'SKILL.md'), '---\nname: also-hidden\ndescription: d\n---\n');
    const ok = join(dirA, 'visible');
    mkdirSync(ok);
    writeFileSync(join(ok, 'SKILL.md'), '---\nname: visible\ndescription: d\n---\n');

    const entries = buildSkillIndex(dirA);
    expect(entries.map(e => e.name)).toEqual(['visible']);
  });

  test('flat-layout skill wins over same-name nested skill (collision policy)', () => {
    // If somehow a skill exists both flat and under a category, the flat one
    // takes precedence — stable during migration in either direction.
    const flat = join(dirA, 'duplicate');
    mkdirSync(flat);
    writeFileSync(join(flat, 'SKILL.md'), '---\nname: duplicate\ndescription: FLAT\n---\n');
    const cat = join(dirA, 'nested-category');
    mkdirSync(cat);
    const nested = join(cat, 'duplicate');
    mkdirSync(nested);
    writeFileSync(join(nested, 'SKILL.md'), '---\nname: duplicate\ndescription: NESTED\n---\n');

    const entries = buildSkillIndex(dirA);
    const dup = entries.find(e => e.name === 'duplicate');
    expect(dup?.skillDir).toBe(flat);
    expect(dup?.description).toBe('FLAT');
  });

  test('mix: one skill keeps unique extracted, shared one is stripped', () => {
    writeSkill(dirA, 's1', `name: s1\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's2', `name: s2\ndescription: ${commonDesc}`);
    writeSkill(dirA, 's3', `name: s3\ndescription: ${commonDesc}`);
    writeSkill(dirA, 'uniq', 'name: uniq\ndescription: Use when the user asks: HBM 사이클, 반도체 매력도.');
    const entries = buildSkillIndex(dirA);
    const uniq = entries.find(e => e.name === 'uniq')!;
    // Unique domain-specific tokens survive — they aren't shared.
    expect(uniq.extractedTriggers).toContain('HBM 사이클');
  });
});

// Session 21 — allow/deny scope filter.
describe('applySkillFilter', () => {
  const mk = (name: string): SkillIndexEntry => ({
    name, description: 'd', triggers: [], extractedTriggers: [],
    triggerSource: 'none', autoTrigger: false,
    skillDir: `/tmp/${name}`, rootDir: '/tmp',
  });

  test('no filter / empty filter → pass-through', () => {
    const input = [mk('a'), mk('b')];
    expect(applySkillFilter(input, undefined).length).toBe(2);
    expect(applySkillFilter(input, {}).length).toBe(2);
    expect(applySkillFilter(input, { allow: [], deny: [] }).length).toBe(2);
  });

  test('allow list pins the visible set', () => {
    const out = applySkillFilter([mk('a'), mk('b'), mk('c')], { allow: ['a', 'c'] });
    expect(out.map(e => e.name)).toEqual(['a', 'c']);
  });

  test('deny list removes specific skills', () => {
    const out = applySkillFilter([mk('a'), mk('b'), mk('c')], { deny: ['b'] });
    expect(out.map(e => e.name)).toEqual(['a', 'c']);
  });

  test('deny precedes allow — denied skill stays hidden even if explicitly allowed', () => {
    const out = applySkillFilter([mk('a'), mk('b')], { allow: ['a', 'b'], deny: ['b'] });
    expect(out.map(e => e.name)).toEqual(['a']);
  });

  test('case-insensitive + trim-tolerant', () => {
    const out = applySkillFilter([mk('MySkill'), mk('other')], { allow: ['  myskill  '] });
    expect(out.map(e => e.name)).toEqual(['MySkill']);
  });

  test('empty strings in allow/deny ignored', () => {
    const out = applySkillFilter([mk('a'), mk('b')], { allow: ['', 'a', '   '] });
    expect(out.map(e => e.name)).toEqual(['a']);
  });
});
