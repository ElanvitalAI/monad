// ── PX-6 P3+P4: pane namespace + FocusCoordinator ──
//
// Pane namespace — plugin-host already prefixes contributed panes as
// `plugin:<pluginId>:<localId>` via pluginPaneId(). This module
// formalises the encode/decode pair + a collision detector so P6 CLI
// can enumerate + report overlaps.
//
// FocusCoordinator — cooperative single-owner key routing. One
// plugin owns input focus at a time; claim() resolves when owner
// releases. Not preemptive — the previous owner must release before
// the queued plugin's claim resolves. Deactivate should always call
// release() to avoid a stuck owner.

// ── Pane namespace ──────────────────────────────────────────────────

const PLUGIN_PANE_PREFIX = 'plugin:';

export interface PluginPaneRef {
  pluginId: string;
  localId: string;
}

export function encodePluginPaneId(pluginId: string, localId: string): string {
  return `${PLUGIN_PANE_PREFIX}${pluginId}:${localId}`;
}

export function decodePluginPaneId(paneId: string): PluginPaneRef | null {
  if (!paneId.startsWith(PLUGIN_PANE_PREFIX)) return null;
  const remainder = paneId.slice(PLUGIN_PANE_PREFIX.length);
  const split = remainder.indexOf(':');
  if (split <= 0 || split === remainder.length - 1) return null;
  return {
    pluginId: remainder.slice(0, split),
    localId: remainder.slice(split + 1),
  };
}

export function isPluginPaneId(paneId: string): boolean {
  return decodePluginPaneId(paneId) !== null;
}

/** Detect duplicate pane ids across a list of contributions. A
 *  collision is two entries with identical encoded paneId — possible
 *  when two plugins register the same localId but we double-encoded
 *  to the same string (shouldn't happen, guard-rail). */
export function detectPaneCollisions(
  contributions: ReadonlyArray<{ pluginId: string; paneId: string }>,
): Array<{ paneId: string; pluginIds: string[] }> {
  const groups = new Map<string, Set<string>>();
  for (const c of contributions) {
    const set = groups.get(c.paneId) ?? new Set<string>();
    set.add(c.pluginId);
    groups.set(c.paneId, set);
  }
  const collisions: Array<{ paneId: string; pluginIds: string[] }> = [];
  for (const [paneId, pluginIds] of groups) {
    if (pluginIds.size > 1) {
      collisions.push({ paneId, pluginIds: [...pluginIds].sort() });
    }
  }
  return collisions;
}

// ── FocusCoordinator ───────────────────────────────────────────────

interface PendingClaim {
  pluginId: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

export class FocusCoordinator {
  private owner: string | null = null;
  private queue: PendingClaim[] = [];
  private disposed = false;

  currentOwner(): string | null {
    return this.owner;
  }

  isOwner(pluginId: string): boolean {
    return this.owner === pluginId;
  }

  /** Reserve key focus for the given plugin. Resolves immediately
   *  if no-one holds it, otherwise queues FIFO until release(). */
  claim(pluginId: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('coordinator disposed'));
    if (this.owner === null) {
      this.owner = pluginId;
      return Promise.resolve();
    }
    if (this.owner === pluginId) {
      // already owner — idempotent
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ pluginId, resolve, reject });
    });
  }

  /** Relinquish focus. If a pending claim is queued, it resolves
   *  immediately (becoming the new owner). Callers should pair every
   *  claim() with a release() — deactivate paths should call release
   *  unconditionally (see PluginHost.deactivate). */
  release(pluginId: string): void {
    if (this.owner !== pluginId) return;
    this.owner = null;
    const next = this.queue.shift();
    if (next) {
      this.owner = next.pluginId;
      next.resolve();
    }
  }

  /** Force-release regardless of current owner — used by the host
   *  when a plugin crashes or deactivate fires mid-claim. Pending
   *  claims are rejected so dangling promises resolve. */
  forceRelease(reason = 'forced release'): void {
    this.owner = null;
    const pending = this.queue.splice(0, this.queue.length);
    for (const p of pending) {
      p.reject(new Error(reason));
    }
  }

  queueLength(): number {
    return this.queue.length;
  }

  dispose(): void {
    this.disposed = true;
    this.forceRelease('coordinator disposed');
  }
}

/** Process-wide singleton. Dashboard key-route consults this to pick
 *  which plugin's onKey receives the current event. */
export const globalFocusCoordinator = new FocusCoordinator();
