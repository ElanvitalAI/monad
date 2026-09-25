import { describe, expect, it } from 'bun:test';

import { runDaemonPromptSubmit } from '../src/boot/daemon-prompt-submit-runtime.js';
import type { TurnSubmit } from '../src/input/turn-submit.js';

describe('runDaemonPromptSubmit', () => {
  it('rejects non-daemon targets', async () => {
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: { kind: 'keyboard' as const },
        text: 'hello',
        route: 'plain' as const,
      },
      source: { kind: 'keyboard' as const },
      text: 'hello',
      target: { kind: 'plain' as const },
    } satisfies TurnSubmit;
    await expect(
      runDaemonPromptSubmit({
        submit,
        runDaemonPrompt: async () => ({ sessionId: 'x', text: 'ok', stopReason: 'end_turn' }),
      }),
    ).rejects.toThrow('daemon prompt runtime requires daemon-prompt submit');
  });

  it('runs daemon-prompt submits through the provided executor', async () => {
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: { kind: 'daemon-api' as const, route: '/v1/prompt' },
        text: 'hello',
        route: 'daemon-prompt' as const,
      },
      source: { kind: 'daemon-api' as const, route: '/v1/prompt' },
      text: 'hello',
      target: { kind: 'daemon-prompt' as const },
    } satisfies TurnSubmit;
    const result = await runDaemonPromptSubmit({
      submit,
      runDaemonPrompt: async () => ({ sessionId: 'sess-1', text: 'ok', stopReason: 'end_turn' }),
    });
    expect(result).toEqual({
      sessionId: 'sess-1',
      text: 'ok',
      stopReason: 'end_turn',
    });
  });

  it('runs beforeExecute before the daemon prompt executor', async () => {
    const calls: string[] = [];
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: { kind: 'daemon-api' as const, route: '/v1/prompt' },
        text: 'hello',
        route: 'daemon-prompt' as const,
      },
      source: { kind: 'daemon-api' as const, route: '/v1/prompt' },
      text: 'hello',
      target: { kind: 'daemon-prompt' as const },
    } satisfies TurnSubmit;
    await runDaemonPromptSubmit({
      submit,
      beforeExecute: (next) => {
        calls.push(`before:${next.target.kind}:${next.source.kind}`);
      },
      runDaemonPrompt: async (next) => {
        calls.push(`run:${next.text}`);
        return { sessionId: 'sess-1', text: 'ok', stopReason: 'end_turn' };
      },
    });

    expect(calls).toEqual([
      'before:daemon-prompt:daemon-api',
      'run:hello',
    ]);
  });
});
