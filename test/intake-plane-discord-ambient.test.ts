import { describe, expect, test } from 'bun:test';
import { maybeHandleDiscordAmbientMessage } from '../src/intake-plane/adapters/discord-ambient.js';

describe('maybeHandleDiscordAmbientMessage', () => {
  test('returns null for commands and ordinary chat', async () => {
    expect(await maybeHandleDiscordAmbientMessage({
      text: '!intake compare two repos',
      channelId: 'C1',
      userId: 'U1',
      ambientCapture: 'capture',
    })).toBeNull();
    expect(await maybeHandleDiscordAmbientMessage({
      text: 'hello there',
      channelId: 'C1',
      userId: 'U1',
      ambientCapture: 'capture',
    })).toBeNull();
  });

  test('returns a channel-flavored suggestion for memo-like text', async () => {
    const reply = await maybeHandleDiscordAmbientMessage({
      text: [
        '- compare two repos',
        '- investigate image preview bug',
        'https://github.com/example/a',
        'https://github.com/example/b',
      ].join('\n'),
      channelId: 'C1',
      userId: 'U1',
      ambientCapture: 'suggest',
    });
    expect(reply).toContain('This looks like a scratch note');
    expect(reply).toContain('!intake');
  });
});
