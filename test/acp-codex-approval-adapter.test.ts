// H4 Phase 3.A · CodexApprovalAdapter scaffold + flattenMcpServersToCodexConfig.
//
// Phase 3.A lands the adapter shape + MCP config flattening so Phase 3.B
// (app-server RPC client) can hook real ExecPolicyAmendment / NetworkPolicyAmendment
// / MCP tool-call requests to the same HITL sinks without refactoring.

import { describe, test, expect, mock } from 'bun:test';
import {
  createCodexApprovalAdapter,
  flattenMcpServersToCodexConfig,
} from '../src/acp/codex-approval-adapter.js';
import type { AcpPermissionApprover } from '../src/acp/client.js';

describe('createCodexApprovalAdapter · approver wiring', () => {
  test('no approvers → auto-approve with logOnly=false', async () => {
    const a = createCodexApprovalAdapter();
    const decision = await a.onExecPolicyAmendment({
      sessionId: 's1',
      command: ['rm', '-rf', '/tmp/x'],
      cwd: '/proj',
      kind: 'exec-policy',
    });
    expect(decision.approved).toBe(true);
    expect(decision.comment).toBe('no approver attached');
  });

  test('logOnly=true · auto-approve even with approver attached', async () => {
    const approver = mock(async () => false);
    const a = createCodexApprovalAdapter({
      permissionApprover: approver as unknown as AcpPermissionApprover,
      logOnly: true,
    });
    const decision = await a.onExecPolicyAmendment({
      sessionId: 's',
      command: ['ls'],
      cwd: '/',
      kind: 'exec-policy',
    });
    expect(decision.approved).toBe(true);
    expect(decision.comment).toBe('logOnly');
    expect(approver).not.toHaveBeenCalled();
  });

  test('exec-policy with permission approver → forwarded', async () => {
    const approver = mock(async () => true);
    const a = createCodexApprovalAdapter({
      permissionApprover: approver as unknown as AcpPermissionApprover,
    });
    const decision = await a.onExecPolicyAmendment({
      sessionId: 's',
      command: ['git', 'push'],
      cwd: '/proj',
      reason: 'wants to push',
      kind: 'exec-policy',
    });
    expect(decision.approved).toBe(true);
    expect(approver).toHaveBeenCalledTimes(1);
    const req = (approver as any).mock.calls[0][0];
    expect(req.sessionId).toBe('s');
    expect(req.backendId).toBe('codex-app-server');
    expect(req.kind).toBe('exec-policy');
    expect(req.title).toContain('git push');
    expect(req.rawInput.cwd).toBe('/proj');
    expect(req.options.map((o: any) => o.optionId)).toEqual(['allow_once', 'allow_always', 'reject_once']);
  });

  test('network-policy · approved=false path', async () => {
    const approver = mock(async () => false);
    const a = createCodexApprovalAdapter({
      permissionApprover: approver as unknown as AcpPermissionApprover,
    });
    const decision = await a.onNetworkPolicyAmendment({
      sessionId: 's',
      host: 'api.openai.com',
      port: 443,
      protocol: 'https',
      kind: 'network-policy',
    });
    expect(decision.approved).toBe(false);
    expect(decision.comment).toBe('rejected');
  });

  test('approver throws → default-deny', async () => {
    const approver = mock(async () => { throw new Error('boom'); });
    const a = createCodexApprovalAdapter({
      permissionApprover: approver as unknown as AcpPermissionApprover,
    });
    const decision = await a.onExecPolicyAmendment({
      sessionId: 's',
      command: ['x'],
      cwd: '/',
      kind: 'exec-policy',
    });
    expect(decision.approved).toBe(false);
    expect(decision.comment).toBe('approver threw');
  });

  test('mcp-tool-call · args round-trip to rawInput', async () => {
    const approver = mock(async () => true);
    const a = createCodexApprovalAdapter({
      permissionApprover: approver as unknown as AcpPermissionApprover,
    });
    await a.onMcpToolCall({
      sessionId: 's',
      server: 'fs',
      tool: 'read',
      args: { path: '/etc/passwd' },
      kind: 'mcp-tool-call',
    });
    const req = (approver as any).mock.calls[0][0];
    expect(req.title).toBe('codex mcp: fs.read');
    expect(req.rawInput.server).toBe('fs');
    expect(req.rawInput.tool).toBe('read');
    expect(req.rawInput.args.path).toBe('/etc/passwd');
  });

  test('setPermissionApprover / setQuestionApprover · hasApprover flips', async () => {
    const a = createCodexApprovalAdapter();
    expect(a.hasApprover('permission')).toBe(false);
    expect(a.hasApprover('question')).toBe(false);
    a.setPermissionApprover(async () => true);
    expect(a.hasApprover('permission')).toBe(true);
    a.setPermissionApprover(null);
    expect(a.hasApprover('permission')).toBe(false);
  });
});

