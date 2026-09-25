// Round 3 PR2 (β-2 · 2026-05-08) — Showroom HITL toggle persistence.
//
// Single localStorage key the toggle button + agent-cli call site
// share. SSR-safe: every reader checks for `typeof window` first
// so the value defaults to "HITL on" (i.e. NOT disabled) on Node.

const STORAGE_KEY = 'showroom.hitl.disabled';

/** Returns true when the user has explicitly disabled HITL for the
 *  current showroom (vision Q1 — demo without prompts). Default false
 *  → HITL stays on, matching the legacy behaviour. */
export function getShowroomHitlDisabled(): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist a new disabled flag. Returns the value actually written
 *  (false on storage failure). */
export function setShowroomHitlDisabled(disabled: boolean): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    if (disabled) window.localStorage.setItem(STORAGE_KEY, 'true');
    else window.localStorage.removeItem(STORAGE_KEY);
    return disabled;
  } catch {
    return false;
  }
}

/** Storage event subscription so multiple Showroom tabs stay in
 *  sync. Returns an unsubscribe function. */
export function subscribeShowroomHitl(onChange: (disabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => { /* no-op */ };
  const handler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange(getShowroomHitlDisabled());
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export const SHOWROOM_HITL_STORAGE_KEY = STORAGE_KEY;
