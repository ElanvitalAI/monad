import { describe, expect, test } from 'bun:test';

import {
  coerceHitlCallbackAnswer,
  createHitlPendingCallbacks,
} from '../src/nexus/api/hitl-runtime.js';
import { handleHitlCallback } from '../src/nexus/api/meta-api.js';

describe('createHitlPendingCallbacks · boolean confirm is unchanged', () => {
  test('awaitCallback still resolves a boolean yes/no tap', async () => {
    const store = createHitlPendingCallbacks({ defaultTimeoutMs: 1_000 });
    const pending = store.awaitCallback('confirm-1');
    expect(store.resolveAnswer('confirm-1', true)).toBe(true);
    await expect(pending).resolves.toBe(true);
  });
});

describe('createHitlPendingCallbacks · structured answers stay structured', () => {
  test('awaitQuestionCallback receives the second option, not a yes/no fold', async () => {
    const store = createHitlPendingCallbacks({ defaultTimeoutMs: 1_000 });
    const pending = store.awaitQuestionCallback('q-1');
    expect(store.resolveAnswer('q-1', { answers: { pick: 'B' } })).toBe(true);
    await expect(pending).resolves.toEqual({ answers: { pick: 'B' } });
  });

  test('a boolean tap cannot settle a structured question (and vice versa)', async () => {
    const store = createHitlPendingCallbacks({ defaultTimeoutMs: 1_000 });
    const question = store.awaitQuestionCallback('q-mix');
    expect(store.resolveAnswer('q-mix', true)).toBe(false);
    expect(store.pending()).toEqual(['q-mix']);
    expect(store.resolveAnswer('q-mix', { answers: { pick: 'C' } })).toBe(true);
    await expect(question).resolves.toEqual({ answers: { pick: 'C' } });

    const confirm = store.awaitCallback('c-mix');
    expect(store.resolveAnswer('c-mix', { answers: { pick: 'A' } })).toBe(false);
    expect(store.resolveAnswer('c-mix', false)).toBe(true);
    await expect(confirm).resolves.toBe(false);
  });

  test('two pending questions: resolving one requestId leaves the other', async () => {
    const store = createHitlPendingCallbacks({ defaultTimeoutMs: 1_000 });
    const first = store.awaitQuestionCallback('q-a');
    const second = store.awaitQuestionCallback('q-b');
    expect(store.resolveAnswer('q-b', { answers: { other: 'Y' } })).toBe(true);
    await expect(second).resolves.toEqual({ answers: { other: 'Y' } });
    expect(store.pending()).toEqual(['q-a']);
    expect(store.resolveAnswer('q-a', { answers: { pick: 'A' } })).toBe(true);
    await expect(first).resolves.toEqual({ answers: { pick: 'A' } });
  });
});

describe('coerceHitlCallbackAnswer', () => {
  test('accepts boolean and structured AskUserQuestion results, rejects folds', () => {
    expect(coerceHitlCallbackAnswer(true)).toBe(true);
    expect(coerceHitlCallbackAnswer({ answers: { pick: 'B' } })).toEqual({ answers: { pick: 'B' } });
    expect(coerceHitlCallbackAnswer('maybe')).toBeUndefined();
    expect(coerceHitlCallbackAnswer({ answers: { pick: 1 } })).toBeUndefined();
  });
});

describe('handleHitlCallback · existing endpoint, widened answer', () => {
  test('boolean answer still 200s on the existing /v1/hitl/callback path', async () => {
    const store = createHitlPendingCallbacks({ defaultTimeoutMs: 1_000 });
    const pending = store.awaitCallback('cb-yes');
    const res = await handleHitlCallback(
      new Request('http://nexus/v1/hitl/callback/cb-yes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: true }),
      }),
      'cb-yes',
      { noAuth: true, hitlPending: store },
    );
    expect(res.status).toBe(200);
    await expect(pending).resolves.toBe(true);
  });

  test('structured answer on the same endpoint settles the matching requestId', async () => {
    const store = createHitlPendingCallbacks({ defaultTimeoutMs: 1_000 });
    const pending = store.awaitQuestionCallback('cb-q');
    const res = await handleHitlCallback(
      new Request('http://nexus/v1/hitl/callback/cb-q', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer: { answers: { pick: 'B' } } }),
      }),
      'cb-q',
      { noAuth: true, hitlPending: store },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; requestId: string };
    expect(body.ok).toBe(true);
    expect(body.requestId).toBe('cb-q');
    await expect(pending).resolves.toEqual({ answers: { pick: 'B' } });
  });
});
