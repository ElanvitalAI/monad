import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { DaemonSessionHistory } from './daemon-runtime.js';
import { runDaemonPromptTurn } from './daemon-prompt-turn.js';
import * as coreTurnModule from '../core-turn/index.js';
import { debug } from '../debug/log.js';
import { surfaceUxFromDispatchCtx } from '../agent/surface-ux/build.js';
import type { ConfirmChannel } from '../hitl/confirm.js';
import type { DaemonToolDispatchCtx, DaemonToolSurface } from './daemon-tools/types.js';

afterEach(() => {
  spyOn(coreTurnModule, 'runCoreTurn').mockRestore();
  spyOn(debug, 'log').mockRestore();
});

describe('runDaemonPromptTurn surface dispatch context', () => {
  test('forwards Android surface and original Korean user text to every daemon tool', async () => {
    let dispatch: ((name: string, args: Record<string, unknown>, ctx?: { callId: string }) => Promise<unknown>) | undefined;
    const runCoreTurn = spyOn(coreTurnModule, 'runCoreTurn').mockImplementation(async (ctx) => {
      dispatch = ctx.dispatchTool;
      return { stopReason: 'end_turn', finalText: 'done' };
    });
    const received: DaemonToolDispatchCtx[] = [];
    const toolSurface: DaemonToolSurface = {
      kind: 'chat',
      specs: [],
      async dispatch(_name, _args, ctx) {
        received.push(ctx);
        return { ok: true };
      },
    };

    await runDaemonPromptTurn({
      history: new DaemonSessionHistory(),
      request: {
        sessionId: 'android-turn',
        userText: '하니스로 구현해줘',
        userContent: null,
        source: { kind: 'native', platform: 'android' },
        effectiveSystemPrompt: undefined,
        tools: null,
      },
      toolSurface,
      toolCwd: process.cwd(),
      surface: 'android',
      surfaceResolutionReason: 'resolved',
      dispatchToolErrorMessage: 'unused',
    });
    await dispatch!('SelfImplement', {}, { callId: 'call-android' });

    expect(runCoreTurn).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      surface: 'android',
      userText: '하니스로 구현해줘',
      toolCallId: 'call-android',
    });
  });

  test('attaches provided HITL channels so SurfaceUx is interactive and omits them otherwise', async () => {
    let dispatch: ((name: string, args: Record<string, unknown>, ctx?: { callId: string }) => Promise<unknown>) | undefined;
    spyOn(coreTurnModule, 'runCoreTurn').mockImplementation(async (ctx) => {
      dispatch = ctx.dispatchTool;
      return { stopReason: 'end_turn', finalText: 'done' };
    });
    const received: DaemonToolDispatchCtx[] = [];
    const toolSurface: DaemonToolSurface = {
      kind: 'chat',
      specs: [],
      async dispatch(_name, _args, ctx) {
        received.push(ctx);
        return { ok: true };
      },
    };
    const channel: ConfirmChannel = { name: 'test', request: async () => false, cancel: () => {} };
    const request = {
      sessionId: 'hitl-turn', userText: 'ask me', userContent: null,
      source: null, effectiveSystemPrompt: undefined, tools: null,
    };

    await runDaemonPromptTurn({
      history: new DaemonSessionHistory(), request, toolSurface, toolCwd: process.cwd(),
      surfaceHitlChannels: [channel], dispatchToolErrorMessage: 'unused',
    });
    await dispatch!('SelfImplement', {});
    expect(received).toHaveLength(1);
    expect(received[0]!.surfaceHitlChannels).toEqual([channel]);
    expect(surfaceUxFromDispatchCtx(received[0]!).interactive).toBe(true);

    received.length = 0;
    await runDaemonPromptTurn({
      history: new DaemonSessionHistory(), request, toolSurface, toolCwd: process.cwd(),
      dispatchToolErrorMessage: 'unused',
    });
    await dispatch!('SelfImplement', {});
    expect(received).toHaveLength(1);
    expect('surfaceHitlChannels' in received[0]!).toBe(false);
    expect(surfaceUxFromDispatchCtx(received[0]!).interactive).toBe(false);
  });

  test('emits exactly one surface-resolved observation per turn', async () => {
    spyOn(coreTurnModule, 'runCoreTurn').mockResolvedValue({ stopReason: 'end_turn', finalText: 'done' });
    const log = spyOn(debug, 'log').mockImplementation(() => {});

    await runDaemonPromptTurn({
      history: new DaemonSessionHistory(),
      request: {
        sessionId: 'surface-observation',
        userText: '',
        userContent: null,
        source: null,
        effectiveSystemPrompt: undefined,
        tools: null,
      },
      surface: 'unknown',
      surfaceResolutionReason: 'absent',
      dispatchToolErrorMessage: 'unused',
    });

    expect(log.mock.calls.filter(([category, event]) => category === 'daemon-prompt-turn' && event === 'surface-resolved')).toEqual([
      ['daemon-prompt-turn', 'surface-resolved', { surface: 'unknown', reason: 'absent', hasUserText: false }],
    ]);
  });

  test('derives an omitted resolution reason from the actual request source', async () => {
    spyOn(coreTurnModule, 'runCoreTurn').mockResolvedValue({ stopReason: 'end_turn', finalText: 'done' });
    const log = spyOn(debug, 'log').mockImplementation(() => {});
    const cases = [
      { source: null, surface: undefined, expected: { surface: 'unknown', reason: 'absent' } },
      { source: { kind: 'native', platform: 'android' } as const, surface: 'android' as const, expected: { surface: 'android', reason: 'resolved' } },
      { source: { kind: 'glass' } as const, surface: undefined, expected: { surface: 'unknown', reason: 'unmapped' } },
    ];

    for (const [index, current] of cases.entries()) {
      await runDaemonPromptTurn({
        history: new DaemonSessionHistory(),
        request: {
          sessionId: `source-resolution-${index}`,
          userText: '',
          userContent: null,
          source: current.source,
          effectiveSystemPrompt: undefined,
          tools: null,
        },
        ...(current.surface ? { surface: current.surface } : {}),
        dispatchToolErrorMessage: 'unused',
      });
    }

    expect(log.mock.calls
      .filter(([category, event]) => category === 'daemon-prompt-turn' && event === 'surface-resolved')
      .map(([, , data]) => data)).toEqual([
      { surface: 'unknown', reason: 'absent', hasUserText: false },
      { surface: 'android', reason: 'resolved', hasUserText: false },
      { surface: 'unknown', reason: 'unmapped', hasUserText: false },
    ]);
  });
});
