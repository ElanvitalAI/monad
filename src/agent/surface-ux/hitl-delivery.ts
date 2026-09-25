import type { HitlDelivery } from '../../hitl/types.js';
import type { SessionSubscriber, SessionSurface } from '../../session/index.js';
import type { SurfaceKind } from './types.js';

/** Maps surfaces with a direct HITL transport to that delivery channel. */
export function hitlDeliveryFromSurface(surface: SurfaceKind): HitlDelivery | undefined {
  switch (surface) {
    case 'telegram':
      return 'telegram';
    case 'discord':
      return 'discord';
    case 'tui':
    case 'cli':
      return 'terminal';
    default:
      return undefined;
  }
}

/** Converts a session subscriber surface to the surface UX vocabulary. */
export function sessionSurfaceToSurfaceKind(surface: SessionSurface): SurfaceKind {
  switch (surface) {
    case 'voice':
      return 'unknown';
    default:
      return surface;
  }
}

function timestampOrUndefined(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/** Resolves the HITL delivery for the origin: the earliest joinedAt subscriber whose presence is not left and role is rw.
 * If no eligible subscriber has a valid joinedAt, uses the eligible subscriber with the most recent lastSeenAt.
 */
export function originHitlDelivery(
  subscribers: readonly SessionSubscriber[],
): HitlDelivery | undefined {
  const candidates = subscribers.filter(
    (subscriber) => subscriber.presence !== 'left' && subscriber.role === 'rw',
  );
  const origin = candidates
    .map((subscriber) => ({ subscriber, joinedAt: timestampOrUndefined(subscriber.joinedAt) }))
    .filter((candidate): candidate is { subscriber: SessionSubscriber; joinedAt: number } =>
      candidate.joinedAt !== undefined,
    )
    .sort((a, b) => a.joinedAt - b.joinedAt)[0]?.subscriber
    ?? candidates
      .map((subscriber) => ({ subscriber, lastSeenAt: timestampOrUndefined(subscriber.lastSeenAt) }))
      .filter((candidate): candidate is { subscriber: SessionSubscriber; lastSeenAt: number } =>
        candidate.lastSeenAt !== undefined,
      )
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0]?.subscriber;

  return origin === undefined
    ? undefined
    : hitlDeliveryFromSurface(sessionSurfaceToSurfaceKind(origin.surface));
}
