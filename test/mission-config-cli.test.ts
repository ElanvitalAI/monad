// ── Mission config CLI helper guard (P1-2 · 2026-05-14) ──
//
// Drives the pure helpers in src/cli/mission-config.ts. No file I/O,
// no user-config touch — the Commander wiring in src/index.ts is what
// persists; these tests only assert that the helper produces the
// expected outcome shape.

import { describe, expect, test } from 'bun:test';
import {
  describeMissionRouting,
  setMissionEntry,
  resetMissionEntry,
  setMissionMode,
} from '../src/cli/mission-config';

describe('describeMissionRouting', () => {
  test('empty config → defaults table + mode auto', () => {
    const out = describeMissionRouting(undefined);
    expect(out.exitCode).toBe(0);
    expect(out.lines[0]).toBe('mode: auto');
    expect(out.lines.find((l) => l.startsWith('plan:'))).toBe('plan: <default>');
    expect(out.lines.length).toBe(7); // mode + 6 missions
  });

  test('single-row query renders only one mission line', () => {
    const out = describeMissionRouting(
      { missions: { plan: { provider: 'gemini', model: 'gemini-3-pro' } } },
      'plan',
    );
    expect(out.lines).toContain('plan: gemini (gemini-3-pro)');
    expect(out.lines.find((l) => l.startsWith('build:'))).toBeUndefined();
  });

  test('unknown mission name → exit 1 with message', () => {
    const out = describeMissionRouting(undefined, 'nonsense');
    expect(out.exitCode).toBe(1);
    expect(out.lines[0]).toContain('unknown mission');
  });
});

describe('setMissionEntry', () => {
  test('writes a new mission row', () => {
    const out = setMissionEntry(undefined, 'plan', 'claude', 'claude-opus-4-7');
    expect(out.exitCode).toBe(0);
    expect(out.next?.missions?.plan).toEqual({ provider: 'claude', model: 'claude-opus-4-7' });
  });

  test('overwrites an existing row', () => {
    const out = setMissionEntry(
      { missions: { plan: { provider: 'gemini' } } },
      'plan',
      'codex-app-server',
      'gpt-5',
    );
    expect(out.next?.missions?.plan).toEqual({
      provider: 'codex-app-server',
      model: 'gpt-5',
    });
  });

  test('omits model when blank', () => {
    const out = setMissionEntry(undefined, 'quick', 'claude', '');
    expect(out.next?.missions?.quick).toEqual({ provider: 'claude', model: undefined });
  });

  test('unknown mission → exit 1', () => {
    const out = setMissionEntry(undefined, 'unknown', 'claude', undefined);
    expect(out.exitCode).toBe(1);
  });

  test('empty provider → exit 1', () => {
    const out = setMissionEntry(undefined, 'plan', '   ', undefined);
    expect(out.exitCode).toBe(1);
  });

  test('preserves other missions when setting one', () => {
    const out = setMissionEntry(
      { missions: { build: { provider: 'codex-app-server' } } },
      'plan',
      'claude',
      undefined,
    );
    expect(out.next?.missions?.build).toEqual({ provider: 'codex-app-server' });
    expect(out.next?.missions?.plan).toBeDefined();
  });
});

describe('resetMissionEntry', () => {
  test('reset single mission removes only that key', () => {
    const out = resetMissionEntry(
      {
        missions: {
          plan: { provider: 'gemini' },
          build: { provider: 'codex-app-server' },
        },
      },
      'plan',
    );
    expect(out.next?.missions?.plan).toBeUndefined();
    expect(out.next?.missions?.build).toEqual({ provider: 'codex-app-server' });
  });

  test('reset all clears missions but keeps mode', () => {
    const out = resetMissionEntry(
      { mode: 'manual', missions: { plan: { provider: 'gemini' } } },
      undefined,
    );
    expect(out.next?.missions).toBeUndefined();
    expect(out.next?.mode).toBe('manual');
  });

  test('reset all when already empty → no-op message', () => {
    const out = resetMissionEntry(undefined, undefined);
    expect(out.exitCode).toBe(0);
    expect(out.next).toBeUndefined();
    expect(out.lines[0]).toContain('already at defaults');
  });

  test('reset single mission already absent → no-op message', () => {
    const out = resetMissionEntry({ missions: { build: { provider: 'x' } } }, 'plan');
    expect(out.exitCode).toBe(0);
    expect(out.next).toBeUndefined();
  });

  test('clears missions dict entirely when last entry removed', () => {
    const out = resetMissionEntry({ missions: { plan: { provider: 'gemini' } } }, 'plan');
    expect(out.next?.missions).toBeUndefined();
  });
});

describe('setMissionMode', () => {
  test('auto / manual accepted', () => {
    expect(setMissionMode(undefined, 'auto').next?.mode).toBe('auto');
    expect(setMissionMode(undefined, 'manual').next?.mode).toBe('manual');
  });

  test('preserves existing missions when toggling mode', () => {
    const out = setMissionMode(
      { missions: { plan: { provider: 'gemini' } } },
      'manual',
    );
    expect(out.next?.missions?.plan).toEqual({ provider: 'gemini' });
    expect(out.next?.mode).toBe('manual');
  });

  test('rejects unknown mode → exit 1', () => {
    const out = setMissionMode(undefined, 'something');
    expect(out.exitCode).toBe(1);
  });
});
