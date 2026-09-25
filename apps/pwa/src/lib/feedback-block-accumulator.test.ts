// M3 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — accumulator
// merge-semantics tests. Locks the contract two SSE handlers
// (`runChatTurnStreaming`, `runChatTurnObserver`) rely on so they
// can't drift.

import { describe, expect, test } from 'bun:test';
import { applyFeedbackEnvelope } from './feedback-block-accumulator';
import type { ChatBlock } from './chat-runtime';
import type { FeedbackEnvelopeWire } from './feedback-envelope';

// ── helpers ──────────────────────────────────────────────────────────

function thinkingEnv(
  overrides: Partial<FeedbackEnvelopeWire> & {
    phase?: FeedbackEnvelopeWire['phase'];
  } = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:thinking:1',
    kind: 'agent.thinking',
    phase: overrides.phase ?? 'start',
    emittedAt: 1_700_000_000_000,
    seq: 1,
    payload: { msg: 'Thinking', metrics: { elapsedMs: 100, tokenCount: 25 } },
    asciiFallback: ['⏳ Thinking…'],
    ...overrides,
  };
}

function statusEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:sys:agent-status:claude-code',
    kind: 'agent.status',
    phase: 'update',
    emittedAt: 1_700_000_000_100,
    seq: 1,
    payload: { agentId: 'claude-code', status: 'running', lastEvent: 'tool-call' },
    asciiFallback: [],
    ...overrides,
  };
}

function planEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:plan:plan-A',
    kind: 'agent.plan',
    phase: 'update',
    emittedAt: 1_700_000_000_200,
    seq: 1,
    payload: {
      ref: 'plan-A',
      steps: [
        { text: 'Step one', status: 'done' },
        { text: 'Step two', status: 'in-progress' },
        { text: 'Step three', status: 'pending' },
      ],
      activeIndex: 1,
    },
    asciiFallback: [],
    ...overrides,
  };
}

// ── agent.thinking ───────────────────────────────────────────────────

describe('applyFeedbackEnvelope · agent.thinking', () => {
  test('first envelope pushes a new block', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, thinkingEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: 'agent_thinking',
      blockId: 's-1:thinking:1',
      msg: 'Thinking',
      done: false,
      metrics: { elapsedMs: 100, tokenCount: 25 },
      asciiFallback: ['⏳ Thinking…'],
    });
  });

  test('subsequent envelope with same blockId mutates in place', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, thinkingEnv({ phase: 'start' }));
    applyFeedbackEnvelope(
      blocks,
      thinkingEnv({
        phase: 'delta',
        payload: { msg: 'Thinking', metrics: { elapsedMs: 500, tokenCount: 100 } },
      }),
    );
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).metrics)
      .toEqual({ elapsedMs: 500, tokenCount: 100 });
    expect((blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).done).toBe(false);
  });

  test('phase=end flips done flag', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, thinkingEnv({ phase: 'start' }));
    applyFeedbackEnvelope(blocks, thinkingEnv({ phase: 'delta' }));
    applyFeedbackEnvelope(blocks, thinkingEnv({ phase: 'end' }));
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).done).toBe(true);
  });

  test('different blockIds create distinct blocks', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, thinkingEnv({ blockId: 's-1:thinking:1' }));
    applyFeedbackEnvelope(blocks, thinkingEnv({ blockId: 's-1:thinking:2' }));
    expect(blocks).toHaveLength(2);
  });

  test('falls back to default msg when payload omits it', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      thinkingEnv({ payload: { metrics: { elapsedMs: 0, tokenCount: 0 } } }),
    );
    expect((blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).msg).toBe('Thinking');
  });

  test('drops metrics when payload metrics fields are missing', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, thinkingEnv({ payload: { msg: 'Reasoning' } }));
    expect(
      (blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).metrics,
    ).toBeUndefined();
  });

  test('omits asciiFallback when envelope provides empty array', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, thinkingEnv({ asciiFallback: [] }));
    expect(
      (blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).asciiFallback,
    ).toBeUndefined();
  });
});

