import { Consumed, Ignored, type EventResult } from '../view.js';
import type { MouseEvent } from '../mouse-events.js';
import { dispatchPointerListMouse } from './pointer-list-controller.js';

export interface BrowseRowMouseDispatchSpec<T> {
  event: MouseEvent;
  browseMode?: boolean;
  value: T;
  index: number;
  onCursor?: (value: T, index: number) => void;
  onActivate?: (value: T, index: number) => void;
}

export function dispatchBrowseRowMouse<T>(spec: BrowseRowMouseDispatchSpec<T>): EventResult {
  return dispatchPointerListMouse({
    event: spec.event,
    count: spec.index + 1,
    currentIndex: spec.index,
    browseMode: spec.browseMode,
    getValueAt: (index) => (index === spec.index ? spec.value : null),
    setCursor: () => {},
    resolveIndex: () => spec.index,
    onCursor: spec.onCursor,
    onActivate: spec.onActivate,
  });
}
