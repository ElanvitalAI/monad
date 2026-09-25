// Ergonomic-port Tier E1.1 (2026-05-11) — pane layout state for the
// /workflows page. Replaces the hard-coded `grid-cols-12` 3/6/3 split
// with a hook that owns:
//   - left-pane collapse / width
//   - right-pane collapse / width
//   - canvas-only toggle (both chrome panes hidden, just the editor)
//   - drag-resize seeded width values
//   - localStorage persistence (key = `monad.workflows.layout`)
//
// All values are clamped so a stale localStorage entry from an earlier
// session can never produce a negative or runaway width — pane widths
// fall back to defaults when out of range.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface PanelLayoutState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  canvasOnly: boolean;
  leftWidthPx: number;
  rightWidthPx: number;
}

export const STORAGE_KEY = 'monad.workflows.layout';

export const DEFAULT_LAYOUT: PanelLayoutState = {
  leftCollapsed: false,
  rightCollapsed: false,
  canvasOnly: false,
  leftWidthPx: 240,
  rightWidthPx: 320,
};

export const LEFT_RAIL_WIDTH_PX = 40;
export const RIGHT_RAIL_WIDTH_PX = 40;
const MIN_PANE_WIDTH = 160;
const MAX_PANE_WIDTH = 640;

function clampWidth(px: number, fallback: number): number {
  if (!Number.isFinite(px)) return fallback;
  if (px < MIN_PANE_WIDTH) return MIN_PANE_WIDTH;
  if (px > MAX_PANE_WIDTH) return MAX_PANE_WIDTH;
  return Math.round(px);
}

/** Pure: merge a (possibly-malformed) persisted record into the
 *  defaults. Exposed for unit tests. */
export function mergeLayout(raw: unknown): PanelLayoutState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT };
  const r = raw as Partial<PanelLayoutState>;
  return {
    leftCollapsed: typeof r.leftCollapsed === 'boolean' ? r.leftCollapsed : DEFAULT_LAYOUT.leftCollapsed,
    rightCollapsed: typeof r.rightCollapsed === 'boolean' ? r.rightCollapsed : DEFAULT_LAYOUT.rightCollapsed,
    canvasOnly: typeof r.canvasOnly === 'boolean' ? r.canvasOnly : DEFAULT_LAYOUT.canvasOnly,
    leftWidthPx: clampWidth(r.leftWidthPx ?? DEFAULT_LAYOUT.leftWidthPx, DEFAULT_LAYOUT.leftWidthPx),
    rightWidthPx: clampWidth(r.rightWidthPx ?? DEFAULT_LAYOUT.rightWidthPx, DEFAULT_LAYOUT.rightWidthPx),
  };
}

function readPersisted(): PanelLayoutState {
  if (typeof window === 'undefined') return { ...DEFAULT_LAYOUT };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LAYOUT };
    return mergeLayout(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function writePersisted(value: PanelLayoutState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // private mode / quota — silently ignore
  }
}

export interface UsePanelLayoutResult extends PanelLayoutState {
  toggleLeft: () => void;
  toggleRight: () => void;
  toggleCanvasOnly: () => void;
  setLeftWidth: (px: number) => void;
  setRightWidth: (px: number) => void;
  /** Reset everything to defaults (used by the canvas-only escape
   *  hatch in case state ends up in a corner). */
  reset: () => void;
}

export function usePanelLayout(): UsePanelLayoutResult {
  const [state, setState] = useState<PanelLayoutState>(() => DEFAULT_LAYOUT);
  const hydratedRef = useRef(false);

  // Hydrate from localStorage on the client. SSR / prerender stays on
  // the defaults so server / first-paint markup matches.
  useEffect(() => {
    setState(readPersisted());
    hydratedRef.current = true;
  }, []);

  // Persist after hydration. Skipping the first effect tick avoids
  // overwriting the persisted value with the default before we've
  // read it.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writePersisted(state);
  }, [state]);

  const toggleLeft = useCallback(() => {
    setState((s) => ({ ...s, leftCollapsed: !s.leftCollapsed }));
  }, []);
  const toggleRight = useCallback(() => {
    setState((s) => ({ ...s, rightCollapsed: !s.rightCollapsed }));
  }, []);
  const toggleCanvasOnly = useCallback(() => {
    setState((s) => ({ ...s, canvasOnly: !s.canvasOnly }));
  }, []);
  const setLeftWidth = useCallback((px: number) => {
    setState((s) => ({ ...s, leftWidthPx: clampWidth(px, s.leftWidthPx) }));
  }, []);
  const setRightWidth = useCallback((px: number) => {
    setState((s) => ({ ...s, rightWidthPx: clampWidth(px, s.rightWidthPx) }));
  }, []);
  const reset = useCallback(() => {
    setState({ ...DEFAULT_LAYOUT });
  }, []);

  return useMemo(
    () => ({ ...state, toggleLeft, toggleRight, toggleCanvasOnly, setLeftWidth, setRightWidth, reset }),
    [state, toggleLeft, toggleRight, toggleCanvasOnly, setLeftWidth, setRightWidth, reset],
  );
}
