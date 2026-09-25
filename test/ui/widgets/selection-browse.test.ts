import { describe, expect, test } from 'bun:test';
import { dispatchBrowseRowMouse } from '../../../src/ui/widgets/selection-browse.js';

describe('selection browse dispatch', () => {
  test('default click browses by moving the cursor without activating', () => {
    const events: string[] = [];
    const result = dispatchBrowseRowMouse({
      event: { type: 'click', x: 0, y: 0, absX: 0, absY: 0 },
      value: 'row-a',
      index: 1,
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(result.kind).toBe('consumed');
    expect(events).toEqual(['cursor:row-a:1']);
  });

  test('browseMode false click activates immediately', () => {
    const events: string[] = [];
    const result = dispatchBrowseRowMouse({
      event: { type: 'click', x: 0, y: 0, absX: 0, absY: 0 },
      browseMode: false,
      value: 'row-d',
      index: 4,
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(result.kind).toBe('consumed');
    expect(events).toEqual(['activate:row-d:4']);
  });

  test('browseMode click moves cursor only', () => {
    const events: string[] = [];
    dispatchBrowseRowMouse({
      event: { type: 'click', x: 0, y: 0, absX: 0, absY: 0 },
      browseMode: true,
      value: 'row-b',
      index: 2,
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(events).toEqual(['cursor:row-b:2']);
  });

  test('browseMode double-click activates', () => {
    const events: string[] = [];
    dispatchBrowseRowMouse({
      event: { type: 'double-click', x: 0, y: 0, absX: 0, absY: 0 },
      browseMode: true,
      value: 'row-c',
      index: 3,
      onCursor: (value, index) => events.push(`cursor:${value}:${index}`),
      onActivate: (value, index) => events.push(`activate:${value}:${index}`),
    });
    expect(events).toEqual(['activate:row-c:3']);
  });
});
