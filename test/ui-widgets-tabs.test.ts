import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { Printer } from '../src/ui/printer.js';
import { TextView } from '../src/ui/view.js';
import { Tabs } from '../src/ui/widgets/tabs.js';

describe('Tabs mouse support', () => {
  test('clicking a tab title changes the active tab', () => {
    const tabs = new Tabs({
      tabs: [
        { title: 'Browser', content: new TextView('browser body') },
        { title: 'History', content: new TextView('history body') },
      ],
    });
    tabs.layout({ width: 40, height: 8 });
    expect(tabs.activeIndex).toBe(0);

    const result = tabs.onMouse?.({
      type: 'click',
      x: 12,
      y: 0,
      absX: 12,
      absY: 0,
      shift: false,
      ctrl: false,
      alt: false,
    });

    expect(result?.kind).toBe('consumed');
    expect(tabs.activeIndex).toBe(1);

    const printer = Printer.create({ width: 40, height: 8, focused: true });
    tabs.draw(printer);
    const out = printer.lines().map(stripAnsi).join('\n');
    expect(out).toContain('History');
    expect(out).toContain('history body');
  });
});
