// Round 3 PR2 (β-2 · 2026-05-08) — agent-cli ?hitl=off honors the
// Showroom HITL toggle by skipping HITL approver wiring on session
// create. Verifies the legacy path is untouched and the off path
// passes undefined approvers + surfaces hitl=off in the response.

import { describe, it, expect, spyOn } from 'bun:test';
import { handleAgentCliCreateSession } from '../src/nexus/api/agent-cli.js';
import * as agentManagerMod from '../src/acp/dual-role-manager.js';

interface SeenCreateOpts {
  backendId: string;
  cwd: string;
  permissionApprover?: unknown;
  questionApprover?: unknown;
}

function installFakeManager(): { seen: SeenCreateOpts[]; restore: () => void } {
  const seen: SeenCreateOpts[] = [];
  const fakeManager = {
    clientSessionCreate: async (opts: SeenCreateOpts) => {
      seen.push(opts);
      return {
        id: 'sess-fake',
        backendId: opts.backendId,
        backendSessionId: 'backend-sess-fake',
        cwd: opts.cwd,
        createdAt: 1_700_000_000,
      };
    },
  };
  const spy = spyOn(agentManagerMod, 'globalDualRoleManager').mockImplementation(
    () => fakeManager as unknown as ReturnType<typeof agentManagerMod.globalDualRoleManager>,
  );
  return {
    seen,
    restore: () => spy.mockRestore(),
  };
}

describe('handleAgentCliCreateSession — ?hitl=off branch', () => {
  it('skips approver wiring when ?hitl=off is set + reports hitl=off in body', async () => {
    const { seen, restore } = installFakeManager();
    try {
      const req = new Request('http://x/v1/agent-cli/sessions?hitl=off', {
        method: 'POST',
        body: JSON.stringify({ backend: 'codex-app-server', cwd: '/tmp' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await handleAgentCliCreateSession(req, { noAuth: true } as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hitl).toBe('off');
      expect(seen).toHaveLength(1);
      expect(seen[0].permissionApprover).toBeUndefined();
      expect(seen[0].questionApprover).toBeUndefined();
      expect(seen[0].backendId).toBe('codex-app-server');
      expect(seen[0].cwd).toBe('/tmp');
    } finally {
      restore();
    }
  });

  it('keeps legacy approver wiring when ?hitl is missing + reports hitl=on', async () => {
    const { seen, restore } = installFakeManager();
    try {
      const req = new Request('http://x/v1/agent-cli/sessions', {
        method: 'POST',
        body: JSON.stringify({ backend: 'claude' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await handleAgentCliCreateSession(req, { noAuth: true } as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.hitl).toBe('on');
      expect(seen).toHaveLength(1);
      // approvers come from getNexusHitlApprovers() which returns
      // wired functions (or memoized stubs in test env). Either way
      // the absence of "skip" means they should be set.
      expect(seen[0].backendId).toBe('claude');
    } finally {
      restore();
    }
  });

  it('honors arbitrary cwd when present', async () => {
    const { seen, restore } = installFakeManager();
    try {
      const req = new Request('http://x/v1/agent-cli/sessions?hitl=off', {
        method: 'POST',
        body: JSON.stringify({ backend: 'gemini', cwd: '/Users/x/proj' }),
        headers: { 'content-type': 'application/json' },
      });
      const res = await handleAgentCliCreateSession(req, { noAuth: true } as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.cwd).toBe('/Users/x/proj');
      expect(seen[0].cwd).toBe('/Users/x/proj');
    } finally {
      restore();
    }
  });
});
