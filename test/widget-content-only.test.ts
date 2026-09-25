import { describe, expect, test } from 'bun:test';

import { contentOnlyMouseRow, renderWidgetBodyWithoutTitle } from '../src/display/widget-content-only.js';
import type { WidgetDef, WidgetInstance } from '../src/widgets/types.js';

describe('widget-content-only adapter', () => {
  test('renders with one extra title row budget and strips the first line', () => {
    const def: WidgetDef<{ n: number }> = {
      type: 'probe',
      description: 'probe',
      initialState: () => ({ n: 0 }),
      render: (_state, ctx) => Array.from({ length: ctx.height }, (_, i) => `row-${i}`),
    };
    const inst: WidgetInstance<{ n: number }> = {
      id: 'w1',
      type: 'probe',
      character: 'Probe',
      state: { n: 0 },
    };
    const body = renderWidgetBodyWithoutTitle(def, inst, {
      width: 10,
      height: 3,
      focused: true,
    });
    expect(body).toEqual(['row-1', 'row-2', 'row-3']);
  });

  test('mouse row translates by one title row', () => {
    expect(contentOnlyMouseRow(0)).toBe(1);
    expect(contentOnlyMouseRow(4)).toBe(5);
  });
});
