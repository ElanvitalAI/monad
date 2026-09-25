// Tier 1 telegram fan-out arc — PR 2 · DashboardSession ambient
// interceptor.
//
// Validates the long-lived sessionUpdate observer that PR 2's telegram
// bridge (and future Discord/Slack ambient consumers) installs to
// receive fan-out chunks from other peers attached to the same
// sessionId. Critical contract:
//
//   - Ambient handler fires for fan-out notifications when no
//     send() call owns the active turn.
//   - Ambient handler is SUPPRESSED while send() is active — the
//     per-prompt interceptor handles delivery (D3 dedup) so the
//     surface that initiated the turn doesn't render twice.
//   - Ambient handler returns to active routing as soon as send()
//     unwinds (finally block clears the per-prompt hook).
//   - Throwing handler does not break routing — observer contract.
//
// This file uses pure routeSessionUpdate dispatch via the test seam
// to avoid spinning up an in-process server. PR 2's telegram bridge
// fan-out test (real wiring) lives in
// telegram-acp-bridge-fanout.test.ts.

import { describe, expect, test } from 'bun:test';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';

import { DashboardSession } from '../src/tui-client/dashboard-session.js';

/** Build a DashboardSession via Reflect — bypassing create()/attach()
 *  lets us exercise routeSessionUpdate + interceptor lifecycle without
 *  booting a real ACP transport. The constructor is private but the
 *  test reaches it through Reflect.construct. */
function buildBareSession(): DashboardSession {
  // The constructor is private; tests use Reflect.construct to
  // bypass the private-ness. Production code goes through
  // create()/attach()/attachExisting().
  const Ctor = DashboardSession as unknown as new (
    client: ClientSideConnection,
    sid: string,
    shutdown: () => Promise<void>,
  ) => DashboardSession;
  const stubClient = {} as ClientSideConnection;
  return new (Ctor as unknown as {
    new (
      c: ClientSideConnection,
      s: string,
      shutdown: () => Promise<void>,
    ): DashboardSession;
  })(stubClient, 'test-session', async () => {});
}

describe('DashboardSession.setAmbientInterceptor', () => {
  test('handler fires when no per-prompt interceptor is active', () => {
    const sess = buildBareSession();
    const calls: unknown[] = [];
    sess.setAmbientInterceptor((u) => calls.push(u));

    sess.routeSessionUpdate({ kind: 'fanout-chunk', text: 'hello' });
    sess.routeSessionUpdate({ kind: 'fanout-chunk', text: 'world' });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ kind: 'fanout-chunk', text: 'hello' });
    expect(calls[1]).toEqual({ kind: 'fanout-chunk', text: 'world' });
  });

  test('ambient is SUPPRESSED while a per-prompt interceptor is set', () => {
    const sess = buildBareSession();
    const ambientCalls: unknown[] = [];
    const perPromptCalls: unknown[] = [];

    sess.setAmbientInterceptor((u) => ambientCalls.push(u));

    // Simulate send() entering — set the private interceptor field.
    // Tests use Reflect because the field is private; production code
    // sets it via send() and clears it in finally.
    Reflect.set(sess, 'interceptor', (u: unknown) => perPromptCalls.push(u));

    sess.routeSessionUpdate({ kind: 'active-turn-chunk', text: 'x' });

    // Per-prompt got the notification; ambient was suppressed.
    expect(perPromptCalls).toHaveLength(1);
    expect(ambientCalls).toHaveLength(0);
  });

  test('ambient resumes after per-prompt interceptor is cleared', () => {
    const sess = buildBareSession();
    const ambientCalls: unknown[] = [];
    sess.setAmbientInterceptor((u) => ambientCalls.push(u));

    Reflect.set(sess, 'interceptor', () => { /* swallow */ });
    sess.routeSessionUpdate({ kind: 'active', n: 1 });
    Reflect.set(sess, 'interceptor', null);
    sess.routeSessionUpdate({ kind: 'fanout', n: 2 });

    expect(ambientCalls).toEqual([{ kind: 'fanout', n: 2 }]);
  });

  test('passing null detaches the ambient handler', () => {
    const sess = buildBareSession();
    const calls: unknown[] = [];
    sess.setAmbientInterceptor((u) => calls.push(u));

    sess.routeSessionUpdate({ kind: 'one' });
    sess.setAmbientInterceptor(null);
    sess.routeSessionUpdate({ kind: 'two' });

    expect(calls).toEqual([{ kind: 'one' }]);
  });

  test('throwing ambient handler does not break routing', () => {
    const sess = buildBareSession();
    sess.setAmbientInterceptor(() => { throw new Error('boom'); });

    expect(() => sess.routeSessionUpdate({ kind: 'x' })).not.toThrow();

    // After the throw, subsequent calls still attempt the handler.
    let secondFired = false;
    sess.setAmbientInterceptor(() => { secondFired = true; });
    sess.routeSessionUpdate({ kind: 'y' });
    expect(secondFired).toBe(true);
  });

  test('routeSessionUpdate is no-op when neither hook is set', () => {
    const sess = buildBareSession();
    expect(() => sess.routeSessionUpdate({ kind: 'lonely' })).not.toThrow();
  });
});
