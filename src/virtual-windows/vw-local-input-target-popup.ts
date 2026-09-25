import { SelectView, type SelectOption } from '../ui/widgets/select-view.js';
import { mountViewAsModalSurface, type ViewSurfaceHandle } from '../ui/modal-adapter.js';
import { computePopupBounds } from '../status/popups.js';
import { BoxView } from '../ui/view.js';
import { resolveWidgetChromeBoxViewOptions } from '../ui/declarative/index.js';
import { resolvePickerChromePresentation } from '../ui/chrome/picker-chrome.js';
import { resolvePickerPopupSize } from '../ui/chrome/picker-popup-sizing.js';
import type { WindowId } from './addressing.js';
import type { LocalInputTarget } from './virtual-window.js';
import type { WindowRegistry } from './window-registry.js';

export interface VwLocalInputTargetPopupOpts {
  registry: WindowRegistry;
  sourceWindowId: WindowId;
  termCols: number;
  termRows: number;
  query?: string | (() => string);
  cursor?: number | (() => number);
  onQueryChange?: (next: string) => void;
  onCursorChange?: (next: number) => void;
  onPick: (target: LocalInputTarget) => void;
  onCancel?: () => void;
}

export function createVwLocalInputTargetPopup(
  opts: VwLocalInputTargetPopupOpts,
): ViewSurfaceHandle | null {
  const sourceWindow = opts.registry.get(opts.sourceWindowId);
  if (!sourceWindow) return null;
  const items = sourceWindow.listLocalInputTargets();
  if (items.length === 0) return null;
  const activeItem = items.find((item) => item.active) ?? items[0]!;
  const options: SelectOption<LocalInputTarget>[] = items.map((item) => ({
    value: item.target,
    label: item.label,
    icon: item.active ? '▸' : ' ',
  }));
  const bounds = computePopupBounds(
    {
      anchorStartCol: 2,
      anchorEndCol: 4,
      statusRow: opts.termRows - 3,
      termCols: opts.termCols,
      termRows: opts.termRows,
    },
    resolvePickerPopupSize(
      options.map((item) => ({
        value: item.value,
        label: item.label,
      })),
      {
        minWidth: 34,
        maxWidth: 48,
        widthPadding: 8,
        visibleRows: 8,
        shellRows: 4,
        minContentWidth: 18,
      },
    ),
  );

  let handle: ViewSurfaceHandle | null = null;
  const presentation = resolvePickerChromePresentation({
    title: 'Local input target',
    primaryAction: 'pick',
    browseMode: true,
    filterable: items.length > 3,
    chromeSpec: {
      titleAlign: 'center',
    },
    maxWidth: bounds.width,
  });
  const select = new SelectView<LocalInputTarget>({
    options,
    initialValue: opts.cursor === undefined ? activeItem.target : undefined,
    searchable: items.length > 3,
    query: opts.query,
    cursor: opts.cursor,
    onQueryChange: opts.onQueryChange,
    onCursorChange: opts.onCursorChange,
    browseMode: true,
    visibleRows: Math.min(8, items.length),
    footerHint: items.length > 3 ? presentation.footerHint : '',
    onSubmit: (target) => {
      opts.onPick(target as LocalInputTarget);
      handle?.dispose();
    },
    onCancel: () => {
      opts.onCancel?.();
      handle?.dispose();
    },
  });

  const view = new BoxView(
    select,
    resolveWidgetChromeBoxViewOptions(
      undefined,
      presentation.chromeSpec,
      'Local input target',
    ),
  );
  handle = mountViewAsModalSurface({
    id: `vw-local-target:${opts.sourceWindowId}:${Date.now().toString(36)}`,
    bounds,
    view,
    priority: 275,
    tier: 'picker',
  });
  return handle;
}
