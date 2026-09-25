import type { MouseEvent } from '../mouse-events.js';
import { Consumed, Ignored, type EventResult } from '../view.js';
import { moveCursorBy } from './selection-cursor.js';

export type PointerListPayload =
  | { kind: 'row'; index: number }
  | { kind: 'row'; idx: number }
  | { kind: 'row'; filtIdx: number };

export interface PointerListControllerSpec<T> {
  event: MouseEvent;
  count: number;
  currentIndex: number;
  browseMode?: boolean;
  scrollStep?: number;
  getValueAt: (index: number) => T | null;
  setCursor: (index: number) => void;
  onCursor?: (value: T, index: number) => void;
  onActivate?: (value: T, index: number) => void;
  resolveIndex?: (event: MouseEvent) => number | null;
}

export function rowIndexFromPointerPayload(event: MouseEvent): number | null {
  const payload = event.payload as PointerListPayload | undefined;
  if (!payload || payload.kind !== 'row') return null;
  if ('index' in payload && typeof payload.index === 'number') return payload.index;
  if ('idx' in payload && typeof payload.idx === 'number') return payload.idx;
  if ('filtIdx' in payload && typeof payload.filtIdx === 'number') return payload.filtIdx;
  return null;
}

export function dispatchPointerListMouse<T>(spec: PointerListControllerSpec<T>): EventResult {
  if (spec.count <= 0) return Ignored;
  const scrollStep = Math.max(1, spec.scrollStep ?? 3);
  if (spec.event.type === 'scroll-up') {
    spec.setCursor(moveCursorBy(spec.currentIndex, spec.count, -scrollStep));
    return Consumed();
  }
  if (spec.event.type === 'scroll-down') {
    spec.setCursor(moveCursorBy(spec.currentIndex, spec.count, scrollStep));
    return Consumed();
  }
  if (spec.event.type !== 'click' && spec.event.type !== 'double-click') return Ignored;
  const resolvedIndex = spec.resolveIndex?.(spec.event) ?? rowIndexFromPointerPayload(spec.event);
  if (resolvedIndex === null || resolvedIndex < 0 || resolvedIndex >= spec.count) return Ignored;
  spec.setCursor(resolvedIndex);
  const value = spec.getValueAt(resolvedIndex);
  if (value === null) return Ignored;
  if (spec.event.type === 'click') {
    if (spec.browseMode === false) {
      spec.onActivate?.(value, resolvedIndex);
      return Consumed();
    }
    spec.onCursor?.(value, resolvedIndex);
    return Consumed();
  }
  spec.onActivate?.(value, resolvedIndex);
  return Consumed();
}
