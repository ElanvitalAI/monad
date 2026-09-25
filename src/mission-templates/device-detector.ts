// W9b Z15.b · Device fleet detector — Apple device family snapshot.
// Cf. ROADMAP-showroom-x-task-fabric-2026-05-12.md §3 S23 + §4 Z15.b.
//
// `DeviceDetector` answers "what Apple devices does this user own right
// now?" by reading a `DeviceFleetSource`. Production wires the source to
// `~/.monad/devices.json` (which the iOS Companion periodically refreshes
// from CKShare / iCloud device family); tests pass an inline source.
//
// The detector normalises raw rows into a stable `DeviceCapabilitySet`
// keyed on `device-kind` so the resolver can ask "do I have a
// `lidar`-capable iPhone?" without each consumer re-parsing model strings.

export type DeviceKind =
  | 'iphone'           // any iPhone (no Pro guarantee)
  | 'iphone-pro'       // Pro-class with LiDAR
  | 'watch'
  | 'airpods-pro'
  | 'ipad'
  | 'mac'
  | 'vision-pro';

export const DEVICE_KINDS: readonly DeviceKind[] = [
  'iphone', 'iphone-pro', 'watch', 'airpods-pro', 'ipad', 'mac', 'vision-pro',
] as const;

export function isDeviceKind(v: unknown): v is DeviceKind {
  return typeof v === 'string' && (DEVICE_KINDS as readonly string[]).includes(v);
}

export interface RawDeviceRow {
  /** Stable identifier — usually the iCloud device record id. The
   *  detector does not interpret it beyond dedup. */
  deviceId: string;
  /** Apple model string (e.g. "iPhone15,3"). Used to infer
   *  `iphone-pro` (LiDAR) when the kind is `iphone`. */
  model?: string;
  kind: DeviceKind;
  /** Capability tokens the device advertises. The detector keeps these
   *  verbatim and trusts upstream — the iCloud Companion is the source
   *  of truth for what an actual device can/can't do. */
  capabilities?: readonly string[];
  /** Wall-clock ms the device last reported as online. The detector
   *  uses `now - lastSeenAt < retentionMs` to drop stale entries. */
  lastSeenAt?: number;
}

export interface DeviceCapabilitySet {
  /** Map of `device-kind` → capability tokens this kind currently owns.
   *  When the user has 2 iPhones, capabilities union (an iPhone Pro +
   *  base iPhone yields both `lidar` and the base camera token). */
  byKind: Map<DeviceKind, Set<string>>;
  /** Device-kind multiplicity (e.g. 2 iPads). The resolver checks
   *  `count('watch') > 0` rather than `byKind.has('watch')` because
   *  the latter would be true even if the only watch row is stale. */
  count(kind: DeviceKind): number;
  /** `true` when this fleet has any device advertising `capability`. */
  has(capability: string): boolean;
  /** Number of distinct devices in the snapshot (post-dedup, post-stale). */
  totalDevices: number;
  /** Wall-clock ms the snapshot was built. Used by the watcher to
   *  diff successive snapshots. */
  snapshotAt: number;
}

export interface DeviceFleetSource {
  /** Resolve the latest fleet. Implementations may cache. */
  read(): Promise<readonly RawDeviceRow[]>;
}

export interface DeviceDetectorOpts {
  source: DeviceFleetSource;
  /** Drop rows whose `lastSeenAt` is older than this. Default 90 days. */
  retentionMs?: number;
  now?: () => number;
}

const DEFAULT_RETENTION = 90 * 24 * 60 * 60 * 1000;

/** Build a `DeviceCapabilitySet` from the source.
 *  Deduplicates by `deviceId`; the row with the most-recent
 *  `lastSeenAt` wins on conflicts.
 *  Promotes `iphone` → `iphone-pro` automatically when the model
 *  string matches the LiDAR-bearing iPhone Pro series. */
export async function detectFleet(opts: DeviceDetectorOpts): Promise<DeviceCapabilitySet> {
  const now = (opts.now ?? Date.now)();
  const retention = opts.retentionMs ?? DEFAULT_RETENTION;
  const raw = await opts.source.read();

  const deduped = new Map<string, RawDeviceRow>();
  for (const row of raw) {
    if (!isDeviceKind(row.kind)) continue;
    if (row.lastSeenAt !== undefined && now - row.lastSeenAt > retention) continue;
    const existing = deduped.get(row.deviceId);
    if (!existing || (row.lastSeenAt ?? 0) >= (existing.lastSeenAt ?? 0)) {
      deduped.set(row.deviceId, row);
    }
  }

  const byKind = new Map<DeviceKind, Set<string>>();
  for (const row of deduped.values()) {
    const promoted = promoteKind(row);
    const set = byKind.get(promoted) ?? new Set<string>();
    for (const cap of row.capabilities ?? []) set.add(cap);
    byKind.set(promoted, set);
  }

  const kindCounts = new Map<DeviceKind, number>();
  for (const row of deduped.values()) {
    const promoted = promoteKind(row);
    kindCounts.set(promoted, (kindCounts.get(promoted) ?? 0) + 1);
  }

  return {
    byKind,
    count: (kind) => kindCounts.get(kind) ?? 0,
    has: (capability) => {
      for (const caps of byKind.values()) {
        if (caps.has(capability)) return true;
      }
      return false;
    },
    totalDevices: deduped.size,
    snapshotAt: now,
  };
}

const IPHONE_PRO_MODEL_RE = /^iPhone(1[1-9]|[2-9][0-9])/i;

function promoteKind(row: RawDeviceRow): DeviceKind {
  if (row.kind === 'iphone' && row.model) {
    if ((row.capabilities ?? []).includes('lidar')) return 'iphone-pro';
    if (IPHONE_PRO_MODEL_RE.test(row.model) && /pro|max/i.test(row.model)) {
      return 'iphone-pro';
    }
  }
  return row.kind;
}

/** Convenience source for tests / dev — just return the rows passed in. */
export function staticDeviceFleetSource(rows: readonly RawDeviceRow[]): DeviceFleetSource {
  const frozen = rows.map((r) => ({ ...r }));
  return { async read() { return frozen; } };
}
