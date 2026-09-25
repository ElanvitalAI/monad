// Step 1 of platform-evolution arc · PR b — channel-agnostic
// bindings store contract.
//
// Validates lookup + cursor + reverse lookup across multiple
// channels in a single store. The Step 4 sqlite chat_bindings table
// inherits this schema 1:1, so test coverage here protects the
// migration path too.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import {
  openChannelBindingsStore,
  type ChannelBindingsStore,
} from '../src/channel/bindings-store.js';

let tmpDir = '';
let storePath = '';

beforeEach(() => {
  tmpDir = mkdtempSync(joinPath(tmpdir(), 'monad-channel-bindings-'));
  storePath = joinPath(tmpDir, 'channel-bindings.json');
});
afterEach(() => {
  if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function makeStore(): ChannelBindingsStore {
  return openChannelBindingsStore({ storePath });
}

describe('openChannelBindingsStore — basic CRUD', () => {
  test('set + resolveSessionId round-trips for telegram + discord', () => {
    const s = makeStore();
    s.set({ channel: 'telegram', chatId: '123', sessionId: 'sid-tg', lastSeenMsgIdx: 0 });
    s.set({ channel: 'discord', chatId: 'abc987', sessionId: 'sid-dc', lastSeenMsgIdx: 0 });
    expect(s.resolveSessionId({ channel: 'telegram', chatId: '123' })).toBe('sid-tg');
    expect(s.resolveSessionId({ channel: 'discord', chatId: 'abc987' })).toBe('sid-dc');
    // Cross-channel collision avoidance — same chatId, different channel.
    s.set({ channel: 'discord', chatId: '123', sessionId: 'sid-dc-collision', lastSeenMsgIdx: 0 });
    expect(s.resolveSessionId({ channel: 'telegram', chatId: '123' })).toBe('sid-tg');
    expect(s.resolveSessionId({ channel: 'discord', chatId: '123' })).toBe('sid-dc-collision');
  });

  test('threadId discriminates entries within a channel', () => {
    const s = makeStore();
    s.set({ channel: 'telegram', chatId: '123', threadId: '', sessionId: 'main', lastSeenMsgIdx: 0 });
    s.set({ channel: 'telegram', chatId: '123', threadId: '5', sessionId: 'thread5', lastSeenMsgIdx: 0 });
    expect(s.resolveSessionId({ channel: 'telegram', chatId: '123' })).toBe('main');
    expect(s.resolveSessionId({ channel: 'telegram', chatId: '123', threadId: '5' })).toBe('thread5');
  });

  test('advanceCursor monotonic + no-op when missing', () => {
    const s = makeStore();
    s.set({ channel: 'telegram', chatId: '1', sessionId: 'sid', lastSeenMsgIdx: 5 });
    s.advanceCursor({ channel: 'telegram', chatId: '1', newIdx: 7 });
    s.advanceCursor({ channel: 'telegram', chatId: '1', newIdx: 6 }); // backward — ignored
    const list = s.list();
    expect(list.find((b) => b.chatId === '1')?.lastSeenMsgIdx).toBe(7);
    // Missing entry — no throw.
    expect(() => s.advanceCursor({ channel: 'telegram', chatId: '999', newIdx: 1 })).not.toThrow();
  });

  test('findChatBySessionId — channel filter narrows hits', () => {
    const s = makeStore();
    s.set({ channel: 'telegram', chatId: '1', sessionId: 'shared', lastSeenMsgIdx: 0 });
    s.set({ channel: 'discord', chatId: 'x', sessionId: 'shared', lastSeenMsgIdx: 0 });
    const tgHit = s.findChatBySessionId('shared', { channel: 'telegram' });
    const dcHit = s.findChatBySessionId('shared', { channel: 'discord' });
    expect(tgHit?.chatId).toBe('1');
    expect(dcHit?.chatId).toBe('x');
    // No filter — first wins (insertion order tie-break is arbitrary; just ensure
    // we get one of them, not null).
    const anyHit = s.findChatBySessionId('shared');
    expect(anyHit).not.toBeNull();
  });

  test('remove drops a single entry', () => {
    const s = makeStore();
    s.set({ channel: 'telegram', chatId: '1', sessionId: 'a', lastSeenMsgIdx: 0 });
    s.set({ channel: 'discord', chatId: '1', sessionId: 'b', lastSeenMsgIdx: 0 });
    s.remove({ channel: 'telegram', chatId: '1' });
    expect(s.resolveSessionId({ channel: 'telegram', chatId: '1' })).toBeNull();
    expect(s.resolveSessionId({ channel: 'discord', chatId: '1' })).toBe('b');
  });

  test('listByChannel filters by channel kind', () => {
    const s = makeStore();
    s.set({ channel: 'telegram', chatId: '1', sessionId: 't', lastSeenMsgIdx: 0 });
    s.set({ channel: 'discord', chatId: 'x', sessionId: 'd', lastSeenMsgIdx: 0 });
    expect(s.listByChannel('telegram').map((b) => b.chatId)).toEqual(['1']);
    expect(s.listByChannel('discord').map((b) => b.chatId)).toEqual(['x']);
  });
});

describe('openChannelBindingsStore — persistence', () => {
  test('writes JSON file with channel-aware schema', () => {
    const s = makeStore();
    s.set({ channel: 'discord', chatId: 'x', sessionId: 'sid', lastSeenMsgIdx: 12 });
    expect(existsSync(storePath)).toBe(true);
    const file = JSON.parse(readFileSync(storePath, 'utf8'));
    expect(file.version).toBe(1);
    expect(file.bindings).toHaveLength(1);
    expect(file.bindings[0].channel).toBe('discord');
    expect(file.bindings[0].chatId).toBe('x');
    expect(file.bindings[0].channelAccount).toBe('default');
  });

  test('reload from disk preserves all entries', () => {
    {
      const s = makeStore();
      s.set({ channel: 'telegram', chatId: '1', sessionId: 'a', lastSeenMsgIdx: 0 });
      s.set({ channel: 'discord', chatId: 'x', sessionId: 'b', lastSeenMsgIdx: 5 });
    }
    const s2 = makeStore();
    expect(s2.resolveSessionId({ channel: 'telegram', chatId: '1' })).toBe('a');
    expect(s2.resolveSessionId({ channel: 'discord', chatId: 'x' })).toBe('b');
    expect(s2.list()).toHaveLength(2);
  });

  test('corrupt on-disk JSON is gracefully ignored — fresh store', () => {
    require('node:fs').writeFileSync(storePath, '{ this is not json');
    const s = makeStore();
    expect(s.list()).toHaveLength(0);
    // And still writable.
    s.set({ channel: 'telegram', chatId: '1', sessionId: 'a', lastSeenMsgIdx: 0 });
    expect(s.resolveSessionId({ channel: 'telegram', chatId: '1' })).toBe('a');
  });
});
