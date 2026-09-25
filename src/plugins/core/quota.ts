// ── PX-6 P5: QuotaCoordinator (advisory counters) ──
//
// Per-plugin usage counters for 3 axes:
//   ptySpawns            — how many PTY surfaces this plugin created
//   concurrentSubagents  — how many Agent() spawns are live
//   tokensPerTurn         — rolling token usage for the current turn
//
// DD-PX-14 — advisory, NOT hard-enforce. bump() always succeeds and
// returns the current check result; callers read `ok:false` to
// self-throttle. The host surfaces breaches via toast / log.
//
// Lifecycle: register(pluginId, quota) on activate; unregister on
// deactivate. reset(pluginId, axis) — per-turn reset for tokensPerTurn
// or manual reset after the underlying resource is released.

import type { PluginResourceQuota } from './manifest.js';

export type QuotaAxis = 'ptySpawns' | 'concurrentSubagents' | 'tokensPerTurn';

export const QUOTA_AXES: readonly QuotaAxis[] = [
  'ptySpawns', 'concurrentSubagents', 'tokensPerTurn',
] as const;

export interface QuotaCheck {
  ok: boolean;                        // false when used >= cap
  used: number;
  cap: number | undefined;            // undefined → unlimited
  axis: QuotaAxis;
  pluginId: string;
}

interface QuotaEntry {
  quota: PluginResourceQuota;
  used: Record<QuotaAxis, number>;
}

export class QuotaCoordinator {
  private entries = new Map<string, QuotaEntry>();
  private breachListeners = new Set<(check: QuotaCheck) => void>();

  register(pluginId: string, quota: PluginResourceQuota | undefined): void {
    if (!quota) {
      this.entries.set(pluginId, {
        quota: {},
        used: { ptySpawns: 0, concurrentSubagents: 0, tokensPerTurn: 0 },
      });
      return;
    }
    this.entries.set(pluginId, {
      quota: { ...quota },
      used: { ptySpawns: 0, concurrentSubagents: 0, tokensPerTurn: 0 },
    });
  }

  unregister(pluginId: string): void {
    this.entries.delete(pluginId);
  }

  /** Increment usage + return the post-bump check. Fires breach
   *  listeners on transition from ok → !ok. */
  bump(pluginId: string, axis: QuotaAxis, delta = 1): QuotaCheck {
    const entry = this.entries.get(pluginId);
    if (!entry) {
      return { ok: true, used: 0, cap: undefined, axis, pluginId };
    }
    const before = entry.used[axis];
    entry.used[axis] += delta;
    const check = this.check(pluginId, axis);
    const beforeOk = before < (entry.quota[axis] ?? Infinity);
    if (beforeOk && !check.ok) this.fireBreach(check);
    return check;
  }

  /** Read-only check without bumping. */
  check(pluginId: string, axis: QuotaAxis): QuotaCheck {
    const entry = this.entries.get(pluginId);
    if (!entry) return { ok: true, used: 0, cap: undefined, axis, pluginId };
    const cap = entry.quota[axis];
    const used = entry.used[axis];
    return {
      ok: cap === undefined || used < cap,
      used,
      cap,
      axis,
      pluginId,
    };
  }

  /** Decrement a released resource. For tokensPerTurn use reset()
   *  at turn boundary; for ptySpawns/subagents call release() when
   *  the resource actually closes. No-op on unknown plugin/axis. */
  release(pluginId: string, axis: QuotaAxis, delta = 1): void {
    const entry = this.entries.get(pluginId);
    if (!entry) return;
    entry.used[axis] = Math.max(0, entry.used[axis] - delta);
  }

  /** Zero one axis — typically tokensPerTurn between turns. */
  reset(pluginId: string, axis?: QuotaAxis): void {
    const entry = this.entries.get(pluginId);
    if (!entry) return;
    if (axis) {
      entry.used[axis] = 0;
    } else {
      for (const a of QUOTA_AXES) entry.used[a] = 0;
    }
  }

  snapshot(pluginId: string): Record<QuotaAxis, { used: number; cap: number | undefined }> | null {
    const entry = this.entries.get(pluginId);
    if (!entry) return null;
    const out: Record<QuotaAxis, { used: number; cap: number | undefined }> = {} as any;
    for (const axis of QUOTA_AXES) {
      out[axis] = { used: entry.used[axis], cap: entry.quota[axis] };
    }
    return out;
  }

  onBreach(listener: (check: QuotaCheck) => void): { dispose(): void } {
    this.breachListeners.add(listener);
    return { dispose: () => { this.breachListeners.delete(listener); } };
  }

  private fireBreach(check: QuotaCheck): void {
    for (const listener of this.breachListeners) {
      try { listener(check); } catch { /* observer isolation */ }
    }
  }

  /** Testing helper. */
  clear(): void {
    this.entries.clear();
    this.breachListeners.clear();
  }
}

export const globalQuotaCoordinator = new QuotaCoordinator();
