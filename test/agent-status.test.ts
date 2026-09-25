import { describe, expect, test } from 'bun:test';

import { AgentStatusStore } from '../src/agent-status/store.js';
import { createClaudeCodeParser, TEXT_CAP_CHARS } from '../src/agent-status/claude-code.js';
import { createCodexParser } from '../src/agent-status/codex.js';
import { BlockStore } from '../src/block/store.js';
import type { SessionStatus } from '../src/session/card.js';

function makeStore(): AgentStatusStore {
  let t = 1_000;
  return new AgentStatusStore({ now: () => ++t });
}

describe('AgentStatusStore', () => {
  test('US1 — set records status + updatedAt', () => {
    const s = makeStore();
    expect(s.set('term:1', 'working')).toBe(true);
    expect(s.get('term:1')).toBe('working');
    const rec = s.getRecord('term:1')!;
    expect(rec.status).toBe('working');
    expect(typeof rec.updatedAt).toBe('number');
  });

  test('US1 — dup set is a no-op and does not notify subscribers', () => {
    const s = makeStore();
    const events: Array<[string, SessionStatus]> = [];
    s.subscribe((id, rec) => events.push([id, rec.status]));
    expect(s.set('term:1', 'working', 'msg')).toBe(true);
    expect(s.set('term:1', 'working', 'msg')).toBe(false);
    expect(events).toEqual([['term:1', 'working']]);
  });

  test('US1 — different lastEvent forces a new notification', () => {
    const s = makeStore();
    const events: Array<[string, SessionStatus, string | undefined]> = [];
    s.subscribe((id, rec) => events.push([id, rec.status, rec.lastEvent]));
    s.set('term:1', 'working', 'start');
    s.set('term:1', 'working', 'content_block_delta');
    expect(events).toEqual([
      ['term:1', 'working', 'start'],
      ['term:1', 'working', 'content_block_delta'],
    ]);
  });

  test('US1 — clear removes a single entry, clearAll drops everything', () => {
    const s = makeStore();
    s.set('term:1', 'working');
    s.set('term:2', 'awaiting');
    s.clear('term:1');
    expect(s.get('term:1')).toBeUndefined();
    expect(s.get('term:2')).toBe('awaiting');
    s.clearAll();
    expect(s.entries()).toEqual([]);
  });
});

describe('claude-code JSONL parser (US2)', () => {
  function jsonl(events: Record<string, unknown>[]): string {
    return events.map(e => JSON.stringify(e)).join('\n') + '\n';
  }

  test('US2 — message_start → working, tool_use → awaiting, result → done', () => {
    const store = makeStore();
    const parser = createClaudeCodeParser({ store });
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'tool_use', name: 'bash' },
      { type: 'result', result: 'ok' },
    ]));
    expect(store.get('term:1')).toBe('done');
    expect(store.getRecord('term:1')!.lastEvent).toBe('result');
  });

  test('US2 — error event flips to err', () => {
    const store = makeStore();
    const parser = createClaudeCodeParser({ store });
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'error', error: { message: 'boom' } },
    ]));
    expect(store.get('term:1')).toBe('err');
  });

  test('US2 — partial JSONL buffers tail across feeds', () => {
    const store = makeStore();
    const parser = createClaudeCodeParser({ store });
    parser.feed('term:1', '{"type":"message_star');
    expect(store.get('term:1')).toBeUndefined();
    parser.feed('term:1', 't"}\n');
    expect(store.get('term:1')).toBe('working');
  });

  test('US2 — unknown type calls onUnknown but never throws', () => {
    const store = makeStore();
    const unknowns: Array<[string, string]> = [];
    const parser = createClaudeCodeParser({
      store,
      onUnknown: (id, line, reason) => unknowns.push([id, reason]),
    });
    parser.feed('term:1', jsonl([{ type: 'weird_event' }]));
    expect(store.get('term:1')).toBeUndefined();
    expect(unknowns.map(u => u[1])).toContain('unhandled-type');
  });

  test('US2 — prompt `> ` heuristic restores idle when state is working', () => {
    const store = makeStore();
    store.set('term:1', 'working', 'message_start');
    const parser = createClaudeCodeParser({ store });
    parser.feed('term:1', '> ');
    expect(store.get('term:1')).toBe('idle');
  });

  test('US2 — prompt heuristic is ignored when state is already done', () => {
    const store = makeStore();
    store.set('term:1', 'done', 'result');
    const parser = createClaudeCodeParser({ store });
    parser.feed('term:1', '> ');
    expect(store.get('term:1')).toBe('done');
  });

  test('US2 — parse-error falls through without mutating state', () => {
    const store = makeStore();
    store.set('term:1', 'working', 'message_start');
    const reasons: string[] = [];
    const parser = createClaudeCodeParser({
      store,
      onUnknown: (_id, _line, reason) => reasons.push(reason),
    });
    parser.feed('term:1', '{not json}\n');
    expect(store.get('term:1')).toBe('working');
    expect(reasons).toContain('parse-error');
  });
});

