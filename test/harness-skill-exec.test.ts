import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  HARNESS_EXEC_ALLOWLIST,
  isDeclaredAutoExecSafe,
  resolveHarnessExecAllowlist,
} from '../src/harness/skill-exec';
import {
  buildSkillIndex,
  getSkillIndex,
  resetSkillIndex,
  type SkillIndexEntry,
} from '../src/skills/index';

let root: string;

function entry(
  name: string,
  sideEffects?: SkillIndexEntry['sideEffects'],
  cost?: SkillIndexEntry['cost'],
): SkillIndexEntry {
  return {
    name,
    description: 'test',
    triggers: [],
    extractedTriggers: [],
    triggerSource: 'none',
    autoTrigger: false,
    sideEffects,
    cost,
    composes: [],
    skillDir: `/tmp/${name}`,
    rootDir: '/tmp',
  };
}

function writeSkill(name: string, frontmatter: string): void {
  const skillDir = join(root, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\n${frontmatter}\n---\nbody\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'harness-skill-exec-'));
  resetSkillIndex();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetSkillIndex();
});

describe('harness declared auto-execution safety', () => {
  test('accepts only read-only, light declarations', () => {
    expect(isDeclaredAutoExecSafe(entry('safe', 'none', 'light'))).toBe(true);
  });

  test.each([
    ['write', 'write', 'light'],
    ['spawn', 'spawn', 'light'],
    ['heavy', 'none', 'heavy'],
    ['undeclared', undefined, undefined],
  ] as const)('rejects %s declarations', (_label, sideEffects, cost) => {
    expect(isDeclaredAutoExecSafe(entry('unsafe', sideEffects, cost))).toBe(false);
  });

  test('keeps the legacy default exactly when declarations are omitted', () => {
    expect(resolveHarnessExecAllowlist()).toBe(HARNESS_EXEC_ALLOWLIST);
    expect([...resolveHarnessExecAllowlist()]).toEqual([...HARNESS_EXEC_ALLOWLIST]);
  });

  test('preserves valid safety declarations through build and cached index loading', () => {
    writeSkill('declared', 'name: declared\ndescription: test\nsideEffects: none\ncost: light');

    const built = buildSkillIndex(root);
    expect(built).toHaveLength(1);
    expect(built[0].sideEffects).toBe('none');
    expect(built[0].cost).toBe('light');

    const loaded = getSkillIndex(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sideEffects).toBe('none');
    expect(loaded[0].cost).toBe('light');
  });

  test.each([
    ['typo', 'nonee', 'cheap'],
    ['prefix', 'none-extra', 'light-extra'],
    ['case', 'None', 'Light'],
  ])('folds unknown or partial %s declarations to undefined', (name, sideEffects, cost) => {
    writeSkill(name, `name: ${name}\ndescription: test\nsideEffects: ${sideEffects}\ncost: ${cost}`);
    const index = buildSkillIndex(root);
    expect(index).toHaveLength(1);
    expect(index[0].sideEffects).toBeUndefined();
    expect(index[0].cost).toBeUndefined();
  });
});

describe('선언 속성 — allowlist 편입 계약', () => {
  test('선언 안전 항목만 편입하고 블록 패턴은 거부한다', () => {
    const rejected: string[] = [];
    const resolved = resolveHarnessExecAllowlist(
      undefined,
      (skill) => rejected.push(skill),
      [
        entry('declared-safe', 'none', 'light'),
        entry('declared-write', 'write', 'light'),
        entry('declared-heavy', 'none', 'heavy'),
        entry('declared-consensus', 'none', 'light'),
      ],
    );

    expect(resolved.has('declared-safe')).toBe(true);
    expect(resolved.has('declared-write')).toBe(false);
    expect(resolved.has('declared-heavy')).toBe(false);
    expect(resolved.has('declared-consensus')).toBe(false);
    expect(rejected).toEqual(['declared-consensus']);
  });

  test('인덱스가 없으면 기본 allowlist와 config 확장 동작을 보존한다', () => {
    expect(resolveHarnessExecAllowlist()).toBe(HARNESS_EXEC_ALLOWLIST);
    const resolved = resolveHarnessExecAllowlist(['config-safe']);
    expect(resolved.has('config-safe')).toBe(true);
    expect(resolved.has('omni-digest')).toBe(true);
  });
});
