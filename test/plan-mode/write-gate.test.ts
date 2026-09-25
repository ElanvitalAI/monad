import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertPlanGate, setPlanModeState, resetPlanModeState, INACTIVE_PLAN_MODE_STATE } from '../../src/plan-mode/index.js';
import { __resetSessionWorkingDir, setSessionCwd } from '../../src/session/working-dir.js';

afterEach(() => {
  resetPlanModeState();
  __resetSessionWorkingDir();
});

describe('assertPlanGate', () => {
  test('returns null when plan mode inactive', () => {
    expect(assertPlanGate('/any/path.ts')).toBeNull();
  });

  test('allows the plan file when active', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: '/abs/plans/s.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    expect(assertPlanGate('/abs/plans/s.md')).toBeNull();
  });

  test('blocks anything other than the plan file', () => {
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: '/abs/plans/s.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    const err = assertPlanGate('/abs/src/foo.ts');
    expect(err).not.toBeNull();
    expect(err!.code).toBe('PlanModeWriteBlocked');
    expect(err!.message).toContain('Plan mode is active');
    expect(err!.message).toContain('/abs/plans/s.md');
  });

  test('relative + absolute resolve to the same canonicalised path', () => {
    const cwd = process.cwd();
    const planPath = `${cwd}/plan.md`;
    setPlanModeState({
      ...INACTIVE_PLAN_MODE_STATE,
      active: true, sessionId: 's', startedAt: 0, phase: 'explore',
      planFilePath: planPath,
      previousPolicy: { mode: 'ask-edit' },
    });
    expect(assertPlanGate('./plan.md')).toBeNull();
    expect(assertPlanGate(planPath)).toBeNull();
  });

  test('WD4 — relative path resolves against session working directory, not process.cwd()', () => {
    // Pin SWD to a fresh tmp dir that does NOT match process.cwd().
    // Plan file lives inside that tmp dir → `plan.md` (relative)
    // must canonicalise through SWD to match.
    const tmp = mkdtempSync(join(tmpdir(), 'swd-gate-'));
    try {
      setSessionCwd(tmp, 'user');
      const planPath = resolve(tmp, 'plan.md');
      setPlanModeState({
        ...INACTIVE_PLAN_MODE_STATE,
        active: true, sessionId: 's', startedAt: 0, phase: 'explore',
        planFilePath: planPath,
        previousPolicy: { mode: 'ask-edit' },
      });
      // Relative path canonicalised via SWD → matches plan file.
      expect(assertPlanGate('plan.md')).toBeNull();
      // Same relative path resolved against process.cwd() would
      // point at <repo>/plan.md — the gate would block it. Confirm
      // it does NOT block (i.e. resolution went through SWD).
      expect(assertPlanGate('./plan.md')).toBeNull();
      // A sibling file inside SWD is still blocked.
      expect(assertPlanGate('other.ts')?.code).toBe('PlanModeWriteBlocked');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
