import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  assessEdit, assessWrite,
  setPolicy, resetPolicyToDefault,
  setCodeEditApprover,
  applyEdit, applyRead, applyWrite,
  EditErrorCode, ReadFileStateStore,
  type CodeEditApprover,
} from '../../src/code-edit/index.js';
import { __resetSessionWorkingDir, setSessionCwd } from '../../src/session/working-dir.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-safety-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  resetPolicyToDefault();
  setCodeEditApprover(null);
  __resetSessionWorkingDir();
});

describe('assessEdit / assessWrite — pure decision', () => {
  const edit = { file_path: '/tmp/f.ts', edits: [{ old_string: 'a', new_string: 'b' }] };

  test('empty edits array rejected outright', () => {
    const d = assessEdit({ file_path: '/tmp/f.ts', edits: [] }, { mode: 'unsupervised' });
    expect(d.kind).toBe('reject');
  });

  test('empty file_path rejected', () => {
    const d = assessEdit({ file_path: '', edits: [{ old_string: 'a', new_string: 'b' }] }, { mode: 'unsupervised' });
    expect(d.kind).toBe('reject');
  });

  test('unsupervised → auto-approve', () => {
    expect(assessEdit(edit, { mode: 'unsupervised' }).kind).toBe('auto-approve');
    expect(assessWrite({ file_path: '/tmp/f.ts', content: 'x' }, { mode: 'unsupervised' }).kind).toBe('auto-approve');
  });

  test('ask-edit → ask-user', () => {
    expect(assessEdit(edit, { mode: 'ask-edit' }).kind).toBe('ask-user');
  });

  test('ask-all → ask-user', () => {
    expect(assessEdit(edit, { mode: 'ask-all' }).kind).toBe('ask-user');
  });

  test('trusted-dirs: inside list → auto-approve', () => {
    const d = assessEdit(
      { file_path: '/home/me/work/src/x.ts', edits: edit.edits },
      { mode: 'trusted-dirs', trustedDirs: ['/home/me/work'] },
    );
    expect(d.kind).toBe('auto-approve');
  });

  test('trusted-dirs: outside list → ask-user', () => {
    const d = assessEdit(
      { file_path: '/etc/passwd', edits: edit.edits },
      { mode: 'trusted-dirs', trustedDirs: ['/home/me/work'] },
    );
    expect(d.kind).toBe('ask-user');
  });

  test('trusted-dirs: empty list → ask-user (degraded to ask-all)', () => {
    const d = assessEdit(edit, { mode: 'trusted-dirs', trustedDirs: [] });
    expect(d.kind).toBe('ask-user');
  });

  test('trusted-dirs: path-prefix match without separator does NOT count', () => {
    // ~/work-other must NOT be treated as under ~/work.
    const d = assessEdit(
      { file_path: '/home/me/work-other/f.ts', edits: edit.edits },
      { mode: 'trusted-dirs', trustedDirs: ['/home/me/work'] },
    );
    expect(d.kind).toBe('ask-user');
  });

  test('deniedDirs overrides unsupervised → reject', () => {
    const d = assessEdit(
      { file_path: '/home/me/.ssh/id_rsa', edits: edit.edits },
      { mode: 'unsupervised', deniedDirs: ['/home/me/.ssh'] },
    );
    expect(d.kind).toBe('reject');
  });

  test('WD4 — relative path resolves against session working directory', () => {
    // Pin SWD to a specific tmp dir. The trusted-dirs list covers
    // that tmp dir. A relative path should canonicalise through SWD
    // → auto-approve. If we were still resolving via process.cwd(),
    // the target would be outside trustedDirs → ask-user.
    const d = mkdir();
    setSessionCwd(d, 'user');
    const decision = assessEdit(
      { file_path: 'foo.ts', edits: edit.edits },
      { mode: 'trusted-dirs', trustedDirs: [d] },
    );
    expect(decision.kind).toBe('auto-approve');
  });
});