// ── agent.status ─────────────────────────────────────────────────────

describe('applyFeedbackEnvelope · agent.status', () => {
  test('pushes a new status block', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, statusEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: 'agent_status',
      agentId: 'claude-code',
      status: 'running',
      lastEvent: 'tool-call',
    });
  });

  test('same blockId mutates in place', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, statusEnv());
    applyFeedbackEnvelope(
      blocks,
      statusEnv({
        payload: { agentId: 'claude-code', status: 'done', lastEvent: 'finalized' },
      }),
    );
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as Extract<ChatBlock, { kind: 'agent_status' }>).status).toBe('done');
  });

  test('drops malformed payload (missing agentId)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      statusEnv({ payload: { status: 'running' } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('omits lastEvent when absent', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      statusEnv({ payload: { agentId: 'codex', status: 'queued' } }),
    );
    expect(
      (blocks[0] as Extract<ChatBlock, { kind: 'agent_status' }>).lastEvent,
    ).toBeUndefined();
  });
});

// ── agent.plan ───────────────────────────────────────────────────────

describe('applyFeedbackEnvelope · agent.plan', () => {
  test('pushes a new plan block', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, planEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Extract<ChatBlock, { kind: 'agent_plan' }>;
    expect(block.ref).toBe('plan-A');
    expect(block.steps).toHaveLength(3);
    expect(block.activeIndex).toBe(1);
  });

  test('same blockId mutates step progression', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, planEnv());
    applyFeedbackEnvelope(
      blocks,
      planEnv({
        payload: {
          ref: 'plan-A',
          steps: [
            { text: 'Step one', status: 'done' },
            { text: 'Step two', status: 'done' },
            { text: 'Step three', status: 'in-progress' },
          ],
          activeIndex: 2,
        },
      }),
    );
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Extract<ChatBlock, { kind: 'agent_plan' }>;
    expect(block.steps[1]!.status).toBe('done');
    expect(block.activeIndex).toBe(2);
  });

  test('drops malformed payload (missing steps array)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      planEnv({ payload: { ref: 'plan-X' } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('omits activeIndex when payload omits it', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      planEnv({
        payload: {
          ref: 'plan-A',
          steps: [{ text: 'Only step', status: 'pending' }],
        },
      }),
    );
    expect(
      (blocks[0] as Extract<ChatBlock, { kind: 'agent_plan' }>).activeIndex,
    ).toBeUndefined();
  });
});

// ── tool.diff ────────────────────────────────────────────────────────

function diffEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:tool:tc-edit-1',
    parentToolCallId: 'tc-edit-1',
    kind: 'tool.diff',
    phase: 'end',
    emittedAt: 1_700_000_000_400,
    seq: 1,
    payload: {
      filePath: 'src/foo.ts',
      language: 'typescript',
      hunks: [
        {
          oldStart: 10,
          oldLines: 1,
          newStart: 10,
          newLines: 2,
          lines: [
            { kind: 'ctx', text: 'context line' },
            { kind: 'del', text: 'old' },
            { kind: 'add', text: 'new1' },
            { kind: 'add', text: 'new2' },
          ],
        },
      ],
    },
    asciiFallback: ['  context line', '- old', '+ new1', '+ new2'],
    ...overrides,
  };
}

