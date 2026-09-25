// src/autopilot/agent-loop.test.ts
//
// Bun test scaffold for AutopilotLoopDriver. Stubs an LlmTurnRunner
// (MB-1) to a duck-typed mock and asserts every termination kind +
// envelope timeline. Mirrors the manual smoke tests from #2741 / #2743
// / #2744 / #2745.

import { describe, test, expect } from 'bun:test';
import {
  AutopilotLoopDriver,
  runMissionOnce,
  extractShellCommand,
  resolveGuidanceText,
  DEFAULT_TERMINAL_AGENCY_GUIDANCE,
} from './agent-loop.js';
import type { LlmTurnRunner } from './runner.js';
import type { FeedbackEnvelope } from '../feedback/envelope.js';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

/** Minimal stub satisfying the LlmTurnRunner surface the driver uses. */
function makeStubRunner(opts: {
  /** Async chunks to feed onUpdate before resolving each prompt. */
  chunks?: (prompt: string) => SessionUpdate[];
  /** Override stopReason. Default 'end_turn'. */
  stopReason?: 'end_turn' | 'cancelled' | 'max_tokens';
  /** Sleep ms before resolving each prompt — useful for wallClock tests. */
  delayMs?: number;
  /** Track cancel() calls. */
  cancels?: number[];
}): LlmTurnRunner {
  const cancels = opts.cancels ?? [];
  return {
    async prompt(
      blocks,
      onUpdate,
    ) {
      const first = blocks[0] as { type?: string; text?: string } | undefined;
      const promptText =
        first?.type === 'text' && typeof first.text === 'string' ? first.text : '';
      const updates = opts.chunks
        ? opts.chunks(promptText)
        : [
            {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: `echo: ${promptText}` },
            } as unknown as SessionUpdate,
          ];
      for (const u of updates) onUpdate(u);
      if (opts.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return { stopReason: opts.stopReason ?? 'end_turn' };
    },
    async cancel(): Promise<void> {
      cancels.push(Date.now());
    },
  };
}

describe('AutopilotLoopDriver — basic flows', () => {
  test('single iteration · success (no follow-up hook)', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-1',
      mission: 'hi',
      maxIterations: 1,
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
    expect(r.iterations).toBe(1);
    expect(r.totalText).toBe('echo: hi');
  });

  test('multi-iteration · hook drives follow-up · success after null', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-2',
      mission: 'mission',
      maxIterations: 5,
      onIterationEnd: ({ iteration }) =>
        iteration < 3 ? `iter ${iteration + 1}` : null,
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
    expect(r.iterations).toBe(3);
  });
});

describe('AutopilotLoopDriver — budget', () => {
  test('iterations budget', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-3',
      mission: 'work',
      maxIterations: 2,
      onIterationEnd: () => 'keep going',
    });
    const r = await driver.run();
    if (r.termination.kind === 'budget') {
      expect(r.termination.budget).toBe('iterations');
      expect(r.termination.limit).toBe(2);
    } else {
      throw new Error(`expected budget, got ${r.termination.kind}`);
    }
  });

  test('outputChars budget', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-4',
      mission: 'work',
      maxIterations: 10,
      maxOutputChars: 15,
      onIterationEnd: () => 'continue',
    });
    const r = await driver.run();
    if (r.termination.kind === 'budget') {
      expect(r.termination.budget).toBe('outputChars');
      expect(r.termination.observed).toBeGreaterThan(15);
    } else {
      throw new Error(`expected budget, got ${r.termination.kind}`);
    }
  });

  test('wallClock budget', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({ delayMs: 40 }),
      sessionId: 'sid-5',
      mission: 'work',
      maxIterations: 10,
      maxWallClockMs: 60,
      onIterationEnd: () => 'continue',
    });
    const r = await driver.run();
    if (r.termination.kind === 'budget') {
      expect(r.termination.budget).toBe('wallClock');
    } else {
      throw new Error(`expected budget, got ${r.termination.kind}`);
    }
  });
});

