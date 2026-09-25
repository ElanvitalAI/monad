import { describe, expect, it } from 'bun:test';
import {
  buildBrowserObservationInputSourceRef,
  buildDaemonApiInputSourceRef,
  buildDiscordTextInputSourceRef,
  buildPwaScratchInputSourceRef,
  buildTelegramTextInputSourceRef,
  buildTerminalObservationInputSourceRef,
  canonicalInputSourceKindFromIntakeSource,
  isInputSourceKind,
} from '../src/input/input-source-kind.js';

describe('input source kind alpha', () => {
  it('maps intake surfaces onto canonical source kinds', () => {
    expect(canonicalInputSourceKindFromIntakeSource('tui-scratch')).toBe('keyboard');
    expect(canonicalInputSourceKindFromIntakeSource('web-scratch')).toBe('pwa');
    expect(canonicalInputSourceKindFromIntakeSource('mobile-scratch')).toBe('pwa');
    expect(canonicalInputSourceKindFromIntakeSource('voice')).toBe('voice');
    expect(canonicalInputSourceKindFromIntakeSource('telegram')).toBe('telegram');
    expect(canonicalInputSourceKindFromIntakeSource('discord')).toBe('discord');
    expect(canonicalInputSourceKindFromIntakeSource('api')).toBe('daemon-api');
  });

  it('guards the canonical kind vocabulary', () => {
    expect(isInputSourceKind('voice')).toBe(true);
    expect(isInputSourceKind('browser')).toBe(true);
    expect(isInputSourceKind('terminal')).toBe(true);
    expect(isInputSourceKind('daemon-api')).toBe(true);
    expect(isInputSourceKind('scratch')).toBe(false);
    expect(isInputSourceKind(null)).toBe(false);
  });

  it('builds canonical source refs for communication and scratch surfaces', () => {
    expect(buildTelegramTextInputSourceRef({
      chatId: '123',
      threadId: '7',
      userId: 'u1',
    })).toEqual({
      kind: 'telegram',
      family: 'communication',
      provider: 'telegram',
      chatId: '123',
      threadId: '7',
      userId: 'u1',
      entry: 'text',
      relay: 'native-bot',
    });
    expect(buildDiscordTextInputSourceRef({
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u2',
    })).toEqual({
      kind: 'discord',
      family: 'communication',
      provider: 'discord',
      channelId: 'c1',
      guildId: 'g1',
      userId: 'u2',
      entry: 'text',
      relay: 'native-bot',
    });
    expect(buildPwaScratchInputSourceRef({ deviceId: 'd1' })).toEqual({
      kind: 'pwa',
      deviceId: 'd1',
      entry: 'scratch',
    });
    expect(buildDaemonApiInputSourceRef({ route: '/v1/prompt' })).toEqual({
      kind: 'daemon-api',
      route: '/v1/prompt',
    });
    expect(buildBrowserObservationInputSourceRef({
      provider: 'cdp',
      capabilities: ['observe', 'verify'],
    })).toEqual({
      kind: 'browser',
      provider: 'cdp',
      capabilities: ['observe', 'verify'],
    });
    expect(buildTerminalObservationInputSourceRef({
      provider: 'tui',
      deviceId: 'vw-1',
      sessionId: 'p0',
      capabilities: ['observe', 'render'],
    })).toEqual({
      kind: 'terminal',
      provider: 'tui',
      deviceId: 'vw-1',
      sessionId: 'p0',
      capabilities: ['observe', 'render'],
    });
  });
});