describe('applyFeedbackEnvelope · tool.diff', () => {
  test('pushes a new diff block with hunks + parentToolCallId', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, diffEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_diff' }>;
    expect(b.filePath).toBe('src/foo.ts');
    expect(b.language).toBe('typescript');
    expect(b.hunks).toHaveLength(1);
    expect(b.hunks[0]!.lines).toHaveLength(4);
    expect(b.parentToolCallId).toBe('tc-edit-1');
  });

  test('same blockId mutates in place', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, diffEnv());
    applyFeedbackEnvelope(
      blocks,
      diffEnv({
        payload: {
          filePath: 'src/foo.ts',
          language: 'typescript',
          hunks: [
            {
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: 1,
              lines: [{ kind: 'add', text: 'header' }],
            },
          ],
        },
      }),
    );
    expect(blocks).toHaveLength(1);
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_diff' }>;
    expect(b.hunks[0]!.lines[0]!.text).toBe('header');
  });

  test('drops malformed payload (missing hunks array)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      diffEnv({ payload: { filePath: 'x' } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('drops malformed hunk (bad lines array)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      diffEnv({
        payload: {
          filePath: 'x',
          hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 0 }],
        },
      }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('omits language when payload omits it', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      diffEnv({
        payload: {
          filePath: 'x',
          hunks: [
            {
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: 1,
              lines: [{ kind: 'add', text: 'h' }],
            },
          ],
        },
      }),
    );
    expect(
      (blocks[0] as Extract<ChatBlock, { kind: 'tool_diff' }>).language,
    ).toBeUndefined();
  });
});

// ── tool.search-hit ──────────────────────────────────────────────────

function searchEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:tool:tc-grep-1',
    parentToolCallId: 'tc-grep-1',
    kind: 'tool.search-hit',
    phase: 'delta',
    emittedAt: 1_700_000_000_500,
    seq: 1,
    payload: {
      query: 'foo',
      hits: [
        { filePath: 'a.ts', line: 10, snippet: 'foo()' },
        { filePath: 'b.ts', line: 5, column: 3, snippet: 'foo(bar)' },
      ],
      accumCount: 2,
    },
    asciiFallback: [],
    ...overrides,
  };
}

