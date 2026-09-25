// MVP M1.5 A.1 — disk-backed history persistence tests.
//
// Validate the opt-in disk path on `DaemonSessionHistory`:
//   - append → file appears, content matches
//   - second instance → seedFromDisk() rebuilds the in-memory cache
//   - forget()    → on-disk file unlinks
//   - gc()        → stale on-disk files unlink
//   - summary()   → msgCount + lastTurnAt parity with in-memory mode

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { DaemonSessionHistory, type DaemonRuntimeOpts } from '../src/boot/daemon-runtime.js';

// ⛔ #14191 이 심은 가드 — 도구 표면이 PtyShell 을 노출하면 중단 시 비-detached PTY 를 걷을
//    함수를 «반드시» 받아야 한다(안 주면 던진다). 이 시험은 그 정리 동작을 재지 않으므로
//    no-op 스텁으로 계약만 지킨다.  📏 2026-08-30: 이 줄이 없어서 빨갰다.
const withPtyCleanup = (opts: DaemonRuntimeOpts = {}): DaemonRuntimeOpts =>
  ({ killNonDetachedPty: () => { /* no-op */ }, ...opts });

import {
  appendAssistantMessages,
  appendUserAndBuildMessages,
} from '../src/boot/daemon-history-helper.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'monad-history-disk-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('DaemonSessionHistory (diskDir)', () => {
  test('append writes a jsonl file with one line per message', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    appendUserAndBuildMessages(h, 's1', 'hello');
    appendAssistantMessages(h, 's1', [
      { role: 'assistant', content: 'hi back' },
    ]);

    const file = joinPath(tmp, 's1.jsonl');
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ role: 'user', content: 'hello' });
    expect(JSON.parse(lines[1]!)).toEqual({ role: 'assistant', content: 'hi back' });
  });

  test('second instance seeds in-memory cache from existing files', () => {
    const h1 = new DaemonSessionHistory({ diskDir: tmp });
    appendUserAndBuildMessages(h1, 'persist-me', 'q1');
    appendAssistantMessages(h1, 'persist-me', [
      { role: 'assistant', content: 'a1' },
    ]);
    appendUserAndBuildMessages(h1, 'persist-me', 'q2');
    appendAssistantMessages(h1, 'persist-me', [
      { role: 'assistant', content: 'a2' },
    ]);

    // New instance, same dir — simulates daemon restart.
    const h2 = new DaemonSessionHistory({ diskDir: tmp });
    expect(h2.has('persist-me')).toBe(true);
    expect(h2.get('persist-me').map((m) => m.content)).toEqual([
      'q1', 'a1', 'q2', 'a2',
    ]);
  });

  test('forget unlinks the on-disk file', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    appendUserAndBuildMessages(h, 'tmp', 'q');
    const file = joinPath(tmp, 'tmp.jsonl');
    expect(existsSync(file)).toBe(true);
    h.forget('tmp');
    expect(existsSync(file)).toBe(false);
  });

  test('gc unlinks stale jsonl files', async () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    appendUserAndBuildMessages(h, 'old', 'q');

    await new Promise((r) => setTimeout(r, 50));
    appendUserAndBuildMessages(h, 'new', 'q');

    const removed = h.gc(30);
    expect(removed).toBe(1);
    expect(existsSync(joinPath(tmp, 'old.jsonl'))).toBe(false);
    expect(existsSync(joinPath(tmp, 'new.jsonl'))).toBe(true);
  });

  test('summary reflects on-disk session count + msgCount', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    appendUserAndBuildMessages(h, 's1', 'q');
    appendAssistantMessages(h, 's1', [
      { role: 'assistant', content: 'a' },
    ]);
    const summary = h.summary();
    expect(summary).toHaveLength(1);
    expect(summary[0]!.id).toBe('s1');
    expect(summary[0]!.msgCount).toBe(2);
  });

  test('persistencePath surfaces the disk dir', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    expect(h.persistencePath).toBe(tmp);

    const h2 = new DaemonSessionHistory();
    expect(h2.persistencePath).toBeUndefined();
  });

  test('rejects path-traversal session ids (no file written)', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    // Defensive guard — ACP server only mints `monad-session-N` style
    // ids today, but verify the safety net for future changes.
    appendUserAndBuildMessages(h, '../escape', 'q');
    // In-memory still holds the value (the guard rejects ONLY the
    // disk write, not the live-turn path).
    expect(h.has('../escape')).toBe(true);
    // No file should have escaped the dir or been created with a
    // suspicious name.
    const entries = readdirSync(tmp);
    expect(entries.some((e) => e.includes('escape'))).toBe(false);
  });

  test('disk-mode preserves the C1 multi-turn user persistence contract', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    appendUserAndBuildMessages(h, 's1', 'q1');
    appendAssistantMessages(h, 's1', [{ role: 'assistant', content: 'a1' }]);
    appendUserAndBuildMessages(h, 's1', 'q2');
    appendAssistantMessages(h, 's1', [{ role: 'assistant', content: 'a2' }]);

    expect(h.get('s1').map((m) => m.role)).toEqual([
      'user', 'assistant', 'user', 'assistant',
    ]);

    // Restart simulation — same contract on rehydrated cache.
    const h2 = new DaemonSessionHistory({ diskDir: tmp });
    expect(h2.get('s1').map((m) => m.content)).toEqual([
      'q1', 'a1', 'q2', 'a2',
    ]);
  });
});

