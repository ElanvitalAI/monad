// WT-A-3b Phase 2 — `:agent` chat mode dispatch unit tests.
//
// Verifies the dispatcher's contract for chat mode entry + exit so the
// PWA TerminalRepl client can rely on `agentChatModeEnter` /
// `exitRequested` markers to drive its state machine.

import { describe, expect, test } from 'bun:test';
import { dispatchMetaCommand } from '../src/repl/dispatch-meta';

const baseCtx = {
  cfg: { rotation: { entries: [], activeIdx: 0 } } as never,
  sessionId: 'sess-1',
  surface: 'web-term' as const,
  terminalId: 'tid-1',
};

describe(':agent chat mode entry', () => {
  test('`:agent` (no args) returns agentChatModeEnter:true', () => {
    const result = dispatchMetaCommand(':agent', baseCtx);
    expect(result.consumed).toBe(true);
    expect(result.agentChatModeEnter).toBe(true);
    expect(result.agentRequest).toBeUndefined();
    expect(result.output).toContain('agent chat mode');
  });

  test('`:agent <prompt>` does NOT enter chat mode', () => {
    const result = dispatchMetaCommand(':agent quick question', baseCtx);
    expect(result.agentChatModeEnter).toBeUndefined();
    expect(result.agentRequest?.prompt).toBe('quick question');
  });
});

describe(':exit returns exitRequested', () => {
  test('`:exit` carries the marker the chat-mode client reads', () => {
    const result = dispatchMetaCommand(':exit', baseCtx);
    expect(result.consumed).toBe(true);
    expect(result.exitRequested).toBe(true);
  });

  test('`:quit` and `:q` are aliases', () => {
    expect(dispatchMetaCommand(':quit', baseCtx).exitRequested).toBe(true);
    expect(dispatchMetaCommand(':q', baseCtx).exitRequested).toBe(true);
  });
});

describe(':agent input handling edge cases', () => {
  test('whitespace-only args treated as no-args (chat mode)', () => {
    const result = dispatchMetaCommand(':agent   ', baseCtx);
    expect(result.agentChatModeEnter).toBe(true);
  });

  test(':agent inside chat mode — handler is the same; client wraps non-: lines with `:agent ` before sending', () => {
    // The dispatcher itself is stateless wrt chat mode — it just sees
    // `:agent <prompt>` either way. The client (PWA TerminalRepl) is
    // the state holder. This test pins that the dispatcher stays
    // mode-agnostic.
    const r1 = dispatchMetaCommand(':agent hello', baseCtx);
    const r2 = dispatchMetaCommand(':agent hello', baseCtx);
    expect(r1.agentRequest?.prompt).toBe(r2.agentRequest?.prompt);
  });
});
