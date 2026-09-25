// ── undo-turn: ring-buffer store ──
//
// Process-local ring of the N most recent snapshots. Oldest entries
// slide off silently — the detached commits they reference stay in
// .git/objects until the user runs `git gc`, so if a user *really*
// wants an older snapshot they can still `git cat-file -p` it.
//
// Not persisted across sessions. A crashed / restarted monad starts
// with an empty ring; the orphan commits from the prior session are
// still in .git/objects but no longer indexed here. Documented in
// LESSONS.

import type { Snapshot } from './types.js';

const DEFAULT_MAX = 20;

function resolveMax(): number {
  const raw = process.env.MONAD_UNDO_HISTORY_MAX;
  if (!raw) return DEFAULT_MAX;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX;
  return Math.min(200, n);
}

let ring: Snapshot[] = [];

/** Push a new snapshot onto the ring. Trims oldest entries past the
 *  MAX cap. Returns the snapshot (same object) for chaining. */
export function pushSnapshot(s: Snapshot): Snapshot {
  ring.push(s);
  const max = resolveMax();
  while (ring.length > max) ring.shift();
  return s;
}

/** Snapshot list, oldest first. Returns a copy so callers can't
 *  mutate the ring. */
export function listSnapshots(): Snapshot[] {
  return ring.slice();
}

/** Most recent snapshot, or null when empty. */
export function peekSnapshot(): Snapshot | null {
  return ring.length > 0 ? ring[ring.length - 1]! : null;
}

/** Remove and return the most recent snapshot. */
export function popSnapshot(): Snapshot | null {
  return ring.pop() ?? null;
}

/** Find a snapshot by its short id or 40-char SHA. */
export function findSnapshotById(idOrSha: string): Snapshot | null {
  const needle = idOrSha.trim().toLowerCase();
  if (!needle) return null;
  for (let i = ring.length - 1; i >= 0; i--) {
    const s = ring[i]!;
    if (s.id === needle) return s;
    if (s.sha.toLowerCase() === needle) return s;
    if (s.sha.toLowerCase().startsWith(needle) && needle.length >= 4) return s;
  }
  return null;
}

/** Remove the snapshot + everything after it (so a targeted restore
 *  also drops the "redo" steps that would have come back to this
 *  state). Returns the number of entries removed. */
export function dropFromSnapshot(idOrSha: string): number {
  const needle = idOrSha.trim().toLowerCase();
  if (!needle) return 0;
  for (let i = 0; i < ring.length; i++) {
    const s = ring[i]!;
    if (s.id === needle || s.sha.toLowerCase() === needle ||
        (needle.length >= 4 && s.sha.toLowerCase().startsWith(needle))) {
      const dropped = ring.length - i;
      ring = ring.slice(0, i);
      return dropped;
    }
  }
  return 0;
}

/** Drop everything. UX for `/undo clear` — the detached commits
 *  themselves stay in .git/objects until `git gc`. */
export function clearSnapshots(): number {
  const n = ring.length;
  ring = [];
  return n;
}

export function __resetSnapshotStore(): void {
  ring = [];
}
