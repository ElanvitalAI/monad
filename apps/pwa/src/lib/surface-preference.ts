/**
 * PR-D (PWA surface picker · 2026-05-13) — persistent surface-kind
 * preference for the chat client.
 *
 * Stores the user's selected `DaemonToolSurfaceKind` (or `null` for
 * "use daemon default") in `localStorage` under `elanous.chat.surface`.
 * Multiple tabs stay in sync via the native `storage` event so a
 * change in one tab propagates to subscribers in every other tab
 * without an extra IPC channel.
 *
 * Persistence is opt-in per-host: the preference is null until the
 * user picks a non-default kind from `<SurfacePicker>`, at which
 * point each turn ChatLayout forwards as `tools` on the
 * `/v1/prompt/stream` body. `null` means "send no `tools` field" —
 * the daemon then falls back to its boot-time surface (CLI `--tools`
 * or `global.tools`). Always-on persistence (write even when the
 * picker is at "default") would force the daemon to honor the PWA
 * choice in perpetuity, which is the wrong UX — defaults change as
 * the daemon evolves.
 */

import type { DaemonToolSurfaceKind } from './daemon-client';
import { DAEMON_TOOL_SURFACE_KINDS } from './daemon-client';

export const SURFACE_PREFERENCE_KEY = 'elanous.chat.surface';

/** Special value the picker uses to mean "send no `tools` field" —
 *  the daemon's configured surface (CLI `--tools` or `global.tools`)
 *  wins. Persisted as the empty string in localStorage. Renderers
 *  treat `null` as "default selected". */
export type SurfacePreference = DaemonToolSurfaceKind | null;

function isDaemonToolSurfaceKind(value: unknown): value is DaemonToolSurfaceKind {
  return (
    typeof value === 'string'
    && (DAEMON_TOOL_SURFACE_KINDS as readonly string[]).includes(value)
  );
}

/** Read the current preference. Returns `null` when no preference is
 *  stored (or when running in SSR / a non-browser context where
 *  `localStorage` is unavailable). Unknown stored values are treated
 *  as `null` so stale entries from an older PWA build don't crash
 *  the renderer. */
export function getSurfacePreference(): SurfacePreference {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(SURFACE_PREFERENCE_KEY);
    if (raw === null || raw === '') return null;
    return isDaemonToolSurfaceKind(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Update (or clear) the preference. Passing `null` removes the
 *  localStorage entry so the daemon's default takes effect again.
 *  Returns true on success; false when localStorage is unavailable
 *  or threw (private-mode safari · quota exceeded). */
export function setSurfacePreference(value: SurfacePreference): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    if (value === null) {
      window.localStorage.removeItem(SURFACE_PREFERENCE_KEY);
    } else {
      window.localStorage.setItem(SURFACE_PREFERENCE_KEY, value);
    }
    notifyLocalSubscribers(value);
    return true;
  } catch {
    return false;
  }
}

// In-process subscriber set — needed because the `storage` event only
// fires in OTHER tabs/windows, not the one that called setItem. So a
// component setting the preference in tab A would not re-render itself
// unless we also dispatch locally.
const localSubscribers = new Set<(value: SurfacePreference) => void>();

function notifyLocalSubscribers(value: SurfacePreference): void {
  for (const cb of localSubscribers) {
    try {
      cb(value);
    } catch {
      /* one bad subscriber must not break the others */
    }
  }
}

/** Subscribe to preference changes from any tab. Returns an
 *  unsubscribe function. Subscribers fire with the new value
 *  (already validated against the kind union — unknowns coerce to
 *  `null`). Cross-tab updates flow through the `storage` event;
 *  same-tab updates flow through the in-process fanout set. */
export function subscribeSurfacePreference(
  callback: (value: SurfacePreference) => void,
): () => void {
  localSubscribers.add(callback);
  let handler: ((ev: StorageEvent) => void) | null = null;
  if (typeof window !== 'undefined') {
    handler = (ev: StorageEvent): void => {
      if (ev.key !== SURFACE_PREFERENCE_KEY) return;
      const next = ev.newValue;
      if (next === null || next === '') {
        callback(null);
        return;
      }
      callback(isDaemonToolSurfaceKind(next) ? next : null);
    };
    window.addEventListener('storage', handler);
  }
  return (): void => {
    localSubscribers.delete(callback);
    if (handler && typeof window !== 'undefined') {
      window.removeEventListener('storage', handler);
    }
  };
}