describe('AutopilotLoopDriver — risky tool call', () => {
  test('high severity → termination=risky · cancel called', async () => {
    const cancels: number[] = [];
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({
        chunks: () => [
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-1',
            rawInput: { command: 'rm -rf /tmp/x' },
          } as unknown as SessionUpdate,
        ],
        cancels,
      }),
      sessionId: 'sid-6',
      mission: 'clean',
      maxIterations: 1,
    });
    const r = await driver.run();
    if (r.termination.kind === 'risky') {
      expect(r.termination.pattern.kind).toBe('rm-rf');
      expect(r.termination.pattern.severity).toBe('high');
    } else {
      throw new Error(`expected risky, got ${r.termination.kind}`);
    }
    expect(cancels.length).toBeGreaterThan(0);
  });

  test('medium severity · default policy allow → success', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({
        chunks: () => [
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-2',
            rawInput: { command: 'git reset --hard HEAD~1' },
          } as unknown as SessionUpdate,
        ],
      }),
      sessionId: 'sid-7',
      mission: 'revert',
      maxIterations: 1,
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
  });

  test('override policy → deny medium', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({
        chunks: () => [
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-3',
            rawInput: { command: 'git reset --hard' },
          } as unknown as SessionUpdate,
        ],
      }),
      sessionId: 'sid-8',
      mission: 'revert',
      maxIterations: 1,
      onRiskyToolCall: () => 'deny',
    });
    const r = await driver.run();
    if (r.termination.kind === 'risky') {
      expect(r.termination.pattern.kind).toBe('reset-hard');
    } else {
      throw new Error(`expected risky, got ${r.termination.kind}`);
    }
  });
});

describe('AutopilotLoopDriver — envelope emission', () => {
  test('emits start · update(s) · end on success', async () => {
    const envelopes: FeedbackEnvelope[] = [];
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-9',
      mission: 'mission text',
      maxIterations: 2,
      onEnvelope: (e) => envelopes.push(e),
      onIterationEnd: ({ iteration }) => (iteration < 2 ? `iter ${iteration + 1}` : null),
    });
    await driver.run();
    // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase A · 2026-05-20 —
    // emit set now includes agent.chat-stream alongside agent.status, so this
    // case must filter to status only when asserting the start/update/end shape.
    const statusEnvs = envelopes.filter((e) => e.kind === 'agent.status');
    expect(statusEnvs.length).toBeGreaterThanOrEqual(4); // start + 2 update + end
    expect(statusEnvs[0].phase).toBe('start');
    expect(statusEnvs.at(-1)?.phase).toBe('end');
    // every status envelope carries the right sessionId.
    for (const env of statusEnvs) {
      expect(env.sessionId).toBe('sid-9');
    }
  });

  test('end status maps to error for risky termination', async () => {
    const envelopes: FeedbackEnvelope[] = [];
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({
        chunks: () => [
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-r',
            rawInput: { command: 'sudo rm -rf /' },
          } as unknown as SessionUpdate,
        ],
      }),
      sessionId: 'sid-10',
      mission: 'risky test',
      maxIterations: 1,
      onEnvelope: (e) => envelopes.push(e),
    });
    await driver.run();
    // Filter to status envelopes — chat-stream done bubble may trail
    // after the agent.status end, so .at(-1) on the full list is wrong.
    const statusEnvs = envelopes.filter((e) => e.kind === 'agent.status');
    const last = statusEnvs.at(-1);
    expect(last?.phase).toBe('end');
    if (last && last.kind === 'agent.status') {
      expect(last.payload.status).toBe('error');
    } else {
      throw new Error('expected agent.status envelope at end');
    }
  });

  // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase A · 2026-05-20 —
  // chat-stream envelope (autopilot bidirectional bubble).
  test('emits agent.chat-stream bubble per iteration + done summary', async () => {
    const envelopes: FeedbackEnvelope[] = [];
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({
        chunks: (prompt) => [
          {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `thinking about ${prompt}` },
          } as unknown as SessionUpdate,
        ],
      }),
      sessionId: 'sid-chat',
      mission: 'chat-stream test',
      maxIterations: 2,
      onEnvelope: (e) => envelopes.push(e),
      onIterationEnd: ({ iteration }) => (iteration < 2 ? 'iter 2' : null),
    });
    await driver.run();
    const chatEnvs = envelopes.filter((e) => e.kind === 'agent.chat-stream');
    // 2 iterations (announce each — stopReason='end_turn' default) + 1 done.
    expect(chatEnvs.length).toBe(3);
    // Iteration bubbles: blockId 가 iter 별 다름.
    expect(chatEnvs[0].blockId).toBe('autopilot:sid-chat:chat:1');
    expect(chatEnvs[1].blockId).toBe('autopilot:sid-chat:chat:2');
    // Final done envelope · phase='end' · role='done'.
    const done = chatEnvs.at(-1);
    if (done && done.kind === 'agent.chat-stream') {
      expect(done.phase).toBe('end');
      expect(done.payload.role).toBe('done');
      expect(done.payload.text).toContain('done');
    } else {
      throw new Error('expected final agent.chat-stream done envelope');
    }
    // Iteration bubble text 가 LLM 의 reasoning 을 carry · role='announce'
    // (stub stopReason='end_turn' default).
    const iter1 = chatEnvs[0];
    if (iter1 && iter1.kind === 'agent.chat-stream') {
      expect(iter1.payload.text).toContain('thinking about');
      expect(iter1.payload.role).toBe('announce');
      expect(iter1.payload.iteration).toBe(1);
    }
  });

  test('chat-stream short-circuits on empty iterationText (tool-only turn)', async () => {
    const envelopes: FeedbackEnvelope[] = [];
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({
        chunks: () => [
          // Tool-only turn — no agent_message_chunk text.
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'tc-1',
            rawInput: { command: 'echo hi' },
          } as unknown as SessionUpdate,
        ],
      }),
      sessionId: 'sid-tool-only',
      mission: 'tool-only test',
      maxIterations: 1,
      onEnvelope: (e) => envelopes.push(e),
    });
    await driver.run();
    // No per-iteration chat-stream emit (empty iterationText) · but the
    // termination done envelope still fires from finalize().
    const chatEnvs = envelopes.filter((e) => e.kind === 'agent.chat-stream');
    expect(chatEnvs.length).toBe(1);
    if (chatEnvs[0]?.kind === 'agent.chat-stream') {
      expect(chatEnvs[0].payload.role).toBe('done');
    }
  });

  test('no onEnvelope sink — no crash · zero emit', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-11',
      mission: 'silent',
      maxIterations: 1,
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
  });
});

