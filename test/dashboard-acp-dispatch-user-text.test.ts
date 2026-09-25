import { expect, test } from 'bun:test';
import type { FeedbackEnvelope } from '../src/feedback/envelope.js';
import { dispatchDashboardSessionRuntimeTool } from '../src/dashboard/session-runtime-dispatch.js';
import { createDashboardSessionRuntimeFeedback } from '../src/dashboard/session-runtime-feedback.js';
import { createTurnStreamPresentationApplier } from '../src/dashboard/turn-stream-presentation-applier.js';
import { createTurnStreamFormatter } from '../src/dashboard/turn-stream-formatter.js';

function feedback(lines: string[], emittedAt = Date.now(), blockId = 'parent-session:autotool:run'): FeedbackEnvelope {
  return {
    envelopeVersion: 1,
    sessionId: 'parent-session',
    blockId,
    kind: 'tool.progress',
    phase: 'delta',
    emittedAt,
    seq: 1,
    asciiFallback: lines,
    payload: { stream: 'generic', lines },
  };
}

function presentation(chatLines: string[], draws: string[]) {
  const args = new Map<string, Record<string, unknown>>();
  const applier = createTurnStreamPresentationApplier({
    chatLines,
    initialAssistantStart: 0,
    draw: () => { draws.push('draw'); },
    pinChatTail: () => {},
    renderedToolRuntime: {
      setArgs: (id, value) => { args.set(id, value); },
      getArgs: id => args.get(id),
      deleteArgs: id => { args.delete(id); },
      replaceBlock: (_id, lines, assistantStart) => {
        chatLines.length = assistantStart;
        chatLines.push(...lines);
        return chatLines.length;
      },
      registerFold: () => {},
    },
  });
  return createTurnStreamFormatter({
    emit: event => applier.apply(event),
    thinking: { update: () => {}, updateMetrics: () => {} },
    termCols: () => 120,
    wrapOpts: {},
    formatResponse: text => [text],
    text: line => line,
    muted: line => `muted:${line}`,
    ptyCallLine: name => `tool-call:${name}`,
    ptyResultLine: name => `tool-result:${name}`,
    renderToolCallEvent: () => null,
    renderToolResultVariants: () => ({ collapsed: ['muted:tool result'], expanded: null }),
    toolRendering: {},
    brainIcon: '🧠',
  });
}

function runtimeDeps(
  formatter: ReturnType<typeof presentation>,
  chatLines: string[],
  draws: string[],
  options: { contextUserText?: string; turnRefUserText: string | null; progress: string[] },
) {
  return {
    contextUserText: options.contextUserText,
    turnRefUserText: options.turnRefUserText,
    muted: (line: string) => `muted:${line}`,
    pushChatLine: (line: string) => { chatLines.push(line); },
    draw: () => { draws.push('draw'); },
    getToolRuntime: () => undefined,
    dispatchToolRuntime: async () => ({ error: 'unexpected runtime fallback' }),
    dispatchPluginTool: async () => ({ ok: false as const, error: 'unexpected plugin fallback' }),
    dispatchAutonomousTool: async (_name: string, _args: Record<string, unknown>, ctx: { userText?: string; emitFeedback?: (envelope: FeedbackEnvelope) => void }) => {
      expect(ctx.userText).toBe(options.contextUserText ?? options.turnRefUserText ?? undefined);
      ctx.emitFeedback?.(feedback(options.progress));
      return { dispatched: 'autonomous' };
    },
  };
}

test('actual dashboard dispatch renders autonomous progress between formatter-applied tool call and result', async () => {
  const chatLines: string[] = [];
  const draws: string[] = [];
  const formatter = presentation(chatLines, draws);
  const call = { id: 'self-implement-1', name: 'SelfImplement', args: {} };

  formatter.onToolCall(call);
  await dispatchDashboardSessionRuntimeTool(
    'SelfImplement',
    {},
    runtimeDeps(formatter, chatLines, draws, {
      contextUserText: 'Implement the requested feedback path.',
      turnRefUserText: 'stale turn text',
      progress: ['SelfImplement: workspace prepared'],
    }),
  );
  formatter.onToolResult({ ...call, result: { dispatched: 'autonomous' } });

  const progress = chatLines.indexOf('muted:SelfImplement: workspace prepared');
  expect(progress).toBeGreaterThan(0);
  expect(progress).toBeLessThan(chatLines.length - 1);
  expect(draws.length).toBeGreaterThanOrEqual(3);
});

