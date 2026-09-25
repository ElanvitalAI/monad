// AskUserQuestion ACP bridge tests — 2026-05-13 (M2).
//
// Validates the glue between dispatcher and ACP server's pushAskRequest /
// pushAskCancel without spinning up a real ACP connection. Mock
// AskBridgeHandle captures push calls + lets us simulate peer responses,
// no-cap fallthrough, turn cancel, session/cancel.

import { describe, expect, test } from 'bun:test';

import {
  AskBridgeUnavailable,
  AskQuestionBridge,
  type AskBridgeHandle,
} from '../src/acp/ask-question-bridge.js';
import { coerceAskResult } from '../src/acp/ask-extensions.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../src/ask-user-question/types.js';

const sampleReq: AskUserQuestionRequest = {
  questions: [
    {
      id: 'pick',
      header: 'Pick',
      question: 'Choose one',
      options: [
        { label: 'A', description: 'first' },
        { label: 'B', description: 'second' },
      ],
    },
  ],
};

/** Build a mock handle whose `pushAskRequest` is controllable. */
function makeHandle(opts: {
  /** Use the sentinel `'no-peer'` to make pushAskRequest return null
   *  (cap-less). A function value is awaited each call (for inflight
   *  promise tests). */
  response?:
    | AskUserQuestionResult
    | 'no-peer'
    | (() => Promise<AskUserQuestionResult | null>);
  onCancel?: (sessionId: string, askId: string, reason?: string) => void;
} = {}): AskBridgeHandle & {
  pushCalls: Array<{ sessionId: string; askId: string }>;
  cancelCalls: Array<{ sessionId: string; askId: string; reason?: string }>;
} {
  const pushCalls: Array<{ sessionId: string; askId: string }> = [];
  const cancelCalls: Array<{ sessionId: string; askId: string; reason?: string }> = [];
  return {
    pushCalls,
    cancelCalls,
    async pushAskRequest(sessionId, payload) {
      pushCalls.push({ sessionId, askId: payload.id });
      if (typeof opts.response === 'function') return opts.response();
      if (opts.response === 'no-peer') return null;
      return opts.response ?? { answers: { pick: 'A' } };
    },
    async pushAskCancel(sessionId, payload) {
      const entry: { sessionId: string; askId: string; reason?: string } = {
        sessionId,
        askId: payload.id,
      };
      if (payload.reason !== undefined) entry.reason = payload.reason;
      cancelCalls.push(entry);
      opts.onCancel?.(sessionId, payload.id, payload.reason);
    },
  };
}

describe('AskUserQuestionResult ACP wire provenance', () => {
  test('preserves valid optional provenance and omits invalid values', () => {
    expect(coerceAskResult({ answers: { pick: 'A' }, answeredBy: 'agent' }).answeredBy).toBe('agent');
    // ⭐ 허용값 «둘 다» wire 경계를 넘는지 본다 — agent 만 보면 human 이 삼켜져도 모른다(리뷰 지적)
    expect(coerceAskResult({ answers: { pick: 'A' }, answeredBy: 'human' }).answeredBy).toBe('human');
    expect(coerceAskResult({ answers: { pick: 'A' }, answeredBy: 'unknown' }).answeredBy).toBeUndefined();
  });
});

describe('AskQuestionBridge.resolve happy path', () => {
  test('returns peer response when handle returns a result', async () => {
    const handle = makeHandle({ response: { answers: { pick: 'B' } } });
    const bridge = new AskQuestionBridge({ handle, generateId: () => 'ask-test-1' });
    const result = await bridge.resolve(sampleReq, { sessionId: 'sess-1' });
    expect(result.answers).toEqual({ pick: 'B' });
    expect(result.answeredBy).toBe('human');
    expect(handle.pushCalls).toEqual([{ sessionId: 'sess-1', askId: 'ask-test-1' }]);
    expect(handle.cancelCalls).toEqual([]);
    expect(bridge._inflightCountForTesting()).toBe(0);
  });

  test('forwards request payload faithfully', async () => {
    const handle = makeHandle();
    let captured: AskUserQuestionRequest | undefined;
    handle.pushAskRequest = async (_sessionId, payload) => {
      captured = payload.request;
      return { answers: { pick: 'A' } };
    };
    const bridge = new AskQuestionBridge({ handle, generateId: () => 'ask-x' });
    await bridge.resolve(sampleReq, { sessionId: 'sess-1' });
    expect(captured).toEqual(sampleReq);
  });
});

