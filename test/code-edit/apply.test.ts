import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { promises as fsp, mkdtempSync, writeFileSync, existsSync, unlinkSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  applyEdit, applyRead, applyWrite,
  EditErrorCode, ReadFileStateStore,
  setPolicy, resetPolicyToDefault,
} from '../../src/code-edit/index.js';
import { setSessionCwd, __resetSessionWorkingDir } from '../../src/session/working-dir.js';

// These tests exercise the apply pipeline in isolation; CE4's policy
// gate is covered separately in safety.test.ts. Force unsupervised
// mode so every path bypasses the approval prompt.
beforeEach(() => setPolicy({ mode: 'unsupervised' }));
afterEach(() => resetPolicyToDefault());

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-apply-'));
  dirs.push(d);
  return d;
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('applyRead', () => {
  test('reads full file + records Read state', async () => {
    const d = mkdir();
    const p = join(d, 'a.txt');
    writeFileSync(p, 'hello\nworld\n');
    const store = new ReadFileStateStore();

    const r = await applyRead(p, store);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.content).toBe('hello\nworld\n');
    expect(r.lines).toBe(3);
    expect(r.truncated).toBe(false);

    const e = store.verifyBeforeEdit(p)!;
    expect(e.partialView).toBe(false);
    expect(e.contentHash).toBeDefined();
  });

  test('partial read sets partialView:true and omits hash', async () => {
    const d = mkdir();
    const p = join(d, 'big.txt');
    writeFileSync(p, 'l1\nl2\nl3\nl4\nl5\n');
    const store = new ReadFileStateStore();

    const r = await applyRead(p, store, { offset: 1, limit: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.content).toBe('l2\nl3');
    expect(r.truncated).toBe(true);

    const e = store.verifyBeforeEdit(p)!;
    expect(e.partialView).toBe(true);
    expect(e.contentHash).toBeUndefined();
  });

  test('missing file → FileNotFound', async () => {
    const store = new ReadFileStateStore();
    const r = await applyRead('/nonexistent/does-not-exist.txt', store);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error();
    expect(r.code).toBe(EditErrorCode.FileNotFound);
  });
});

