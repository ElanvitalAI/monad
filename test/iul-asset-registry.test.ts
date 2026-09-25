import { describe, expect, test } from 'bun:test';
import { getCatalogForIulLab } from '../src/playground/catalog.js';
import { createIulAssetRegistry } from '../src/iul/asset-registry.js';
import { getIulSceneRegistry } from '../src/iul/scene-registry.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';
import { Printer } from '../src/ui/printer.js';
import { stripAnsi } from '../src/tui.js';
import type { MouseEvent } from '../src/ui/mouse-events.js';

function renderLines(view: { draw: (p: Printer) => void }, width = 52, height = 14): string[] {
  const printer = Printer.create({ width, height, focused: true });
  view.draw(printer);
  return printer.lines().map(stripAnsi);
}

function render(view: { draw: (p: Printer) => void }, width = 52, height = 14): string {
  return renderLines(view, width, height).join('\n');
}

function renderAnsi(view: { draw: (p: Printer) => void }, width = 52, height = 14): string {
  const printer = Printer.create({ width, height, focused: true });
  view.draw(printer);
  return printer.lines().join('\n');
}

function mouse(type: MouseEvent['type'], x: number, y: number): MouseEvent {
  return { type, x, y, absX: x, absY: y };
}

describe('IUL asset registry', () => {
  test('test-lab scene references reusable registered assets', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const scene = getIulSceneRegistry().get('test-lab-core');
    expect(scene?.assetIds).toEqual([
      'runtime.change-layout',
      'runtime.dock-menu',
      'ux.context-menu',
      'ux.file-dialog',
    ]);
    for (const assetId of scene?.assetIds ?? []) {
      expect(assets.has(assetId)).toBe(true);
    }
    expect(assets.get('yaml-editor')?.label).toBe('YAML Editor');
  });

  test('runtime representative dims when preview focus moves away', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.change-layout')?.createView();
    if (!view) throw new Error('missing change-layout asset');
    view.layout({ width: 42, height: 12 });
    const focused = Printer.create({ width: 42, height: 12, focused: true });
    const unfocused = Printer.create({ width: 42, height: 12, focused: false });
    view.draw(focused);
    view.draw(unfocused);
    expect(stripAnsi(focused.lines().join('\n'))).toContain('Change layout');
    expect(focused.lines().join('\n')).not.toEqual(unfocused.lines().join('\n'));
  });

  test('dock-menu asset preserves authored submenu prototype without CTA buttons', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    const initial = render(view);
    expect(initial).toContain('Menu');
    expect(initial).toContain('Add surface');

    expect(view.onMouse?.(mouse('click', 3, 1))?.kind).toBe('consumed');
    const parentOpen = render(view);
    expect(parentOpen).toContain('Pop out pane');
    expect(parentOpen).toContain('Add surface');
    expect(parentOpen).toContain('Exit program');
    expect(parentOpen).not.toContain('Switch');
    expect(parentOpen).not.toContain('Cancel');

    expect(view.onEvent?.({ name: 'down' } as never)?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: 'enter' } as never)?.kind).toBe('consumed');

    const after = render(view);
    expect(after).toContain('Pane');
    expect(after).toContain('Browser');
  });

  test('dock-menu asset opens add-window child submenu on right-arrow', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('click', 3, 1))?.kind).toBe('consumed');
    const opened = render(view);
    expect(opened).toContain('Pop out pane');

    expect(view.onEvent?.({ name: 'right' } as never)?.kind).toBe('consumed');
    const child = render(view);
    expect(child).toContain('Browser');
    expect(child).toContain('Preview');
  });

  test('dock-menu asset closes child submenu and preserves parent state on left-arrow', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('click', 3, 1))?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: 'right' } as never)?.kind).toBe('consumed');
    const childOpen = render(view);
    expect(childOpen).toContain('Pop out pane');
    expect(childOpen).toContain('Browser');

    expect(view.onEvent?.({ name: 'left' } as never)?.kind).toBe('consumed');
    const restored = render(view);
    expect(restored).toContain('Pop out pane');
    expect(restored).toContain('Add surface');
    expect(restored).not.toContain('Browser');
  });

  test('dock-menu asset child submenu accepts double-click selection', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('click', 3, 1))?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: 'right' } as never)?.kind).toBe('consumed');
    render(view);

    expect(view.onMouse?.(mouse('double-click', 25, 4))?.kind).toBe('consumed');
    const dismissed = render(view);
    expect(dismissed).not.toContain('Pop out pane');
    expect(dismissed).not.toContain('Browser');
  });

  test('dock-menu asset add-surface submenu overflows and reveals later rows via scroll', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('click', 3, 1))?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: 'down' } as never)?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: 'right' } as never)?.kind).toBe('consumed');

    const initialChild = render(view);
    expect(initialChild).toContain('Add surface');
    expect(initialChild).toContain('  Browser');
    expect(initialChild).not.toContain('Search');
    expect(renderAnsi(view)).toContain('█');
    expect(renderAnsi(view)).toContain('│');

    for (let i = 0; i < 12; i += 1) {
      expect(view.onEvent?.({ name: 'down' } as never)?.kind).toBe('consumed');
    }

    const scrolledChild = render(view);
    expect(scrolledChild).toContain('  Search');
  });

  test('dock-menu asset cycles palette presets for submenu tone comparison', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });
    expect(view.onMouse?.(mouse('click', 3, 1))?.kind).toBe('consumed');

    const vivid = renderAnsi(view);
    expect(vivid).toContain('Tone: Vivid');

    expect(view.onMouse?.(mouse('click', 34, 1))?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: '2' } as never)?.kind).toBe('consumed');
    const soft = renderAnsi(view);
    expect(soft).toContain('Tone: Soft');

    expect(view.onMouse?.(mouse('click', 34, 1))?.kind).toBe('consumed');
    expect(view.onEvent?.({ name: '3' } as never)?.kind).toBe('consumed');
    const base = renderAnsi(view);
    expect(base).toContain('Tone: Default');

    expect(vivid).not.toEqual(soft);
    expect(soft).not.toEqual(base);
  });

  test('dock-menu asset opens palette dropdown from the lab chrome', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('double-click', 34, 1))?.kind).toBe('consumed');
    const opened = render(view, 52, 14);
    expect(opened).toContain('Tone');
    expect(opened).toContain('Vivid');

    expect(view.onMouse?.(mouse('click', 35, 4))?.kind).toBe('consumed');
  });

  test('dock-menu asset palette dropdown accepts 1-3 keys and closes', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('double-click', 34, 1))?.kind).toBe('consumed');
    expect(renderAnsi(view)).toContain('Tone');
    expect(view.onEvent?.({ name: '2' } as never)?.kind).toBe('consumed');
    const after = renderAnsi(view);
    expect(after).toContain('Tone: Soft');
    expect(after).not.toContain('Tone\n');
  });

  test('dock-menu asset palette toggle hit area covers the full visible label', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(view.onMouse?.(mouse('double-click', 45, 1))?.kind).toBe('consumed');
    const opened = render(view, 52, 14);
    expect(opened).toContain('Tone');
    expect(opened).toContain('Vivid');
  });

  test('dock-menu asset tone rail left-click cycles forward and right-click cycles backward', () => {
    const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
    const assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => DEFAULT_THEME_TOKENS,
    });
    const view = assets.get('runtime.dock-menu')?.createView();
    if (!view) throw new Error('missing dock-menu asset');
    view.layout({ width: 52, height: 14 });

    expect(renderAnsi(view)).toContain('Tone: Vivid');
    expect(view.onMouse?.(mouse('click', 45, 1))?.kind).toBe('consumed');
    expect(renderAnsi(view)).toContain('Tone: Soft');
    expect(view.onMouse?.(mouse('right-click', 45, 1))?.kind).toBe('consumed');
    expect(renderAnsi(view)).toContain('Tone: Vivid');
  });
});
