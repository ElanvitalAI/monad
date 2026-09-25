import { describe, expect, test } from 'bun:test';

import { buildDashboardTurnMessage } from '../src/dashboard/turn-message-runtime.js';
import { createContextRegistry } from '../src/context.js';

describe('buildDashboardTurnMessage', () => {
  test('builds the question body and emits block banner lines', () => {
    const chatLines: string[] = [];
    const result = buildDashboardTurnMessage({
      userText: 'hello world',
      promptBankContext: '## Prompt Bank Context\nWindow is compact.',
      contextText: 'cwd=/tmp',
      contextRegistry: createContextRegistry(),
      terminalRegistry: {} as never,
      addressBook: {} as never,
      windowRegistry: {} as never,
      blockAttach: {
        banner: () => 'Attached block #7',
        consume: (msg) => `[Block #7]\n${msg}`,
      },
      pushChatLine: (line) => { chatLines.push(line); },
    });

    expect(chatLines).toHaveLength(1);
    expect(chatLines[0]).toContain('Attached block #7');
    expect(result.questionWithBlock).toContain('[Block #7]');
    expect(result.questionBody).toContain('## Prompt Bank Context');
    expect(result.questionBody).toContain('Context:\ncwd=/tmp');
    expect(result.questionBody).toContain('Question: [Block #7]');
    expect(result.userMsg.role).toBe('user');
  });

  test('skips banner line when no block is attached', () => {
    const chatLines: string[] = [];
    const result = buildDashboardTurnMessage({
      userText: 'plain text',
      promptBankContext: '',
      contextText: 'ctx',
      contextRegistry: createContextRegistry(),
      terminalRegistry: {} as never,
      addressBook: {} as never,
      windowRegistry: {} as never,
      blockAttach: {
        banner: () => null,
        consume: (msg) => msg,
      },
      pushChatLine: (line) => { chatLines.push(line); },
    });

    expect(chatLines).toEqual([]);
    expect(result.questionWithBlock).toBe('plain text');
  });
});
