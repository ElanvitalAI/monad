// PLAN §4.2 · Phase 1.2 — Self-edit guard tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  assessEdit,
  findElanousRepoRoot,
  getDefaultSystemFileDirs,
  setSystemFileGuardDisabled,
  __resetSystemFileGuard,
  setPolicy, resetPolicyToDefault, getPolicy,
} from '../../src/code-edit/index.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'self-edit-guard-'));
  dirs.push(d);
  return d;
}

function makeElanousRepo(): { root: string; src: string } {
  const root = mkdir();
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'elanous', version: '0.0.0' }),
  );
  const src = join(root, 'src');
  mkdirSync(src, { recursive: true });
  return { root, src };
}

beforeEach(() => {
  __resetSystemFileGuard();
  resetPolicyToDefault();
});

afterEach(() => {
  __resetSystemFileGuard();
  resetPolicyToDefault();
  delete process.env.ELANOUS_SYSTEM_FILE_GUARD;
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('findElanousRepoRoot', () => {
  test('finds the directory holding the elanous package.json', () => {
    const { root, src } = makeElanousRepo();
    expect(findElanousRepoRoot(src)).toBe(root);
  });

  test('returns null when no elanous package.json exists upstream', () => {
    const dir = mkdir();
    expect(findElanousRepoRoot(dir)).toBeNull();
  });

  test('skips package.json with a different name', () => {
    const root = mkdir();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'something-else' }),
    );
    expect(findElanousRepoRoot(root)).toBeNull();
  });

  test('tolerates malformed package.json on the way up', () => {
    const dir = mkdir();
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, 'a', 'package.json'), '{not json');
    expect(findElanousRepoRoot(nested)).toBeNull();
  });
});

describe('getDefaultSystemFileDirs', () => {
  test('returns [repoRoot] when called from inside a elanous checkout', () => {
    const { root, src } = makeElanousRepo();
    expect(getDefaultSystemFileDirs(src)).toEqual([root]);
  });

  test('returns [] when no elanous checkout is detected', () => {
    expect(getDefaultSystemFileDirs(mkdir())).toEqual([]);
  });
});

describe('assessEdit — systemFileDirs guard', () => {
  test('edit inside systemFileDirs forces ask-user even in unsupervised mode', () => {
    const { root, src } = makeElanousRepo();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    const decision = assessEdit({
      file_path: join(src, 'llm.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('ask-user');
    if (decision.kind === 'ask-user') {
      expect(decision.reason).toContain('self-source');
      expect(decision.reason).toContain('UndoTurn');
    }
  });

  test('edit outside systemFileDirs is unaffected', () => {
    const { root } = makeElanousRepo();
    const elsewhere = mkdir();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    const decision = assessEdit({
      file_path: join(elsewhere, 'scratch.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('auto-approve');
  });

  test('systemFileDirs takes precedence over trusted-dirs auto-approve', () => {
    const { root, src } = makeElanousRepo();
    setPolicy({
      mode: 'trusted-dirs',
      trustedDirs: [root],
      systemFileDirs: [root],
    });
    const decision = assessEdit({
      file_path: join(src, 'llm.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('ask-user');
  });

  test('deniedDirs takes precedence over systemFileDirs', () => {
    const { root, src } = makeElanousRepo();
    setPolicy({
      mode: 'unsupervised',
      systemFileDirs: [root],
      deniedDirs: [src],
    });
    const decision = assessEdit({
      file_path: join(src, 'llm.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('reject');
  });

  test('disabled flag turns the guard off', () => {
    const { root, src } = makeElanousRepo();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    setSystemFileGuardDisabled(true);
    const decision = assessEdit({
      file_path: join(src, 'llm.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('auto-approve');
  });

  test('ELANOUS_SYSTEM_FILE_GUARD=off env var turns the guard off', () => {
    const { root, src } = makeElanousRepo();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    process.env.ELANOUS_SYSTEM_FILE_GUARD = 'off';
    const decision = assessEdit({
      file_path: join(src, 'llm.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('auto-approve');
  });

  test('empty systemFileDirs is a no-op', () => {
    const elsewhere = mkdir();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [] });
    const decision = assessEdit({
      file_path: join(elsewhere, 'foo.ts'),
      edits: [{ old_string: 'a', new_string: 'b' }],
    }, getPolicy());
    expect(decision.kind).toBe('auto-approve');
  });
});

describe('setPolicy — systemFileDirs preservation across mode flips', () => {
  test('flipping mode without specifying systemFileDirs keeps the previous value', () => {
    const { root } = makeElanousRepo();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    setPolicy({ mode: 'ask-edit' }); // dashboard `/code-edit policy ask-edit` style
    expect(getPolicy().systemFileDirs).toEqual([root]);
  });

  test('explicitly clearing systemFileDirs (empty array) is honoured', () => {
    const { root } = makeElanousRepo();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    setPolicy({ mode: 'ask-edit', systemFileDirs: [] });
    expect(getPolicy().systemFileDirs).toEqual([]);
  });

  test('replacing systemFileDirs is honoured', () => {
    const { root } = makeElanousRepo();
    const otherRoot = mkdir();
    setPolicy({ mode: 'unsupervised', systemFileDirs: [root] });
    setPolicy({ mode: 'ask-edit', systemFileDirs: [otherRoot] });
    expect(getPolicy().systemFileDirs).toEqual([otherRoot]);
  });
});
