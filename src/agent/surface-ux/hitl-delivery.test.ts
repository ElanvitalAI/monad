import { describe, expect, test } from 'bun:test';
import {
  hitlDeliveryFromSurface,
  originHitlDelivery,
  sessionSurfaceToSurfaceKind,
} from './hitl-delivery.js';
import type { HitlDelivery } from '../../hitl/types.js';
import type { SessionSubscriber, SessionSurface } from '../../session/index.js';
import type { SurfaceKind } from './types.js';

function subscriber(overrides: Partial<SessionSubscriber> = {}): SessionSubscriber {
  return {
    surface: 'telegram',
    endpoint: 'chat-1',
    role: 'rw',
    joinedAt: '2026-08-12T00:00:00.000Z',
    lastSeenAt: '2026-08-12T00:00:00.000Z',
    presence: 'active',
    ...overrides,
  };
}

const expectedDeliveryBySurface = {
  telegram: 'telegram',
  discord: 'discord',
  pwa: undefined,
  ios: undefined,
  android: undefined,
  acp: undefined,
  tui: 'terminal',
  cli: 'terminal',
  unknown: undefined,
} satisfies Record<SurfaceKind, HitlDelivery | undefined>;

describe('hitlDeliveryFromSurface', () => {
  for (const [surface, expected] of Object.entries(expectedDeliveryBySurface) as Array<
    [SurfaceKind, HitlDelivery | undefined]
  >) {
    test(`${surface} maps to ${expected ?? 'undefined'}`, () => {
      expect(hitlDeliveryFromSurface(surface)).toBe(expected);
    });
  }
});

describe('sessionSurfaceToSurfaceKind', () => {
  const expectedSurfaceKindBySessionSurface = {
    telegram: 'telegram',
    discord: 'discord',
    pwa: 'pwa',
    acp: 'acp',
    cli: 'cli',
    voice: 'unknown',
  } satisfies Record<SessionSurface, SurfaceKind>;

  for (const [surface, expected] of Object.entries(expectedSurfaceKindBySessionSurface) as Array<
    [SessionSurface, SurfaceKind]
  >) {
    test(`${surface} maps to ${expected}`, () => {
      expect(sessionSurfaceToSurfaceKind(surface)).toBe(expected);
    });
  }
});

describe('originHitlDelivery', () => {
  test('chooses the earliest joined eligible rw subscriber over earlier left and ro subscribers', () => {
    expect(originHitlDelivery([
      subscriber({
        surface: 'discord',
        presence: 'left',
        joinedAt: '2026-08-12T00:00:00.000Z',
      }),
      subscriber({
        surface: 'cli',
        role: 'ro',
        joinedAt: '2026-08-12T00:01:00.000Z',
      }),
      subscriber({
        surface: 'telegram',
        endpoint: 'origin',
        joinedAt: '2026-08-12T00:02:00.000Z',
      }),
      subscriber({
        surface: 'discord',
        endpoint: 'later',
        joinedAt: '2026-08-12T00:03:00.000Z',
      }),
    ])).toBe('telegram');
  });

  test('falls back to the most recently seen eligible rw subscriber when joinedAt is unavailable', () => {
    expect(originHitlDelivery([
      subscriber({
        surface: 'telegram',
        joinedAt: 'not-a-timestamp',
        lastSeenAt: '2026-08-12T00:01:00.000Z',
      }),
      subscriber({
        surface: 'discord',
        joinedAt: 'not-a-timestamp',
        lastSeenAt: '2026-08-12T00:02:00.000Z',
      }),
    ])).toBe('discord');
  });

  test('returns undefined when every rw subscriber has left', () => {
    expect(originHitlDelivery([
      subscriber({ presence: 'left' }),
      subscriber({ surface: 'discord', presence: 'left' }),
    ])).toBeUndefined();
  });

  test('returns undefined through the voice-to-unknown delivery chain', () => {
    expect(originHitlDelivery([subscriber({ surface: 'voice' })])).toBeUndefined();
  });

  test('returns undefined for an empty subscriber list', () => {
    expect(originHitlDelivery([])).toBeUndefined();
  });
});
