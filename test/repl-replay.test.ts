// BACKLOG #5 — REPL session replay. Covers the pure helper that
// converts a LoadedSession's messages into ScenarioTurn[] for the
// REPL's --scenario path.

import { describe, expect, test } from 'bun:test';
import { buildReplayTurnsFromSession } from '../src/repl/replay.js';
import type { LoadedSession, SerializedMessage, SessionMeta } from '../src/session/index.js';

function fakeMeta(): SessionMeta {
  return {
    id: '01TEST0000000000000000000A',
    title: 'replay test',
    createdAt: '2026-05-05T00:00:00.000Z',
    updatedAt: '2026-05-05T00:00:00.000Z',
    source: 'cli',
    sourceKind: 'keyboard',
  } as SessionMeta;
}

function msg(role: SerializedMessage['role'], content: string, extra: Partial<SerializedMessage> = {}): SerializedMessage {
  return { role, content, ts: '2026-05-05T00:00:00.000Z', ...extra };
}

function loaded(messages: SerializedMessage[]): LoadedSession {
  return { meta: fakeMeta(), messages };
}

describe('buildReplayTurnsFromSession', () => {
  test('extracts user-only prompts in order', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('user', 'first prompt'),
      msg('assistant', 'first reply'),
      msg('user', 'second prompt'),
      msg('assistant', 'second reply'),
    ]));
    expect(out.turns.map(t => t.prompt)).toEqual(['first prompt', 'second prompt']);
    expect(out.extractedCount).toBe(2);
    expect(out.skippedCount).toBe(2);  // 2 assistant
  });

  test('skips assistant / tool / system messages', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('system', 'system seed'),
      msg('user', 'real prompt'),
      msg('tool', '{"result":"x"}', { toolName: 'Read' }),
      msg('assistant', 'reply'),
    ]));
    expect(out.turns.length).toBe(1);
    expect(out.turns[0].prompt).toBe('real prompt');
    expect(out.skippedCount).toBe(3);
  });

  test('skips empty / whitespace-only user messages', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('user', ''),
      msg('user', '   \n\t'),
      msg('user', 'real one'),
    ]));
    expect(out.turns.length).toBe(1);
    expect(out.turns[0].prompt).toBe('real one');
    expect(out.skippedCount).toBe(2);
  });

  test('emits monotonic replay-<n> ids for correlation', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('user', 'a'),
      msg('user', 'b'),
      msg('user', 'c'),
    ]));
    expect(out.turns.map(t => t.id)).toEqual(['replay-1', 'replay-2', 'replay-3']);
  });

  test('counts attachment markers without blocking the replay', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('user', 'normal prompt'),
      msg('user', 'see this image: data:image/png;base64,AAAAA...'),
      msg('user', '```text\nattached file_path: x\n```'),
    ]));
    expect(out.turns.length).toBe(3);  // all replayable
    expect(out.droppedAttachmentCount).toBe(2);  // 2 marker matches
  });

  test('empty session → no turns, zero counts', () => {
    const out = buildReplayTurnsFromSession(loaded([]));
    expect(out.turns).toEqual([]);
    expect(out.extractedCount).toBe(0);
    expect(out.skippedCount).toBe(0);
    expect(out.droppedAttachmentCount).toBe(0);
  });

  test('session with only assistant/tool messages → no turns', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('assistant', 'unsolicited'),
      msg('tool', 'tool noise', { toolName: 'Bash' }),
    ]));
    expect(out.turns).toEqual([]);
    expect(out.extractedCount).toBe(0);
    expect(out.skippedCount).toBe(2);
  });

  test('non-string content skipped (defensive — wire safety)', () => {
    const out = buildReplayTurnsFromSession(loaded([
      msg('user', null as unknown as string),  // simulating wire corruption
      msg('user', 'real one'),
    ]));
    expect(out.turns.length).toBe(1);
    expect(out.turns[0].prompt).toBe('real one');
  });
});
