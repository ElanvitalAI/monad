// ── PFC-S2 P2: agent completion flash + unread tracking ──
//
// When a background (or foreground, for operator visibility) task
// transitions to a terminal state, we remember it briefly so the
// roster renderer can paint a one-frame pulse behind the row. The
// tracker is time-based — no tick loop needed; the roster's per-redraw
// `isFlashing(id)` call checks Date.now() against the registered
// timestamp and returns true while the entry is still within
// FLASH_DURATION_MS. Entries older than that are silently ignored on
// the next lookup (they get purged lazily in `pending()`).
//
// This file is deliberately UI-agnostic: it produces booleans. The
// actual row highlight (ANSI background color) lives in
// src/display/agent-surface.ts::renderAgentRoster.
//
// Wiring: src/agent/task-notification.ts registers a second
// onTaskDone listener at module load that calls
// `globalAgentFlash.register(task.id)` for every terminal-state
// transition (foreground OR background). Keeping the flash
// universal lets the operator see completion even for synchronous
// Agent() calls they were watching.

export interface FlashEntry {
  taskId: string;
  startedAt: number;
}

/** 1.5 seconds of pulse — long enough to catch the eye on a redraw
 *  cadence of ~2 Hz without lingering past the operator's next glance.
 *  The roster renderer's redraw is driven by dashboard state ticks,
 *  not a flash-specific timer, so the pulse duration is really "how
 *  many redraws it survives" rather than a precise number of frames. */
export const FLASH_DURATION_MS = 1500;

export class AgentFlashTracker {
  private entries = new Map<string, FlashEntry>();

  /** Mark a task as just-completed — subsequent isFlashing(id) calls
   *  return true for FLASH_DURATION_MS. Re-registering while active
   *  resets the timer (operator sees a fresh pulse if a task
   *  completes twice — e.g., retry). */
  register(taskId: string, now: number = Date.now()): void {
    this.entries.set(taskId, { taskId, startedAt: now });
  }

  /** True when the entry is still within the flash window. Expired
   *  entries are purged opportunistically on access. */
  isFlashing(taskId: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(taskId);
    if (!entry) return false;
    if (now - entry.startedAt >= FLASH_DURATION_MS) {
      this.entries.delete(taskId);
      return false;
    }
    return true;
  }

  /** Drop a flash entry early — e.g., when the user explicitly
   *  navigates away or acknowledges. Idempotent. */
  clear(taskId: string): void {
    this.entries.delete(taskId);
  }

  /** All currently-pulsing task ids. Called by unread-count badge on
   *  the roster character. Purges expired entries as a side effect
   *  so the Map does not grow unboundedly over a long session. */
  pending(now: number = Date.now()): readonly string[] {
    const alive: string[] = [];
    for (const [id, entry] of this.entries) {
      if (now - entry.startedAt < FLASH_DURATION_MS) alive.push(id);
      else this.entries.delete(id);
    }
    return alive;
  }

  /** Forget every entry — tests rely on this for isolation. */
  clearAll(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Process-wide singleton. The roster renderer imports this directly
 *  rather than threading a tracker through widget state — the tracker
 *  is effectively a cross-cutting signal bus. */
export const globalAgentFlash = new AgentFlashTracker();
