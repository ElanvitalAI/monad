// ── UT2 — apply.ts ↔ undo-turn integration ──

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  applyEdit, applyWrite, applyRead,
  resetPolicyToDefault, setPolicy,
  setCodeEditApprover,
  ReadFileStateStore,
} from '../src/code-edit/index.js';
import {
  __resetSnapshotStore,
  __resetTurnState,
  startTurn, endTurn,
  listSnapshots,
  restoreSnapshot,
  setUndoDisabled,
} from '../src/undo-turn/index.js';
import {
  __resetSessionWorkingDir,
  initSessionWorkingDir,
} from '../src/session/working-dir.js';

function gitInit(cwd: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], {
    cwd, stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}
function gitCommitAll(cwd: string, msg: string): void {
  execFileSync('git', ['add', '.'], { cwd, stdio: 'pipe' });
  execFileSync('git', ['commit', '-q', '-m', msg], {
    cwd, stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
}

describe('apply.ts auto-snapshot hook', () => {
  let repo: string;

  beforeEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    __resetSessionWorkingDir();
    resetPolicyToDefault();
    setUndoDisabled(false);
    delete process.env.MONAD_UNDO;
    setPolicy({ mode: 'unsupervised' });  // skip approver prompts
    repo = mkdtempSync(join(tmpdir(), 'ut2-'));
    gitInit(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1\n');
    gitCommitAll(repo, 'c1');
    initSessionWorkingDir(repo);
  });

  afterEach(() => {
    __resetSnapshotStore();
    __resetTurnState();
    __resetSessionWorkingDir();
    resetPolicyToDefault();
    setCodeEditApprover(null);
    setUndoDisabled(false);
    try { rmSync(repo, { recursive: true, force: true }); } catch {}
  });

  test('first Edit of a turn takes a snapshot; second Edit does not', async () => {
    startTurn('turn A');
    const store = new ReadFileStateStore();
    const p = join(repo, 'a.txt');

    await applyRead(p, store);
    const r1 = await applyEdit({
      file_path: p,
      edits: [{ old_string: 'v1\n', new_string: 'v2\n' }],
    }, store);
    expect(r1.ok).toBe(true);
    expect(listSnapshots().length).toBe(1);

    await applyRead(p, store);
    const r2 = await applyEdit({
      file_path: p,
      edits: [{ old_string: 'v2\n', new_string: 'v3\n' }],
    }, store);
    expect(r2.ok).toBe(true);
    // Still only one snapshot — same turn
    expect(listSnapshots().length).toBe(1);

    endTurn();
  });

  test('new turn → new snapshot', async () => {
    const store = new ReadFileStateStore();
    const p = join(repo, 'a.txt');

    startTurn('turn A');
    await applyRead(p, store);
    await applyEdit({ file_path: p, edits: [{ old_string: 'v1\n', new_string: 'v2\n' }] }, store);
    endTurn();

    startTurn('turn B');
    await applyRead(p, store);
    await applyEdit({ file_path: p, edits: [{ old_string: 'v2\n', new_string: 'v3\n' }] }, store);
    endTurn();

    expect(listSnapshots().length).toBe(2);
  });

  test('Write also triggers the snapshot hook', async () => {
    startTurn('turn C');
    const store = new ReadFileStateStore();
    const r = await applyWrite({
      file_path: join(repo, 'b.txt'),
      content: 'hello',
    }, store);
    expect(r.ok).toBe(true);
    expect(listSnapshots().length).toBe(1);
    endTurn();
  });

  test('MONAD_UNDO=off → no snapshot even with Edit', async () => {
    process.env.MONAD_UNDO = 'off';
    startTurn('turn D');
    const store = new ReadFileStateStore();
    const p = join(repo, 'a.txt');
    await applyRead(p, store);
    await applyEdit({ file_path: p, edits: [{ old_string: 'v1\n', new_string: 'v2\n' }] }, store);
    expect(listSnapshots().length).toBe(0);
    endTurn();
    delete process.env.MONAD_UNDO;
  });

  test('end-to-end — Edit, then restore reverses the change', async () => {
    startTurn('turn E');
    const store = new ReadFileStateStore();
    const p = join(repo, 'a.txt');
    await applyRead(p, store);
    await applyEdit({ file_path: p, edits: [{ old_string: 'v1\n', new_string: 'vX\n' }] }, store);
    endTurn();

    expect(readFileSync(p, 'utf8')).toBe('vX\n');
    const snaps = listSnapshots();
    expect(snaps.length).toBe(1);

    const r = restoreSnapshot(snaps[0]!);
    expect(r.ok).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('v1\n');
  });

  test('Write of a new file, then restore removes it', async () => {
    startTurn('turn F');
    const store = new ReadFileStateStore();
    const newFile = join(repo, 'created.txt');
    await applyWrite({ file_path: newFile, content: 'llm wrote this' }, store);
    endTurn();

    const snap = listSnapshots()[0]!;
    // File exists now
    expect(readFileSync(newFile, 'utf8')).toBe('llm wrote this');

    const r = restoreSnapshot(snap);
    expect(r.ok).toBe(true);
    // File removed (it was untracked at restore time but not at snapshot time)
    let threw = false;
    try { readFileSync(newFile, 'utf8'); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});
