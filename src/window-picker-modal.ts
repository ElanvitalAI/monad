// Window picker modal — T2-P4.
//
// Sibling of session-picker-modal.ts. Wraps createSearchModal with a
// list of live VirtualWindow entries so the user can fuzz-match a
// title and press Enter to switch to it. Bound to the VW navigation
// chord's onPicker callback (^B 0) but also reusable from any slash
// command.
//
// Label format mirrors the terminal-session picker for visual
// consistency:
//
//   ● win:2  project-build        3 panes   5m   (title)
//   ○ win:3  notes                1 pane   12m
//
//   ●/○  foreground marker
//   win:N  window id (stable)
//   N panes  pane count (pluralized)
//   relative-age
//   title
//
// Accept calls onAccept(window) — typical host behavior is
// registry.switchTo(window.id). Cancel disposes the modal.

import type { SearchItem, SearchModalHandle } from './chat/search/modal.js';
import type { ThemeTokens } from './theme/tokens.js';
import type { ModalBounds } from './display/modal-stack.js';
import type { WindowRegistry } from './virtual-windows/window-registry.js';
import type { VirtualWindow } from './virtual-windows/virtual-window.js';
import { filterPickerItemsByLabel } from './ui/chrome/picker-query.js';
import { createVwFilterPickerModal } from './ui/vw-filter-picker-modal.js';
import {
  searchItemsToPickerSpec,
  type PickerSearchItem,
  type PickerSpec,
} from './expression/index.js';

export interface OpenWindowPickerOpts {
  registry: WindowRegistry;
  bounds: ModalBounds;
  width: number;
  maxVisible?: number;
  /** Called when the user picks a window. Default action is
   *  registry.switchTo(window.id); callers may override to do
   *  close / inspect / rename instead. */
  onAccept: (window: VirtualWindow | 'main') => void;
  onCancel?: () => void;
  theme?: ThemeTokens;
}

export function createWindowPickerModal(opts: OpenWindowPickerOpts): SearchModalHandle {
  let selectedPayload: string | number = 'main';
  const items = (): SearchItem[] => {
    const wins = opts.registry.list();
    return [
      {
        label: formatMainLabel(selectedPayload === 'main'),
        payload: 'main',
      },
      ...wins.map((w): SearchItem => ({
        label: formatWindowLabel(w, selectedPayload === w.id),
        payload: w.id,
      })),
    ];
  };

  return createVwFilterPickerModal({
    id: `window-picker:${Date.now().toString(36)}`,
    bounds: opts.bounds,
    title: 'Windows',
    width: opts.width,
    maxVisible: opts.maxVisible ?? 9,
    primaryActionLabel: 'switch',
    cancelActionLabel: 'cancel',
    onQuery: (q) => {
      const all = items();
      return filterPickerItemsByLabel(all, q, (it) => String(it.label ?? ''));
    },
    onAccept: (item) => {
      if (item.payload === 'main') {
        opts.onAccept('main');
        return;
      }
      const w = opts.registry.get(Number(item.payload));
      if (w) opts.onAccept(w);
    },
    onCancel: opts.onCancel,
    theme: opts.theme,
    requeryOnSelectionChange: true,
    onSelectionChange: (item) => {
      selectedPayload =
        item?.payload === 'main' || typeof item?.payload === 'number'
          ? item.payload
          : 'main';
    },
  });
}

function formatMainLabel(isForeground: boolean): string {
  const stateGlyph = isForeground ? '●' : '○';
  return `  ${stateGlyph} Main`;
}

function formatWindowLabel(w: VirtualWindow, isForeground: boolean): string {
  const stateGlyph = isForeground ? '●' : '○';
  const title = w.title.length > 32 ? w.title.slice(0, 31) + '…' : w.title;
  return `  ${stateGlyph} ${title}`;
}

/** Build an expression `PickerSpec` describing the live virtual
 *  windows. Pure helper — see `buildSessionPickerSpec` for shape +
 *  rationale.
 *
 *  Each item's `description` carries the pane count + foreground
 *  marker as plain text so SR users learn the same signal the visual
 *  glyph conveys. Adapter strips ANSI from `formatWindowLabel`.
 *
 *  2026-04-28 (Pick A PR-S2) — picker family a11y integration. */
export function buildWindowPickerSpec(registry: WindowRegistry): PickerSpec {
  const wins = registry.list();
  const current = registry.current();
  const items: PickerSearchItem[] = wins.map((w) => {
    const panes = w.listPanes();
    const paneLabel = panes.length === 1 ? '1 pane' : `${panes.length} panes`;
    const fg = w === current ? 'foreground' : 'background';
    return {
      label: formatWindowLabel(w, w === current),
      payload: String(w.id),
      description: `${fg} · ${paneLabel}`,
    };
  });
  return searchItemsToPickerSpec(items, {
    id: 'window-picker',
    title: 'Virtual windows',
  });
}
