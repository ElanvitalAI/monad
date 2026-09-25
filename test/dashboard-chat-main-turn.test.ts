import { describe, expect, test } from 'bun:test';

import { buildChatMainTextInputRequest } from '../src/dashboard/input/chat-main-turn.js';

describe('dashboard chat-main turn', () => {
  test('builds textInput requests without legacy picker presentation switches', () => {
    const request = buildChatMainTextInputRequest({
      session: {
        inputRow: 18,
        getInputRow: () => 18,
        inputWidth: 72,
        paintChrome: () => {},
        shouldPaint: () => true,
        register: () => {},
        unregister: () => {},
      } as any,
      history: ['a'],
      placeholder: 'Ask',
      textInputOpts: {
        onEscape: () => false,
      },
    });

    expect(request.row).toBe(18);
    expect(request.getRow?.()).toBe(18);
    expect(request.width).toBe(72);
    expect(request.prompt).toBe('❯ ');
    expect('pickerPresentation' in request).toBe(false);
  });
});
