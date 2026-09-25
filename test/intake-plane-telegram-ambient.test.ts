import { describe, expect, test } from 'bun:test';
import { maybeHandleTelegramAmbientMessage } from '../src/intake-plane/adapters/telegram-ambient.js';

describe('maybeHandleTelegramAmbientMessage', () => {
  test('returns null for slash commands and ordinary chat', async () => {
    expect(await maybeHandleTelegramAmbientMessage({
      text: '/intake compare two repos',
      chatId: 1,
      userId: 42,
      ambientCapture: 'capture',
    })).toBeNull();
    expect(await maybeHandleTelegramAmbientMessage({
      text: 'hello there',
      chatId: 1,
      userId: 42,
      ambientCapture: 'capture',
    })).toBeNull();
  });

  test('returns a telegram-flavored suggestion for memo-like text', async () => {
    const reply = await maybeHandleTelegramAmbientMessage({
      text: [
        '- compare two repos',
        '- investigate image preview bug',
        'https://github.com/example/a',
        'https://github.com/example/b',
      ].join('\n'),
      chatId: 1,
      userId: 42,
      ambientCapture: 'suggest',
    });
    expect(reply).toContain('This looks like a scratch note');
    expect(reply).toContain('/intake');
  });
});