describe('createDaemonRuntime + MONAD_HISTORY_DIR env', () => {
  let toolCwd: string;

  beforeEach(() => {
    toolCwd = mkdtempSync(joinPath(tmpdir(), 'monad-history-tool-cwd-'));
  });

  afterEach(() => {
    rmSync(toolCwd, { recursive: true, force: true });
  });

  test('env var seeds diskDir when no opt provided', async () => {
    const original = process.env.MONAD_HISTORY_DIR;
    process.env.MONAD_HISTORY_DIR = tmp;
    try {
      const { createDaemonRuntime } = await import('../src/boot/daemon-runtime.js');
      const { history } = createDaemonRuntime(withPtyCleanup({ toolCwd }));
      expect(history.persistencePath).toBe(tmp);
      appendUserAndBuildMessages(history, 'env-history', 'persist through env');
      expect(existsSync(joinPath(tmp, 'env-history.jsonl'))).toBe(true);
      expect(existsSync(joinPath(toolCwd, 'env-history.jsonl'))).toBe(false);
    } finally {
      if (original === undefined) delete process.env.MONAD_HISTORY_DIR;
      else process.env.MONAD_HISTORY_DIR = original;
    }
  });

  test('explicit diskDir opt wins over env var', async () => {
    const original = process.env.MONAD_HISTORY_DIR;
    const envDiskDir = mkdtempSync(joinPath(tmpdir(), 'monad-history-env-disk-'));
    process.env.MONAD_HISTORY_DIR = envDiskDir;
    try {
      const { createDaemonRuntime } = await import('../src/boot/daemon-runtime.js');
      const { history } = createDaemonRuntime(withPtyCleanup({ diskDir: tmp, toolCwd }));
      expect(history.persistencePath).toBe(tmp);
      appendUserAndBuildMessages(history, 'explicit-history', 'persist through opt');
      expect(existsSync(joinPath(tmp, 'explicit-history.jsonl'))).toBe(true);
      expect(existsSync(joinPath(envDiskDir, 'explicit-history.jsonl'))).toBe(false);
    } finally {
      if (original === undefined) delete process.env.MONAD_HISTORY_DIR;
      else process.env.MONAD_HISTORY_DIR = original;
      rmSync(envDiskDir, { recursive: true, force: true });
    }
  });

  test('no env, no opt → in-memory mode (persistencePath undefined)', async () => {
    const original = process.env.MONAD_HISTORY_DIR;
    delete process.env.MONAD_HISTORY_DIR;
    try {
      const { createDaemonRuntime } = await import('../src/boot/daemon-runtime.js');
      const { history } = createDaemonRuntime(withPtyCleanup({ toolCwd }));
      expect(history.persistencePath).toBeUndefined();
      appendUserAndBuildMessages(history, 'memory-history', 'do not persist');
      expect(existsSync(joinPath(tmp, 'memory-history.jsonl'))).toBe(false);
      expect(existsSync(joinPath(toolCwd, 'memory-history.jsonl'))).toBe(false);
    } finally {
      if (original !== undefined) process.env.MONAD_HISTORY_DIR = original;
    }
  });
});
