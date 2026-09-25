import { describe, expect, test } from 'bun:test';

import {
  createTurnStreamPresentationApplier,
  type TurnStreamRenderedToolRuntime,
} from './turn-stream-presentation-applier.js';

describe('createTurnStreamPresentationApplier kind-unit grouping', () => {
  test('forwards operationKind into registerFold and omits it when absent', () => {
    const groupings: Array<unknown> = [];
    const renderedToolRuntime: TurnStreamRenderedToolRuntime = {
      setArgs: () => {},
      getArgs: () => undefined,
      deleteArgs: () => {},
      replaceBlock: (_id, _lines, start) => start + 1,
      registerFold: (_id, _collapsed, _expanded, grouping) => { groupings.push(grouping); },
    };
    const applier = createTurnStreamPresentationApplier({
      chatLines: ['head'],
      renderedToolRuntime,
      initialAssistantStart: 1,
      draw: () => {},
      pinChatTail: () => {},
    });

    applier.apply({
      type: 'tool.replaceBlock',
      callId: 'c1',
      collapsedLines: ['Read a.ts'],
      expandedLines: ['Read a.ts', 'body'],
      operationKind: 'Read',
    });
    applier.apply({
      type: 'tool.replaceBlock',
      callId: 'c2',
      collapsedLines: ['Read b.ts'],
      expandedLines: ['Read b.ts', 'body'],
    });

    expect(groupings[0]).toEqual({ operationKind: 'Read' });
    expect(groupings[1]).toBeUndefined();
  });
});
