// MX6 — Slash command launcher.
//
// PLAN-mouse-ux §7/MX6 calls for a small ⌘ icon in the status bar
// that, when clicked, pops a searchable SelectView containing every
// slash command. This module is the host-friendly factory — the
// dashboard wires the ⌘ icon into its status-bar render pipeline
// (pill-style region), and on click it constructs the launcher
// popup via `createSlashLauncherPopup`.

import { SlashMenu, type SlashCommand } from './widgets/slash-menu.js';
import { mountViewAsModalSurface, type ViewSurfaceHandle } from './modal-adapter.js';
import type { ModalBounds } from '../display/modal-stack.js';

export interface SlashLauncherSpec {
  /** Full slash-command list. Categories (if any) appear inline in
   *  the SelectView description column. */
  commands: SlashCommand[];
  /** Where on screen to pop — falls back to centered when omitted. */
  anchorRow?: number;
  anchorCol?: number;
  termCols: number;
  termRows: number;
  onCancel?: () => void;
}

/** Build a searchable slash-menu popup anchored near the launcher
 *  icon. The SlashMenu widget (LC9) internally is a SelectView with
 *  searchable:true and each command's `onRun` as the action closure,
 *  so single-click on a row immediately runs that command. */
export function createSlashLauncherPopup(spec: SlashLauncherSpec): ViewSurfaceHandle {
  const width = Math.min(spec.termCols - 4, Math.max(40, 60));
  const height = Math.min(spec.termRows - 4, Math.max(8, Math.min(spec.commands.length + 3, 14)));

  const anchorRow = spec.anchorRow ?? Math.floor((spec.termRows - height) / 2) + 1;
  const anchorCol = spec.anchorCol ?? Math.floor((spec.termCols - width) / 2) + 1;

  // Prefer opening above the anchor when it's near the bottom.
  let row = anchorRow + 1;
  if (row + height - 1 > spec.termRows) row = Math.max(1, anchorRow - height);
  let col = anchorCol;
  if (col + width - 1 > spec.termCols) col = Math.max(1, spec.termCols - width + 1);

  const bounds: ModalBounds = { row, col, width, height };

  const view = new SlashMenu({
    title: 'Commands',
    commands: spec.commands,
    onCancel: spec.onCancel,
  });

  return mountViewAsModalSurface({
    id: 'slash-launcher',
    bounds,
    view,
    priority: 265,                    // between pill popup (260) and context menu (270)
    tier: 'picker',
  });
}
