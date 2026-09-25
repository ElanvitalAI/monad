import { describe, expect, test } from 'bun:test';
import { WidgetHost, type WidgetHostHooks } from './host.js';
import type { WidgetDef } from './types.js';

function makeHooks(): WidgetHostHooks {
  return {
    log() {},
    requestRender() {},
  };
}

const stub: WidgetDef<{ n: number }> = {
  type: 'size-contract-stub',
  description: 'fixture',
  defaultCharacter: 'Stub',
  initialState: () => ({ n: 0 }),
  render: () => ['ok'],
};

describe('WidgetHost size contract', () => {
  test('buildContext does not synthesize width or height', () => {
    const host = new WidgetHost(makeHooks());
    host.register(stub);
    const inst = host.spawn({ type: 'size-contract-stub', id: 'stub-1' });
    const ctx = host.buildContext(inst.id);
    if (!ctx) throw new Error('missing ctx');
    expect(Object.prototype.hasOwnProperty.call(ctx, 'width')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ctx, 'height')).toBe(false);
    expect(ctx.width).toBeUndefined();
    expect(ctx.height).toBeUndefined();
  });
});