describe('AskQuestionBridge.resolve unavailable paths', () => {
  test('throws AskBridgeUnavailable when no sessionId on context', async () => {
    const handle = makeHandle();
    const bridge = new AskQuestionBridge({ handle });
    await expect(bridge.resolve(sampleReq)).rejects.toThrow(AskBridgeUnavailable);
    expect(handle.pushCalls).toEqual([]);
  });

  test('throws AskBridgeUnavailable when handle returns null (no cap-able peer)', async () => {
    const handle = makeHandle({ response: 'no-peer' });
    const bridge = new AskQuestionBridge({ handle });
    await expect(bridge.resolve(sampleReq, { sessionId: 'sess-1' })).rejects.toThrow(AskBridgeUnavailable);
    expect(bridge._inflightCountForTesting()).toBe(0);
  });

  test('AbortSignal already aborted returns cancelled degrade', async () => {
    const handle = makeHandle();
    const bridge = new AskQuestionBridge({ handle });
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await bridge.resolve(sampleReq, {
      sessionId: 'sess-1',
      signal: ctrl.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.answeredBy).toBeUndefined();
    expect(result.answers).toEqual({});
    expect(handle.pushCalls).toEqual([]);   // never even pushed
  });
});

describe('AskQuestionBridge.cancelAllForSession', () => {
  test('rejects every inflight ask + fans cancel notifications', async () => {
    let resolvePeer: (result: AskUserQuestionResult | null) => void = () => {};
    const handle = makeHandle({
      response: () => new Promise<AskUserQuestionResult | null>((res) => { resolvePeer = res; }),
    });
    const bridge = new AskQuestionBridge({ handle, generateId: () => 'ask-pending' });
    const askPromise = bridge.resolve(sampleReq, { sessionId: 'sess-1' });
    // Give the resolve() microtask a tick so inflight registers.
    await Promise.resolve();
    expect(bridge._inflightCountForTesting('sess-1')).toBe(1);

    await bridge.cancelAllForSession('sess-1', 'turn aborted');
    await expect(askPromise).rejects.toThrow(/AskUserQuestion cancelled/);

    expect(handle.cancelCalls).toEqual([
      { sessionId: 'sess-1', askId: 'ask-pending', reason: 'turn aborted' },
    ]);
    expect(bridge._inflightCountForTesting()).toBe(0);

    // Cleanup: resolve the peer promise so the test doesn't leak.
    resolvePeer({ answers: { pick: 'A' } });
  });

  test('idempotent — second call on drained session is a no-op', async () => {
    const handle = makeHandle();
    const bridge = new AskQuestionBridge({ handle });
    await bridge.cancelAllForSession('sess-empty', 'reason');
    expect(handle.cancelCalls).toEqual([]);
  });

  test('cancels only the targeted session, not siblings', async () => {
    const handle = makeHandle({
      response: () => new Promise<AskUserQuestionResult | null>(() => { /* never */ }),
    });
    let nextId = 1;
    const bridge = new AskQuestionBridge({ handle, generateId: () => `ask-${nextId++}` });

    const promiseA = bridge.resolve(sampleReq, { sessionId: 'sess-A' });
    const promiseB = bridge.resolve(sampleReq, { sessionId: 'sess-B' });
    await Promise.resolve();   // let resolve register inflight
    expect(bridge._inflightCountForTesting()).toBe(2);

    await bridge.cancelAllForSession('sess-A', 'A only');
    await expect(promiseA).rejects.toThrow(/A only/);
    expect(bridge._inflightCountForTesting('sess-A')).toBe(0);
    expect(bridge._inflightCountForTesting('sess-B')).toBe(1);

    // Cleanup
    void promiseB.catch(() => {});
  });
});

describe('AskQuestionBridge per-turn AbortSignal', () => {
  test('signal abort during inflight rejects + fans cancel', async () => {
    let resolvePeer: (result: AskUserQuestionResult | null) => void = () => {};
    const handle = makeHandle({
      response: () => new Promise<AskUserQuestionResult | null>((res) => { resolvePeer = res; }),
    });
    const bridge = new AskQuestionBridge({ handle, generateId: () => 'ask-abortable' });

    const ctrl = new AbortController();
    const promise = bridge.resolve(sampleReq, {
      sessionId: 'sess-x',
      signal: ctrl.signal,
    });
    await Promise.resolve();
    expect(bridge._inflightCountForTesting('sess-x')).toBe(1);

    ctrl.abort();
    await expect(promise).rejects.toThrow(/AskUserQuestion cancelled/);
    expect(handle.cancelCalls[0]?.askId).toBe('ask-abortable');
    expect(handle.cancelCalls[0]?.reason).toBe('turn aborted by caller');
    expect(bridge._inflightCountForTesting()).toBe(0);

    resolvePeer({ answers: { pick: 'A' } });
  });
});

describe('AskQuestionBridge errors from handle', () => {
  test('peer extMethod failure is coerced into cancelled result by the server handle (bridge gets back the coerced result)', async () => {
    // Bridge never sees raw exception — server handle's pushAskRequest
    // catches & returns { answers: {}, cancelled: true }. Mock 직접.
    const handle = makeHandle({ response: { answers: {}, cancelled: true, answeredBy: 'human' } });
    const bridge = new AskQuestionBridge({ handle });
    const result = await bridge.resolve(sampleReq, { sessionId: 'sess-1' });
    expect(result.cancelled).toBe(true);
    expect(result.answeredBy).toBeUndefined();
  });
});

describe('AskQuestionBridge id generation', () => {
  test('default generator emits unique ids', () => {
    const handle = makeHandle();
    const bridge = new AskQuestionBridge({ handle });
    const ids = new Set<string>();
    // Call private id gen indirectly by triggering resolve N times.
    // Easier to validate uniqueness by inspecting pushCalls.
    return Promise.all(
      Array.from({ length: 8 }, () => bridge.resolve(sampleReq, { sessionId: 's' })),
    ).then(() => {
      for (const c of (handle as ReturnType<typeof makeHandle>).pushCalls) {
        ids.add(c.askId);
      }
      expect(ids.size).toBe(8);
      for (const id of ids) {
        expect(id).toMatch(/^ask-[0-9a-f]{12}$/);
      }
    });
  });
});
