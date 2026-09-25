// VW-B1/B2 — Compact single-line rename modal for VW titles and pane
// custom titles. Wraps EditView inside a BoxView and mounts as a modal
// surface. The host pushes the surface to the coordinator; Enter fires
// onSubmit with the final trimmed string, Esc cancels.
//
// This is intentionally a small file (no feedback prompt, no picker,
// no multi-line) so both callers (rename-window, rename-pane) share
// identical UX: type → Enter to confirm, Esc to bail.

import { createPromptEditView } from '../ui/widgets/edit-view.js';
import { BoxView } from '../ui/view.js';
import { mountViewAsModalSurface, type ViewSurfaceHandle } from '../ui/modal-adapter.js';
import type { ModalBounds } from '../display/modal-stack.js';
import { resolveWidgetChromeBoxViewOptions } from '../ui/declarative/index.js';
import { resolveModalDialogChromeSpec } from '../ui/chrome/dialog-chrome.js';

export interface VwRenameModalOpts {
  title: string;
  /** Current title used as the initial buffer. */
  current: string;
  /** Terminal viewport for centering when `bounds` is omitted. */
  termCols: number;
  termRows: number;
  /** Explicit bounds override. When omitted, a centered 40×5 box is used. */
  bounds?: ModalBounds;
  placeholder?: string;
  maxLength?: number;
  /** Enter with a non-empty trimmed value — fires submit. Empty value
   *  calls onCancel (matches EditView.cancelOnEmptySubmit). */
  onSubmit: (next: string) => void;
  onCancel?: () => void;
}

export function createVwRenameModal(opts: VwRenameModalOpts): ViewSurfaceHandle {
  const width = Math.min(50, Math.max(28, opts.termCols - 6));
  const height = 5;
  const bounds: ModalBounds = opts.bounds ?? {
    row: Math.max(1, Math.floor((opts.termRows - height) / 2)),
    col: Math.max(1, Math.floor((opts.termCols - width) / 2)),
    width,
    height,
  };

  let handle: ViewSurfaceHandle | null = null;
  const edit = createPromptEditView({
    initialValue: opts.current,
    placeholder: opts.placeholder ?? 'Type a title, Enter to confirm',
    maxLength: opts.maxLength ?? 64,
    submitMode: 'trimmed',
    emptySubmit: 'cancel',
    onSubmit: (next) => {
      opts.onSubmit(next);
      handle?.dispose();
    },
    onCancel: () => {
      opts.onCancel?.();
      handle?.dispose();
    },
  });

  const view = new BoxView(
    edit,
    resolveWidgetChromeBoxViewOptions(
      undefined,
      resolveModalDialogChromeSpec(opts.title, undefined, 'center'),
      opts.title,
    ),
  );
  handle = mountViewAsModalSurface({
    id: `vw-rename:${Date.now().toString(36)}`,
    bounds,
    view,
    priority: 280,
    tier: 'dialog',
  });
  return handle;
}