describe('flattenMcpServersToCodexConfig', () => {
  test('stdio server with command + args → dotted-friendly tree', () => {
    const cfg = flattenMcpServersToCodexConfig([
      { name: 'docs', command: 'docs-server', args: ['--port', '3000'] },
    ]);
    expect(cfg.docs).toBeDefined();
    expect(cfg.docs!.command).toBe('docs-server');
    expect(cfg.docs!.args).toEqual(['--port', '3000']);
  });

  test('env as array-of-pairs → object', () => {
    const cfg = flattenMcpServersToCodexConfig([
      {
        name: 'x',
        command: 'server',
        args: [],
        env: [
          { name: 'FOO', value: 'bar' },
          { name: 'BAZ', value: 'qux' },
        ],
      },
    ]);
    expect(cfg.x!.env).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  test('env as record → pass through as-is', () => {
    const cfg = flattenMcpServersToCodexConfig([
      { name: 'x', command: 'c', args: [], env: { A: '1' } },
    ]);
    expect(cfg.x!.env).toEqual({ A: '1' });
  });

  test('explicit type=http → dropped (Phase 3.A SDK path · stdio only)', () => {
    const cfg = flattenMcpServersToCodexConfig([
      { type: 'http', name: 'remote', url: 'https://example.com/mcp' } as any,
    ]);
    expect(cfg.remote).toBeUndefined();
  });

  test('multiple stdio servers flatten side-by-side', () => {
    const cfg = flattenMcpServersToCodexConfig([
      { name: 'a', command: 'cmd-a' },
      { name: 'b', command: 'cmd-b', args: ['--flag'] },
    ]);
    expect(Object.keys(cfg).sort()).toEqual(['a', 'b']);
  });

  test('no command + no type → dropped', () => {
    const cfg = flattenMcpServersToCodexConfig([
      { name: 'bad' } as any,
    ]);
    expect(cfg.bad).toBeUndefined();
  });
});

// acceptForSession — 3-way approval via the multi-option question path.
describe('createCodexApprovalAdapter · 3-way question (allow once / session / reject)', () => {
  const exec = { sessionId: 's', command: ['ls'], cwd: '/', kind: 'exec-policy' } as const;

  function withAnswer(label: string) {
    const q = mock(async (req: { questions: { id: string }[] }) => ({
      answers: { [req.questions[0]!.id]: label },
    }));
    return { adapter: createCodexApprovalAdapter({ questionApprover: q as never }), q };
  }

  test('"Allow for session" → {approved, scope:session}', async () => {
    const { adapter, q } = withAnswer('Allow for session');
    const d = await adapter.onExecPolicyAmendment({ ...exec });
    expect(d).toEqual({ approved: true, scope: 'session', comment: 'allowed for session' });
    // surfaced exactly 3 options, no free-form Other
    const asked = (q.mock.calls[0] as unknown as [{ questions: { options: { label: string }[]; includeOther?: boolean }[] }])[0];
    expect(asked.questions[0]!.options.map((o) => o.label)).toEqual(['Allow once', 'Allow for session', 'Reject']);
    expect(asked.questions[0]!.includeOther).toBe(false);
  });

  test('"Allow once" → {approved, scope:once}', async () => {
    const d = await withAnswer('Allow once').adapter.onExecPolicyAmendment({ ...exec });
    expect(d).toEqual({ approved: true, scope: 'once', comment: 'allowed once' });
  });

  test('"Reject" → not approved', async () => {
    expect((await withAnswer('Reject').adapter.onExecPolicyAmendment({ ...exec })).approved).toBe(false);
  });

  test('cancelled → not approved', async () => {
    const cancelled = createCodexApprovalAdapter({
      questionApprover: (async () => ({ answers: {}, cancelled: true })) as never,
    });
    expect((await cancelled.onExecPolicyAmendment({ ...exec })).approved).toBe(false);
  });

  test('question path takes precedence over a permission approver when both attached', async () => {
    const perm = mock(async () => false); // would reject if used
    const q = mock(async (req: { questions: { id: string }[] }) => ({
      answers: { [req.questions[0]!.id]: 'Allow once' },
    }));
    const a = createCodexApprovalAdapter({ permissionApprover: perm as never, questionApprover: q as never });
    const d = await a.onExecPolicyAmendment({ ...exec });
    expect(d.approved).toBe(true);
    expect(perm).not.toHaveBeenCalled();
  });
});
