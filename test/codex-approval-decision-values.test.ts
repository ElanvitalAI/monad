// Regression guard for the Codex approval decision-value drift.
//
// elanous used to answer every codex approval server-request with
// `{decision:'approve'|'deny'}`. Current codex (app-server-protocol,
// checkout 2026-07-08) uses camelCase `accept|acceptForSession|decline|
// cancel` for command/fileChange, `ReviewDecision` (approved|denied) for
// the legacy methods, and a granted-profile object for permissions — so
// `approve`/`deny` failed to deserialize and broke every approval. These
// tests pin the exact wire values against the native protocol.

import { describe, expect, test } from 'bun:test';
import { buildCodexApprovalResponse } from '../src/acp/codex-app-server-agent';

describe('buildCodexApprovalResponse · codex wire compliance', () => {
  test('v2 commandExecution → accept / decline (NOT approve/deny)', () => {
    expect(buildCodexApprovalResponse('item/commandExecution/requestApproval', true)).toEqual({ decision: 'accept' });
    expect(buildCodexApprovalResponse('item/commandExecution/requestApproval', false)).toEqual({ decision: 'decline' });
  });

  test('scope:session → acceptForSession (allow-for-session); once → accept', () => {
    expect(buildCodexApprovalResponse('item/commandExecution/requestApproval', true, { scope: 'session' }))
      .toEqual({ decision: 'acceptForSession' });
    expect(buildCodexApprovalResponse('item/commandExecution/requestApproval', true, { scope: 'once' }))
      .toEqual({ decision: 'accept' });
    expect(buildCodexApprovalResponse('item/fileChange/requestApproval', true, { scope: 'session' }))
      .toEqual({ decision: 'acceptForSession' });
    // deny ignores scope
    expect(buildCodexApprovalResponse('item/commandExecution/requestApproval', false, { scope: 'session' }))
      .toEqual({ decision: 'decline' });
  });

  test('v2 fileChange → accept / decline', () => {
    expect(buildCodexApprovalResponse('item/fileChange/requestApproval', true)).toEqual({ decision: 'accept' });
    expect(buildCodexApprovalResponse('item/fileChange/requestApproval', false)).toEqual({ decision: 'decline' });
  });

  test('legacy execCommandApproval / applyPatchApproval → ReviewDecision approved / denied', () => {
    expect(buildCodexApprovalResponse('execCommandApproval', true)).toEqual({ decision: 'approved' });
    expect(buildCodexApprovalResponse('execCommandApproval', false)).toEqual({ decision: 'denied' });
    expect(buildCodexApprovalResponse('applyPatchApproval', true)).toEqual({ decision: 'approved' });
    expect(buildCodexApprovalResponse('applyPatchApproval', false)).toEqual({ decision: 'denied' });
  });

  test('permissions → granted profile ({permissions:{}} on deny), NOT a decision', () => {
    // Deny → grant nothing.
    expect(buildCodexApprovalResponse('item/permissions/requestApproval', false)).toEqual({ permissions: {} });
    // Approve → pass through the requested network/fileSystem overlay.
    const req = { network: { allowedHosts: ['example.com'] }, fileSystem: { writableRoots: ['/tmp'] } };
    expect(
      buildCodexApprovalResponse('item/permissions/requestApproval', true, { requestedPermissions: req }),
    ).toEqual({ permissions: { network: req.network, fileSystem: req.fileSystem } });
    // Approve with no requested overlay → empty grant (valid shape).
    expect(buildCodexApprovalResponse('item/permissions/requestApproval', true)).toEqual({ permissions: {} });
  });

  test('never emits the stale approve/deny values', () => {
    const outs = [
      buildCodexApprovalResponse('item/commandExecution/requestApproval', true),
      buildCodexApprovalResponse('item/commandExecution/requestApproval', false),
      buildCodexApprovalResponse('item/fileChange/requestApproval', true),
      buildCodexApprovalResponse('unknown/method', false),
    ];
    for (const o of outs) {
      const d = (o as { decision?: string }).decision;
      expect(d).not.toBe('approve');
      expect(d).not.toBe('deny');
    }
  });

  test('unknown approval method → decline (defensive)', () => {
    expect(buildCodexApprovalResponse('some/other/method', false)).toEqual({ decision: 'decline' });
  });
});
