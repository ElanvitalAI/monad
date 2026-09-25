// W9d-FU Z15.b · `~/.monad/devices.json` reader → DeviceFleetSource.
// Cf. 내부 문서 §2.3 follow-up #4.
//
// The iOS Companion writes `~/.monad/devices.json` on iCloud device-family
// sync; the daemon reads it through this source. Schema (intentionally
// permissive):
//
// [
//   {
//     "deviceId": "icloud:abcd...",
//     "kind": "iphone" | "iphone-pro" | "watch" | "airpods-pro" | "ipad" | "mac" | "vision-pro",
//     "model": "iPhone15,3",         // optional · iPhone Pro/Max promotion uses this
//     "capabilities": ["lidar", ...], // optional · resolver uses these tokens
//     "lastSeenAt": 1715512345678     // optional · stale drop uses this
//   },
//   ...
// ]
//
// Missing file / parse error → returns `[]` (no devices). The substrate
// surfaces this as "no Apple devices detected yet" in the PWA empty state.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DeviceFleetSource, RawDeviceRow } from './device-detector.js';

export function defaultDevicesJsonPath(): string {
  return join(homedir(), '.monad', 'devices.json');
}

export interface JsonDevicesSourceOpts {
  /** Override path. Defaults to `~/.monad/devices.json`. */
  path?: string;
  /** Test seam — override the disk read. */
  read?: (path: string) => string;
  /** Telemetry hook — called when the file is missing or unparseable so
   *  a daemon `console.warn` can surface the failure. The source itself
   *  swallows the failure and returns `[]` so a misconfigured file
   *  doesn't crash the cron tick. */
  onError?: (err: unknown) => void;
}

/** Build a `DeviceFleetSource` that reads `~/.monad/devices.json` (or
 *  the override) on every `.read()`. The source is intentionally
 *  stateless — the caller (`tickUpgradeWatcher`) holds the snapshot. */
export function jsonDevicesFleetSource(opts: JsonDevicesSourceOpts = {}): DeviceFleetSource {
  const path = opts.path ?? defaultDevicesJsonPath();
  const read = opts.read ?? ((p) => readFileSync(p, 'utf8'));

  return {
    async read(): Promise<readonly RawDeviceRow[]> {
      let raw: string;
      try { raw = read(path); }
      catch (err) {
        if (opts.onError) opts.onError(err);
        return [];
      }
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch (err) {
        if (opts.onError) opts.onError(err);
        return [];
      }
      if (!Array.isArray(parsed)) {
        if (opts.onError) opts.onError(new Error('devices.json root is not an array'));
        return [];
      }
      return parsed.map(coerceRow).filter((r): r is RawDeviceRow => r !== null);
    },
  };
}

function coerceRow(raw: unknown): RawDeviceRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.deviceId !== 'string' || !r.deviceId.trim()) return null;
  if (typeof r.kind !== 'string' || !r.kind.trim()) return null;
  const row: RawDeviceRow = {
    deviceId: r.deviceId,
    // `kind` validation lives downstream in `detectFleet` (it filters
    // via `isDeviceKind`). We pass through here so the watcher logs a
    // clean dropped-row warning instead of a parse-level rejection.
    kind: r.kind as RawDeviceRow['kind'],
  };
  if (typeof r.model === 'string') row.model = r.model;
  if (Array.isArray(r.capabilities)) {
    row.capabilities = r.capabilities.filter((c): c is string => typeof c === 'string');
  }
  if (typeof r.lastSeenAt === 'number') row.lastSeenAt = r.lastSeenAt;
  return row;
}