describe('AutopilotLoopDriver — Phase B injection queue', () => {
  // PLAN-autopilot-terminal-driving-2026-05-20 v2 Phase B · 2026-05-20 —
  // mid-mission user instruction injection queue · driver drains at iter-start.

  test('drains queued instruction → prepends marker to next prompt', async () => {
    const seenPrompts: string[] = [];
    const pending: string[] = ['use dryRun please'];
    const driver = new AutopilotLoopDriver({
      runner: {
        async prompt(blocks, _onUpdate) {
          const first = blocks[0] as { type?: string; text?: string };
          seenPrompts.push(first?.text ?? '');
          return { stopReason: 'end_turn' };
        },
        async cancel(): Promise<void> { /* no-op */ },
      },
      sessionId: 'sid-inject-1',
      mission: 'main mission text',
      maxIterations: 1,
      injectionQueue: {
        drain: () => {
          if (pending.length === 0) return [];
          const out = pending.slice();
          pending.length = 0;
          return out;
        },
      },
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
    expect(seenPrompts.length).toBe(1);
    expect(seenPrompts[0]).toContain('[user injected mid-mission: "use dryRun please"]');
    expect(seenPrompts[0]).toContain('main mission text');
    // Order — marker must come BEFORE mission so the LLM reads context first.
    expect(seenPrompts[0]!.indexOf('user injected')).toBeLessThan(seenPrompts[0]!.indexOf('main mission'));
  });

  test('empty drain — prompt unchanged · no marker', async () => {
    const seenPrompts: string[] = [];
    const driver = new AutopilotLoopDriver({
      runner: {
        async prompt(blocks, _onUpdate) {
          const first = blocks[0] as { type?: string; text?: string };
          seenPrompts.push(first?.text ?? '');
          return { stopReason: 'end_turn' };
        },
        async cancel(): Promise<void> { /* no-op */ },
      },
      sessionId: 'sid-inject-2',
      mission: 'main mission only',
      maxIterations: 1,
      injectionQueue: { drain: () => [] },
    });
    await driver.run();
    expect(seenPrompts[0]).not.toContain('user injected');
    expect(seenPrompts[0]).toBe('main mission only');
  });

  test('multi-line instruction — newlines flattened in marker', async () => {
    const seenPrompts: string[] = [];
    const driver = new AutopilotLoopDriver({
      runner: {
        async prompt(blocks, _onUpdate) {
          const first = blocks[0] as { type?: string; text?: string };
          seenPrompts.push(first?.text ?? '');
          return { stopReason: 'end_turn' };
        },
        async cancel(): Promise<void> { /* no-op */ },
      },
      sessionId: 'sid-inject-3',
      mission: 'm',
      maxIterations: 1,
      injectionQueue: { drain: () => ['line1\nline2\nline3'] },
    });
    await driver.run();
    expect(seenPrompts[0]).toContain('[user injected mid-mission: "line1 line2 line3"]');
  });

  test('drain failure swallowed — loop continues with unmodified prompt', async () => {
    const seenPrompts: string[] = [];
    const driver = new AutopilotLoopDriver({
      runner: {
        async prompt(blocks, _onUpdate) {
          const first = blocks[0] as { type?: string; text?: string };
          seenPrompts.push(first?.text ?? '');
          return { stopReason: 'end_turn' };
        },
        async cancel(): Promise<void> { /* no-op */ },
      },
      sessionId: 'sid-inject-4',
      mission: 'safe mission',
      maxIterations: 1,
      injectionQueue: { drain: () => { throw new Error('queue boom'); } },
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
    expect(seenPrompts[0]).toBe('safe mission');
  });
});

describe('AutopilotLoopDriver — cancellation', () => {
  test('AbortSignal aborts mid-loop → cancelled', async () => {
    const controller = new AbortController();
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({ delayMs: 50 }),
      sessionId: 'sid-12',
      mission: 'long',
      maxIterations: 5,
      signal: controller.signal,
      onIterationEnd: () => 'go',
    });
    // Abort shortly after start.
    setTimeout(() => controller.abort(), 20);
    const r = await driver.run();
    expect(r.termination.kind).toBe('cancelled');
  });
});

describe('runMissionOnce convenience', () => {
  test('single-shot wrapper', async () => {
    const r = await runMissionOnce(makeStubRunner({}), 'sid-13', 'hi');
    expect(r.termination.kind).toBe('success');
    expect(r.iterations).toBe(1);
  });
});

describe('resolveGuidanceText (G4)', () => {
  test('undefined → default', () => {
    expect(resolveGuidanceText(undefined)).toBe(DEFAULT_TERMINAL_AGENCY_GUIDANCE);
  });
  test('true → default', () => {
    expect(resolveGuidanceText(true)).toBe(DEFAULT_TERMINAL_AGENCY_GUIDANCE);
  });
  test('false → empty', () => {
    expect(resolveGuidanceText(false)).toBe('');
  });
  test('custom string → as-is', () => {
    expect(resolveGuidanceText('custom guidance')).toBe('custom guidance');
  });
  test('default guidance covers control codes + SGR mouse', () => {
    const g = DEFAULT_TERMINAL_AGENCY_GUIDANCE;
    // keyboard control codes
    expect(g).toContain('Ctrl-C');
    expect(g).toContain('Ctrl-L');
    expect(g).toContain('PgUp');
    // editor/multiplexer idioms
    expect(g).toContain('vim/nvim');
    expect(g).toContain('tmux');
    expect(g).toContain('git rebase -i');
    // SGR mouse encoding
    expect(g.toLowerCase()).toContain('sgr mouse');
    expect(g).toContain('1006');
    expect(g).toContain('scroll-up');
    // safety rail mention
    expect(g.toLowerCase()).toContain('rm -rf');
  });
});

describe('extractShellCommand (G2)', () => {
  test('rawInput.command + bash toolName', () => {
    const cmd = extractShellCommand({
      sessionUpdate: 'tool_call',
      toolName: 'Bash',
      rawInput: { command: 'ls -la' },
    });
    expect(cmd).toBe('ls -la');
  });

  test('toolUseBlock.input.command (Anthropic SDK shape)', () => {
    const cmd = extractShellCommand({
      sessionUpdate: 'tool_call',
      toolName: 'shell',
      toolUseBlock: { input: { command: 'git status' } },
    });
    expect(cmd).toBe('git status');
  });

  test('non-shell toolName + command present → null', () => {
    const cmd = extractShellCommand({
      sessionUpdate: 'tool_call',
      toolName: 'Read',
      rawInput: { command: 'cat foo' },
    });
    expect(cmd).toBeNull();
  });

  test('shell toolName but no command → null', () => {
    const cmd = extractShellCommand({
      sessionUpdate: 'tool_call',
      toolName: 'Bash',
      rawInput: {},
    });
    expect(cmd).toBeNull();
  });

  test('non-object → null', () => {
    expect(extractShellCommand(null)).toBeNull();
    expect(extractShellCommand(undefined)).toBeNull();
    expect(extractShellCommand('string')).toBeNull();
  });
});

describe('AutopilotLoopDriver — plan-driven iteration (D1.4a)', () => {
  test('3-step plan drives iter 2/3 prompts · emits agent.plan envelopes', async () => {
    const promptsSeen: string[] = [];
    const planEnvelopes: FeedbackEnvelope[] = [];
    const runner: LlmTurnRunner = {
      async prompt(blocks, onUpdate) {
        const first = blocks[0] as { type?: string; text?: string } | undefined;
        const text = first?.text ?? '';
        promptsSeen.push(text);
        onUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `did: ${text}` },
        } as unknown as SessionUpdate);
        return { stopReason: 'end_turn' as const };
      },
      async cancel(): Promise<void> {},
    };

    const driver = new AutopilotLoopDriver({
      runner,
      sessionId: 'sid-plan-1',
      mission: 'start mission',
      maxIterations: 10,
      plan: {
        ref: 'plan-1',
        steps: [
          { id: 's1', text: 'first step' },
          { id: 's2', text: 'second step' },
          { id: 's3', text: 'third step' },
        ],
      },
      onEnvelope: (e) => {
        if (e.kind === 'agent.plan') planEnvelopes.push(e);
      },
    });

    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
    // iter 1 = mission (per spec) · iter 2 = step[1] · iter 3 = step[2]
    expect(promptsSeen[0]).toBe('start mission');
    expect(promptsSeen[1]).toBe('second step');
    expect(promptsSeen[2]).toBe('third step');
    // plan envelopes: start + 3 step updates + end (at least 5)
    expect(planEnvelopes.length).toBeGreaterThanOrEqual(5);
    expect(planEnvelopes[0].phase).toBe('start');
    expect(planEnvelopes.at(-1)?.phase).toBe('end');
  });

  test('plan exhaustion terminates with reason "plan complete"', async () => {
    const runner = makeStubRunner({});
    const driver = new AutopilotLoopDriver({
      runner,
      sessionId: 'sid-plan-2',
      mission: 'go',
      maxIterations: 20,
      plan: {
        ref: 'plan-short',
        steps: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
    });
    const r = await driver.run();
    if (r.termination.kind === 'success') {
      expect(r.termination.reason).toBe('plan complete');
    } else {
      throw new Error(`expected success, got ${r.termination.kind}`);
    }
  });

  test('onIterationEnd is observed for telemetry but return is ignored', async () => {
    const hookCalls: number[] = [];
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-plan-3',
      mission: 'go',
      maxIterations: 10,
      plan: { ref: 'p', steps: [{ id: '1', text: 'step1' }, { id: '2', text: 'step2' }] },
      onIterationEnd: ({ iteration }) => {
        hookCalls.push(iteration);
        return 'IGNORED_FOLLOWUP';
      },
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
    // Hook was called for both iterations (telemetry path).
    expect(hookCalls).toEqual([1, 2]);
  });

  test('empty plan steps falls back to non-plan flow', async () => {
    const driver = new AutopilotLoopDriver({
      runner: makeStubRunner({}),
      sessionId: 'sid-plan-4',
      mission: 'hi',
      maxIterations: 1,
      plan: { ref: 'empty', steps: [] },
    });
    const r = await driver.run();
    expect(r.termination.kind).toBe('success');
  });
});
