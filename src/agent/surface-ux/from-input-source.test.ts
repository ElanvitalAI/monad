import { describe, expect, test } from 'bun:test';

import { resolveSurfaceKindFromInputSource } from './from-input-source.js';

describe('resolveSurfaceKindFromInputSource', () => {
  test('maps known input sources to their SurfaceKind', () => {
    expect(resolveSurfaceKindFromInputSource({ kind: 'native', platform: 'android' })).toEqual({
      surface: 'android', reason: 'resolved',
    });
    expect(resolveSurfaceKindFromInputSource({ kind: 'native', platform: 'ios' })).toEqual({
      surface: 'ios', reason: 'resolved',
    });
    expect(resolveSurfaceKindFromInputSource({ kind: 'pwa' })).toEqual({ surface: 'pwa', reason: 'resolved' });
    expect(resolveSurfaceKindFromInputSource({ kind: 'telegram' })).toEqual({ surface: 'telegram', reason: 'resolved' });
    expect(resolveSurfaceKindFromInputSource({ kind: 'discord' })).toEqual({ surface: 'discord', reason: 'resolved' });
    expect(resolveSurfaceKindFromInputSource({ kind: 'terminal' })).toEqual({ surface: 'tui', reason: 'resolved' });
    expect(resolveSurfaceKindFromInputSource({ kind: 'daemon-api' })).toEqual({ surface: 'acp', reason: 'resolved' });
  });

  test('distinguishes absent input from unmapped input without guessing native platform', () => {
    const absent = resolveSurfaceKindFromInputSource(null);
    const unmapped = resolveSurfaceKindFromInputSource({ kind: 'glass' });
    const nativeWithoutPlatform = resolveSurfaceKindFromInputSource({ kind: 'native' });

    expect(absent).toEqual({ surface: 'unknown', reason: 'absent' });
    expect(unmapped).toEqual({ surface: 'unknown', reason: 'unmapped' });
    expect(nativeWithoutPlatform).toEqual({ surface: 'unknown', reason: 'unmapped' });
    expect(new Set([absent.reason, unmapped.reason, 'resolved']).size).toBe(3);
    expect(nativeWithoutPlatform.surface).not.toBe('android');
  });
});
