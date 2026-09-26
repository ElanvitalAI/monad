// Tier 1 Phase 3 양방향 sync · PR 1 · DaemonSessionHistory.register tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';

import { DaemonSessionHistory } from '../src/boot/daemon-runtime.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(joinPath(tmpdir(), 'elanous-history-register-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('DaemonSessionHistory.register (in-memory)', () => {
  test('registering an id makes has() return true', () => {
    const h = new DaemonSessionHistory();
    expect(h.has('11111111-2222-3333-4444-555555555555')).toBe(false);
    h.register('11111111-2222-3333-4444-555555555555');
    expect(h.has('11111111-2222-3333-4444-555555555555')).toBe(true);
  });

  test('registering an id with no messages keeps history empty', () => {
    const h = new DaemonSessionHistory();
    h.register('s1');
    expect(h.get('s1')).toEqual([]);
    expect(h.has('s1')).toBe(true);
  });

  test('register with initialMessages persists them in chronological order', () => {
    const h = new DaemonSessionHistory();
    h.register('s1', [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ]);
    expect(h.get('s1')).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ]);
  });

  test('register is idempotent — does not clear existing messages', () => {
    const h = new DaemonSessionHistory();
    h.append('s1', [{ role: 'user', content: 'first' }]);
    h.register('s1'); // re-register without messages
    expect(h.get('s1')).toEqual([{ role: 'user', content: 'first' }]);
  });

  test('re-registering with new messages appends rather than replacing', () => {
    const h = new DaemonSessionHistory();
    h.register('s1', [{ role: 'user', content: 'A' }]);
    h.register('s1', [{ role: 'assistant', content: 'B' }]);
    expect(h.get('s1')).toEqual([
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
    ]);
  });

  test('register fires onAppend listeners when initialMessages are provided', () => {
    const h = new DaemonSessionHistory();
    const events: { id: string; count: number }[] = [];
    h.onAppend((id, msgs) => { events.push({ id, count: msgs.length }); });
    h.register('s1', [{ role: 'user', content: 'x' }]);
    expect(events).toEqual([{ id: 's1', count: 1 }]);
  });

  test('register without messages does NOT fire onAppend (no append happened)', () => {
    const h = new DaemonSessionHistory();
    let fired = 0;
    h.onAppend(() => { fired += 1; });
    h.register('s1');
    expect(fired).toBe(0);
  });

  test('rejects ids with path-traversal characters', () => {
    const h = new DaemonSessionHistory();
    expect(() => h.register('../etc/passwd')).toThrow();
    expect(() => h.register('foo/bar')).toThrow();
    expect(() => h.register('a\\b')).toThrow();
    expect(() => h.register('')).toThrow();
  });
});

describe('DaemonSessionHistory.register (disk-backed)', () => {
  test('register without messages creates an empty jsonl file', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    h.register('disk-s1');
    const path = joinPath(tmp, 'disk-s1.jsonl');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  test('register with initialMessages writes them through to disk', () => {
    const h = new DaemonSessionHistory({ diskDir: tmp });
    h.register('disk-s2', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
    const path = joinPath(tmp, 'disk-s2.jsonl');
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ role: 'user', content: 'first' });
    expect(JSON.parse(lines[1]!)).toEqual({ role: 'assistant', content: 'reply' });
  });

  test('a second DaemonSessionHistory bound to the same dir sees the registered session', () => {
    {
      const h1 = new DaemonSessionHistory({ diskDir: tmp });
      h1.register('survives-restart', [{ role: 'user', content: 'persist me' }]);
    }
    {
      const h2 = new DaemonSessionHistory({ diskDir: tmp });
      expect(h2.has('survives-restart')).toBe(true);
      expect(h2.get('survives-restart')).toEqual([
        { role: 'user', content: 'persist me' },
      ]);
    }
  });
});