describe('applyFeedbackEnvelope · tool.search-hit', () => {
  test('pushes a new search-hits block with query + hits + accumCount', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, searchEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_search_hits' }>;
    expect(b.query).toBe('foo');
    expect(b.hits).toHaveLength(2);
    expect(b.accumCount).toBe(2);
    expect(b.parentToolCallId).toBe('tc-grep-1');
  });

  test('phase=delta appends new hits (dedupes on filePath:line:column)', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, searchEnv());
    applyFeedbackEnvelope(
      blocks,
      searchEnv({
        seq: 2,
        payload: {
          query: 'foo',
          hits: [
            { filePath: 'a.ts', line: 10, snippet: 'foo()' }, // dupe of first envelope
            { filePath: 'c.ts', line: 99, snippet: 'foo!()' }, // new
          ],
          accumCount: 3,
        },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_search_hits' }>;
    expect(b.hits).toHaveLength(3);
    expect(b.hits.map((h) => h.filePath)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(b.accumCount).toBe(3);
  });

  test('truncated flag preserved', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      searchEnv({
        payload: {
          query: 'x',
          hits: [{ filePath: 'a', line: 1, snippet: 'x' }],
          accumCount: 5000,
          truncated: true,
        },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_search_hits' }>;
    expect(b.truncated).toBe(true);
    expect(b.accumCount).toBe(5000);
    expect(b.hits).toHaveLength(1); // truncated server-side
  });

  test('preserves context lines per hit', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      searchEnv({
        payload: {
          query: 'q',
          hits: [
            {
              filePath: 'a.ts',
              line: 5,
              snippet: 'match',
              contextBefore: ['line 4'],
              contextAfter: ['line 6'],
            },
          ],
          accumCount: 1,
        },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_search_hits' }>;
    expect(b.hits[0]!.contextBefore).toEqual(['line 4']);
    expect(b.hits[0]!.contextAfter).toEqual(['line 6']);
  });

  test('drops malformed payload (missing accumCount)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      searchEnv({ payload: { query: 'x', hits: [] } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('drops malformed hit (missing line)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      searchEnv({
        payload: {
          query: 'x',
          hits: [{ filePath: 'a', snippet: 'foo' }],
          accumCount: 1,
        },
      }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });
});

// ── tool.progress ────────────────────────────────────────────────────

function progressEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:tool:tc-bash-1',
    parentToolCallId: 'tc-bash-1',
    kind: 'tool.progress',
    phase: 'start',
    emittedAt: 1_700_000_000_600,
    seq: 1,
    payload: { stream: 'stdout', lines: ['$ ls'] },
    asciiFallback: ['$ ls'],
    ...overrides,
  };
}

describe('applyFeedbackEnvelope · tool.progress', () => {
  test('phase=start creates a block with initial lines', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, progressEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    expect(b.stream).toBe('stdout');
    expect(b.lines).toEqual(['$ ls']);
    expect(b.done).toBe(false);
    expect(b.parentToolCallId).toBe('tc-bash-1');
  });

  test('phase=delta appends lines to existing block', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, progressEnv({ phase: 'start' }));
    applyFeedbackEnvelope(
      blocks,
      progressEnv({
        seq: 2,
        phase: 'delta',
        payload: { stream: 'stdout', lines: ['a.ts', 'b.ts'] },
      }),
    );
    applyFeedbackEnvelope(
      blocks,
      progressEnv({
        seq: 3,
        phase: 'delta',
        payload: { stream: 'stdout', lines: ['c.ts'] },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    expect(b.lines).toEqual(['$ ls', 'a.ts', 'b.ts', 'c.ts']);
    expect(b.done).toBe(false);
  });

  test('phase=end appends + flips done=true + records exitCode', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, progressEnv({ phase: 'start' }));
    applyFeedbackEnvelope(
      blocks,
      progressEnv({
        seq: 2,
        phase: 'end',
        payload: { stream: 'stdout', lines: ['done'], exitCode: 0 },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    expect(b.done).toBe(true);
    expect(b.exitCode).toBe(0);
    expect(b.lines).toEqual(['$ ls', 'done']);
  });

  test('phase=update replaces lines (server-side full snapshot)', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, progressEnv({ phase: 'start' }));
    applyFeedbackEnvelope(
      blocks,
      progressEnv({
        seq: 2,
        phase: 'update',
        payload: { stream: 'stdout', lines: ['fresh-snapshot'] },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    expect(b.lines).toEqual(['fresh-snapshot']);
  });

  test('different blockIds keep separate progress blocks', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, progressEnv({ blockId: 's:bash-A' }));
    applyFeedbackEnvelope(blocks, progressEnv({ blockId: 's:bash-B' }));
    expect(blocks).toHaveLength(2);
  });

  test('stderr stream is preserved (not coerced to stdout)', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      progressEnv({
        payload: { stream: 'stderr', lines: ['error: not found'] },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    expect(b.stream).toBe('stderr');
  });

  test('bytesSoFar surfaces when provided', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      progressEnv({
        payload: { stream: 'http', lines: ['HTTP/1.1 200 OK'], bytesSoFar: 4096 },
      }),
    );
    const b = blocks[0] as Extract<ChatBlock, { kind: 'tool_progress' }>;
    expect(b.bytesSoFar).toBe(4096);
    expect(b.stream).toBe('http');
  });

  test('drops malformed payload (missing stream field)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      progressEnv({ payload: { lines: ['x'] } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('drops malformed payload (invalid stream value)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      progressEnv({ payload: { stream: 'weird', lines: ['x'] } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('drops malformed payload (non-string line)', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(
      blocks,
      progressEnv({ payload: { stream: 'stdout', lines: [1, 2, 3] } }),
    );
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });
});

// ── unhandled kinds ──────────────────────────────────────────────────

// ── debug.line (M6 PR 1) ─────────────────────────────────────────────

function debugLineEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:debug:session',
    kind: 'debug.line',
    phase: 'delta',
    emittedAt: 1_700_000_000_500,
    seq: 1,
    payload: {
      category: 'chat.turn',
      event: 'begin',
      data: { who: 'user' },
      loggedAt: 1_700_000_000_499,
    },
    asciiFallback: ['[chat.turn] begin'],
    ...overrides,
  };
}

