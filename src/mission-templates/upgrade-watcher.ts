// W9b Z15.b · Device-fleet upgrade watcher — fire reconfigure when the
// detected fleet changes shape. Cf. ROADMAP §3 S23 + §4 Z15.b.
//
// The detector is point-in-time. When the user buys an Apple Watch, the
// next iCloud sync repopulates `~/.elanous/devices.json` with a new row
// and the daemon needs to re-resolve every installed mission template's
// optional capabilities so PWA UI promotes (or demotes) accordingly.
//
// `compareFleets(prev, next)` and `watchFleetChanges(state, next)` are
// pure helpers that the daemon polls on a cron — this module owns the
// diff shape, not the loop. The W7a OutboundRouter is the consumer:
// `onChange` emits an `OutboundEvent`-shaped payload the daemon can
// route to whichever channel the user prefers for capability changes
// (push / live-activity / silent toast).

import type { DeviceCapabilitySet, DeviceKind } from './device-detector.js';

export interface FleetSignature {
  kinds: Record<string, number>;
  capabilities: Record<string, true>;
}

export function fleetSignature(fleet: DeviceCapabilitySet): FleetSignature {
  const kinds: Record<string, number> = {};
  const capabilities: Record<string, true> = {};
  for (const [kind] of fleet.byKind) {
    kinds[kind] = fleet.count(kind);
  }
  for (const caps of fleet.byKind.values()) {
    for (const cap of caps) capabilities[cap] = true;
  }
  return { kinds, capabilities };
}

export type FleetChangeKind =
  | 'no-change'
  | 'device-added'
  | 'device-removed'
  | 'capability-added'
  | 'capability-removed';

export interface FleetChange {
  kind: FleetChangeKind;
  /** Devices in `next` but not in `prev`. */
  devicesAdded: DeviceKind[];
  /** Devices in `prev` but not in `next`. */
  devicesRemoved: DeviceKind[];
  /** Capabilities newly available. */
  capabilitiesAdded: string[];
  /** Capabilities that disappeared. */
  capabilitiesRemoved: string[];
  /** When true, the daemon should re-run the capability resolver for
   *  every installed template (`device-*` or `capability-*` changed). */
  shouldReconfigure: boolean;
}

export function compareFleets(prev: FleetSignature, next: FleetSignature): FleetChange {
  const devicesAdded: DeviceKind[] = [];
  const devicesRemoved: DeviceKind[] = [];
  for (const kind of Object.keys(next.kinds)) {
    const cur = next.kinds[kind] ?? 0;
    const before = prev.kinds[kind] ?? 0;
    if (cur > 0 && before === 0) devicesAdded.push(kind as DeviceKind);
  }
  for (const kind of Object.keys(prev.kinds)) {
    const before = prev.kinds[kind] ?? 0;
    const cur = next.kinds[kind] ?? 0;
    if (before > 0 && cur === 0) devicesRemoved.push(kind as DeviceKind);
  }
  const capabilitiesAdded = Object.keys(next.capabilities).filter((c) => !prev.capabilities[c]);
  const capabilitiesRemoved = Object.keys(prev.capabilities).filter((c) => !next.capabilities[c]);

  const kindLevel = devicesAdded.length > 0 || devicesRemoved.length > 0;
  const capLevel = capabilitiesAdded.length > 0 || capabilitiesRemoved.length > 0;

  const kind: FleetChangeKind = devicesAdded.length > 0
    ? 'device-added'
    : devicesRemoved.length > 0
      ? 'device-removed'
      : capabilitiesAdded.length > 0
        ? 'capability-added'
        : capabilitiesRemoved.length > 0
          ? 'capability-removed'
          : 'no-change';

  return {
    kind,
    devicesAdded,
    devicesRemoved,
    capabilitiesAdded,
    capabilitiesRemoved,
    shouldReconfigure: kindLevel || capLevel,
  };
}

export interface FleetWatcherState {
  /** Last signature observed. `null` ⇒ first tick. */
  lastSignature: FleetSignature | null;
}

export function createFleetWatcherState(): FleetWatcherState {
  return { lastSignature: null };
}

export interface FleetChangeEvent {
  change: FleetChange;
  prev: FleetSignature | null;
  next: FleetSignature;
  /** Wall-clock ms when the watcher observed the change. */
  observedAt: number;
}

export interface FleetUpgradeWatcherDeps {
  /** Persist or broadcast the change. Best-effort — exceptions are
   *  swallowed so a downstream surface error does not prevent the
   *  state pointer from advancing. */
  onChange?: (event: FleetChangeEvent) => void | Promise<void>;
  now?: () => number;
}

/** One tick of the watcher loop. Mutates `state.lastSignature` in
 *  place; returns the change envelope so the daemon can log + decide
 *  whether to re-run the resolver. */
export async function tickUpgradeWatcher(
  state: FleetWatcherState,
  next: FleetCapabilitySetLike,
  deps: FleetUpgradeWatcherDeps = {},
): Promise<FleetChangeEvent> {
  const nextSig = fleetSignature(next as DeviceCapabilitySet);
  const change = state.lastSignature === null
    ? bootstrapChange(nextSig)
    : compareFleets(state.lastSignature, nextSig);
  const event: FleetChangeEvent = {
    change,
    prev: state.lastSignature,
    next: nextSig,
    observedAt: (deps.now ?? Date.now)(),
  };
  state.lastSignature = nextSig;
  if (deps.onChange && change.shouldReconfigure) {
    try { await deps.onChange(event); } catch { /* surface-side issue */ }
  }
  return event;
}

/** Tighten typing — the watcher only needs the methods the resolver
 *  also relies on, not the full `DeviceCapabilitySet` value type. */
export type FleetCapabilitySetLike = DeviceCapabilitySet;

function bootstrapChange(next: FleetSignature): FleetChange {
  const devicesAdded = (Object.keys(next.kinds).filter((k) => (next.kinds[k] ?? 0) > 0)) as DeviceKind[];
  const capabilitiesAdded = Object.keys(next.capabilities);
  // First snapshot reconfigures (the resolver had nothing to apply
  // before); subsequent ticks only reconfigure on a real diff.
  return {
    kind: devicesAdded.length > 0 ? 'device-added' : 'no-change',
    devicesAdded,
    devicesRemoved: [],
    capabilitiesAdded,
    capabilitiesRemoved: [],
    shouldReconfigure: devicesAdded.length > 0 || capabilitiesAdded.length > 0,
  };
}
