// W9d-FU Z15.b · Devices fleet cron — periodic tick + OutboundRouter
// onChange consumer. Cf. HANDOFF §2.3 follow-up #4.
//
// On each tick:
//   1. read fleet via injected `DeviceFleetSource`
//   2. `detectFleet` → `DeviceCapabilitySet`
//   3. `tickUpgradeWatcher` → `FleetChangeEvent`
//   4. when `change.shouldReconfigure === true` and router is wired,
//      route an `OutboundEvent` so the surface (iOS push / live
//      activity / PWA toast) can notify the user that a new
//      capability is available

import { detectFleet, type DeviceCapabilitySet, type DeviceFleetSource } from './device-detector.js';
import {
  tickUpgradeWatcher,
  createFleetWatcherState,
  type FleetChange,
  type FleetChangeEvent,
  type FleetWatcherState,
} from './upgrade-watcher.js';

/** Subset of `OutboundRouter` this module relies on. Defined as a
 *  structural interface so tests can inject a stub without importing
 *  the showroom/outbound package. */
export interface DevicesOutboundRouter {
  route(event: {
    id: string;
    source: 'showroom' | 'workflow_runtime' | 'task_orchestrator' | 'thinker' | 'patcher';
    urgency: 'low' | 'normal' | 'high' | 'critical';
    title: string;
    body?: string;
    payload?: Record<string, unknown>;
    ts: number;
  }): Promise<unknown>;
}

export interface DevicesFleetCronDeps {
  source: DeviceFleetSource;
  router?: DevicesOutboundRouter;
  state?: FleetWatcherState;
  /** Default `15 * 60 * 1000` (15 minutes). Lower for tests. */
  tickIntervalMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  /** Test seam — `now()` reaches `detectFleet` so the retention drop is
   *  deterministic. */
  now?: () => number;
  retentionMs?: number;
  /** Observed on every tick (router or not). Surface layer can keep a
   *  ring buffer for `/v1/health`. */
  onTick?: (event: FleetChangeEvent, fleet: DeviceCapabilitySet) => void;
  /** Observed when a tick throws — defaults to `console.error`. */
  onError?: (err: unknown) => void;
}

export interface DevicesFleetCronHandle {
  tickOnce(): Promise<{ event: FleetChangeEvent; fleet: DeviceCapabilitySet }>;
  stop(): void;
  diagnostics(): { ticks: number; lastChangeKind: FleetChange['kind'] | null; running: boolean };
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

export function startDevicesFleetCron(deps: DevicesFleetCronDeps): DevicesFleetCronHandle {
  const intervalMs = deps.tickIntervalMs ?? DEFAULT_INTERVAL_MS;
  const setIntervalFn = deps.setIntervalImpl ?? setInterval;
  const clearIntervalFn = deps.clearIntervalImpl ?? clearInterval;
  const onError = deps.onError ?? ((err) => { console.error('[devices-cron]', err); });
  const state = deps.state ?? createFleetWatcherState();

  let ticks = 0;
  let lastChangeKind: FleetChange['kind'] | null = null;
  let stopped = false;

  async function runTick(): Promise<{ event: FleetChangeEvent; fleet: DeviceCapabilitySet }> {
    const fleet = await detectFleet({
      source: deps.source,
      ...(deps.retentionMs !== undefined ? { retentionMs: deps.retentionMs } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    const event = await tickUpgradeWatcher(state, fleet, {
      ...(deps.now ? { now: deps.now } : {}),
      onChange: deps.router
        ? async (changeEvent) => {
            try { await routeFleetChange(deps.router!, changeEvent); }
            catch (err) { onError(err); }
          }
        : undefined,
    });
    ticks += 1;
    lastChangeKind = event.change.kind;
    if (deps.onTick) {
      try { deps.onTick(event, fleet); } catch { /* surface side */ }
    }
    return { event, fleet };
  }

  const timer = setIntervalFn(() => {
    if (stopped) return;
    runTick().catch(onError);
  }, intervalMs);

  return {
    async tickOnce() { return runTick(); },
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(timer);
    },
    diagnostics() {
      return { ticks, lastChangeKind, running: !stopped };
    },
  };
}

async function routeFleetChange(router: DevicesOutboundRouter, event: FleetChangeEvent): Promise<void> {
  // Devices addition is the noteworthy signal — capability-added /
  // device-removed surface separately to keep the toast actionable.
  if (event.change.kind === 'no-change') return;

  const { devicesAdded, capabilitiesAdded, devicesRemoved } = event.change;
  const title = titleForChange(event.change.kind, devicesAdded, devicesRemoved, capabilitiesAdded);
  const body = bodyForChange(event.change);
  await router.route({
    id: `device-fleet-${event.observedAt}`,
    source: 'task_orchestrator',
    urgency: event.change.kind === 'device-added' ? 'normal' : 'low',
    title,
    body,
    payload: {
      changeKind: event.change.kind,
      devicesAdded,
      devicesRemoved,
      capabilitiesAdded,
      capabilitiesRemoved: event.change.capabilitiesRemoved,
    },
    ts: event.observedAt,
  });
}

function titleForChange(
  kind: FleetChange['kind'],
  added: string[],
  removed: string[],
  capsAdded: string[],
): string {
  switch (kind) {
    case 'device-added':
      return `New ${added[0] ?? 'device'} detected`;
    case 'device-removed':
      return `${removed[0] ?? 'device'} no longer in fleet`;
    case 'capability-added':
      return capsAdded.length === 1
        ? `New capability: ${capsAdded[0]}`
        : `${capsAdded.length} new capabilities`;
    case 'capability-removed':
      return 'A device capability went offline';
    case 'no-change':
      return 'Fleet snapshot';
  }
}

function bodyForChange(change: FleetChange): string {
  const parts: string[] = [];
  if (change.devicesAdded.length > 0) parts.push(`+ ${change.devicesAdded.join(', ')}`);
  if (change.devicesRemoved.length > 0) parts.push(`- ${change.devicesRemoved.join(', ')}`);
  if (change.capabilitiesAdded.length > 0) parts.push(`+caps ${change.capabilitiesAdded.join(', ')}`);
  if (change.capabilitiesRemoved.length > 0) parts.push(`-caps ${change.capabilitiesRemoved.join(', ')}`);
  return parts.join(' · ');
}