describe('applyFeedbackEnvelope · debug.line', () => {
  test('first envelope creates a debug_session block with one line', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, debugLineEnv());
    expect(r).toBe('applied');
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Extract<ChatBlock, { kind: 'debug_session' }>;
    expect(block.kind).toBe('debug_session');
    expect(block.blockId).toBe('s-1:debug:session');
    expect(block.lines).toHaveLength(1);
    expect(block.lines[0]).toEqual({
      seq: 1,
      category: 'chat.turn',
      event: 'begin',
      data: { who: 'user' },
      loggedAt: 1_700_000_000_499,
    });
  });

  test('subsequent envelopes append to the same block (blockId merge)', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, debugLineEnv({ seq: 1 }));
    applyFeedbackEnvelope(
      blocks,
      debugLineEnv({
        seq: 2,
        payload: {
          category: 'tool.spawn',
          event: 'rg-start',
          loggedAt: 1_700_000_000_600,
        },
      }),
    );
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Extract<ChatBlock, { kind: 'debug_session' }>;
    expect(block.lines).toHaveLength(2);
    expect(block.lines.map((l) => l.event)).toEqual(['begin', 'rg-start']);
    expect(block.lines.map((l) => l.seq)).toEqual([1, 2]);
  });

  test('different blockId creates a sibling block', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, debugLineEnv({ blockId: 's-A:debug:session' }));
    applyFeedbackEnvelope(blocks, debugLineEnv({ blockId: 's-B:debug:session' }));
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === 'debug_session')).toBe(true);
  });

  test('ring cap = 200 — overflow drops oldest', () => {
    const blocks: ChatBlock[] = [];
    for (let i = 0; i < 205; i++) {
      applyFeedbackEnvelope(
        blocks,
        debugLineEnv({
          seq: i + 1,
          payload: {
            category: 'chat.test',
            event: `e-${i}`,
            loggedAt: 1_700_000_000_000 + i,
          },
        }),
      );
    }
    const block = blocks[0] as Extract<ChatBlock, { kind: 'debug_session' }>;
    expect(block.lines).toHaveLength(200);
    // First 5 should have been dropped — oldest remaining is e-5.
    expect(block.lines[0]!.event).toBe('e-5');
    expect(block.lines[199]!.event).toBe('e-204');
  });

  test('malformed payload (missing required field) returns unhandled', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, {
      ...debugLineEnv(),
      payload: { category: 'chat.test', event: 'no-loggedAt' },
    });
    expect(r).toBe('unhandled');
    expect(blocks).toHaveLength(0);
  });

  test('data is omitted from line entry when payload.data absent', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      debugLineEnv({
        payload: {
          category: 'chat.test',
          event: 'no-data',
          loggedAt: 1_700_000_000_000,
        },
      }),
    );
    const block = blocks[0] as Extract<ChatBlock, { kind: 'debug_session' }>;
    expect(block.lines[0]!.data).toBeUndefined();
    expect('data' in block.lines[0]!).toBe(false);
  });
});

// ── perf.tick (Opportunistic followup §6.2 #6) ───────────────────────

function perfTickEnv(
  overrides: Partial<FeedbackEnvelopeWire> = {},
): FeedbackEnvelopeWire {
  return {
    envelopeVersion: 1,
    sessionId: 's-1',
    blockId: 's-1:perf:session',
    kind: 'perf.tick',
    phase: 'delta',
    emittedAt: 1_700_000_000_500,
    seq: 1,
    payload: { metric: 'llm.tokens-per-sec', value: 30, unit: 'tok/s' },
    asciiFallback: ['⎯ llm.tokens-per-sec 30 tok/s'],
    ...overrides,
  };
}

