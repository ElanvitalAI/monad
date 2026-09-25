// T2.B — sidebar tab item setup-needed detection.

import { describe, expect, test } from 'bun:test';

import { isSetupNeeded } from './sidebar-tab-item';
import type { NexusTabState } from '../types';

function tab(meta: Record<string, unknown>): NexusTabState {
  return {
    spec: {
      id: 'telegram:1',
      kind: 'channel-bot',
      label: 'telegram',
      meta,
    },
    status: 'idle',
    restartCount: 0,
  } as unknown as NexusTabState;
}

describe('T2.B · isSetupNeeded', () => {
  test('returns true when meta.disabled = true (channel-bot token missing)', () => {
    expect(isSetupNeeded(tab({ disabled: true, platform: 'telegram' }))).toBe(true);
  });

  test('returns false when meta.disabled = false', () => {
    expect(isSetupNeeded(tab({ disabled: false }))).toBe(false);
  });

  test('returns false when meta.disabled is absent', () => {
    expect(isSetupNeeded(tab({ platform: 'discord' }))).toBe(false);
  });

  test('returns false for kind without meta', () => {
    expect(isSetupNeeded({
      spec: { id: 'x', kind: 'webterm', label: 'x' },
      status: 'idle',
      restartCount: 0,
    } as unknown as NexusTabState)).toBe(false);
  });
});
