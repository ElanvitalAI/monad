import { describe, expect, test } from 'bun:test';
import type { WidgetContext } from './types.js';

function baseCtx(): WidgetContext {
  return {
    widgetId: 'w',
    widgetType: 't',
    character: 'c',
    state: {},
    setState() {},
    requestRender() {},
    dismiss() {},
    log() {},
  };
}

describe('WidgetContext size contract', () => {
  test('width and height are optional and omitted when a host does not inject them', () => {
    const ctx = baseCtx();
    expect(Object.prototype.hasOwnProperty.call(ctx, 'width')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ctx, 'height')).toBe(false);
    expect(ctx.width).toBeUndefined();
    expect(ctx.height).toBeUndefined();
    expect(ctx.width ?? 8).toBe(8);
    expect(ctx.height ?? 8).toBe(8);
  });

  test('hosts that know layout size may inject readonly width and height', () => {
    const ctx: WidgetContext = { ...baseCtx(), width: 40, height: 12 };
    expect(ctx.width).toBe(40);
    expect(ctx.height).toBe(12);
  });
});
