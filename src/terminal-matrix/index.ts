// ── Terminal Matrix — barrel export ──
//
// Public surface for the unified terminal registry. Module consumers
// should import from here rather than individual files so future
// internal reshuffles don't ripple through call sites.

export type {
  GlobalTerminalId,
  TerminalCharacter,
  TerminalTransport,
  TerminalPlacement,
  TerminalInstance,
  TerminalSpawnSpec,
  TerminalEvent,
  TerminalListFilter,
  TerminalSummary,
} from './types.js';

export {
  DEFAULT_CHARACTER,
  DEFAULT_PLACEMENT,
  DEFAULT_TRANSPORT,
  summarize,
} from './types.js';

export { TerminalRegistry, placementEquals } from './registry.js';
export type { TerminalRegistryDeps, PlacementTransitionAdapter, PipeHandle } from './registry.js';
export { BroadcastBus } from './broadcast-bus.js';
export type { BroadcastResult } from './broadcast-bus.js';
export { ChannelBus, DEFAULT_REPLAY_LIMIT } from './channel-bus.js';
export type {
  ChannelMessage,
  ChannelSubscriber,
  ChannelSubscription,
  ChannelStats,
  SubscribeOpts,
  ChannelBusOpts,
} from './channel-bus.js';
export { resolveTransport, transportLabel } from './transport.js';
export type { ResolvedTransport, TransportResolveContext } from './transport.js';
export { PreviewSlotAdapter } from './preview-slot-adapter.js';
export type { PreviewSlotBinding, PreviewSlotAdapterDeps } from './preview-slot-adapter.js';
export { VwPlacementAdapter } from './vw-placement-adapter.js';
export type { VwPlacementAdapterDeps } from './vw-placement-adapter.js';
export { createOsc133Detector, interpretPayload } from './osc133.js';
export type { Osc133Detector } from './osc133.js';

// ── Singleton access ────────────────────────────────────────────
//
// Dashboard bootstrapping calls initTerminalMatrix() once it has a
// session registry + termSize() function. After that, anywhere in
// the codebase can ask getTerminalMatrix() to discover / move /
// subscribe without threading the instance through every layer.

import type { TerminalRegistry as _TerminalRegistry } from './registry.js';
import { ChannelBus as _ChannelBus } from './channel-bus.js';

let singleton: _TerminalRegistry | null = null;
let channelBusSingleton: _ChannelBus | null = null;

export function initTerminalMatrix(registry: _TerminalRegistry): _TerminalRegistry {
  singleton = registry;
  // Fresh ChannelBus per matrix init — keeps tests isolated when
  // the dashboard boot sequence re-runs.
  channelBusSingleton = new _ChannelBus();
  return registry;
}

export function getTerminalMatrix(): _TerminalRegistry {
  if (!singleton) {
    throw new Error(
      'TerminalMatrix not initialized — call initTerminalMatrix() from the dashboard boot path.',
    );
  }
  return singleton;
}

/** Shared channel bus for terminal IPC. Lazy-created so tests that
 *  don't init the matrix don't trip — they can still `new ChannelBus()`
 *  directly for unit tests. */
export function getChannelBus(): _ChannelBus {
  if (!channelBusSingleton) channelBusSingleton = new _ChannelBus();
  return channelBusSingleton;
}

export function resetTerminalMatrix(): void {
  singleton?.dispose();
  singleton = null;
  channelBusSingleton?.reset();
  channelBusSingleton = null;
}
