import type { SearchItem, SearchModalHandle } from '../chat/search/modal.js';
import type { ModalBounds } from '../display/modal-stack.js';
import type { ThemeTokens } from '../theme/tokens.js';
import type { WidgetChromeSpec } from './declarative/spec.js';
import { createVwSearchModal } from './vw-search-modal.js';

export interface VwFilterPickerModalSpec {
  id: string;
  bounds: ModalBounds;
  title: string;
  width: number;
  maxVisible: number;
  primaryActionLabel: string;
  cancelActionLabel?: string;
  onQuery: (query: string) => SearchItem[];
  onAccept: (item: SearchItem, query: string) => void;
  onCancel?: () => void;
  onSelectionChange?: (item: SearchItem | null) => void;
  requeryOnSelectionChange?: boolean;
  theme?: ThemeTokens;
  chromeSpec?: WidgetChromeSpec;
}

export function createVwFilterPickerModal(spec: VwFilterPickerModalSpec): SearchModalHandle {
  return createVwSearchModal({
    id: spec.id,
    bounds: spec.bounds,
    title: spec.title,
    width: spec.width,
    maxVisible: spec.maxVisible,
    primaryActionLabel: spec.primaryActionLabel,
    cancelActionLabel: spec.cancelActionLabel ?? 'cancel',
    onQuery: spec.onQuery,
    onAccept: spec.onAccept,
    onCancel: spec.onCancel,
    onSelectionChange: spec.onSelectionChange,
    requeryOnSelectionChange: spec.requeryOnSelectionChange,
    theme: spec.theme,
    filterable: true,
    actionButtons: true,
    browseMode: true,
    footerHint: '',
    chromeSpec: spec.chromeSpec,
  });
}
