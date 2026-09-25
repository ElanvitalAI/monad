import { describe, expect, test } from 'bun:test';

import {
  dispatchChromeControlAction,
  formatChromeControlsTitleRight,
  mountViewAsModalSurface,
} from '../src/ui/modal-adapter.js';
import {
  DEFAULT_CLOSE_GLYPH,
  DEFAULT_MINIMIZE_GLYPH,
} from '../src/ui/chrome/control-glyphs.js';
import { BoxView, TextView } from '../src/ui/view.js';

describe('modal-adapter chrome controls', () => {
  test('formatChromeControlsTitleRight renders minimize + close order', () => {
    expect(formatChromeControlsTitleRight({
      minimizeButton: true,
      closeButton: true,
    })).toBe(`${DEFAULT_MINIMIZE_GLYPH} ${DEFAULT_CLOSE_GLYPH}`);
  });

  test('clicking chrome-close invokes callback and disposes the surface', () => {
    let closed = 0;
    const view = new BoxView(new TextView('body'), {
      border: true,
      title: 'Popup',
      titleRight: formatChromeControlsTitleRight({ closeButton: true }),
    });
    const handle = mountViewAsModalSurface({
      id: 'popup:test',
      bounds: { row: 10, col: 10, width: 20, height: 6 },
      view,
      chromeControls: {
        closeButton: true,
        onClose: () => { closed++; },
      },
    });
    handle.surface.paint();
    const result = handle.handleMouse({ type: 'click', row: 10, col: 27 });
    expect(result).toBe('consumed');
    expect(closed).toBe(1);
    expect(handle.isDisposed()).toBe(true);
  });

  test('clicking chrome-minimize invokes callback and disposes the surface', () => {
    let minimized = 0;
    const view = new BoxView(new TextView('body'), {
      border: true,
      title: 'Popup',
      titleRight: formatChromeControlsTitleRight({
        minimizeButton: true,
        closeButton: true,
      }),
    });
    const handle = mountViewAsModalSurface({
      id: 'popup:test',
      bounds: { row: 10, col: 10, width: 20, height: 6 },
      view,
      chromeControls: {
        minimizeButton: true,
        closeButton: true,
        onMinimize: () => { minimized++; },
      },
    });
    handle.surface.paint();
    const result = handle.handleMouse({ type: 'click', row: 10, col: 25 });
    expect(result).toBe('consumed');
    expect(minimized).toBe(1);
    expect(handle.isDisposed()).toBe(true);
  });

  test('close disposition can keep the window open without bypassing the shared trigger', () => {
    let closed = 0;
    const view = new BoxView(new TextView('body'), {
      border: true,
      title: 'Popup',
      titleRight: formatChromeControlsTitleRight({ closeButton: true }),
    });
    const handle = mountViewAsModalSurface({
      id: 'popup:test:keep-open',
      bounds: { row: 10, col: 10, width: 20, height: 6 },
      view,
      chromeControls: {
        closeButton: true,
        closeDisposition: 'keep-open',
        onClose: () => { closed++; },
      },
    });
    handle.surface.paint();
    const result = handle.handleMouse({ type: 'click', row: 10, col: 27 });
    expect(result).toBe('consumed');
    expect(closed).toBe(1);
    expect(handle.isDisposed()).toBe(false);
  });

  test('callback return value can override default minimize disposal', () => {
    let minimized = 0;
    let disposed = 0;
    const outcome = dispatchChromeControlAction(
      'minimize',
      {
        minimizeButton: true,
        onMinimize: () => {
          minimized++;
          return 'keep-open';
        },
      },
      () => { disposed++; },
    );
    expect(outcome).toBe('keep-open');
    expect(minimized).toBe(1);
    expect(disposed).toBe(0);
  });
});
