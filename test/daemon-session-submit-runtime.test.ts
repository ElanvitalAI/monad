import { describe, expect, it } from 'bun:test';

import { runDaemonSessionTurnSubmit } from '../src/tui-client/daemon-session-submit-runtime.js';
import { debug, type DebugEvent } from '../src/debug/log.js';
import type { TurnSubmit } from '../src/input/turn-submit.js';

describe('runDaemonSessionTurnSubmit', () => {
  it('rejects non-daemon-session targets', async () => {
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
      runDaemonSessionTurnSubmit({
        submit,
        session: {
          send: async () => ({ stopReason: 'end_turn' }),
        } as never,
      }),
    ).rejects.toThrow('daemon session runtime requires daemon-session submit');
  });

  it('writes the daemon session id to input.submit lifecycle records', async () => {
    const events: DebugEvent[] = [];
    const wasFileEnabled = debug.status().file;
    debug.setFileEnabled(true);
    debug.setDiagEnabled(true);
    const unregister = debug.registerSink({ emit: (event) => events.push(event) });
    try {
      await runDaemonSessionTurnSubmit({
        submit: {
          intent: { kind: 'submit-turn', source: { kind: 'keyboard' }, text: 'hello', route: 'daemon-session' },
          source: { kind: 'keyboard' },
          text: 'hello',
          target: { kind: 'daemon-session' },
        } satisfies TurnSubmit,
        session: { id: 'session-input-submit', send: async () => ({ stopReason: 'end_turn' }) } as never,
      });
    } finally {
      unregister();
      debug.setDiagEnabled(false);
      debug.setFileEnabled(wasFileEnabled);
    }
    expect(events.filter((event) => event.category === 'input.submit')).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'daemon-session.begin', session_id: 'session-input-submit' }),
      expect.objectContaining({ event: 'daemon-session.ok', session_id: 'session-input-submit' }),
    ]));
  });

  it('sends text and source metadata through the dashboard session', async () => {
    let captured!: Record<string, unknown>;
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: {
          kind: 'discord' as const,
          family: 'communication' as const,
          provider: 'discord' as const,
          channelId: 'c1',
          entry: 'text' as const,
          relay: 'native-bot' as const,
        },
        text: 'hello',
        route: 'daemon-session' as const,
      },
      source: {
        kind: 'discord' as const,
        family: 'communication' as const,
        provider: 'discord' as const,
        channelId: 'c1',
        entry: 'text' as const,
        relay: 'native-bot' as const,
      },
      text: 'hello',
      target: { kind: 'daemon-session' as const },
    } satisfies TurnSubmit;
    const result = await runDaemonSessionTurnSubmit({
      submit,
      session: {
        send: async (req: Record<string, unknown>) => {
          captured = req;
          return { stopReason: 'end_turn' };
        },
      } as never,
    });
    expect(result).toEqual({ stopReason: 'end_turn' });
    expect(captured).toMatchObject({
      userText: 'hello',
    });
    expect((captured.meta as Record<string, unknown>).input_source).toEqual({
      kind: 'discord',
      family: 'communication',
      provider: 'discord',
      channelId: 'c1',
      entry: 'text',
      relay: 'native-bot',
    });
  });

  it('runs beforeExecute before sending the daemon session submit', async () => {
    const calls: string[] = [];
    const submit = {
      intent: {
        kind: 'submit-turn',
        source: {
          kind: 'discord' as const,
          family: 'communication' as const,
          provider: 'discord' as const,
          channelId: 'c1',
          entry: 'text' as const,
          relay: 'native-bot' as const,
        },
        text: 'hello',
        route: 'daemon-session' as const,
      },
      source: {
        kind: 'discord' as const,
        family: 'communication' as const,
        provider: 'discord' as const,
        channelId: 'c1',
        entry: 'text' as const,
        relay: 'native-bot' as const,
      },
      text: 'hello',
      target: { kind: 'daemon-session' as const },
    } satisfies TurnSubmit;
    await runDaemonSessionTurnSubmit({
      submit,
      beforeExecute: (next) => {
        calls.push(`before:${next.target.kind}:${next.source.kind}`);
      },
      session: {
        send: async () => {
          calls.push('send');
          return { stopReason: 'end_turn' };
        },
      } as never,
    });

    expect(calls).toEqual([
      'before:daemon-session:discord',
      'send',
    ]);
  });
});
