// historyFromSession — JSONL → chat.history converter used by the
// TUI /session load path. Keep it strictly a mapping test: the
// underlying JSONL persistence is covered elsewhere, here we only
// care about what shape the TUI sees.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSession,
  appendMessage,
  historyFromSession,
} from '../src/session/index.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sess-resume-'));
  process.env.XDG_STATE_HOME = join(root, '_state');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.XDG_STATE_HOME;
});

describe('historyFromSession', () => {
  test('returns null for unknown id', () => {
    expect(historyFromSession('does-not-exist', root)).toBeNull();
  });

  test('empty session → empty history with meta populated', () => {
    const s = createSession({ title: 'empty' }, root);
    const out = historyFromSession(s.id, root);
    expect(out).not.toBeNull();
    expect(out!.meta.id).toBe(s.id);
    expect(out!.history).toEqual([]);
  });

  test('preserves user/assistant/system in order', () => {
    const s = createSession({}, root);
    const ts = '2026-04-15T00:00:00Z';
    appendMessage(s.id, { role: 'system', content: 'you are a pirate', ts }, root);
    appendMessage(s.id, { role: 'user', content: 'first', ts }, root);
    appendMessage(s.id, { role: 'assistant', content: 'second', ts }, root);
    appendMessage(s.id, { role: 'user', content: 'third', ts }, root);

    const out = historyFromSession(s.id, root);
    expect(out!.history).toEqual([
      { role: 'system', content: 'you are a pirate' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ]);
  });

  test('drops tool rows — not replayable as chat history', () => {
    const s = createSession({}, root);
    const ts = '2026-04-15T00:00:00Z';
    appendMessage(s.id, { role: 'user', content: 'list files', ts }, root);
    appendMessage(s.id, { role: 'tool', content: 'file1.txt\nfile2.txt', ts, toolName: 'ls' }, root);
    appendMessage(s.id, { role: 'assistant', content: 'two files', ts }, root);

    const out = historyFromSession(s.id, root);
    expect(out!.history.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(out!.history[0]!.content).toBe('list files');
  });

  test('drops blank/whitespace-only messages (guards against corrupt JSONL)', () => {
    const s = createSession({}, root);
    const ts = '2026-04-15T00:00:00Z';
    appendMessage(s.id, { role: 'user', content: '', ts }, root);
    appendMessage(s.id, { role: 'assistant', content: '   \n\t  ', ts }, root);
    appendMessage(s.id, { role: 'user', content: 'real turn', ts }, root);

    const out = historyFromSession(s.id, root);
    expect(out!.history.length).toBe(1);
    expect(out!.history[0]!.content).toBe('real turn');
  });

  test('round-trips via a realistic handoff scenario', () => {
    // Laptop persisted 3 turns, mobile added 2 more — loading should
    // return all 5 in order so the TUI can resume where mobile left
    // off.
    const s = createSession({ title: 'debug prod' }, root);
    appendMessage(s.id, { role: 'user', content: 'why is ingest lagging?', ts: '2026-04-15T09:00:00Z' }, root);
    appendMessage(s.id, { role: 'assistant', content: 'check kafka consumer lag on node b', ts: '2026-04-15T09:00:30Z' }, root);
    appendMessage(s.id, { role: 'user', content: 'lag is 40k', ts: '2026-04-15T09:01:00Z' }, root);
    // Mobile-side additions while laptop was closed
    appendMessage(s.id, { role: 'assistant', content: 'restart consumer pool', ts: '2026-04-15T10:00:00Z' }, root);
    appendMessage(s.id, { role: 'user', content: 'done, lag dropped to 0', ts: '2026-04-15T10:05:00Z' }, root);

    const out = historyFromSession(s.id, root);
    expect(out!.history.length).toBe(5);
    expect(out!.history[0]!.content).toContain('why is ingest lagging');
    expect(out!.history[4]!.content).toContain('lag dropped to 0');
  });
});
