import { describe, expect, test } from 'bun:test';
import { createIulTestLabView } from '../src/iul/lab-tabs.js';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';

function render(view: { draw: (p: Printer) => void }, width = 120, height = 32): string[] {
  const printer = Printer.create({ width, height, focused: true });
  view.draw(printer);
  return printer.lines().map(stripAnsi);
}

function mouse(type: MouseEvent['type'], x: number, y: number): MouseEvent {
  return { type, x, y, absX: x, absY: y };
}

describe('IUL test lab top controls', () => {
  test('theme control cycles forward on click and backward on right-click', () => {
    const view = createIulTestLabView();
    view.layout?.({ width: 120, height: 32 });

    const before = render(view);
    const line = before[1] ?? '';
    const themeX = line.indexOf('Theme:');
    expect(themeX).toBeGreaterThanOrEqual(0);

    expect(view.onMouse?.(mouse('click', themeX + 2, 1))?.kind).toBe('consumed');
    const afterClick = render(view);
    expect(afterClick[1]).toContain('Theme:');
    expect(afterClick[1]).not.toBe(before[1]);

    expect(view.onMouse?.(mouse('right-click', themeX + 2, 1))?.kind).toBe('consumed');
    const afterRightClick = render(view);
    expect(afterRightClick[1]).toBe(before[1]);
  });
});
