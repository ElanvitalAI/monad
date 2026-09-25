import { describe, expect, test } from 'bun:test';

import { bootDashboardApproverRuntimes } from '../src/dashboard/approver-runtime-boot.js';

describe('bootDashboardApproverRuntimes', () => {
  test('wires shell approver, code-edit approver, ask-user deps, and worktree deps', () => {
    const calls: {
      shell?: unknown;
      codeEdit?: unknown;
      askUser?: { coordinator: unknown; termSize: () => { cols: number; rows: number } };
      worktree?: { sessionId: () => string };
    } = {};

    bootDashboardApproverRuntimes({
      setShellApprover: (approver) => { calls.shell = approver; },
      createShellApprover: () => ({ kind: 'shell-approver' }),
      setCodeEditApprover: (approver) => { calls.codeEdit = approver; },
      createCodeEditApprover: () => ({ kind: 'code-edit-approver' }),
      setAskUserQuestionDeps: (deps) => { calls.askUser = deps; },
      setWorktreeRuntimeDeps: (deps) => { calls.worktree = deps; },
      coordinator: { kind: 'display' },
      termSize: () => ({ cols: 120, rows: 40 }),
      sessionId: () => 'pid-123',
    });

    expect(calls.shell).toEqual({ kind: 'shell-approver' });
    expect(calls.codeEdit).toEqual({ kind: 'code-edit-approver' });
    expect(calls.askUser?.coordinator).toEqual({ kind: 'display' });
    expect(calls.askUser?.termSize()).toEqual({ cols: 120, rows: 40 });
    expect(calls.worktree?.sessionId()).toBe('pid-123');
  });
});
