// ── undo-turn module (UT1) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  captureSnapshot,
  restoreSnapshot,
  pushSnapshot,
  popSnapshot,
  listSnapshots,
  findSnapshotById,
  dropFromSnapshot,
  clearSnapshots,
  __resetSnapshotStore,
  captureIfFirstMutationOfTurn,
  startTurn,
  endTurn,
  isUndoDisabled,
  setUndoDisabled,
  __resetTurnState,
} from '../src/undo-turn/index.js';

function gitInit(cwd: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], {
    cwd, stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}
function gitCommit(cwd: string, msg: string): void {
  execFileSync('git', ['add', '.'], { cwd, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '-m', msg], {
    cwd, stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    },
  });
}

describe('captureSnapshot', () => {
  let repo: string;

  beforeEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    repo = mkdtempSync(join(tmpdir(), 'ut-cap-'));
    gitInit(repo);
    writeFileSync(join(repo, 'a.txt'), 'original');
    gitCommit(repo, 'c1');
  });

  afterEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  test('returns null outside a git repo', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ut-out-'));
    try {
      const s = captureSnapshot(outside);
      expect(s).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('captures a clean working tree', () => {
    const s = captureSnapshot(repo);
    expect(s).not.toBeNull();
    expect(s!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(s!.parentSha).toMatch(/^[0-9a-f]{40}$/);
    expect(s!.id).toMatch(/^[0-9a-f]{8}$/);
    expect(s!.repoRoot).toBe(resolve(repo));
    // Commit object exists
    const r = execFileSync('git', ['cat-file', '-t', s!.sha], {
      cwd: repo, encoding: 'utf8',
    }).trim();
    expect(r).toBe('commit');
  });

  test('captures tracked modifications', () => {
    writeFileSync(join(repo, 'a.txt'), 'modified');
    const s = captureSnapshot(repo);
    expect(s).not.toBeNull();
    const tree = execFileSync('git', ['ls-tree', s!.sha, 'a.txt'], {
      cwd: repo, encoding: 'utf8',
    }).trim();
    const [, , blob] = tree.split(/\s+/);
    const content = execFileSync('git', ['cat-file', '-p', blob!], {
      cwd: repo, encoding: 'utf8',
    });
    expect(content).toBe('modified');
  });

  test('captures untracked files', () => {
    writeFileSync(join(repo, 'new.txt'), 'untracked');
    const s = captureSnapshot(repo);
    expect(s).not.toBeNull();
    expect(s!.untrackedFiles).toContain('new.txt');
    // untracked also landed in the tree
    const ls = execFileSync('git', ['ls-tree', s!.sha, 'new.txt'], {
      cwd: repo, encoding: 'utf8',
    });
    expect(ls.length).toBeGreaterThan(0);
  });

  test('skips ignored files by default', () => {
    writeFileSync(join(repo, '.gitignore'), 'secret.txt\n');
    writeFileSync(join(repo, 'secret.txt'), 'hidden');
    gitCommit(repo, 'add gitignore');
    const s = captureSnapshot(repo);
    expect(s).not.toBeNull();
    const ls = execFileSync('git', ['ls-tree', s!.sha, 'secret.txt'], {
      cwd: repo, encoding: 'utf8',
    });
    expect(ls).toBe('');
  });

  test('description flows into commit message', () => {
    const s = captureSnapshot(repo, { description: 'turn 7' });
    expect(s).not.toBeNull();
    const msg = execFileSync('git', ['log', '-1', '--format=%B', s!.sha], {
      cwd: repo, encoding: 'utf8',
    });
    expect(msg).toContain('turn 7');
  });
});

describe('restoreSnapshot', () => {
  let repo: string;

  beforeEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    repo = mkdtempSync(join(tmpdir(), 'ut-res-'));
    gitInit(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    gitCommit(repo, 'c1');
  });

  afterEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  test('restores a modified tracked file', () => {
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const s = captureSnapshot(repo)!;
    writeFileSync(join(repo, 'a.txt'), 'v3');
    const r = restoreSnapshot(s);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v2');
  });

  test('removes new untracked files added after snapshot', () => {
    const s = captureSnapshot(repo)!;
    writeFileSync(join(repo, 'new.txt'), 'junk from LLM');
    expect(existsSync(join(repo, 'new.txt'))).toBe(true);
    const r = restoreSnapshot(s);
    expect(r.ok).toBe(true);
    expect(r.untrackedRemoved).toBe(1);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
  });

  test('keeps untracked files that existed AT snapshot time', () => {
    writeFileSync(join(repo, 'tmp.log'), 'logged');
    const s = captureSnapshot(repo)!;
    writeFileSync(join(repo, 'tmp.log'), 'logged more');
    writeFileSync(join(repo, 'another.txt'), 'new');
    const r = restoreSnapshot(s);
    expect(r.ok).toBe(true);
    // tmp.log content restored to snapshot state
    expect(readFileSync(join(repo, 'tmp.log'), 'utf8')).toBe('logged');
    // another.txt removed (new)
    expect(existsSync(join(repo, 'another.txt'))).toBe(false);
  });

  test('reports error when snapshot commit was gc\'d', () => {
    const s = captureSnapshot(repo)!;
    // Simulate GC by advancing branch + pruning. Easiest: fake a
    // snapshot with a nonexistent SHA.
    const fake = { ...s, sha: '0000000000000000000000000000000000000000' };
    const r = restoreSnapshot(fake);
    expect(r.ok).toBe(false);
    expect(r.error ?? '').toMatch(/no longer exists|gc/);
  });

  test('refuses cross-repo restore — sha not in other repo', () => {
    // Safety against a snapshot object whose repoRoot was manually
    // redirected to a different working copy. The sha from repo A
    // does not exist in repo B's .git/objects, so restore fails
    // with a "snapshot missing" error — exactly the protection we
    // want (structurally safe; no silent cross-write).
    const s = captureSnapshot(repo)!;
    const otherRepo = mkdtempSync(join(tmpdir(), 'ut-other-'));
    try {
      gitInit(otherRepo);
      writeFileSync(join(otherRepo, 'x'), '1');
      gitCommit(otherRepo, 'c1');
      const cross = { ...s, repoRoot: otherRepo };
      const r = restoreSnapshot(cross);
      expect(r.ok).toBe(false);
      expect(r.error ?? '').toMatch(/no longer exists|refusing/);
    } finally {
      rmSync(otherRepo, { recursive: true, force: true });
    }
  });

  test('refuses restore when repoRoot no longer exists as a git repo', () => {
    const s = captureSnapshot(repo)!;
    // Move the snapshot to point at a non-git path — triggers the
    // "repo root has changed" branch specifically.
    const outside = mkdtempSync(join(tmpdir(), 'ut-outside-'));
    try {
      const cross = { ...s, repoRoot: outside };
      const r = restoreSnapshot(cross);
      expect(r.ok).toBe(false);
      expect(r.error ?? '').toMatch(/refusing/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('store (ring buffer)', () => {
  beforeEach(() => __resetSnapshotStore());
  afterEach(() => __resetSnapshotStore());

  const mkSnap = (id: string, sha: string) => ({
    id, sha, parentSha: null, repoRoot: '/tmp', gitDir: '/tmp/.git',
    untrackedFiles: [], capturedAt: Date.now(),
  });

  test('push + list preserves order', () => {
    pushSnapshot(mkSnap('aa', 'a'.repeat(40)));
    pushSnapshot(mkSnap('bb', 'b'.repeat(40)));
    const l = listSnapshots();
    expect(l.map(s => s.id)).toEqual(['aa', 'bb']);
  });

  test('pop returns most recent', () => {
    pushSnapshot(mkSnap('aa', 'a'.repeat(40)));
    pushSnapshot(mkSnap('bb', 'b'.repeat(40)));
    expect(popSnapshot()?.id).toBe('bb');
    expect(popSnapshot()?.id).toBe('aa');
    expect(popSnapshot()).toBeNull();
  });

  test('findSnapshotById by id / full SHA / prefix', () => {
    pushSnapshot(mkSnap('aa', 'a'.repeat(40)));
    pushSnapshot(mkSnap('bb', 'b'.repeat(40)));
    expect(findSnapshotById('bb')?.id).toBe('bb');
    expect(findSnapshotById('a'.repeat(40))?.id).toBe('aa');
    expect(findSnapshotById('aaaa')?.id).toBe('aa'); // prefix ≥4
    expect(findSnapshotById('zzz')).toBeNull();
  });

  test('dropFromSnapshot removes target + everything after', () => {
    pushSnapshot(mkSnap('aa', 'a'.repeat(40)));
    pushSnapshot(mkSnap('bb', 'b'.repeat(40)));
    pushSnapshot(mkSnap('cc', 'c'.repeat(40)));
    const n = dropFromSnapshot('bb');
    expect(n).toBe(2);
    expect(listSnapshots().map(s => s.id)).toEqual(['aa']);
  });

  test('clearSnapshots wipes', () => {
    pushSnapshot(mkSnap('aa', 'a'.repeat(40)));
    clearSnapshots();
    expect(listSnapshots()).toEqual([]);
  });

  test('ring cap enforced (default 20)', () => {
    for (let i = 0; i < 25; i++) {
      pushSnapshot(mkSnap(`s${i}`, String(i).padStart(40, '0')));
    }
    const l = listSnapshots();
    expect(l.length).toBe(20);
    // oldest 5 slid off
    expect(l[0]!.id).toBe('s5');
    expect(l[19]!.id).toBe('s24');
  });
});

describe('turn-scoped capture helpers', () => {
  let repo: string;
  beforeEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    repo = mkdtempSync(join(tmpdir(), 'ut-turn-'));
    gitInit(repo);
    writeFileSync(join(repo, 'a'), '1');
    gitCommit(repo, 'c1');
    delete process.env.ELANOUS_UNDO;
  });
  afterEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  test('no-op before startTurn', () => {
    const s = captureIfFirstMutationOfTurn(repo);
    expect(s).toBeNull();
    expect(listSnapshots()).toEqual([]);
  });

  test('single capture per turn despite repeated calls', () => {
    startTurn('turn A');
    const s1 = captureIfFirstMutationOfTurn(repo);
    const s2 = captureIfFirstMutationOfTurn(repo);
    const s3 = captureIfFirstMutationOfTurn(repo);
    expect(s1).not.toBeNull();
    expect(s2).toBeNull();
    expect(s3).toBeNull();
    expect(listSnapshots().length).toBe(1);
    expect(listSnapshots()[0]!.description).toBe('turn A');
  });

  test('new turn → new snapshot', () => {
    startTurn('A');
    captureIfFirstMutationOfTurn(repo);
    endTurn();
    startTurn('B');
    captureIfFirstMutationOfTurn(repo);
    expect(listSnapshots().length).toBe(2);
    expect(listSnapshots().map(s => s.description)).toEqual(['A', 'B']);
  });

  test('ELANOUS_UNDO=off disables', () => {
    process.env.ELANOUS_UNDO = 'off';
    expect(isUndoDisabled()).toBe(true);
    startTurn();
    const s = captureIfFirstMutationOfTurn(repo);
    expect(s).toBeNull();
    expect(listSnapshots()).toEqual([]);
    delete process.env.ELANOUS_UNDO;
  });

  test('setUndoDisabled respected regardless of env', () => {
    setUndoDisabled(true);
    expect(isUndoDisabled()).toBe(true);
    startTurn();
    expect(captureIfFirstMutationOfTurn(repo)).toBeNull();
    setUndoDisabled(false);
  });
});
