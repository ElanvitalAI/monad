import { describe, expect, test } from 'bun:test';
import { dispatchPointerListMouse, rowIndexFromPointerPayload } from '../../../src/ui/widgets/pointer-list-controller.js';

describe('pointer list controller', () => {
  test('extracts canonical row indices from row payload variants', () => {
    expect(rowIndexFromPointerPayload({
      type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', index: 1 },
    })).toBe(1);
    expect(rowIndexFromPointerPayload({
      type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', idx: 2 },
    })).toBe(2);
    expect(rowIndexFromPointerPayload({
      type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', filtIdx: 3 },
    })).toBe(3);
  });

  test('scroll events route through shared cursor movement', () => {
    const seen: number[] = [];
    const result = dispatchPointerListMouse({
      event: { type: 'scroll-down', x: 0, y: 0, absX: 0, absY: 0 },
      count: 10,
      currentIndex: 1,
      getValueAt: (index) => `row-${index}`,
      setCursor: (index) => seen.push(index),
    });
    expect(result.kind).toBe('consumed');
    expect(seen).toEqual([4]);
  });

  test('browse mode click only updates cursor callback', () => {
    const events: string[] = [];
    dispatchPointerListMouse({
      event: { type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', index: 2 } },
      count: 4,
      currentIndex: 0,
      browseMode: true,
      getValueAt: (index) => `row-${index}`,
      setCursor: (index) => events.push(`set:${index}`),
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(events).toEqual(['set:2', 'cursor:row-2:2']);
  });

  test('default click selects without activating', () => {
    const events: string[] = [];
    dispatchPointerListMouse({
      event: { type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', index: 1 } },
      count: 4,
      currentIndex: 0,
      getValueAt: (index) => `row-${index}`,
      setCursor: (index) => events.push(`set:${index}`),
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(events).toEqual(['set:1', 'cursor:row-1:1']);
  });

  test('menu-mode click activates immediately when browseMode is false', () => {
    const events: string[] = [];
    dispatchPointerListMouse({
      event: { type: 'click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', index: 1 } },
      count: 4,
      currentIndex: 0,
      browseMode: false,
      getValueAt: (index) => `row-${index}`,
      setCursor: (index) => events.push(`set:${index}`),
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(events).toEqual(['set:1', 'activate:row-1:1']);
  });

  test('double-click activates after selecting the row', () => {
    const events: string[] = [];
    dispatchPointerListMouse({
      event: { type: 'double-click', x: 0, y: 0, absX: 0, absY: 0, payload: { kind: 'row', index: 1 } },
      count: 4,
      currentIndex: 0,
      getValueAt: (index) => `row-${index}`,
      setCursor: (index) => events.push(`set:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(events).toEqual(['set:1', 'activate:row-1:1']);
  });
});