test('actual dashboard dispatch preserves turn-ref user text and leaves chat and draw untouched for empty progress', async () => {
  const chatLines: string[] = [];
  const draws: string[] = [];
  const formatter = presentation(chatLines, draws);
  const call = { id: 'self-implement-2', name: 'SelfImplement', args: {} };

  formatter.onToolCall(call);
  const drawsBefore = draws.length;
  const linesBefore = chatLines.length;
  await dispatchDashboardSessionRuntimeTool(
    'SelfImplement',
    {},
    runtimeDeps(formatter, chatLines, draws, {
      turnRefUserText: 'Use the preserved parent turn text.',
      progress: ['', '   '],
    }),
  );
  expect(chatLines.length).toBe(linesBefore);
  expect(draws.length).toBe(drawsBefore);
  formatter.onToolResult({ ...call, result: { dispatched: 'autonomous' } });
});

// ⛔ 관측이 «렌더를 막지 않는다» — observe 가 던져도 진행 줄은 그려져야 한다.
//   (무인 리뷰 R4 must-fix ① 계열 · 종전엔 observe 가 던지면 pushChatLine 에 영영 못 닿았다)
test('observe 가 던져도 진행 줄은 그려진다', () => {
  const pushed: string[] = [];
  const draws: string[] = [];
  const render = createDashboardSessionRuntimeFeedback({
    muted: line => line,
    pushChatLine: line => { pushed.push(line); },
    draw: () => { draws.push('draw'); },
    observe: () => { throw new Error('observability sink exploded'); },
  });

  expect(() => render(feedback(['🔨 SelfImplement 시작']))).not.toThrow();
  expect(pushed).toEqual(['🔨 SelfImplement 시작']);
  expect(draws).toEqual(['draw']);
});

test('같은 blockId의 후속 진행 줄에는 첫 엔벨로프 기준 경과를 붙인다', () => {
  const pushed: string[] = [];
  const render = createDashboardSessionRuntimeFeedback({
    muted: line => line,
    pushChatLine: line => { pushed.push(line); },
    draw: () => {},
    observe: () => {},
  });

  render(feedback(['첫 진행'], 1_000, 'block-a'));
  render(feedback(['후속 진행'], 61_000, 'block-a'));

  expect(pushed).toEqual(['첫 진행', '후속 진행 [경과: 60초]']);
});

test('같은 시각의 후속 진행과 읽을 수 없는 시각을 다른 경과값으로 렌더링한다', () => {
  const pushed: string[] = [];
  const render = createDashboardSessionRuntimeFeedback({
    muted: line => line,
    pushChatLine: line => { pushed.push(line); },
    draw: () => {},
    observe: () => {},
  });

  render(feedback(['첫 진행'], 1_000, 'zero-elapsed'));
  render(feedback(['동시 진행'], 1_000, 'zero-elapsed'));
  render(feedback(['시각 없는 첫 진행'], Number.NaN, 'missing-time'));
  render(feedback(['시각 없는 후속 진행'], 2_000, 'missing-time'));

  expect(pushed).toEqual([
    '첫 진행',
    '동시 진행 [경과: 0초]',
    '시각 없는 첫 진행',
    '시각 없는 후속 진행 [경과: 시각 없음]',
  ]);
});

test('빈 진행은 줄을 안 늘린다 — observe 가 던져도 마찬가지다', () => {
  const pushed: string[] = [];
  const draws: string[] = [];
  const render = createDashboardSessionRuntimeFeedback({
    muted: line => line,
    pushChatLine: line => { pushed.push(line); },
    draw: () => { draws.push('draw'); },
    observe: () => { throw new Error('observability sink exploded'); },
  });

  expect(() => render(feedback(['   ']))).not.toThrow();
  expect(pushed).toEqual([]);
  expect(draws).toEqual([]);
});
