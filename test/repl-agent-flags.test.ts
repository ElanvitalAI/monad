// WT-A-3b Phase 3 — `:agent` flag parsing + scrollback cap.
//
// Two contracts:
//   1. `dispatchMetaCommand(":agent --scroll N <prompt>", ...)`
//      threads scrollLines into agentRequest, drops the flag from the
//      prompt body, and rejects non-positive values.
//   2. `collectAgentContext(..., { maxLines })` truncates the buffer
//      to the trailing N lines so users can keep prompt cost
//      predictable on long-running TUIs.

import { describe, expect, test } from 'bun:test';
import { dispatchMetaCommand } from '../src/repl/dispatch-meta';
import { collectAgentContext } from '../src/repl/agent-context-bundle';

const baseCtx = {
  cfg: { rotation: { entries: [], activeIdx: 0 } } as never,
  sessionId: 'sess-1',
  surface: 'web-term' as const,
  terminalId: 'tid-1',
};

describe(':agent --scroll flag', () => {
  test('parses --scroll N + drops it from the prompt', () => {
    const r = dispatchMetaCommand(':agent --scroll 50 list files', baseCtx);
    expect(r.agentRequest?.prompt).toBe('list files');
    expect(r.agentRequest?.scrollLines).toBe(50);
    expect(r.output).toContain('scroll=50');
  });

  test('--scroll without prompt body falls into chat mode', () => {
    const r = dispatchMetaCommand(':agent --scroll 100', baseCtx);
    expect(r.agentChatModeEnter).toBe(true);
    expect(r.agentRequest).toBeUndefined();
  });

  test('--scroll non-integer rejected', () => {
    const r = dispatchMetaCommand(':agent --scroll abc hello', baseCtx);
    expect(r.consumed).toBe(true);
    expect(r.agentRequest).toBeUndefined();
    expect(r.output).toContain('positive integer');
  });

  test('--scroll 0 rejected (must be > 0)', () => {
    const r = dispatchMetaCommand(':agent --scroll 0 hello', baseCtx);
    expect(r.agentRequest).toBeUndefined();
    expect(r.output).toContain('positive integer');
  });
});

describe(':agent --chat flag', () => {
  test('--chat alone enters chat mode', () => {
    const r = dispatchMetaCommand(':agent --chat', baseCtx);
    expect(r.agentChatModeEnter).toBe(true);
  });

  test('--chat with prompt still enters chat mode (explicit override)', () => {
    const r = dispatchMetaCommand(':agent --chat ignored body', baseCtx);
    expect(r.agentChatModeEnter).toBe(true);
    // Prompt body discarded — explicit chat mode wins.
    expect(r.agentRequest).toBeUndefined();
  });
});

describe('collectAgentContext maxLines', () => {
  function fakePt(lines: string[]): unknown {
    return {
      cols: 80,
      rows: 24,
      opts: { cwd: '/x' },
      renderForLLM: () => lines.join('\n'),
    };
  }

  test('keeps only the trailing N lines when maxLines < total', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const ctx = collectAgentContext('sid', 'tid', () => fakePt(lines) as never, {
      maxLines: 5,
    });
    expect(ctx.bufferLines).toBe(5);
    expect(ctx.bufferText).toBe('line 196\nline 197\nline 198\nline 199\nline 200');
  });

  test('returns full buffer when total <= maxLines', () => {
    const lines = ['a', 'b', 'c'];
    const ctx = collectAgentContext('sid', 'tid', () => fakePt(lines) as never, {
      maxLines: 100,
    });
    expect(ctx.bufferLines).toBe(3);
    expect(ctx.bufferText).toBe('a\nb\nc');
  });

  test('omitting maxLines preserves the existing behavior (full buffer)', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`);
    const ctx = collectAgentContext('sid', 'tid', () => fakePt(lines) as never);
    expect(ctx.bufferLines).toBe(50);
  });
});