describe('applyEdit', () => {
  test('happy path: Read → Edit → file on disk reflects new content', async () => {
    const d = mkdir();
    const p = join(d, 'h.txt');
    writeFileSync(p, 'hello world\n');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    const out = await applyEdit(
      { file_path: p, edits: [{ old_string: 'world', new_string: 'elanous' }] },
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error();
    expect(out.newContent).toBe('hello elanous\n');
    expect(out.linesAdded).toBe(1);
    expect(out.linesRemoved).toBe(1);

    expect(await fsp.readFile(p, 'utf-8')).toBe('hello elanous\n');
    // Re-record lets a second edit work without another Read.
    const e = store.verifyBeforeEdit(p)!;
    expect(e.contentHash).toBeDefined();
  });

  test('no prior Read → NotReadFirst', async () => {
    const d = mkdir();
    const p = join(d, 'x.txt');
    writeFileSync(p, 'abc');
    const store = new ReadFileStateStore();

    const out = await applyEdit(
      { file_path: p, edits: [{ old_string: 'a', new_string: 'A' }] },
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.NotReadFirst);
  });

  test('partial Read → NotReadFirst', async () => {
    const d = mkdir();
    const p = join(d, 'x.txt');
    writeFileSync(p, 'a\nb\nc\n');
    const store = new ReadFileStateStore();
    await applyRead(p, store, { offset: 0, limit: 1 });

    const out = await applyEdit(
      { file_path: p, edits: [{ old_string: 'a', new_string: 'A' }] },
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.NotReadFirst);
  });

  test('file changed on disk between Read and Edit → ModifiedSinceRead', async () => {
    const d = mkdir();
    const p = join(d, 'x.txt');
    writeFileSync(p, 'original');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    // External mutation.
    writeFileSync(p, 'tampered');

    const out = await applyEdit(
      { file_path: p, edits: [{ old_string: 'original', new_string: 'new' }] },
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.ModifiedSinceRead);
    // Disk is untouched.
    expect(await fsp.readFile(p, 'utf-8')).toBe('tampered');
  });

  test('multiple matches without replace_all → MultipleMatches with count', async () => {
    const d = mkdir();
    const p = join(d, 'x.txt');
    writeFileSync(p, 'foo foo foo');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    const out = await applyEdit(
      { file_path: p, edits: [{ old_string: 'foo', new_string: 'bar' }] },
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.MultipleMatches);
    expect(out.meta?.matchCount).toBe(3);
  });

  test('batch edits apply in order', async () => {
    const d = mkdir();
    const p = join(d, 'x.txt');
    writeFileSync(p, 'alpha beta gamma');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    const out = await applyEdit(
      {
        file_path: p,
        edits: [
          { old_string: 'alpha', new_string: 'ALPHA' },
          { old_string: 'beta', new_string: 'BETA' },
          { old_string: 'gamma', new_string: 'GAMMA' },
        ],
      },
      store,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error();
    expect(out.newContent).toBe('ALPHA BETA GAMMA');
  });

  test('validation: missing file_path → ValidationError', async () => {
    const store = new ReadFileStateStore();
    const out = await applyEdit({ file_path: '', edits: [{ old_string: 'a', new_string: 'b' }] }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.ValidationError);
  });
});

describe('applyWrite', () => {
  test('creates a new file when path does not exist', async () => {
    const d = mkdir();
    const p = join(d, 'new.md');
    const store = new ReadFileStateStore();

    const out = await applyWrite({ file_path: p, content: '# hello\n' }, store);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error();
    expect(out.originalContent).toBe('');
    expect(out.newContent).toBe('# hello\n');
    expect(await fsp.readFile(p, 'utf-8')).toBe('# hello\n');
  });

  test('overwriting existing file requires prior Read', async () => {
    const d = mkdir();
    const p = join(d, 'existing.txt');
    writeFileSync(p, 'v1');
    const store = new ReadFileStateStore();

    const out = await applyWrite({ file_path: p, content: 'v2' }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.NotReadFirst);
    expect(await fsp.readFile(p, 'utf-8')).toBe('v1');
  });

  test('with prior Read, overwrite succeeds + diff counted', async () => {
    const d = mkdir();
    const p = join(d, 'existing.txt');
    writeFileSync(p, 'line1\nline2\n');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    const out = await applyWrite({ file_path: p, content: 'line1\nLINE2\nline3\n' }, store);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error();
    expect(out.linesAdded).toBeGreaterThan(0);
  });

  test('identical content → NoChange', async () => {
    const d = mkdir();
    const p = join(d, 'same.txt');
    writeFileSync(p, 'identical');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    const out = await applyWrite({ file_path: p, content: 'identical' }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.NoChange);
  });
});

describe('session-cwd resolution (write-drop regression)', () => {
  // Regression: relative-path Write/Edit/Read must resolve against the
  // SESSION working dir (getSessionCwd), NOT process.cwd(). Before the fix
  // the approval gate + shell verification used getSessionCwd while fs I/O
  // used process.cwd() — so after entering a worktree a relative Write
  // reported success but the bytes landed in the boot dir, invisible to
  // `git status` in the worktree → write→verify→missing→rewrite loops.
  afterEach(() => __resetSessionWorkingDir());

  test('relative Write lands under getSessionCwd, not process.cwd', async () => {
    const worktree = mkdir();
    expect(worktree).not.toBe(process.cwd());
    setSessionCwd(worktree, 'user');
    const rel = 'writedrop-regression.txt';
    const store = new ReadFileStateStore();

    const out = await applyWrite({ file_path: rel, content: 'materialized\n' }, store);
    expect(out.ok).toBe(true);

    // Materialized in the session worktree...
    expect(existsSync(join(worktree, rel))).toBe(true);
    expect(await fsp.readFile(join(worktree, rel), 'utf-8')).toBe('materialized\n');
    // ...and did NOT leak into process.cwd() (the boot dir). Clean up first
    // so a regression can't pollute the repo, then assert.
    const leaked = join(process.cwd(), rel);
    const didLeak = existsSync(leaked);
    if (didLeak) { try { unlinkSync(leaked); } catch { /* ignore */ } }
    expect(didLeak).toBe(false);
  });

  test('relative Read then Edit both resolve to getSessionCwd', async () => {
    const worktree = mkdir();
    setSessionCwd(worktree, 'user');
    const rel = 'edit-regression.txt';
    writeFileSync(join(worktree, rel), 'alpha\nbeta\n');
    const store = new ReadFileStateStore();

    const r = await applyRead(rel, store);   // relative → must read the worktree file
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(r.content).toBe('alpha\nbeta\n');

    const out = await applyEdit(
      { file_path: rel, edits: [{ old_string: 'beta', new_string: 'BETA' }] },
      store,
    );
    expect(out.ok).toBe(true);
    expect(await fsp.readFile(join(worktree, rel), 'utf-8')).toBe('alpha\nBETA\n');
    const leaked = join(process.cwd(), rel);
    const didLeak = existsSync(leaked);
    if (didLeak) { try { unlinkSync(leaked); } catch { /* ignore */ } }
    expect(didLeak).toBe(false);
  });
});
