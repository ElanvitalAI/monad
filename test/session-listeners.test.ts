// Tier 1 Phase 3 양방향 sync · PR 2 · session/index.ts listener primitive tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  _clearSessionListenersForTest,
  appendMessage,
  createSession,
  onMessageAppended,
  onSessionCreated,
  type SerializedMessage,
  type SessionMeta,
} from '../src/session/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(joinPath(tmpdir(), 'elanous-session-listeners-'));
  _clearSessionListenersForTest();
});

afterEach(() => {
  _clearSessionListenersForTest();
  rmSync(root, { recursive: true, force: true });
});

function ts(): string { return new Date().toISOString(); }

describe('onSessionCreated listener', () => {
  test('fires with the freshly-minted SessionMeta', () => {
    const created: SessionMeta[] = [];
    onSessionCreated((meta) => { created.push(meta); });

    const meta = createSession({ provider: 'test', model: 'tm' }, root);
    expect(created).toHaveLength(1);
    expect(created[0]!.id).toBe(meta.id);
    expect(created[0]!.provider).toBe('test');
  });

  test('multiple listeners all fire', () => {
    const a: string[] = [];
    const b: string[] = [];
    onSessionCreated((m) => { a.push(m.id); });
    onSessionCreated((m) => { b.push(m.id); });

    const m = createSession({}, root);
    expect(a).toEqual([m.id]);
    expect(b).toEqual([m.id]);
  });

  test('unsubscribe stops further deliveries', () => {
    const got: string[] = [];
    const off = onSessionCreated((m) => { got.push(m.id); });

    createSession({}, root);
    off();
    createSession({}, root);

    expect(got).toHaveLength(1);
  });

  test('throwing listener does not break createSession', () => {
    onSessionCreated(() => { throw new Error('boom'); });
    expect(() => createSession({}, root)).not.toThrow();
  });
});

describe('onMessageAppended listener', () => {
  test('fires with sessionId + just-appended message + updated meta', () => {
    const events: { id: string; msg: SerializedMessage; meta: SessionMeta }[] = [];
    onMessageAppended((id, msg, meta) => { events.push({ id, msg, meta }); });

    const sess = createSession({}, root);
    appendMessage(sess.id, { role: 'user', content: 'hi', ts: ts() }, root);

    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(sess.id);
    expect(events[0]!.msg.role).toBe('user');
    expect(events[0]!.msg.content).toBe('hi');
    expect(events[0]!.meta.messageCount).toBe(1);
  });

  test('listener fires AFTER on-disk write — meta reflects updated count', () => {
    let observedCount = -1;
    onMessageAppended((_id, _msg, meta) => { observedCount = meta.messageCount; });

    const sess = createSession({}, root);
    appendMessage(sess.id, { role: 'user', content: 'first', ts: ts() }, root);
    expect(observedCount).toBe(1);

    appendMessage(sess.id, { role: 'assistant', content: 'second', ts: ts() }, root);
    expect(observedCount).toBe(2);
  });

  test('throwing listener does not break appendMessage', () => {
    onMessageAppended(() => { throw new Error('boom'); });
    const sess = createSession({}, root);
    expect(() =>
      appendMessage(sess.id, { role: 'user', content: 'x', ts: ts() }, root),
    ).not.toThrow();
  });

  test('unsubscribe is idempotent', () => {
    const got: string[] = [];
    const off = onMessageAppended((id) => { got.push(id); });
    const sess = createSession({}, root);
    appendMessage(sess.id, { role: 'user', content: 'one', ts: ts() }, root);
    off();
    off(); // double-unsubscribe should be safe
    appendMessage(sess.id, { role: 'assistant', content: 'two', ts: ts() }, root);
    expect(got).toHaveLength(1);
  });
});
