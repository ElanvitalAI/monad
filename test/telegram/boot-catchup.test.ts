// Tier 1 telegram fan-out arc — PR 4 · boot catch-up tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { runTelegramBootCatchUp } from '../../src/telegram/boot-catchup.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../../src/elanous-config-dir.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-tg-catchup-'));
  setElanousConfigDir(tmp);
});

afterEach(() => {
  resetElanousConfigDir();
  rmSync(tmp, { recursive: true, force: true });
});

function writeRuntime(historyDir: string): void {
  writeFileSync(
    joinPath(tmp, 'elanous.runtime.json'),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      socketPath: joinPath(tmp, 'elanous.sock'),
      historyDir,
    }, null, 2),
  );
}

interface SentMessage { chatId: number; text: string }

function buildBridge(bindings: Array<{
  chatId: number; threadId: number; sessionId: string; lastSeenMsgIdx: number;
}>): {
  listDaemonBindings(): typeof bindings;
  advanceCursor(chatId: number, threadId: number | undefined, newIdx: number): void;
  cursorMoves: Array<{ chatId: number; threadId: number; newIdx: number }>;
} {
  const cursorMoves: Array<{ chatId: number; threadId: number; newIdx: number }> = [];
  return {
    listDaemonBindings() {
      // Return a fresh copy so the caller can't mutate our state.
      return bindings.map((b) => ({ ...b }));
    },
    advanceCursor(chatId, threadId, newIdx) {
      const idx = bindings.findIndex((b) => b.chatId === chatId && b.threadId === (threadId ?? 0));
      if (idx >= 0) bindings[idx]!.lastSeenMsgIdx = newIdx;
      cursorMoves.push({ chatId, threadId: threadId ?? 0, newIdx });
    },
    cursorMoves,
  };
}

describe('runTelegramBootCatchUp', () => {
  test('does nothing when no bindings exist', async () => {
    const bridge = buildBridge([]);
    const sent: SentMessage[] = [];
    const sendMessage = async (chatId: number, text: string) => { sent.push({ chatId, text }); };
    const n = await runTelegramBootCatchUp(bridge, sendMessage);
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test('skips chats whose cursor matches the current jsonl tail', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'elanous-session-3.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'hi' }),
        JSON.stringify({ role: 'assistant', content: 'hello' }),
      ].join('\n') + '\n',
    );

    const bridge = buildBridge([
      { chatId: 1, threadId: 0, sessionId: 'elanous-session-3', lastSeenMsgIdx: 2 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runTelegramBootCatchUp(
      bridge,
      async (chatId, text) => { sent.push({ chatId, text }); },
    );
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test('emits digest for chat with missed turns + advances cursor', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'elanous-session-3.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'old user' }),
        JSON.stringify({ role: 'assistant', content: 'old reply' }),
        JSON.stringify({ role: 'user', content: 'new user' }),
        JSON.stringify({ role: 'assistant', content: 'NEW REPLY' }),
      ].join('\n') + '\n',
    );

    const bridge = buildBridge([
      { chatId: 99, threadId: 0, sessionId: 'elanous-session-3', lastSeenMsgIdx: 2 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runTelegramBootCatchUp(
      bridge,
      async (chatId, text) => { sent.push({ chatId, text }); },
    );
    expect(n).toBe(1);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]!.chatId).toBe(99);
    // Either chunk should mention the most recent missed assistant message.
    const concatenated = sent.map((s) => s.text).join('');
    expect(concatenated).toContain('NEW REPLY');
    expect(concatenated).toContain('new user');
    // Old turns (already shown) must NOT appear.
    expect(concatenated).not.toContain('old reply');
    // Cursor advanced to current tail.
    expect(bridge.cursorMoves).toEqual([{ chatId: 99, threadId: 0, newIdx: 4 }]);
  });

  test('skips bindings whose jsonl is missing (daemon GC or fresh)', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    // No jsonl file written for elanous-session-99.

    const bridge = buildBridge([
      { chatId: 5, threadId: 0, sessionId: 'elanous-session-99', lastSeenMsgIdx: 3 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runTelegramBootCatchUp(
      bridge,
      async (chatId, text) => { sent.push({ chatId, text }); },
    );
    expect(n).toBe(0);
    expect(sent).toEqual([]);
    // Cursor preserved (caller may want to retry on next boot).
    expect(bridge.cursorMoves).toEqual([]);
  });

  test('does not advance cursor when sendMessage throws', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'elanous-session-3.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'fresh' }) + '\n',
    );

    const bridge = buildBridge([
      { chatId: 1, threadId: 0, sessionId: 'elanous-session-3', lastSeenMsgIdx: 0 },
    ]);
    const n = await runTelegramBootCatchUp(
      bridge,
      async () => { throw new Error('telegram offline'); },
      { log: () => { /* swallow */ } },
    );
    expect(n).toBe(0);
    expect(bridge.cursorMoves).toEqual([]);
  });

  test('handles multiple bindings independently', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 's-A.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'A1' }) + '\n',
    );
    writeFileSync(
      joinPath(historyDir, 's-B.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'B-q' }),
        JSON.stringify({ role: 'assistant', content: 'B-a' }),
      ].join('\n') + '\n',
    );

    const bridge = buildBridge([
      { chatId: 1, threadId: 0, sessionId: 's-A', lastSeenMsgIdx: 0 },
      { chatId: 2, threadId: 0, sessionId: 's-B', lastSeenMsgIdx: 0 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runTelegramBootCatchUp(
      bridge,
      async (chatId, text) => { sent.push({ chatId, text }); },
    );
    expect(n).toBe(2);

    const chatsTouched = new Set(sent.map((s) => s.chatId));
    expect(chatsTouched).toEqual(new Set([1, 2]));

    // Both cursors advanced to their respective tails.
    expect(bridge.cursorMoves.find((m) => m.chatId === 1)?.newIdx).toBe(1);
    expect(bridge.cursorMoves.find((m) => m.chatId === 2)?.newIdx).toBe(2);
  });
});
