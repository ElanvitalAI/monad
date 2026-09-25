// CV-3 mobile-readiness #1 follow-up · IntentPanel collapsed
// preference storage (2026-05-08).
//
// Tiny localStorage shim around the boolean "is the IntentPanel
// collapsed?" preference. Pattern mirrors `lib/showroom/runtime.ts
// readDmModeFromStorage` (β-1a era) — same key naming convention
// (`monad.showroom.intentPanel.collapsed`), same opt-out semantics
// (default = expanded; storing 'true' opts out).
//
// Cross-tab sync via the standard `storage` DOM event so a user
// who collapses on iPhone Safari sees the same state on the
// desktop Tab.

const STORAGE_KEY = 'monad.showroom.intentPanel.collapsed';
const DISPLAY_MODE_KEY = 'monad.showroom.intentPanel.displayMode';

/** Display modes for the IntentPanel surface. Added 2026-05-09 in
 *  response to user feedback that the always-on fixed panel takes
 *  permanent screen real estate even when most turns don't need
 *  intent affordance. The three modes lay out the design space:
 *
 *  - `fixed`  — panel is always visible above ShowroomInput
 *               (pre-2026-05-09 default; current behavior). Best
 *               for keyboard-driven dogfood — buttons are always
 *               one tap away.
 *  - `popup`  — panel hides until a turn finishes (ranking version
 *               bumps); shows briefly with a fade-out, dismisses
 *               on tap or after a few seconds. Best for mobile
 *               foreground use where screen height is precious.
 *  - `off`    — panel is hidden entirely. Best for users who
 *               prefer pure-input interaction or for testing.
 *
 *  iOS Phase 1 lock-screen widget reuses these modes (PLAN-ios §7) —
 *  the lock surface defaults to `popup` semantics when the app is
 *  in the background, which is why the user wanted PWA settings
 *  to expose all three. */
export type IntentPanelDisplayMode = 'fixed' | 'popup' | 'off';

const DEFAULT_DISPLAY_MODE: IntentPanelDisplayMode = 'fixed';

const VALID_DISPLAY_MODES: ReadonlySet<IntentPanelDisplayMode> = new Set([
  'fixed',
  'popup',
  'off',
]);

/** Read the persisted collapsed flag. Default `false` (expanded).
 *  SSR-safe — returns the default when localStorage is absent. */
export function getIntentPanelCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the collapsed flag. Setting `false` removes the key
 *  entirely (default state) so unset users + opt-out users share
 *  the same observable shape. */
export function setIntentPanelCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (collapsed) window.localStorage.setItem(STORAGE_KEY, 'true');
    else window.localStorage.removeItem(STORAGE_KEY);
    // Manually fire a storage event so other tabs + same-tab
    // subscribers (the IntentPanel hook) re-read.
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: collapsed ? 'true' : null,
    }));
  } catch {
    /* ignore — quota / private mode */
  }
}

/** Subscribe to collapsed changes. The callback fires on cross-tab
 *  storage events AND on same-tab `setIntentPanelCollapsed` calls
 *  (via the dispatched StorageEvent above). Returns an unsubscribe. */
export function subscribeIntentPanelCollapsed(
  callback: (collapsed: boolean) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: StorageEvent): void => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    callback(getIntentPanelCollapsed());
  };
  window.addEventListener('storage', handler);
  return () => { window.removeEventListener('storage', handler); };
}

/** Read the persisted display mode. Default `fixed`. Unknown values
 *  in storage (legacy / corrupted entries) fall back to default so
 *  the panel never disappears unexpectedly. SSR-safe. */
export function getIntentPanelDisplayMode(): IntentPanelDisplayMode {
  if (typeof window === 'undefined') return DEFAULT_DISPLAY_MODE;
  try {
    const raw = window.localStorage.getItem(DISPLAY_MODE_KEY);
    if (raw && VALID_DISPLAY_MODES.has(raw as IntentPanelDisplayMode)) {
      return raw as IntentPanelDisplayMode;
    }
    return DEFAULT_DISPLAY_MODE;
  } catch {
    return DEFAULT_DISPLAY_MODE;
  }
}

/** Persist the display mode. Setting the default ('fixed') removes
 *  the key entirely so unset users + default users share the same
 *  observable shape. Cross-tab sync via storage event. */
export function setIntentPanelDisplayMode(mode: IntentPanelDisplayMode): void {
  if (typeof window === 'undefined') return;
  try {
    if (mode === DEFAULT_DISPLAY_MODE) {
      window.localStorage.removeItem(DISPLAY_MODE_KEY);
    } else {
      window.localStorage.setItem(DISPLAY_MODE_KEY, mode);
    }
    window.dispatchEvent(new StorageEvent('storage', {
      key: DISPLAY_MODE_KEY,
      newValue: mode === DEFAULT_DISPLAY_MODE ? null : mode,
    }));
  } catch {
    /* ignore — quota / private mode */
  }
}

/** Subscribe to display-mode changes. Same cross-tab + same-tab
 *  semantics as subscribeIntentPanelCollapsed. Returns unsubscribe. */
export function subscribeIntentPanelDisplayMode(
  callback: (mode: IntentPanelDisplayMode) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: StorageEvent): void => {
    if (e.key !== DISPLAY_MODE_KEY && e.key !== null) return;
    callback(getIntentPanelDisplayMode());
  };
  window.addEventListener('storage', handler);
  return () => { window.removeEventListener('storage', handler); };
}
