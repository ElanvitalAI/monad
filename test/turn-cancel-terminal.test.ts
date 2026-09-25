// /cancel for self/terminal turns — the abort signal must actually STOP the
// in-flight work, not just the LLM loop. Two paths:
//   • Bash: the turn signal is threaded into dispatchBash, which kills the
//     whole process GROUP (shell + grandchildren) on abort.
//   • PtyShell: persistent PTYs are terminated via killNonDetached().
// (The wiring that connects /cancel → these is in telegram-agent.ts; here we
//  verify the two termination mechanisms themselves.)

import { describe, test, expect, afterEach } from 'bun:test';
import { buildContinuationAgentTools } from '../src/dispatch/continuation-turn-runner';
import { startPty, listPty, killNonDetached, resetForTesting } from '../src/pty-shell/registry';

afterEach(() => resetForTesting());

describe('Bash abort — kills the whole process group', () => {
  test('an aborted long Bash returns promptly (grandchild killed, not waited out)', async () => {
    const { dispatch } = buildContinuationAgentTools();
    const ac = new AbortController();
    const t0 = Date.now();
    setTimeout(() => ac.abort(), 300);
    // `sleep 5` is a GRANDCHILD of the shell — the fix must group-kill it so
    // the stdout pipe closes immediately instead of hanging ~5s.
    const r = await dispatch('Bash', { command: 'sleep 5; echo DONE' }, ac.signal) as { aborted?: boolean };
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(3000); // would be ~5000 without group-kill
    expect(r.aborted).toBe(true);
  });

  test('a normal Bash (no abort) still returns its output', async () => {
    const { dispatch } = buildContinuationAgentTools();
    const r = await dispatch('Bash', { command: 'echo hi; echo $((6*7))' }, undefined) as { stdout?: string };
    expect(String(r.stdout ?? JSON.stringify(r))).toContain('42');
  });
});

describe('PtyShell termination — killNonDetached', () => {
  test('kills a non-detached PTY (its session, incl. children)', async () => {
    const h = startPty({ cmd: 'sleep', args: ['300'] } as never);
    expect(h.isAlive()).toBe(true);
    expect(listPty().length).toBe(1);
    const killed = killNonDetached();
    expect(killed).toBe(1);
    await new Promise(r => setTimeout(r, 300));
    expect(h.isAlive()).toBe(false);
  });

  test('leaves a detached PTY running (survives /cancel by design)', async () => {
    const h = startPty({ cmd: 'sleep', args: ['300'], detach: true } as never);
    expect(h.isAlive()).toBe(true);
    const killed = killNonDetached();
    expect(killed).toBe(0); // detached ones are spared
    expect(h.isAlive()).toBe(true);
    h.kill('SIGKILL'); // cleanup
  });
});
