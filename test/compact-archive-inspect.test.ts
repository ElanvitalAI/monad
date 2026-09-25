// PR3 §5.3 — /compact --inspect (archive replay viewer).

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendArchiveEntry,
  formatInspectOutput,
  formatSessionList,
  inspectArchive,
  listArchiveSessions,
} from '../src/compact/index.js';
import type { CompactArchiveEntry } from '../src/compact/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `monad-archive-inspect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<CompactArchiveEntry> = {}): CompactArchiveEntry {
  return {
    ts: Date.now(),
    layer: 'tool-output-budget',
    sessionId: 'session-x',
    origin: { kind: 'tool_result', tool_use_id: 'tu_abc123' },
    content: 'a'.repeat(100),
    replacement: '[trimmed]',
    ...overrides,
  };
}

describe('inspectArchive', () => {
  test('returns exists=false when no archive file', () => {
    const r = inspectArchive('missing-session', tmpDir);
    expect(r.exists).toBe(false);
    expect(r.entries).toEqual([]);
    expect(r.totalContentChars).toBe(0);
  });

  test('parses valid JSONL entries + accumulates per-layer + char totals', () => {
    appendArchiveEntry(makeEntry({ sessionId: 'sx', content: 'aaaa' }), tmpDir);
    appendArchiveEntry(makeEntry({ sessionId: 'sx', content: 'bb', layer: 'microcompact' }), tmpDir);
    appendArchiveEntry(makeEntry({ sessionId: 'sx', content: 'cccccc', layer: 'microcompact' }), tmpDir);
    const r = inspectArchive('sx', tmpDir);
    expect(r.exists).toBe(true);
    expect(r.entries.length).toBe(3);
    expect(r.totalContentChars).toBe(4 + 2 + 6);
    expect(r.perLayer['tool-output-budget']).toBe(1);
    expect(r.perLayer['microcompact']).toBe(2);
    expect(r.parseErrors).toBe(0);
  });

  test('skips malformed lines without throwing + counts them', () => {
    appendArchiveEntry(makeEntry({ sessionId: 'sm', content: 'good' }), tmpDir);
    appendFileSync(join(tmpDir, 'sm.jsonl'), 'not json at all\n', 'utf-8');
    appendFileSync(join(tmpDir, 'sm.jsonl'), '{"ts":"not-a-number"}\n', 'utf-8');
    appendArchiveEntry(makeEntry({ sessionId: 'sm', content: 'good2' }), tmpDir);
    const r = inspectArchive('sm', tmpDir);
    expect(r.entries.length).toBe(2);
    expect(r.parseErrors).toBe(2);
    expect(r.totalContentChars).toBe(4 + 5);
  });

  test('sessionId sanitisation matches archive write path', () => {
    appendArchiveEntry(makeEntry({ sessionId: 'weird/session id!' }), tmpDir);
    // archivePath sanitises to 'weird_session_id_'
    const r = inspectArchive('weird/session id!', tmpDir);
    expect(r.exists).toBe(true);
    expect(r.entries.length).toBe(1);
  });
});

describe('listArchiveSessions', () => {
  test('returns empty list when dir missing or empty', () => {
    const r = listArchiveSessions(tmpDir);
    expect(r.sessions).toEqual([]);
    const ghost = listArchiveSessions(join(tmpDir, 'does-not-exist'));
    expect(ghost.sessions).toEqual([]);
  });

  test('enumerates *.jsonl files newest first, ignores other files', () => {
    writeFileSync(join(tmpDir, 'a.jsonl'), '{}\n');
    writeFileSync(join(tmpDir, 'b.jsonl'), '{}\n{}\n');
    writeFileSync(join(tmpDir, 'README.md'), 'x'); // non-archive
    const r = listArchiveSessions(tmpDir);
    expect(r.sessions.length).toBe(2);
    expect(r.sessions.map((s) => s.sessionId).sort()).toEqual(['a', 'b']);
  });
});

describe('formatInspectOutput', () => {
  test('renders no-archive fallback', () => {
    const out = formatInspectOutput(
      { path: '/tmp/x.jsonl', exists: false, entries: [], totalContentChars: 0, perLayer: {}, parseErrors: 0 },
      { sessionId: 'x' },
    );
    expect(out).toContain('/compact --inspect');
    expect(out).toContain('no archive');
  });

  test('renders entries + per-layer + recent-N tail', () => {
    appendArchiveEntry(makeEntry({ sessionId: 'sf', content: 'a'.repeat(2_000) }), tmpDir);
    appendArchiveEntry(makeEntry({ sessionId: 'sf', layer: 'microcompact', content: 'b'.repeat(50) }), tmpDir);
    const r = inspectArchive('sf', tmpDir);
    const out = formatInspectOutput(r, { sessionId: 'sf', limit: 10 });
    expect(out).toContain('Session:  sf');
    expect(out).toContain('Entries:  2');
    expect(out).toContain('tool-output-budget');
    expect(out).toContain('microcompact');
    expect(out).toContain('Latest 2 of 2');
  });

  test('flags malformed-line count when present', () => {
    appendArchiveEntry(makeEntry({ sessionId: 'sm2' }), tmpDir);
    appendFileSync(join(tmpDir, 'sm2.jsonl'), 'garbage\n', 'utf-8');
    const r = inspectArchive('sm2', tmpDir);
    const out = formatInspectOutput(r, { sessionId: 'sm2' });
    expect(out).toContain('1 malformed line(s) skipped');
  });
});

describe('formatSessionList', () => {
  test('empty case', () => {
    const out = formatSessionList({ sessions: [] });
    expect(out).toContain('no archives');
  });

  test('renders sessions with size + mtime', () => {
    writeFileSync(join(tmpDir, 'session-a.jsonl'), 'x'.repeat(2048));
    const list = listArchiveSessions(tmpDir);
    const out = formatSessionList(list);
    expect(out).toContain('Found 1 archive');
    expect(out).toContain('session-a');
    expect(out).toContain('KB');
  });
});
