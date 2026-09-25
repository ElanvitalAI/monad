// WT-A-3b — `:agent` dispatcher case + runner unit tests.
//
// Two narrowly-scoped contracts:
//   1. `dispatchMetaCommand(":agent <prompt>", ...)` returns `consumed:true`,
//      sync placeholder text, and `agentRequest:{prompt}` so the ACP
//      handler can pick up the heavy lift.
//   2. `createAgentTurnRunner(...)` formats the user text via
//      `formatAgentPrompt`, threads the right tool surface +
//      sessionId, and packages the assistant text + provider label
//      back to the caller.
//
// We don't drive the full ACP wire here — that's covered by the
// dispatcher unit (verifies the marker that triggers the handler) and
// the runner unit (verifies what happens once the handler routes
// through). Together they pin both ends of the contract.

import { describe, expect, test, spyOn } from 'bun:test';
import { dispatchMetaCommand } from '../src/repl/dispatch-meta';
import { createAgentTurnRunner } from '../src/repl/agent-turn';
import { DaemonSessionHistory } from '../src/boot/daemon-runtime';
import * as promptTurnModule from '../src/boot/daemon-prompt-turn';

describe(':agent dispatcher case', () => {
  test('with prompt — consumed=true + agentRequest carries prompt', () => {
    const result = dispatchMetaCommand(':agent what is in this dir?', {
      cfg: { rotation: { entries: [], activeIdx: 0 } } as never,
      sessionId: 'sess-1',
      surface: 'web-term',
      terminalId: 'tid-1',
    });
    expect(result.consumed).toBe(true);
    expect(result.agentRequest?.prompt).toBe('what is in this dir?');
    // Synchronous placeholder echo — ACP handler replaces it once the
    // LLM turn finishes.
    expect(result.output).toContain(':agent — running');
  });

  test('without prompt — chat mode error, no agentRequest', () => {
    const result = dispatchMetaCommand(':agent', {
      cfg: { rotation: { entries: [], activeIdx: 0 } } as never,
      sessionId: 'sess-1',
      surface: 'web-term',
      terminalId: 'tid-1',
    });
    expect(result.consumed).toBe(true);
    expect(result.agentRequest).toBeUndefined();
    expect(result.output.toLowerCase()).toContain('chat mode');
  });

  test('multi-word prompts join on whitespace', () => {
    const result = dispatchMetaCommand(':agent  hello   there  friend', {
      cfg: { rotation: { entries: [], activeIdx: 0 } } as never,
      sessionId: 'sess-1',
      surface: 'web-term',
      terminalId: 'tid-1',
    });
    expect(result.agentRequest?.prompt).toBe('hello there friend');
  });
});

describe('createAgentTurnRunner', () => {
  test('formats prompt with terminal context + threads sessionId', async () => {
    const history = new DaemonSessionHistory();
    const runnerSpy = spyOn(promptTurnModule, 'runDaemonPromptTurn').mockImplementation(
      async (opts) => ({
        sessionId: opts.request.sessionId,
        text: '## Files\n\n- a.txt\n- b.txt',
        stopReason: 'end_turn',
      }),
    );
    try {
      const runner = createAgentTurnRunner({
        history,
        collectContext: (sid, tid) => ({
          bufferText: `$ ls\nfile.txt\nREADME.md`,
          cwd: '/home/x',
          cols: 80,
          rows: 24,
          bufferLines: 3,
        }),
      });
      const result = await runner({
        sessionId: 'sess-42',
        terminalId: 'tid-5',
        prompt: 'list files',
      });
      expect(result.markdown).toContain('## Files');
      expect(result.stopReason).toBe('end_turn');
      expect(result.contextLines).toBe(3);
      // Provider label always present (falls back to '?/?' when no
      // active rotation entry — fine; we just assert the shape).
      expect(result.modelLabel).toMatch(/.+\/.+/);

      expect(runnerSpy).toHaveBeenCalledTimes(1);
      const call = runnerSpy.mock.calls[0]![0];
      expect(call.request.sessionId).toBe('sess-42');
      // user text bundles the buffer + cwd + dimensions and ends with
      // the operator's prompt.
      expect(call.request.userText).toContain('<terminal-buffer>');
      expect(call.request.userText).toContain('cwd: /home/x');
      expect(call.request.userText).toContain('size: 80×24');
      expect(call.request.userText.endsWith('list files')).toBe(true);
      // Source must record this as a terminal-driven turn.
      expect(call.request.source).toEqual({
        kind: 'terminal',
        provider: 'tui',
        sessionId: 'tid-5',
      });
    } finally {
      runnerSpy.mockRestore();
    }
  });

  test('passes through tool surface + tool cwd to underlying runner', async () => {
    const history = new DaemonSessionHistory();
    const fakeSurface = {
      kind: 'webterm' as const,
      specs: [],
      dispatch: async () => ({}),
    };
    const runnerSpy = spyOn(promptTurnModule, 'runDaemonPromptTurn').mockImplementation(
      async (opts) => ({
        sessionId: opts.request.sessionId,
        text: 'ok',
        stopReason: 'end_turn',
      }),
    );
    try {
      const runner = createAgentTurnRunner({
        history,
        toolSurface: fakeSurface as never,
        toolCwd: '/tmp/repo',
        collectContext: () => ({
          bufferText: '',
          cwd: '',
          cols: 0,
          rows: 0,
          bufferLines: 0,
        }),
      });
      await runner({ sessionId: 'sess-1', terminalId: 'tid-1', prompt: 'hi' });
      const call = runnerSpy.mock.calls[0]![0];
      expect(call.toolSurface).toBe(fakeSurface as never);
      expect(call.toolCwd).toBe('/tmp/repo');
    } finally {
      runnerSpy.mockRestore();
    }
  });
});
