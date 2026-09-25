import { createSearchModal, type SearchItem, type SearchModalHandle } from '../chat/search/modal.js';
import type { ModalBounds } from '../display/modal-stack.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { WidgetChromeSpec } from './declarative/spec.js';

export interface VwSearchModalSpec {
  id: string;
  bounds: ModalBounds;
  title: string;
  width: number;
  maxVisible: number;
  initialQuery?: string;
  onQuery: (query: string) => SearchItem[];
  onAccept: (item: SearchItem, query: string) => void;
  onCancel?: () => void;
  onSelectionChange?: (item: SearchItem | null) => void;
  requeryOnSelectionChange?: boolean;
  primaryActionLabel?: string;
  cancelActionLabel?: string;
  filterable?: boolean;
  actionButtons?: boolean;
  browseMode?: boolean;
  footerHint?: string;
  theme?: ThemeTokens;
  chromeSpec?: WidgetChromeSpec;
}

export function createVwSearchModal(spec: VwSearchModalSpec): SearchModalHandle {
  const modal = createSearchModal({
    id: spec.id,
    bounds: spec.bounds,
    title: spec.title,
    width: spec.width,
    maxVisible: spec.maxVisible,
    footerHint: spec.footerHint ?? '',
    primaryActionLabel: spec.primaryActionLabel ?? 'select',
    cancelActionLabel: spec.cancelActionLabel ?? 'cancel',
    filterable: spec.filterable ?? true,
    actionButtons: spec.actionButtons ?? true,
    chromeSpec: {
      titleAlign: 'center',
      ...spec.chromeSpec,
    },
    onQuery: spec.onQuery,
    onAccept: spec.onAccept,
    onCancel: spec.onCancel,
    onSelectionChange: spec.onSelectionChange,
    requeryOnSelectionChange: spec.requeryOnSelectionChange,
    theme: spec.theme,
    browseMode: spec.browseMode ?? true,
  });
  for (const ch of spec.initialQuery ?? '') modal.type(ch);
  return modal;
}
