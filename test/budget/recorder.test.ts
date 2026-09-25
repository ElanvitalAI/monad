// H6 P1 Bundle 1 · Log-scan recorder tests.
//
// Exercise the Codex + Claude JSONL parsers against synthetic log
// files in a tmp directory — real logs aren't stable across users.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanCodexTurns, scanClaudeTurns, runRecorder } from '../../src/budget/recorder';
import { BudgetHistoryStore } from '../../src/budget/history-store';
import { UsageStore } from '../../src/budget/usage-store';

describe('recorder · codex log parser', () => {
  let root: string;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'recorder-codex-'));
    root = join(tmp, 'sessions');
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('parses token_count events into TurnSummary rows', () => {
    const dayDir = join(root, '2026', '04', '22');
    mkdirSync(dayDir, { recursive: true });
    const path = join(dayDir, 'sess-abc.jsonl');
    const lines = [
      { ts: '2026-04-22T10:00:00Z', session_id: 'sess-abc', turn_context: { model: 'gpt-5-codex' } },
      {
        ts: '2026-04-22T10:00:01Z',
        session_id: 'sess-abc',
        event_msg: {
          type: 'token_count',
          id: 'evt-1',
          token_count: { input_tokens: 500, output_tokens: 200, cached_tokens: 50 },
        },
      },
    ];
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const out = scanCodexTurns({ codexRoot: root });
    expect(out.turns.length).toBe(1);
    expect(out.turns[0]?.provider).toBe('codex');
    expect(out.turns[0]?.turnId).toBe('codex:evt-1');
    expect(out.turns[0]?.model).toBe('gpt-5-codex');
    expect(out.turns[0]?.inputTokens).toBe(500);
    expect(out.turns[0]?.cacheReadTokens).toBe(50);
  });

  test('skips files older than lookbackDays', () => {
    const path = join(root, 'stale.jsonl');
    writeFileSync(
      path,
      JSON.stringify({
        event_msg: {
          type: 'token_count',
          id: 'old',
          token_count: { input_tokens: 1, output_tokens: 1 },
        },
      }) + '\n',
    );
    const ancient = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(path, ancient, ancient);
    const out = scanCodexTurns({ codexRoot: root, lookbackDays: 30 });
    expect(out.turns.length).toBe(0);
  });

  test('tolerates malformed lines without crashing', () => {
    mkdirSync(root, { recursive: true });
    const path = join(root, 'mixed.jsonl');
    writeFileSync(
      path,
      [
        'not-json-here',
        JSON.stringify({
          event_msg: {
            type: 'token_count',
            id: 'ok',
            token_count: { input_tokens: 5, output_tokens: 7 },
          },
        }),
        '',
      ].join('\n'),
    );
    const out = scanCodexTurns({ codexRoot: root });
    expect(out.turns.length).toBe(1);
    expect(out.turns[0]?.turnId).toBe('codex:ok');
  });

  test('ignores non-token_count event_msg types', () => {
    const path = join(root, 'misc.jsonl');
    writeFileSync(
      path,
      [
        JSON.stringify({ event_msg: { type: 'agent_message', id: 'x' } }),
        JSON.stringify({
          event_msg: {
            type: 'token_count',
            id: 'y',
            token_count: { input_tokens: 1, output_tokens: 1 },
          },
        }),
      ].join('\n'),
    );
    const out = scanCodexTurns({ codexRoot: root });
    expect(out.turns.length).toBe(1);
    expect(out.turns[0]?.turnId).toBe('codex:y');
  });
});

describe('recorder · claude log parser', () => {
  let tmp: string;
  let projectsRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'recorder-claude-'));
    projectsRoot = join(tmp, 'projects');
    mkdirSync(projectsRoot, { recursive: true });
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  test('parses assistant messages with usage', () => {
    const projDir = join(projectsRoot, 'my-project');
    mkdirSync(projDir, { recursive: true });
    const path = join(projDir, 'conv.jsonl');
    const lines = [
      {
        type: 'assistant',
        timestamp: '2026-04-22T11:00:00Z',
        requestId: 'req-1',
        sessionId: 's-1',
        message: {
          id: 'msg-a',
          model: 'claude-sonnet-4-5',
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 10,
          },
        },
      },
    ];
    writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const out = scanClaudeTurns({ claudeRoots: [projectsRoot] });
    expect(out.turns.length).toBe(1);
    expect(out.turns[0]?.turnId).toBe('claude:msg-a:req-1');
    expect(out.turns[0]?.cacheReadTokens).toBe(30);
    expect(out.turns[0]?.cacheCreateTokens).toBe(10);
  });

  test('skips non-assistant lines', () => {
    const projDir = join(projectsRoot, 'p');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, 'x.jsonl'),
      [
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        JSON.stringify({ type: 'assistant', requestId: 'r', message: { id: 'm', usage: { input_tokens: 1, output_tokens: 1 } } }),
      ].join('\n'),
    );
    const out = scanClaudeTurns({ claudeRoots: [projectsRoot] });
    expect(out.turns.length).toBe(1);
  });

  test('tolerates missing requestId (message.id-only key)', () => {
    const projDir = join(projectsRoot, 'p');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, 'y.jsonl'),
      JSON.stringify({
        type: 'assistant',
        message: { id: 'only-id', usage: { input_tokens: 1, output_tokens: 1 } },
      }) + '\n',
    );
    const out = scanClaudeTurns({ claudeRoots: [projectsRoot] });
    expect(out.turns.length).toBe(1);
    expect(out.turns[0]?.turnId).toBe('claude:only-id:');
  });
});

describe('recorder · runRecorder dedup via store', () => {
  let tmp: string;
  let history: BudgetHistoryStore;
  let store: UsageStore;
  let codexRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'recorder-run-'));
    history = new BudgetHistoryStore(join(tmp, 'h.sqlite'));
    store = new UsageStore({ storageDir: tmp, historyStore: history });
    codexRoot = join(tmp, 'sessions');
    mkdirSync(codexRoot, { recursive: true });
    writeFileSync(
      join(codexRoot, 'a.jsonl'),
      JSON.stringify({
        event_msg: {
          type: 'token_count',
          id: 'dup',
          token_count: { input_tokens: 1, output_tokens: 2 },
        },
      }) + '\n',
    );
  });

  afterEach(() => {
    history.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('second run produces zero new turns (dedup on turnId)', () => {
    const first = runRecorder(store, { codexRoot, claudeRoots: [] });
    expect(first.newTurns).toBe(1);
    const second = runRecorder(store, { codexRoot, claudeRoots: [] });
    expect(second.newTurns).toBe(0);
    expect(history.size()).toBe(1);
  });
});
