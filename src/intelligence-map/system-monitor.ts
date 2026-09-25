// ── PFC-S5 P3: system monitor ──
//
// CPU load average + memory via Node `os` APIs only — no external
// binaries. 5-second cache so ambient UI polling does not thrash.
// Temperature monitoring (osx-cpu-temp / sensors) is deferred to the
// follow-up pfc-intelligence-runners session (platform-specific).

import { arch, cpus, freemem, loadavg, platform, totalmem } from 'node:os';
import type { SystemSnapshot } from './types.js';

export const DEFAULT_TTL_MS = 5000;
const BYTES_PER_GB = 1024 ** 3;

interface CachedSnapshot {
  snapshot: SystemSnapshot;
  expiresAt: number;
}

let cache: CachedSnapshot | null = null;

export interface SystemSnapshotOpts {
  ttlMs?: number;
  now?: number;
}

export function getSystemSnapshot(opts: SystemSnapshotOpts = {}): SystemSnapshot {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (cache && cache.expiresAt > now && opts.ttlMs === undefined && opts.now === undefined) {
    return cache.snapshot;
  }
  const snap = buildSnapshot(now);
  cache = { snapshot: snap, expiresAt: now + ttl };
  return snap;
}

export function resetSystemMonitorCacheForTest(): void {
  cache = null;
}

function buildSnapshot(now: number): SystemSnapshot {
  const cpuList = cpus();
  const cpuCount = cpuList.length || 1;
  const load = loadavg();
  const loadAvg1 = load[0] ?? 0;
  const loadAvg5 = load[1] ?? 0;
  const loadAvg15 = load[2] ?? 0;
  const cpuPercent = clampPercent((loadAvg1 / cpuCount) * 100);
  const free = freemem();
  const total = totalmem() || 1;
  return {
    cpuCount,
    loadAvg1,
    loadAvg5,
    loadAvg15,
    cpuPercent,
    freeMemGb: round2(free / BYTES_PER_GB),
    totalMemGb: round2(total / BYTES_PER_GB),
    freeMemPercent: clampPercent((free / total) * 100),
    platform: platform(),
    arch: arch(),
    snapshotAt: now,
  };
}

function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return round2(v);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function formatSystemLine(snap: SystemSnapshot): string {
  return `CPU ${snap.cpuPercent.toFixed(0)}% (${snap.cpuCount} cores) · RAM ${snap.freeMemGb.toFixed(1)}/${snap.totalMemGb.toFixed(1)} GB free`;
}