describe('claude-code block builder (BL2)', () => {
  function makeBlockStore(): BlockStore {
    let t = 1_000;
    return new BlockStore({ capPerSession: 5, now: () => ++t });
  }

  function jsonl(events: Record<string, unknown>[]): string {
    return events.map(e => JSON.stringify(e)).join('\n') + '\n';
  }

  test('BL2 — message_start..message_stop produces one block with concatenated text', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createClaudeCodeParser({ store, blockStore: blocks });
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: 'Hello ' } },
      { type: 'content_block_delta', delta: { text: 'world' } },
      { type: 'message_stop' },
    ]));
    const blk = blocks.getLatest('term:1');
    expect(blk).toBeDefined();
    expect(blk!.text).toBe('Hello world');
    expect(blk!.events).toContain('message_start');
    expect(blk!.events).toContain('message_stop');
    expect(blk!.kind).toBe('claude-code');
  });

  test('BL2 — error event commits a block with meta.error', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createClaudeCodeParser({ store, blockStore: blocks });
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: 'partial' } },
      { type: 'error', message: 'boom' },
    ]));
    const blk = blocks.getLatest('term:1');
    expect(blk?.text).toBe('partial');
    expect(blk?.meta?.['error']).toBe('boom');
  });

  test('BL2 — text is capped at TEXT_CAP_CHARS with a truncation marker', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createClaudeCodeParser({ store, blockStore: blocks });
    const giant = 'x'.repeat(TEXT_CAP_CHARS + 500);
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: giant } },
      { type: 'message_stop' },
    ]));
    const blk = blocks.getLatest('term:1')!;
    expect(blk.text.startsWith('x'.repeat(TEXT_CAP_CHARS))).toBe(true);
    expect(blk.text).toContain('[truncated at');
  });

  test('BL2 — implicit begin when delta arrives without prior message_start', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createClaudeCodeParser({ store, blockStore: blocks });
    parser.feed('term:1', jsonl([
      { type: 'content_block_delta', delta: { text: 'resume' } },
      { type: 'message_stop' },
    ]));
    expect(blocks.getLatest('term:1')?.text).toBe('resume');
  });

  test('BL2 — prompt heuristic commits a pending block (soft boundary)', () => {
    const store = makeStore();
    store.set('term:1', 'working', 'message_start');
    const blocks = makeBlockStore();
    const parser = createClaudeCodeParser({ store, blockStore: blocks });
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: 'interrupted' } },
    ]));
    // Now a bare prompt arrives — claude REPL returned control
    parser.feed('term:1', '> ');
    expect(store.get('term:1')).toBe('idle');
    expect(blocks.getLatest('term:1')?.text).toBe('interrupted');
  });

  test('BL2 — multiple message cycles produce multiple blocks in order', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createClaudeCodeParser({ store, blockStore: blocks });
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: 'first' } },
      { type: 'message_stop' },
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: 'second' } },
      { type: 'result' },
    ]));
    const list = blocks.list('term:1');
    expect(list.map(b => b.text)).toEqual(['first', 'second']);
  });

  test('BL2 — absent blockStore does not affect status parsing', () => {
    const store = makeStore();
    const parser = createClaudeCodeParser({ store }); // no blockStore
    parser.feed('term:1', jsonl([
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { text: 'x' } },
      { type: 'message_stop' },
    ]));
    expect(store.get('term:1')).toBe('done');
  });
});

