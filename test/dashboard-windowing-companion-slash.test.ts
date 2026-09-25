import { describe, expect, test } from 'bun:test';

import { parseWindowCompanionSlash } from '../src/dashboard/windowing/companion-slash.js';

describe('parseWindowCompanionSlash', () => {
  test('defaults to toggle on the current foreground window', () => {
    const result = parseWindowCompanionSlash(['clipboard'], { currentWindowId: 7 });
    expect(result).toEqual({
      ok: true,
      value: { key: 'clipboard', action: 'toggle', windowId: 7 },
    });
  });

  test('accepts explicit action aliases and explicit window ids in either order', () => {
    expect(parseWindowCompanionSlash(['memo', 'show', '12'])).toEqual({
      ok: true,
      value: { key: 'memo', action: 'open', windowId: 12 },
    });
    expect(parseWindowCompanionSlash(['detail', '12', 'off'])).toEqual({
      ok: true,
      value: { key: 'detail', action: 'close', windowId: 12 },
    });
  });

  test('normalizes case and surrounding whitespace in key/action tokens', () => {
    expect(parseWindowCompanionSlash(['  CLIP  ', '  OFF  ', '12'])).toEqual({
      ok: true,
      value: { key: 'clipboard', action: 'close', windowId: 12 },
    });
  });

  test('surfaces missing target window clearly', () => {
    expect(parseWindowCompanionSlash(['clipboard'])).toEqual({
      ok: false,
      message: 'No target virtual window. Focus a VW first or pass an explicit window id.',
    });
  });

  test('surfaces usage when the companion key is missing', () => {
    expect(parseWindowCompanionSlash([])).toEqual({
      ok: false,
      message: 'Usage: /window companion <clipboard|memo|detail> [open|close|toggle] [windowId]',
    });
  });

  test('rejects unknown trailing args', () => {
    expect(parseWindowCompanionSlash(['clipboard', 'weird'])).toEqual({
      ok: false,
      message: 'Unknown /window companion arg: weird. Expected open|close|toggle or window id.',
    });
  });
});