describe('applyEdit — policy gate integration', () => {
  test('ask-edit without approver → ApproverMissing', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'hello');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    setPolicy({ mode: 'ask-edit' });
    setCodeEditApprover(null);

    const out = await applyEdit({ file_path: p, edits: [{ old_string: 'hello', new_string: 'hi' }] }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.ApproverMissing);
  });

  test('ask-edit + approver returns false → UserRejected + file untouched', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'before');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    setPolicy({ mode: 'ask-edit' });
    const approverCalls: unknown[] = [];
    const approver: CodeEditApprover = async (req) => { approverCalls.push(req); return false; };
    setCodeEditApprover(approver);

    const out = await applyEdit({ file_path: p, edits: [{ old_string: 'before', new_string: 'after' }] }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.UserRejected);
    expect(approverCalls.length).toBe(1);

    // Disk untouched.
    const fs = await import('fs');
    expect(fs.readFileSync(p, 'utf-8')).toBe('before');
  });

  test('ask-edit + approver returns true → apply proceeds', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'before');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    setPolicy({ mode: 'ask-edit' });
    setCodeEditApprover(async () => true);

    const out = await applyEdit({ file_path: p, edits: [{ old_string: 'before', new_string: 'after' }] }, store);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error();
    expect(out.newContent).toBe('after');
  });

  test('approver receives summary + reason', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'aaa\nbbb\nccc\n');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    setPolicy({ mode: 'ask-edit' });
    let received: any = null;
    setCodeEditApprover(async (req) => { received = req; return true; });

    await applyEdit({ file_path: p, edits: [{ old_string: 'bbb', new_string: 'BBB' }] }, store);
    expect(received).not.toBeNull();
    expect(received.kind).toBe('edit');
    expect(received.file_path).toBe(p);
    expect(received.changeSummary).toMatch(/added/);
    expect(received.reason).toBeDefined();
    expect(received.preview).toBeDefined();
    expect(received.preview.structuredPatch).toHaveLength(1);
    expect(received.preview.linesAdded).toBeGreaterThan(0);
  });

  test('denied-dirs blocks unsupervised mode too', async () => {
    const d = mkdir();
    const p = join(d, 'secret.txt');
    writeFileSync(p, 'v1');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    setPolicy({ mode: 'unsupervised', deniedDirs: [d] });
    const out = await applyEdit({ file_path: p, edits: [{ old_string: 'v1', new_string: 'v2' }] }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.PolicyRejected);
  });

  test('approver throwing is treated as rejection (defensive)', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'x');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    setPolicy({ mode: 'ask-edit' });
    setCodeEditApprover(async () => { throw new Error('boom'); });

    const out = await applyEdit({ file_path: p, edits: [{ old_string: 'x', new_string: 'y' }] }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.UserRejected);
  });
});

describe('applyWrite — policy gate', () => {
  test('ask-all blocks creation without approval', async () => {
    const d = mkdir();
    const p = join(d, 'new.md');
    const store = new ReadFileStateStore();

    setPolicy({ mode: 'ask-all' });
    setCodeEditApprover(async () => false);

    const out = await applyWrite({ file_path: p, content: '# hi\n' }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.UserRejected);

    const fs = await import('fs');
    expect(fs.existsSync(p)).toBe(false);
  });

  test('unsupervised lets creation through', async () => {
    const d = mkdir();
    const p = join(d, 'new.md');
    const store = new ReadFileStateStore();

    setPolicy({ mode: 'unsupervised' });
    const out = await applyWrite({ file_path: p, content: '# hi\n' }, store);
    expect(out.ok).toBe(true);
  });
});

describe('getPolicy / setPolicy', () => {
  test('setPolicy clone-protects its input', () => {
    const dirs = ['/a'];
    setPolicy({ mode: 'trusted-dirs', trustedDirs: dirs });
    dirs.push('/b');
    const p = require('../../src/code-edit/safety.js').getPolicy();
    expect(p.trustedDirs).toEqual(['/a']);
  });

  test('resetPolicyToDefault restores ask-edit', () => {
    setPolicy({ mode: 'unsupervised' });
    resetPolicyToDefault();
    const { getPolicy } = require('../../src/code-edit/safety.js');
    expect(getPolicy().mode).toBe('ask-edit');
  });
});
