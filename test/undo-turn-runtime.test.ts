// ── UndoTurn runtime (UT3) ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { undoTurnRuntime } from '../src/tool-runtime/undo-turn-runtime';
import {
  captureSnapshot, pushSnapshot, listSnapshots,
  __resetSnapshotStore, __resetTurnState,
} from '../src/undo-turn/index.js';

function gitInit(cwd: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], {
    cwd, stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}
function gitCommit(cwd: string, msg: string): void {
  execFileSync('git', ['add', '.'], { cwd, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '-m', msg], {
    cwd, stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

describe('UndoTurn runtime', () => {
  let repo: string;

  beforeEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    repo = mkdtempSync(join(tmpdir(), 'ut3-'));
    gitInit(repo);
    writeFileSync(join(repo, 'a'), 'v1\n');
    gitCommit(repo, 'c1');
  });

  afterEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  test('errors when no snapshots', async () => {
    await expect(
      undoTurnRuntime.run({}, { surface: 'dashboard' }),
    ).rejects.toThrow(/no snapshots/);
  });

  test('restores latest without snapshotId', async () => {
    writeFileSync(join(repo, 'a'), 'v2\n');
    const snap = captureSnapshot(repo)!;
    pushSnapshot(snap);
    writeFileSync(join(repo, 'a'), 'v3\n');
    const res = await undoTurnRuntime.run({}, { surface: 'dashboard' });
    expect(res.restoredId).toBe(snap.id);
    expect(readFileSync(join(repo, 'a'), 'utf8')).toBe('v2\n');
    // Restored snapshot dropped from ring
    expect(listSnapshots()).toEqual([]);
  });

  test('errors when snapshotId does not match', async () => {
    writeFileSync(join(repo, 'a'), 'v2\n');
    const snap = captureSnapshot(repo)!;
    pushSnapshot(snap);
    await expect(
      undoTurnRuntime.run({ snapshotId: 'zzzzzzzz' }, { surface: 'dashboard' }),
    ).rejects.toThrow(/no snapshot matches/);
  });

  test('restoring a specific mid-ring snapshot drops everything after', async () => {
    writeFileSync(join(repo, 'a'), 'v2\n');
    const s1 = captureSnapshot(repo, { description: 's1' })!;
    pushSnapshot(s1);
    writeFileSync(join(repo, 'a'), 'v3\n');
    const s2 = captureSnapshot(repo, { description: 's2' })!;
    pushSnapshot(s2);
    writeFileSync(join(repo, 'a'), 'v4\n');
    const s3 = captureSnapshot(repo, { description: 's3' })!;
    pushSnapshot(s3);
    // 3 snapshots in ring; restore s2 → drop s2 + s3, leaving s1.
    writeFileSync(join(repo, 'a'), 'v5\n'); // dirty just to prove restore happened
    const res = await undoTurnRuntime.run({ snapshotId: s2.id }, { surface: 'dashboard' });
    expect(res.restoredId).toBe(s2.id);
    expect(res.snapshotsDropped).toBe(2);
    expect(readFileSync(join(repo, 'a'), 'utf8')).toBe('v3\n');
    expect(listSnapshots().map(s => s.description)).toEqual(['s1']);
  });
});
