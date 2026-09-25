import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { Printer } from '../src/ui/printer.js';
import {
  createThemeLabLaneState,
  createThemeLabLaneView,
} from '../src/iul/theme-lab-lane-view.js';

function render(view: ReturnType<typeof createThemeLabLaneView>): string {
  view.layout({ width: 108, height: 30 });
  const printer = Printer.create({ width: 108, height: 30, focused: true });
  view.draw(printer);
  return printer.lines().map(stripAnsi).join('\n');
}

describe('IUL theme lab lane view', () => {
  test('renders a freeform themed showcase surface', () => {
    const view = createThemeLabLaneView({
      footerHint: '↑↓ live preview · Enter keep theme · Esc revert to baseline',
      state: createThemeLabLaneState('catppuccin-mocha'),
    });
    const out = render(view);
    expect(out).toContain('Theme Lab');
    expect(out).toContain('Live widget showcase');
    expect(out).toContain('Surface menu');
    expect(out).toContain('Apply this theme?');
  });

  test('cursor preview, commit, and revert drive the preview control', () => {
    let activeTheme = 'catppuccin-mocha';
    const log: string[] = [];
    const state = createThemeLabLaneState(activeTheme);
    const view = createThemeLabLaneView({
      footerHint: '↑↓ live preview · Enter keep theme · Esc revert to baseline',
      state,
      themePreviewControl: {
        getActiveThemeName: () => activeTheme,
        previewTheme: (name: string) => { activeTheme = name; log.push(`preview:${name}`); },
        revertPreview: () => { activeTheme = state.baselineTheme; log.push('revert'); },
        commitTheme: (name: string) => { activeTheme = name; log.push(`commit:${name}`); },
      },
    });
    view.layout({ width: 108, height: 30 });
    view.takeFocus('front');
    view.onEvent({ name: 'down', ctrl: false, shift: false, alt: false });
    expect(log[0]).toMatch(/^preview:/);
    expect(state.previewActive).toBe(true);
    view.onEvent({ name: 'enter', ctrl: false, shift: false, alt: false });
    expect(log[1]).toMatch(/^commit:/);
    expect(state.previewActive).toBe(false);
    view.onEvent({ name: 'down', ctrl: false, shift: false, alt: false });
    view.onEvent({ name: 'escape', ctrl: false, shift: false, alt: false });
    expect(log.at(-1)).toBe('revert');
    expect(state.previewActive).toBe(false);
    expect(state.previewTheme).toBe(state.baselineTheme);
  });
});
