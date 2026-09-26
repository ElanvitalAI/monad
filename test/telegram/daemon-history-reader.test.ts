// Tier 1 telegram fan-out arc — PR 3 · daemon history reader tests.
//
// readDaemonSessionHistoryFromDir tests use the explicit-dir overload
// so the tests don't depend on a real daemon's runtime.json. The
// runtime.json discovery path is exercised in the live verification
// scenario from the HANDOFF (no automated coverage of the env-var
// side because spawning a daemon adds 1s+ to the suite).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { readDaemonSessionHistoryFromDir } from '../../src/telegram/daemon-history-reader.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-tg-history-reader-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('readDaemonSessionHistoryFromDir', () => {
  test('returns exists=false for unknown sessionId', () => {
    const r = readDaemonSessionHistoryFromDir(tmp, 'never-existed');
    expect(r.exists).toBe(false);
    expect(r.messages).toEqual([]);
    expect(r.historyDir).toBe(tmp);
  });

  test('reads and parses jsonl messages in order', () => {
    const path = joinPath(tmp, 'elanous-session-3.jsonl');
    writeFileSync(
      path,
      [
        JSON.stringify({ role: 'user', content: 'first' }),
        JSON.stringify({ role: 'assistant', content: 'reply 1' }),
        JSON.stringify({ role: 'user', content: 'second' }),
      ].join('\n') + '\n',
    );
    const r = readDaemonSessionHistoryFromDir(tmp, 'elanous-session-3');
    expect(r.exists).toBe(true);
    expect(r.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'second' },
    ]);
  });

  test('skips corrupt jsonl lines (best-effort recovery)', () => {
    const path = joinPath(tmp, 's1.jsonl');
    writeFileSync(
      path,
      [
        JSON.stringify({ role: 'user', content: 'good' }),
        '{this is not valid JSON',
        JSON.stringify({ role: 'assistant', content: 'also good' }),
        '',
      ].join('\n'),
    );
    const r = readDaemonSessionHistoryFromDir(tmp, 's1');
    expect(r.exists).toBe(true);
    expect(r.messages).toEqual([
      { role: 'user', content: 'good' },
      { role: 'assistant', content: 'also good' },
    ]);
  });

  test('rejects sessionIds with path-traversal characters', () => {
    const r1 = readDaemonSessionHistoryFromDir(tmp, '../etc/passwd');
    expect(r1.exists).toBe(false);

    const r2 = readDaemonSessionHistoryFromDir(tmp, 'foo/bar');
    expect(r2.exists).toBe(false);

    const r3 = readDaemonSessionHistoryFromDir(tmp, 'a\\b');
    expect(r3.exists).toBe(false);
  });

  test('rejects empty sessionId', () => {
    expect(readDaemonSessionHistoryFromDir(tmp, '').exists).toBe(false);
  });

  test('returns empty messages for empty jsonl file', () => {
    const path = joinPath(tmp, 'empty.jsonl');
    writeFileSync(path, '');
    const r = readDaemonSessionHistoryFromDir(tmp, 'empty');
    expect(r.exists).toBe(true);
    expect(r.messages).toEqual([]);
  });
});
