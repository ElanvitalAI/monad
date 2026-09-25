// Tier 1 telegram fan-out arc — PR 3 · /resume slash-command tests.
//
// Drives the slash dispatcher with synthetic TgIncoming messages and
// asserts on the rendered reply. The history reader uses the real
// runtime.json discovery path; tests stub MONAD_HISTORY_DIR via
// a temp dir + monad.runtime.json side-file.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
void mkdirSync; // imported above for callers that wrap subdir creation

import {
  dispatchTelegramSlash,
  defaultTelegramCommands,
} from '../src/telegram-commands.js';
import type { TgIncoming } from '../src/telegram.js';
import type { UserConfig } from '../src/user-config.js';
import { setMonadConfigDir, resetMonadConfigDir } from '../src/monad-config-dir.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-tg-resume-test-'));
  // monadDaemonDir() honors setMonadConfigDir() over homedir(). The
  // daemon dir is where monad.runtime.json lives.
  setMonadConfigDir(tmp);
});

afterEach(() => {
  resetMonadConfigDir();
  rmSync(tmp, { recursive: true, force: true });
});

function syntheticIncoming(text: string): TgIncoming {
  return {
    updateId: 1,
    chatId: 99,
    userId: 1,
    text,
    messageId: 1,
    isDm: true,
    isGroup: false,
    attachments: [],
  };
}

function dummyConfig(): UserConfig {
  return {} as unknown as UserConfig;
}

function writeRuntime(historyDir: string): void {
  // monadDaemonDir() === tmp (overridden), so runtime.json lands at
  // <tmp>/monad.runtime.json directly.
  writeFileSync(
    joinPath(tmp, 'monad.runtime.json'),
    JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      socketPath: joinPath(tmp, 'monad.sock'),
      historyDir,
    }, null, 2),
  );
}

describe('/resume slash command', () => {
  test('usage hint when no arg provided', async () => {
    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      expect(typeof result.reply).toBe('string');
      expect(result.reply as string).toContain('Usage');
    }
  });

  test('reports unknown daemon session when runtime metadata absent', async () => {
    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-bogus'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
    });
    expect(result.handled).toBe(true);
    if (result.handled) {
      const reply = result.reply as string;
      expect(reply).toContain('Unknown daemon session');
      expect(reply).toContain('monad-session-bogus');
    }
  });

  test('reports unknown when historyDir set but jsonl file missing', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);

    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-99'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
    });
    if (result.handled) {
      const reply = result.reply as string;
      expect(reply).toContain('Unknown daemon session');
      expect(reply).toContain(historyDir);
    }
  });

  test('renders preview when daemon session has history', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);

    writeFileSync(
      joinPath(historyDir, 'monad-session-3.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'what is 2+2?' }),
        JSON.stringify({ role: 'assistant', content: '4' }),
      ].join('\n') + '\n',
    );

    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-3'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
    });

    expect(result.handled).toBe(true);
    if (result.handled) {
      const reply = result.reply as string;
      expect(reply).toContain('Resumed');
      expect(reply).toContain('monad-session-3');
      expect(reply).toContain('what is 2+2?');
      expect(reply).toContain('4');
    }
  });

  test('renders empty-history note when jsonl exists but is empty', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(joinPath(historyDir, 'monad-session-empty.jsonl'), '');

    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-empty'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
    });
    if (result.handled) {
      const reply = result.reply as string;
      expect(reply).toContain('Resumed');
      expect(reply).toContain('history is empty');
    }
  });

  test('binds chat to daemon session via daemonBridge.setDaemonSessionForChat (PR 4)', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'monad-session-9.jsonl'),
      [
        JSON.stringify({ role: 'user', content: 'hi' }),
        JSON.stringify({ role: 'assistant', content: 'hello' }),
      ].join('\n') + '\n',
    );

    const setCalls: Array<{ chatId: number; sessionId: string; lastSeenMsgIdx: number }> = [];
    const stubBridge = {
      setDaemonSessionForChat: (a: { chatId: number; sessionId: string; lastSeenMsgIdx: number }) => {
        setCalls.push(a);
      },
    };

    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-9'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
      daemonBridge: stubBridge,
    });
    expect(result.handled).toBe(true);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]!.chatId).toBe(99);
    expect(setCalls[0]!.sessionId).toBe('monad-session-9');
    // Cursor starts at jsonl length so the preview's last-N isn't
    // re-emitted on the next boot.
    expect(setCalls[0]!.lastSeenMsgIdx).toBe(2);
  });

  test('does not call setDaemonSessionForChat for unknown sessions', async () => {
    const setCalls: unknown[] = [];
    const stubBridge = {
      setDaemonSessionForChat: () => { setCalls.push(true); },
    };

    const cmds = defaultTelegramCommands();
    await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-bogus'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
      daemonBridge: stubBridge,
    });
    expect(setCalls).toEqual([]);
  });

  test('uses streamer when provided (path that telegram bot takes)', async () => {
    const historyDir = joinPath(tmp, 'history');
    mkdirSync(historyDir, { recursive: true });
    writeRuntime(historyDir);
    writeFileSync(
      joinPath(historyDir, 'monad-session-7.jsonl'),
      JSON.stringify({ role: 'user', content: 'hello' }) + '\n',
    );

    const edits: string[] = [];
    const cmds = defaultTelegramCommands();
    const result = await dispatchTelegramSlash(syntheticIncoming('/resume monad-session-7'), {
      userConfig: dummyConfig(),
      allCommands: cmds,
      streamer: { edit: (t) => edits.push(t) },
    });

    expect(result.handled).toBe(true);
    if (result.handled) {
      // Handler returned void (streamer path) — content went to edit().
      expect(result.reply).toBeUndefined();
      expect(edits.length).toBeGreaterThan(0);
      expect(edits[edits.length - 1]).toContain('hello');
    }
  });
});