describe('applyFeedbackEnvelope · perf.tick', () => {
  test('first envelope creates a perf_session block with one sample', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, perfTickEnv());
    expect(r).toBe('applied');
    const block = blocks[0] as Extract<ChatBlock, { kind: 'perf_session' }>;
    expect(block.kind).toBe('perf_session');
    expect(block.samples).toHaveLength(1);
    expect(block.samples[0]).toEqual({
      seq: 1,
      metric: 'llm.tokens-per-sec',
      value: 30,
      unit: 'tok/s',
      emittedAt: 1_700_000_000_500,
    });
  });

  test('subsequent envelopes append to the same block — multi-metric interleave', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, perfTickEnv({ seq: 1 }));
    applyFeedbackEnvelope(
      blocks,
      perfTickEnv({
        seq: 2,
        payload: { metric: 'llm.cost-usd', value: 0.04, unit: 'USD' },
      }),
    );
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Extract<ChatBlock, { kind: 'perf_session' }>;
    expect(block.samples.map((s) => s.metric)).toEqual([
      'llm.tokens-per-sec',
      'llm.cost-usd',
    ]);
  });

  test('cap 60 — overflow drops oldest', () => {
    const blocks: ChatBlock[] = [];
    for (let i = 0; i < 65; i++) {
      applyFeedbackEnvelope(
        blocks,
        perfTickEnv({
          seq: i + 1,
          payload: { metric: 'llm.tokens-per-sec', value: i, unit: 'tok/s' },
        }),
      );
    }
    const block = blocks[0] as Extract<ChatBlock, { kind: 'perf_session' }>;
    expect(block.samples).toHaveLength(60);
    expect(block.samples[0]!.value).toBe(5);
    expect(block.samples[59]!.value).toBe(64);
  });

  test('malformed payload (missing value) returns unhandled', () => {
    const blocks: ChatBlock[] = [];
    const r = applyFeedbackEnvelope(blocks, {
      ...perfTickEnv(),
      payload: { metric: 'x' },
    });
    expect(r).toBe('unhandled');
    expect(blocks).toEqual([]);
  });

  test('omits unit field when payload.unit absent', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(
      blocks,
      perfTickEnv({ payload: { metric: 'llm.cost-usd', value: 0.1 } }),
    );
    const block = blocks[0] as Extract<ChatBlock, { kind: 'perf_session' }>;
    expect(block.samples[0]!.unit).toBeUndefined();
    expect('unit' in block.samples[0]!).toBe(false);
  });
});

// ── coexistence with existing blocks ─────────────────────────────────

describe('applyFeedbackEnvelope · coexists with existing blocks', () => {
  test('thinking block is appended after text + tool_use without disturbing them', () => {
    const blocks: ChatBlock[] = [
      { kind: 'text', text: 'partial reply' },
      { kind: 'tool_use', id: 'tc-1', name: 'read', status: 'running', args: {} },
    ];
    applyFeedbackEnvelope(blocks, thinkingEnv());
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.kind).toBe('text');
    expect(blocks[1]!.kind).toBe('tool_use');
    expect(blocks[2]!.kind).toBe('agent_thinking');
  });

  test('multiple envelope kinds interleave by blockId', () => {
    const blocks: ChatBlock[] = [];
    applyFeedbackEnvelope(blocks, thinkingEnv());
    applyFeedbackEnvelope(blocks, statusEnv());
    applyFeedbackEnvelope(blocks, planEnv());
    applyFeedbackEnvelope(blocks, thinkingEnv({ phase: 'end' })); // mutates in place
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.kind)).toEqual([
      'agent_thinking',
      'agent_status',
      'agent_plan',
    ]);
    expect(
      (blocks[0] as Extract<ChatBlock, { kind: 'agent_thinking' }>).done,
    ).toBe(true);
  });
});