describe('codex heuristic parser (US3)', () => {
  test('US3 — Thinking → working, Awaiting → awaiting, Done → done, Error → err', () => {
    const store = makeStore();
    const parser = createCodexParser({ store });
    parser.feed('term:1', 'Thinking hard about your request...');
    expect(store.get('term:1')).toBe('working');
    parser.feed('term:1', 'Awaiting approval for bash run (Y/N)?');
    expect(store.get('term:1')).toBe('awaiting');
    parser.feed('term:1', 'Done in 1.2s');
    expect(store.get('term:1')).toBe('done');
    parser.feed('term:1', 'Error: model timed out');
    expect(store.get('term:1')).toBe('err');
  });

  test('US3 — Running / Executing also count as working', () => {
    const store = makeStore();
    const parser = createCodexParser({ store });
    parser.feed('term:1', 'Running: git status');
    expect(store.get('term:1')).toBe('working');
    store.clear('term:1');
    parser.feed('term:1', 'Executing bash command');
    expect(store.get('term:1')).toBe('working');
  });

  test('US3 — trailing prompt restores idle when working', () => {
    const store = makeStore();
    store.set('term:1', 'working', 'codex-thinking');
    const parser = createCodexParser({ store });
    parser.feed('term:1', '> ');
    expect(store.get('term:1')).toBe('idle');
  });

  test('US3 — no match leaves the status untouched', () => {
    const store = makeStore();
    store.set('term:1', 'working', 'codex-thinking');
    const parser = createCodexParser({ store });
    parser.feed('term:1', 'Some random chunk without keywords.');
    expect(store.get('term:1')).toBe('working');
  });
});

describe('codex block builder (BL3)', () => {
  function makeBlockStore(): BlockStore {
    let t = 1_000;
    return new BlockStore({ capPerSession: 5, now: () => ++t });
  }

  test('BL3 — Thinking → working + begin, Done → commit', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createCodexParser({ store, blockStore: blocks });
    parser.feed('term:1', 'Thinking about plan A...');
    parser.feed('term:1', 'more detail about the plan');
    parser.feed('term:1', 'Done: finished');
    const blk = blocks.getLatest('term:1');
    expect(blk).toBeDefined();
    expect(blk!.text).toContain('more detail');
    expect(blk!.events[0]).toBe('codex-thinking');
  });

  test('BL3 — Error commits a block with meta.error', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createCodexParser({ store, blockStore: blocks });
    parser.feed('term:1', 'Running: git pull');
    parser.feed('term:1', 'Error: network timeout');
    const blk = blocks.getLatest('term:1');
    expect(blk?.meta?.['error']).toBe(true);
  });

  test('BL3 — prompt `> ` commits a pending block', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createCodexParser({ store, blockStore: blocks });
    parser.feed('term:1', 'Thinking out loud...');
    parser.feed('term:1', '> ');
    expect(store.get('term:1')).toBe('idle');
    expect(blocks.getLatest('term:1')).toBeDefined();
  });

  test('BL3 — Done without prior begin is a no-op for blocks', () => {
    const store = makeStore();
    const blocks = makeBlockStore();
    const parser = createCodexParser({ store, blockStore: blocks });
    parser.feed('term:1', 'Done'); // lonely done
    expect(blocks.getLatest('term:1')).toBeUndefined();
    expect(store.get('term:1')).toBe('done');
  });
});

describe('US4 — status pipes into SessionCard', () => {
  test('US4 — store.get flows into listSessionCards status lookup', async () => {
    const { listSessionCards, terminalToSessionCard } = await import('../src/session/card.js');
    const store = makeStore();
    store.set('term:1', 'awaiting', 'tool_use');
    const terminal = {
      id: 'term:1',
      title: 'claude',
      character: { kind: 'claude-code' as const },
      transport: { kind: 'local' as const },
      placement: { kind: 'modal' as const, modalId: 'x' },
      readOnly: false,
      visibility: 'both' as const,
      broadcastGroups: new Set<string>(),
      createdAt: 1,
      lastActivityAt: 2,
      exitCode: null,
      attentionLevel: 0 as const,
      metadata: { agentKind: 'claude-code' },
      pty: {} as any,
    } as any;
    const card = terminalToSessionCard(terminal, { get: (id) => store.get(id) });
    expect(card.status).toBe('awaiting');

    const cards = listSessionCards({
      listTerminals: () => [terminal],
      status: { get: (id) => store.get(id) },
    });
    expect(cards[0]!.status).toBe('awaiting');
  });
});
