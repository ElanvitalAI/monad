// VW-U4 — Right-click pane/window selector popup.
//
// Anchored SelectView that lists the current window's panes plus every
// other window. The user picks a pane (for same-window focus) or a
// different window (for registry.switchTo). Reuses the buildActionPicker
// recipe pattern from mouse-action-recipes.ts so the visual layout
// stays consistent with the model / wd / session pickers.
//
// Items shape:
//   ▸ [abc123] terminal         current focused pane in this window
//     [def456] llm-chat         other pane in this window
//   ── other windows ──
//     ● win:2 notes — 2 panes   foreground window (rare — this popup
//                                fires from inside the current VW, so
//                                only background windows usually match)
//     ○ win:3 build — 4 panes
//
// Accept routes to focusPane (same window) or registry.switchTo
// (different window). Esc cancels.

import { SelectView, type SelectOption } from '../ui/widgets/select-view.js';
import { mountViewAsModalSurface, type ViewSurfaceHandle } from '../ui/modal-adapter.js';
import { computePopupBounds } from '../status/popups.js';
import { BoxView } from '../ui/view.js';
import { C } from '../tui.js';
import { attachSurfaceToWorkspace, workspaceOwnerIdForVirtualWindow } from '../display/workspace-affinity.js';
import { resolveWidgetChromeBoxViewOptions } from '../ui/declarative/index.js';
import { resolvePickerChromePresentation } from '../ui/chrome/picker-chrome.js';
import { resolvePickerPopupSize } from '../ui/chrome/picker-popup-sizing.js';
import type { WindowRegistry } from './window-registry.js';
import type { WindowId, PaneId } from './addressing.js';

export interface VwSelectorAction {
  type: 'pane' | 'window';
  windowId: WindowId;
  paneId?: PaneId;
  label: string;
}

export interface VwSelectorOpts {
  registry: WindowRegistry;
  /** Window the click landed in — used to compute the primary pane
   *  list + skip that window from the "other windows" section. */
  sourceWindowId: WindowId;
  /** Screen coords of the click. The popup opens anchored near this
   *  point; `statusRow` in PopupPlacement is abused as "the row the
   *  click was on" and the computePopupBounds flip logic decides
   *  whether to open upward or downward. */
  col: number;
  row: number;
  /** Terminal viewport for clamping. */
  termCols: number;
  termRows: number;
  onFocusPane: (windowId: WindowId, paneId: PaneId) => void;
  onSwitchWindow: (windowId: WindowId) => void;
  onCancel?: () => void;
}

/** Open the selector popup. Returns a ViewSurfaceHandle ready for
 *  `display.pushModal(handle.surface)`. Caller owns the dispose lifecycle. */
export function createVwSelectorPopup(opts: VwSelectorOpts): ViewSurfaceHandle | null {
  const sourceWindow = opts.registry.get(opts.sourceWindowId);
  if (!sourceWindow) return null;

  const focused = sourceWindow.focused;
  const paneItems = sourceWindow.listPanes().map(({ id, content }): SelectOption<VwSelectorAction> => ({
    value: {
      type: 'pane',
      windowId: opts.sourceWindowId,
      paneId: id,
      label: content.kind,
    },
    label: `[${id.slice(0, 6)}] ${content.kind}`,
    icon: id === focused ? C.accent('▸') : ' ',
    description: id === focused ? 'focused' : undefined,
  }));

  const otherWindows = opts.registry.list()
    .filter(w => w.id !== opts.sourceWindowId)
    .sort((a, b) => a.id - b.id);
  const currentFg = opts.registry.current();

  const windowItems: SelectOption<VwSelectorAction>[] = otherWindows.map(w => {
    const panes = w.listPanes();
    const isFg = currentFg?.id === w.id;
    return {
      value: {
        type: 'window',
        windowId: w.id,
        label: w.title,
      },
      label: `win:${w.id}  ${w.title}`,
      icon: isFg ? C.success('●') : C.muted('○'),
      description: `${panes.length} pane${panes.length > 1 ? 's' : ''}`,
    };
  });

  // Separator row (disabled, purely visual). We keep the item count
  // low (≤ 2 sections) so a single-disabled separator is fine — the
  // SelectView filters disabled rows out of keyboard dispatch.
  const items: SelectOption<VwSelectorAction>[] = [...paneItems];
  if (windowItems.length > 0) {
    items.push({
      value: { type: 'window', windowId: -1 as WindowId, label: '--' },
      label: C.muted('── other windows ──'),
      disabled: true,
    });
    items.push(...windowItems);
  }

  // Empty-list short-circuit: one pane + no other windows is nothing
  // to choose from. Caller treats null as "don't bother".
  if (items.length === 0) return null;

  const id = `vw-selector:${opts.sourceWindowId}:${Date.now().toString(36)}`;
  let handle: ViewSurfaceHandle | null = null;
  const bounds = computePopupBounds(
    {
      anchorStartCol: Math.max(0, opts.col - 1),
      anchorEndCol: Math.max(1, opts.col),
      statusRow: opts.row,
      termCols: opts.termCols,
      termRows: opts.termRows,
    },
    resolvePickerPopupSize(items, {
      minWidth: 32,
      maxWidth: 60,
      widthPadding: 6,
      visibleRows: 10,
      shellRows: 5,
      minContentWidth: 20,
    }),
  );
  const presentation = resolvePickerChromePresentation({
    title: 'Windows & panes',
    primaryAction: 'switch',
    browseMode: true,
    filterable: items.length > 8,
    chromeSpec: {
      titleAlign: 'center',
    },
    maxWidth: bounds.width,
  });

  const select = new SelectView<VwSelectorAction>({
    options: items,
    searchable: items.length > 8,
    browseMode: true,
    visibleRows: Math.min(items.length, 10),
    footerHint: items.length > 8 ? presentation.footerHint : '',
    onSubmit: (picked) => {
      const p = picked as VwSelectorAction;
      if (p.type === 'pane' && p.paneId) {
        opts.onFocusPane(p.windowId, p.paneId);
      } else if (p.type === 'window' && p.windowId > 0) {
        opts.onSwitchWindow(p.windowId);
      }
      handle?.dispose();
    },
    onCancel: () => {
      opts.onCancel?.();
      handle?.dispose();
    },
  });

  const view = new BoxView(select, resolveWidgetChromeBoxViewOptions(
    undefined,
    presentation.chromeSpec,
    'Windows & panes',
  ));
  handle = mountViewAsModalSurface({ id, bounds, view, priority: 270, tier: 'popup' });
  attachSurfaceToWorkspace(
    handle.surface,
    workspaceOwnerIdForVirtualWindow(opts.sourceWindowId),
  );
  return handle;
}
