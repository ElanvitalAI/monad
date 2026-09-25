// W9d-FU Z15.b · Devices substrate NEXUS boot composer.
// Cf. 내부 문서 §2.3 follow-up #4.
//
// Pattern mirrors `src/notifications/outbound-boot.ts` (#2453) and
// `src/background-reasoning/patcher-boot.ts` (W9d-FU U5).

import { jsonDevicesFleetSource } from './devices-json-source.js';
import {
  startDevicesFleetCron,
  type DevicesFleetCronHandle,
  type DevicesOutboundRouter,
} from './devices-cron.js';
import type { DeviceFleetSource } from './device-detector.js';
import { debug } from '../debug/log.js';

let devicesJsonMissingObserved = false;

export interface DevicesFleetSourceErrorSinks {
  warn?: (message: string) => void;
  observe?: (category: string, event: string) => void;
}

/** Missing devices.json means no Companion is paired. Observe that state once
 *  per process; preserve warnings for damaged or unreadable fleet data. */
export function createDevicesFleetSourceErrorReporter(
  sinks: DevicesFleetSourceErrorSinks = {},
): (err: unknown) => void {
  const warn = sinks.warn ?? ((message) => console.warn(message));
  const observe = sinks.observe ?? ((category, event) => debug.log(category, event));
  return (err: unknown): void => {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      if (!devicesJsonMissingObserved) {
        devicesJsonMissingObserved = true;
        observe('devices', `fleet source absent: ${msg}`);
      }
      return;
    }
    warn(`[devices] fleet source: ${msg}`);
  };
}

export type DevicesSkipReason =
  | 'devices-disabled-in-config'
  | 'devices-boot-error';

export interface DevicesSubstrate {
  /** Fleet source so the http `/v1/devices` handler can serve a
   *  snapshot even when the cron is disabled. */
  source: DeviceFleetSource;
  cron: DevicesFleetCronHandle | null;
  skipReason?: DevicesSkipReason;
  detail?: string;
}

export interface BuildDevicesSubstrateOpts {
  /** Optional outbound router — when wired, the cron emits an
   *  `OutboundEvent` on every meaningful fleet change. */
  router?: DevicesOutboundRouter;
  /** Override the fleet source path / read function. */
  source?: DeviceFleetSource;
  /** When false the cron is not scheduled (substrate still exposes
   *  source so `/v1/devices` returns the empty fleet on read). */
  cronEnabled?: boolean;
  tickIntervalMs?: number;
  retentionMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  now?: () => number;
}

export function buildDevicesSubstrate(opts: BuildDevicesSubstrateOpts = {}): DevicesSubstrate {
  const source = opts.source ?? jsonDevicesFleetSource({
    onError: createDevicesFleetSourceErrorReporter(),
  });

  if (opts.cronEnabled === false) {
    return {
      source,
      cron: null,
      skipReason: 'devices-disabled-in-config',
      detail: 'set devices.cron.enabled = true (or omit) to schedule fleet ticks',
    };
  }

  try {
    const cron = startDevicesFleetCron({
      source,
      ...(opts.router ? { router: opts.router } : {}),
      ...(opts.tickIntervalMs !== undefined ? { tickIntervalMs: opts.tickIntervalMs } : {}),
      ...(opts.retentionMs !== undefined ? { retentionMs: opts.retentionMs } : {}),
      ...(opts.setIntervalImpl ? { setIntervalImpl: opts.setIntervalImpl } : {}),
      ...(opts.clearIntervalImpl ? { clearIntervalImpl: opts.clearIntervalImpl } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    return { source, cron };
  } catch (err) {
    return {
      source,
      cron: null,
      skipReason: 'devices-boot-error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Idempotent shutdown helper — invoke from NEXUS stop path. */
export function stopDevicesSubstrate(substrate: DevicesSubstrate | undefined): void {
  if (substrate?.cron) {
    try { substrate.cron.stop(); } catch { /* best-effort */ }
  }
}
