// /cancel wiring for the NL delegate — the piece that lets a user stop an
// in-flight `delegate_code_agent` (which blocks elanous's brain via
// clientSessionSend) instead of killing processes.
//
// Two halves:
//   1. turn-runner registry: beginCancelableTurn/cancelAcpTurn/endCancelableTurn.
//   2. delegate-agent: ctx.signal abort → mgr.clientSessionClose(session) +
//      a `cancelled` result.

import { describe, test, expect, afterEach } from 'bun:test';
import {
  beginCancelableTurn,
  endCancelableTurn,
  cancelAcpTurn,
} from '../src/acp/turn-runner';
import { dispatchDelegateAgent } from '../src/boot/daemon-tools/delegate-agent';
import { __setDualRoleManagerForTest, type DualRoleManager } from '../src/acp/dual-role-manager';

// ── registry ──────────────────────────────────────────────────────────
describe('cancelable-turn registry', () => {
  test('cancelAcpTurn aborts a registered controller (NL brain turn)', async () => {
    const ac = beginCancelableTurn(90001);
    expect(ac.signal.aborted).toBe(false);
    const hit = await cancelAcpTurn(90001);
    expect(hit).toBe(true);
    expect(ac.signal.aborted).toBe(true);
    endCancelableTurn(90001, undefined, ac);
  });

  test('returns false when nothing is in-flight for the chat', async () => {
    expect(await cancelAcpTurn(90002)).toBe(false);
  });

  test('endCancelableTurn deregisters (no stale abort next time)', async () => {
    const ac = beginCancelableTurn(90003);
    endCancelableTurn(90003, undefined, ac);
    expect(await cancelAcpTurn(90003)).toBe(false);
  });

  test('thread-scoped keys are independent', async () => {
    const a = beginCancelableTurn(90004, 1);
    const b = beginCancelableTurn(90004, 2);
    await cancelAcpTurn(90004, 1);
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    endCancelableTurn(90004, 1, a);
    endCancelableTurn(90004, 2, b);
  });
});

// ── delegate cancel ─────────────────────────────────────────────────────
function installDrm(opts: { closed: string[]; onSend?: () => Promise<{ stopReason: string }> }): void {
  const fake = {
    async clientSessionCreate() { return { id: 'sub-cancel-1' }; },
    async clientSessionSetGoal() { return null; },
    async clientSessionGetGoal() { return null; },
    async clientSessionClose(id: string) { opts.closed.push(id); return true; },
    async clientSessionSend() { return opts.onSend ? opts.onSend() : { stopReason: 'end_turn' }; },
  };
  __setDualRoleManagerForTest(fake as unknown as DualRoleManager);
}

const baseCtx = () => ({ cwd: process.cwd(), signal: new AbortController().signal });

describe('dispatchDelegateAgent · /cancel', () => {
  afterEach(() => { __setDualRoleManagerForTest(null); });

  test('pre-aborted signal → closes the ACP session + result cancelled', async () => {
    const closed: string[] = [];
    installDrm({ closed });
    const ac = new AbortController();
    ac.abort();
    const res = await dispatchDelegateAgent(
      { backend: 'claude', task: 'x' },
      { cwd: process.cwd(), signal: ac.signal },
    ) as { cancelled?: boolean };
    expect(closed).toContain('sub-cancel-1');
    expect(res.cancelled).toBe(true);
  });

  test('abort DURING the send → close fires + cancelled result', async () => {
    const closed: string[] = [];
    // The send blocks until close is called (mirrors agent.cancel unblocking
    // the pending prompt).
    installDrm({
      closed,
      onSend: () => new Promise((resolve) => {
        const t = setInterval(() => {
          if (closed.length > 0) { clearInterval(t); resolve({ stopReason: 'cancelled' }); }
        }, 1);
      }),
    });
    const ac = new AbortController();
    const p = dispatchDelegateAgent({ backend: 'claude', task: 'x' }, { cwd: process.cwd(), signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    const res = await p as { cancelled?: boolean };
    expect(closed).toContain('sub-cancel-1');
    expect(res.cancelled).toBe(true);
  });

  test('no abort → normal completion, session NOT closed', async () => {
    const closed: string[] = [];
    installDrm({ closed });
    const res = await dispatchDelegateAgent({ backend: 'claude', task: 'x' }, baseCtx()) as { cancelled?: boolean; stopReason?: string };
    expect(closed).toHaveLength(0);
    expect(res.cancelled).toBeUndefined();
    expect(res.stopReason).toBe('end_turn');
  });
});
