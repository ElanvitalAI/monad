// R1.3 — Overlay family policy lock.
//
// This file is the source-level vocabulary for "which transient UI
// family is allowed to paint through which authority path". It does
// NOT route paint by itself; it exists so docs, comments, and tests
// can all point to one canonical matrix.

export type TransientOverlayPath =
  | 'modal-surface'
  | 'overlay-host'
  | 'chrome-layer';

export type TransientOverlayFamily =
  | 'tooltip'
  | 'context-menu'
  | 'status-popup'
  | 'drag-overlay'
  | 'chrome';

export interface TransientOverlayPolicyEntry {
  readonly family: TransientOverlayFamily;
  readonly path: TransientOverlayPath;
  readonly rationale: string;
}

export const TRANSIENT_OVERLAY_POLICY:
  Readonly<Record<TransientOverlayFamily, TransientOverlayPolicyEntry>> = Object.freeze({
    tooltip: {
      family: 'tooltip',
      path: 'modal-surface',
      rationale: 'stable-hover bubbles are modal-surface decorations owned by DisplayCoordinator',
    },
    'context-menu': {
      family: 'context-menu',
      path: 'modal-surface',
      rationale: 'menus are popup/menu tier surfaces even when their lifecycle follows the overlay family',
    },
    'status-popup': {
      family: 'status-popup',
      path: 'modal-surface',
      rationale: 'status-bar pickers are popup-tier transient surfaces, not non-modal sprite overlays',
    },
    'drag-overlay': {
      family: 'drag-overlay',
      path: 'overlay-host',
      rationale: 'drag ghost/highlight/banner are non-modal transient overlays flushed after the main frame',
    },
    chrome: {
      family: 'chrome',
      path: 'chrome-layer',
      rationale: 'chrome ownership stays in the compositor chrome-layer track, not modal or sprite paths',
    },
  });

export function transientOverlayPathForFamily(
  family: TransientOverlayFamily,
): TransientOverlayPath {
  return TRANSIENT_OVERLAY_POLICY[family].path;
}
