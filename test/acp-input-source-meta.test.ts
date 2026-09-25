import { describe, expect, test } from 'bun:test';

import {
  readInputSourceMeta,
  writeInputSourceMeta,
} from '../src/acp/input-source-meta.js';

describe('input source ACP meta helpers', () => {
  test('round-trips canonical source payloads', () => {
    const meta = writeInputSourceMeta({
      kind: 'voice',
      channel: 'discord',
      mode: 'voice-channel',
      transcriptSource: 'voice',
      surface: 'discord-voice-channel',
    });
    expect(readInputSourceMeta(meta)).toEqual({
      kind: 'voice',
      channel: 'discord',
      mode: 'voice-channel',
      transcriptSource: 'voice',
      surface: 'discord-voice-channel',
    });
  });

  test('returns null for malformed payloads', () => {
    expect(readInputSourceMeta(null)).toBeNull();
    expect(readInputSourceMeta({})).toBeNull();
    expect(readInputSourceMeta({ input_source: { kind: 'unknown' } })).toBeNull();
  });
});
