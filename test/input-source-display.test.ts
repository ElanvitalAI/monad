import { describe, expect, it } from 'bun:test';

import {
  classifyInputSurfaceFamily,
  formatInputSourceLine,
} from '../src/input/input-source-display.js';

describe('input source display', () => {
  it('classifies communication, embodied, automation, wearable, and direct families', () => {
    expect(classifyInputSurfaceFamily({ kind: 'telegram', entry: 'text' })).toBe('communication');
    expect(classifyInputSurfaceFamily({ kind: 'browser', provider: 'cdp' })).toBe('embodied');
    expect(classifyInputSurfaceFamily({ kind: 'daemon-api', route: '/v1/prompt' })).toBe('automation');
    expect(classifyInputSurfaceFamily({ kind: 'glass', deviceId: 'g1' })).toBe('wearable');
    expect(classifyInputSurfaceFamily({ kind: 'voice', channel: 'discord' })).toBe('direct');
  });

  it('formats compact input source detail lines', () => {
    expect(formatInputSourceLine({
      kind: 'browser',
      provider: 'cdp',
      capabilities: ['observe', 'verify'],
    })).toBe('Input source kind: browser (provider=cdp, capabilities=observe+verify)');
    expect(formatInputSourceLine({
      kind: 'discord',
      family: 'communication',
      provider: 'discord',
      entry: 'text',
      relay: 'daemon-bridge',
    })).toBe('Input source kind: discord (entry=text, provider=discord, relay=daemon-bridge)');
    expect(formatInputSourceLine({
      kind: 'voice',
      channel: 'discord',
      mode: 'voice-channel',
    })).toBe('Input source kind: voice (channel=discord, mode=voice-channel)');
  });
});
