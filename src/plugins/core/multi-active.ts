// ── PX-6 P2: peer-compat check + multi-active bookkeeping ──
//
// The full "multiple plugins active at once" runtime is a progressive
// rollout — this phase lands the **decision** primitive so plugin-host
// can reject incompatible combinations at activate. The single-active
// code path (deactivate-then-activate) is preserved by default;
// multi-active turns on only when every participating plugin sets
// allowMultiActive: true AND peer compat allows.
//
// Consumers:
//   plugin-host.activate → checkPeerCompat(candidate, peers)
//   /plugins active slash (P6) → activePluginList(peers)
//
// Design decision — advisory quota (DD-PX-14):
//   QuotaCoordinator tracks usage per plugin + emits toast on breach.
//   Plugins are expected to `check()` before spending a resource and
//   self-throttle. Host does NOT hard-enforce (plugin code still runs)
//   so existing plugins are never surprised by a block.

import type { PluginManifest } from './manifest.js';

export type CompatStatus =
  | 'ok'
  | 'deny-explicit'     // candidate's deny includes peer, or peer's deny includes candidate
  | 'allow-list-mismatch'   // candidate's non-empty allow excludes peer
  | 'peer-single-active'    // one of the parties has allowMultiActive: false
  | 'self-single-active';

export interface CompatDecision {
  ok: boolean;
  status: CompatStatus;
  /** Which plugin id blocked the activation (for the toast text). */
  blockedBy?: string;
  reason: string;
}

/** Check whether `candidate` may coexist with every plugin in
 *  `peers`. Returns `ok:true` when multi-active is either granted
 *  by both parties or `peers` is empty (first plugin). */
export function checkPeerCompat(
  candidate: PluginManifest,
  peers: readonly PluginManifest[],
): CompatDecision {
  if (peers.length === 0) {
    return { ok: true, status: 'ok', reason: 'no peers active' };
  }
  if (!candidate.allowMultiActive) {
    return {
      ok: false,
      status: 'self-single-active',
      reason: `plugin '${candidate.id}' declares allowMultiActive=false; cannot coexist with peers`,
    };
  }
  for (const peer of peers) {
    if (!peer.allowMultiActive) {
      return {
        ok: false,
        status: 'peer-single-active',
        blockedBy: peer.id,
        reason: `peer '${peer.id}' declares allowMultiActive=false; cannot share activation`,
      };
    }
    const denyFromCandidate = candidate.activePeerCompat?.deny ?? [];
    if (denyFromCandidate.includes(peer.id)) {
      return {
        ok: false,
        status: 'deny-explicit',
        blockedBy: peer.id,
        reason: `plugin '${candidate.id}' deny-lists peer '${peer.id}'`,
      };
    }
    const denyFromPeer = peer.activePeerCompat?.deny ?? [];
    if (denyFromPeer.includes(candidate.id)) {
      return {
        ok: false,
        status: 'deny-explicit',
        blockedBy: peer.id,
        reason: `peer '${peer.id}' deny-lists plugin '${candidate.id}'`,
      };
    }
    const allowFromCandidate = candidate.activePeerCompat?.allow ?? [];
    if (allowFromCandidate.length > 0 && !allowFromCandidate.includes(peer.id)) {
      return {
        ok: false,
        status: 'allow-list-mismatch',
        blockedBy: peer.id,
        reason: `plugin '${candidate.id}' allow-list excludes '${peer.id}'`,
      };
    }
    const allowFromPeer = peer.activePeerCompat?.allow ?? [];
    if (allowFromPeer.length > 0 && !allowFromPeer.includes(candidate.id)) {
      return {
        ok: false,
        status: 'allow-list-mismatch',
        blockedBy: peer.id,
        reason: `peer '${peer.id}' allow-list excludes '${candidate.id}'`,
      };
    }
  }
  return { ok: true, status: 'ok', reason: 'all peer compat checks passed' };
}

// ── Active plugin list (read-only snapshot) ────────────────────────────

/** Host-friendly description of a single active plugin. Used by the
 *  CLI / status pill. Kept minimal so the host can build it from its
 *  ActivePlugin entries without threading extra fields. */
export interface ActivePluginSummary {
  id: string;
  allowMultiActive: boolean;
  activatedAt: number;
  quota?: {
    ptySpawns: { used: number; cap: number | undefined };
    concurrentSubagents: { used: number; cap: number | undefined };
    tokensPerTurn: { used: number; cap: number | undefined };
  };
}

// ── CLI formatting helpers (P6) ───────────────────────────────────────

/** Render `/plugins active` output as a fixed-width text table. Host
 *  calls this from the slash dispatcher after collecting active plugin
 *  summaries. */
export function formatActivePluginsTable(summaries: readonly ActivePluginSummary[]): string {
  if (summaries.length === 0) {
    return '(no plugins active)';
  }
  const rows: string[][] = [
    ['id', 'multi', 'uptime', 'quota'],
  ];
  const now = Date.now();
  for (const s of summaries) {
    const uptime = formatMs(now - s.activatedAt);
    const quotaStr = s.quota
      ? quotaLine(s.quota)
      : '—';
    rows.push([
      s.id,
      s.allowMultiActive ? 'yes' : 'no',
      uptime,
      quotaStr,
    ]);
  }
  return renderTable(rows);
}

function quotaLine(q: NonNullable<ActivePluginSummary['quota']>): string {
  const parts: string[] = [];
  for (const [axis, short] of [
    ['ptySpawns', 'pty'], ['concurrentSubagents', 'sub'], ['tokensPerTurn', 'tok'],
  ] as const) {
    const v = q[axis as keyof typeof q];
    if (v.cap === undefined) continue;
    parts.push(`${short} ${v.used}/${v.cap}`);
  }
  return parts.join(' · ') || '—';
}

function formatMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function renderTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const len = row[i]!.length;
      if ((widths[i] ?? 0) < len) widths[i] = len;
    }
  }
  return rows.map(r => r.map((cell, i) => cell.padEnd(widths[i]!)).join('  ')).join('\n');
}
