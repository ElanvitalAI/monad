import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  applyEdit, applyRead, applyWrite,
  EditErrorCode, ReadFileStateStore,
  setPolicy, resetPolicyToDefault,
} from '../../src/code-edit/index.js';
import {
  setPlanModeState, resetPlanModeState, INACTIVE_PLAN_MODE_STATE,
} from '../../src/plan-mode/index.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-pm-int-'));
  dirs.push(d);
  return d;
}

beforeEach(() => setPolicy({ mode: 'unsupervised' }));

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  resetPolicyToDefault();
  resetPlanModeState();
});

describe('applyEdit respects plan-mode gate', () => {
  test('edit on a non-plan file is blocked with PolicyRejected', async () => {
    const d = mkdir();
    const src = join(d, 'src.ts');
    const plan = join(d, 'plan.md');
    writeFileSync(src, 'original');
    writeFileSync(plan, 'plan v1');
    const store = new ReadFileStateStore();
    await applyRead(src, store);

    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: plan, previousPolicy: { mode: 'ask-edit' },
    });

    const out = await applyEdit(
      { file_path: src, edits: [{ old_string: 'original', new_string: 'changed' }] },
      store,
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.PolicyRejected);
    expect(out.message).toContain('Plan mode');
  });

  test('edit on the plan file itself is allowed', async () => {
    const d = mkdir();
    const plan = join(d, 'plan.md');
    writeFileSync(plan, 'plan v1');
    const store = new ReadFileStateStore();
    await applyRead(plan, store);

    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: plan, previousPolicy: { mode: 'ask-edit' },
    });

    const out = await applyEdit(
      { file_path: plan, edits: [{ old_string: 'v1', new_string: 'v2' }] },
      store,
    );
    expect(out.ok).toBe(true);
  });

  test('write on non-plan file blocked', async () => {
    const d = mkdir();
    const plan = join(d, 'plan.md');
    writeFileSync(plan, 'x');
    const store = new ReadFileStateStore();

    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: plan, previousPolicy: { mode: 'ask-edit' },
    });

    const out = await applyWrite({ file_path: join(d, 'other.md'), content: 'nope' }, store);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error();
    expect(out.code).toBe(EditErrorCode.PolicyRejected);
    expect(out.meta?.planMode).toBe(true);
  });
});
