// Step 1 of platform-evolution arc · PR c — discord boot catch-up.
//
// Mirrors test/telegram/boot-catchup.test.ts; covers the channel-
// agnostic runner via the discord-shaped wrapper. The discord render
// uses plain-text chunks (vs telegram's HTML), but the cursor-diff
// + delivery + advance contract is identical — that's the whole
// point of the channel/boot-catchup hoist.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { runDiscordBootCatchUp } from '../../src/discord/boot-catchup.js';
import { setElanousConfigDir, resetElanousConfigDir } from '../../src/elanous-config-dir.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-dc-catchup-'));
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

interface SentMessage { channelId: string; text: string }

function buildBridge(bindings: Array<{
  channelId: string; sessionId: string; lastSeenMsgIdx: number;
}>): {
  listDaemonBindings(): typeof bindings;
  advanceCursor(channelId: string, newIdx: number): void;
  cursorMoves: Array<{ channelId: string; newIdx: number }>;
} {
  const cursorMoves: Array<{ channelId: string; newIdx: number }> = [];
  return {
    listDaemonBindings() {
      return bindings.map((b) => ({ ...b }));
    },
    advanceCursor(channelId, newIdx) {
      const idx = bindings.findIndex((b) => b.channelId === channelId);
      if (idx >= 0) bindings[idx]!.lastSeenMsgIdx = newIdx;
      cursorMoves.push({ channelId, newIdx });
    },
    cursorMoves,
  };
}

describe('runDiscordBootCatchUp', () => {
  test('does nothing when no bindings exist', async () => {
    const bridge = buildBridge([]);
    const sent: SentMessage[] = [];
    const n = await runDiscordBootCatchUp(
      bridge,
      async (channelId, text) => { sent.push({ channelId, text }); },
    );
    expect(n).toBe(0);
    expect(sent).toEqual([]);
  });

  test('emits digest for missed turns + advances cursor', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'elanous-session-7.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'old user' }),
        JSON.stringify({ role: 'assistant', content: 'old reply' }),
        JSON.stringify({ role: 'user', content: 'new user' }),
        JSON.stringify({ role: 'assistant', content: 'FRESH REPLY' }),
      ].join('\n') + '\n',
    );

    const bridge = buildBridge([
      { channelId: 'snowflake-99', sessionId: 'elanous-session-7', lastSeenMsgIdx: 2 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runDiscordBootCatchUp(
      bridge,
      async (channelId, text) => { sent.push({ channelId, text }); },
    );
    expect(n).toBe(1);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent[0]!.channelId).toBe('snowflake-99');
    const concatenated = sent.map((s) => s.text).join('');
    expect(concatenated).toContain('FRESH REPLY');
    expect(concatenated).toContain('new user');
    // Old turns (already shown) must NOT appear.
    expect(concatenated).not.toContain('old reply');
    // Cursor advanced.
    expect(bridge.cursorMoves).toEqual([{ channelId: 'snowflake-99', newIdx: 4 }]);
  });

  test('skips bindings whose jsonl is missing', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);

    const bridge = buildBridge([
      { channelId: 'x', sessionId: 'elanous-session-missing', lastSeenMsgIdx: 5 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runDiscordBootCatchUp(
      bridge,
      async (channelId, text) => { sent.push({ channelId, text }); },
    );
    expect(n).toBe(0);
    expect(sent).toEqual([]);
    expect(bridge.cursorMoves).toEqual([]);
  });

  test('does not advance cursor when send throws', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'elanous-session-7.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'fresh' }) + '\n',
    );

    const bridge = buildBridge([
      { channelId: 'x', sessionId: 'elanous-session-7', lastSeenMsgIdx: 0 },
    ]);
    const n = await runDiscordBootCatchUp(
      bridge,
      async () => { throw new Error('discord offline'); },
      { log: () => { /* swallow */ } },
    );
    expect(n).toBe(0);
    expect(bridge.cursorMoves).toEqual([]);
  });

  test('handles multiple discord channels independently', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'sess-A.jsonl'),
      JSON.stringify({ role: 'assistant', content: 'A-reply' }) + '\n',
    );
    writeFileSync(
      joinPath(historyDir, 'sess-B.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'B-q' }),
        JSON.stringify({ role: 'assistant', content: 'B-a' }),
      ].join('\n') + '\n',
    );

    const bridge = buildBridge([
      { channelId: 'chan-1', sessionId: 'sess-A', lastSeenMsgIdx: 0 },
      { channelId: 'chan-2', sessionId: 'sess-B', lastSeenMsgIdx: 0 },
    ]);
    const sent: SentMessage[] = [];
    const n = await runDiscordBootCatchUp(
      bridge,
      async (channelId, text) => { sent.push({ channelId, text }); },
    );
    expect(n).toBe(2);
    expect(new Set(sent.map((s) => s.channelId))).toEqual(new Set(['chan-1', 'chan-2']));
    expect(bridge.cursorMoves.find((m) => m.channelId === 'chan-1')?.newIdx).toBe(1);
    expect(bridge.cursorMoves.find((m) => m.channelId === 'chan-2')?.newIdx).toBe(2);
  });
});
