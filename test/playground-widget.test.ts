import { beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import playgroundWidget, {
  playgroundSlotSnapshot,
  type PlaygroundWidgetState,
} from '../src/playground/widget.js';
import { serializeScenarioToYaml } from '../src/playground-scenario/index.js';
import { DIALOG_CONFIRM_FLOW } from '../src/playground-scenario/default-scenarios.js';
import type { PlaygroundScenarioPaletteEntry } from '../src/playground/lab.js';
import type { PlaygroundThemeOptionEntry, PlaygroundPresetOptionEntry, PlaygroundShowcaseEntry } from '../src/playground/lab.js';
import {
  getCatalog,
  resetCatalogForTest,
  setWidgetHostForCatalog,
  type CatalogEntry,
} from '../src/playground/catalog.js';

// VP6 — tests use the catalog without a WidgetHost wired, so the
// 'widget' group is empty. UX + Modal groups (with ~26 entries total)
// are always present.
beforeEach(() => {
  setWidgetHostForCatalog(null);
  resetCatalogForTest();
});

function mkState(partial: Partial<PlaygroundWidgetState> = {}): PlaygroundWidgetState {
  return {
    cursor: 0,
    previewSize: 'medium',
    size: 'medium',
    groupOpen: { ux: true, widget: true, modal: true },
    browserScroll: 0,
    slots: playgroundSlotSnapshot(),
    focused: false,
    mode: 'browse',
    editSource: '',
    editCursor: 0,
    editScrollTop: 0,
    editResult: null,
    scenarioPalette: [],
    scenarioPaletteCursor: 0,
    labFeedback: null,
    themeOptions: [],
    themeCursor: 0,
    presetOptions: [],
    presetCursor: 0,
    chromeAffectiveState: 'neutral',
    chromeMotionDisabled: true,
    chromeMotionMode: 'off',
    chromeVariantOverride: null,
    chromeTargetOverride: null,
    showcaseOptions: [],
    showcaseCursor: 0,
    lastRailCapture: null,
    previousRailCapture: null,
    ...partial,
  };
}

function mkPalette(ids: string[]): PlaygroundScenarioPaletteEntry[] {
  return ids.map((id, idx) => ({
    id,
    title: `Scenario ${idx + 1}`,
    tags: idx === 0 ? ['smoke'] : [],
    stepCount: idx + 1,
  }));
}

function mkThemes(names: string[]): PlaygroundThemeOptionEntry[] {
  return names.map((name, idx) => ({
    name,
    isDark: idx === 0,
    isPastel: true,
  }));
}

function mkPresets(ids: string[]): PlaygroundPresetOptionEntry[] {
  return ids.map((id, idx) => ({
    id,
    label: `Preset ${idx + 1}`,
    description: 'desc',
    rowCount: idx + 1,
  }));
}

function mkShowcases(ids: string[]): PlaygroundShowcaseEntry[] {
  return ids.map((id, idx) => ({
    id,
    label: `Showcase ${idx + 1}`,
    pluginId: id,
    description: 'desc',
  }));
}

function findCursorInGroup(catalog: CatalogEntry[], group: 'ux' | 'widget' | 'modal'): number {
  return catalog.findIndex(e => e.group === group);
}

describe('VP6 — playground widget', () => {
  test('registers with type "playground" + default character', () => {
    expect(playgroundWidget.type).toBe('playground');
    expect(playgroundWidget.defaultCharacter).toBe('Widget Playground');
  });

  test('initialState honors config.initialSize and seeds catalog snapshot', () => {
    const s = playgroundWidget.initialState({ initialSize: 'large' });
    expect(s.previewSize).toBe('large');
    expect(s.size).toBe('large');
    expect(s.groupOpen).toEqual({ ux: true, widget: true, modal: true });
    expect(s.cursor).toBe(0);
    expect(s.slots.length).toBe(getCatalog().length);
    // UX group is always first; cursor 0 should be a ux entry.
    expect(s.slots[0]!.group).toBe('ux');
  });

  test('initialState defaults to medium when config omits size', () => {
    const s = playgroundWidget.initialState(undefined);
    expect(s.previewSize).toBe('medium');
  });

  test('down/j skips over group headers (only visits catalog entries)', () => {
    const s = mkState();
    const catalog = getCatalog();
    const before = catalog[s.cursor]!.id;
    playgroundWidget.onKey!({ name: 'down' } as never, s, undefined as never);
    expect(catalog[s.cursor]!.id).not.toBe(before);
    // All visited entries are valid catalog entries (not headers).
    expect(catalog[s.cursor]).toBeDefined();
  });

  test('up/k wraps to the last visible entry when at index 0', () => {
    const s = mkState({ cursor: 0 });
    const catalog = getCatalog();
    playgroundWidget.onKey!({ name: 'up' } as never, s, undefined as never);
    expect(s.cursor).toBe(catalog.length - 1);
  });

  test('tab forward / shift+tab toggles current group', () => {
    const s = mkState();
    const before = s.cursor;
    playgroundWidget.onKey!({ name: 'tab' } as never, s, undefined as never);
    expect(s.cursor).not.toBe(before);

    // shift+tab on a ux entry collapses ux group
    s.cursor = findCursorInGroup(getCatalog(), 'ux');
    playgroundWidget.onKey!({ name: 'tab', shift: true } as never, s, undefined as never);
    expect(s.groupOpen.ux).toBe(false);
    // Cursor snapped to first visible (first entry of the next open group).
    const catalog = getCatalog();
    expect(catalog[s.cursor]!.group).not.toBe('ux');
  });

  test('pagedown jumps to the first entry of the next open group', () => {
    const s = mkState({ cursor: 0 });
    const catalog = getCatalog();
    playgroundWidget.onKey!({ name: 'pagedown' } as never, s, undefined as never);
    const nextGroup = catalog[s.cursor]!.group;
    expect(nextGroup).not.toBe(catalog[0]!.group);
  });

  test('1 / 2 / 3 swap preview size', () => {
    const s = mkState();
    playgroundWidget.onKey!({ name: '1' } as never, s, undefined as never);
    expect(s.previewSize).toBe('small');
    playgroundWidget.onKey!({ name: '3' } as never, s, undefined as never);
    expect(s.previewSize).toBe('large');
    playgroundWidget.onKey!({ name: '2' } as never, s, undefined as never);
    expect(s.previewSize).toBe('medium');
  });

  test('r bumps reloadRequestedAt monotonically', async () => {
    const s = mkState();
    expect(s.reloadRequestedAt).toBeUndefined();
    playgroundWidget.onKey!({ name: 'r' } as never, s, undefined as never);
    const first = s.reloadRequestedAt!;
    expect(typeof first).toBe('number');
    await new Promise((r) => setTimeout(r, 2));
    playgroundWidget.onKey!({ name: 'r' } as never, s, undefined as never);
    expect(s.reloadRequestedAt!).toBeGreaterThan(first);
  });

  test('unknown keys return { type: "none" }', () => {
    const s = mkState();
    const r = playgroundWidget.onKey!({ name: 'escape' } as never, s, undefined as never);
    expect(r).toEqual({ type: 'none' });
    expect(s.cursor).toBe(0);
  });

  test('render emits title + legend + browser/preview rows for sane geometry', () => {
    const s = mkState();
    const lines = playgroundWidget.render(s, {
      width: 120,
      height: 30,
      focused: true,
      originRow: 1,
      originCol: 1,
    } as never, 'Widget Playground');
    expect(lines.length).toBeGreaterThan(10);
    const joined = lines.join('\n');
    expect(joined).toContain('size:');
    expect(joined).toContain('slot:');
    expect(joined).toContain('UX Components');
    expect(joined).toContain('Modals');
    expect(s.lastWidth).toBe(120);
    expect(s.lastHeight).toBe(30);
  });

  test('render returns empty for degenerate geometry', () => {
    const s = mkState();
    const tiny = playgroundWidget.render(s, {
      width: 4,
      height: 1,
      focused: false,
      originRow: 1,
      originCol: 1,
    } as never, 'Widget Playground');
    expect(tiny).toEqual([]);
  });

  test('inspect bar reflects the selected entry + hides when body is too small', () => {
    const s = mkState();
    const tall = playgroundWidget.render(s, {
      width: 120, height: 30, focused: true, originRow: 1, originCol: 1,
    } as never, 'Widget Playground');
    const bottom = tall[tall.length - 1]!;
    expect(bottom).toContain('inspect:');
    const entry = getCatalog()[s.cursor]!;
    expect(bottom).toContain(entry.id);

    const shallow = playgroundWidget.render(mkState(), {
      width: 120, height: 6, focused: false, originRow: 1, originCol: 1,
    } as never, 'Widget Playground');
    expect(shallow.join('\n')).not.toContain('inspect:');
  });

  test('preview header names the currently-selected catalog entry', () => {
    const s = mkState();
    const lines = playgroundWidget.render(s, {
      width: 120, height: 30, focused: true, originRow: 1, originCol: 1,
    } as never, 'Widget Playground');
    const entry = getCatalog()[s.cursor]!;
    const joined = lines.join('\n');
    expect(joined).toContain(entry.title);
  });

  test('mouse click on a browser row changes cursor + logs', () => {
    const s = mkState({ cursor: 0, lastWidth: 120, lastHeight: 30 });
    let logged = '';
    const ctx = {
      widgetId: 'test',
      widgetType: 'playground',
      character: 'x',
      state: s,
      setState: () => {},
      requestRender: () => {},
      dismiss: () => {},
      log: (line: string) => { logged = line; },
    } as never;
    // Row = bodyTop (2 with title) + offset → points to second visible entry.
    playgroundWidget.onMouse!({ type: 'click', row: 5, col: 4 }, s, ctx);
    expect(s.cursor).not.toBe(0);
    expect(logged).toContain('[playground] →');
  });

  test('mouse click on a header toggles the group', () => {
    const s = mkState({ cursor: 0, lastWidth: 120, lastHeight: 30 });
    // Row 2 = first browser row (header of UX group when the title is present).
    const ctx = {
      widgetId: 'test', widgetType: 'playground', character: 'x',
      state: s, setState: () => {}, requestRender: () => {},
      dismiss: () => {}, log: () => {},
    } as never;
    playgroundWidget.onMouse!({ type: 'click', row: 2, col: 2 }, s, ctx);
    expect(s.groupOpen.ux).toBe(false);
  });
});

// F-B5b Phase 1 — mode toggle basic contract
describe('F-B5b · mode toggle', () => {
  function mkCtx(logged: string[]) {
    return {
      widgetId: 't', widgetType: 'playground', character: 'x',
      state: null as never, setState: () => {}, requestRender: () => {},
      dismiss: () => {}, log: (l: string) => logged.push(l),
    } as never;
  }

  test('initialState starts in browse mode', () => {
    const s = playgroundWidget.initialState(undefined);
    expect(s.mode).toBe('browse');
  });

  test('pressing e in browse mode switches to edit', () => {
    const s = mkState();
    const logged: string[] = [];
    const r = playgroundWidget.onKey!({ name: 'e' } as never, s, mkCtx(logged));
    expect(s.mode).toBe('edit');
    expect(r).toEqual({ type: 'refresh' });
    expect(logged.join('\n')).toContain('browse → edit');
  });

  test('Esc in edit mode returns to browse', () => {
    const s = mkState({ mode: 'edit' });
    const logged: string[] = [];
    const r = playgroundWidget.onKey!({ name: 'escape' } as never, s, mkCtx(logged));
    expect(s.mode).toBe('browse');
    expect(r).toEqual({ type: 'refresh' });
    expect(logged.join('\n')).toContain('edit mode → browse');
  });

  test('edit mode does not reuse browse navigation state for arbitrary keys', () => {
    const s = mkState({ mode: 'edit', cursor: 5 });
    const r = playgroundWidget.onKey!({ name: 'j' } as never, s, mkCtx([]));
    expect(s.mode).toBe('edit');
    expect(s.cursor).toBe(5);
    expect(s.editCursor).toBe(0);
    expect(r).toEqual({ type: 'none' });
  });

  test('edit mode absorbs mouse clicks without changing browse cursor', () => {
    const s = mkState({ mode: 'edit', cursor: 3, lastWidth: 120, lastHeight: 30 });
    const r = playgroundWidget.onMouse!({ type: 'click', row: 5, col: 4 } as never, s, mkCtx([]));
    expect(s.cursor).toBe(3);
    expect(r).toEqual({ type: 'refresh' });
  });

  test('render shows editor/preview/error rails in edit mode', () => {
    const yaml = serializeScenarioToYaml(DIALOG_CONFIRM_FLOW);
    const s = mkState({
      mode: 'edit',
      editSource: yaml,
      editResult: {
        scenario: DIALOG_CONFIRM_FLOW,
        validSteps: DIALOG_CONFIRM_FLOW.steps,
        errors: [],
        warnings: [],
      },
      editScenarioId: DIALOG_CONFIRM_FLOW.id,
      scenarioPalette: mkPalette(['dialog:confirm-flow', 'picker:row-click']),
      themeOptions: mkThemes(['catppuccin-mocha', 'elanous-pastel-default']),
      presetOptions: mkPresets(['newsroom', 'coding-focus']),
      showcaseOptions: mkShowcases(['canvas-sketch', 'runtime-signals']),
    });
    const ctx = { width: 100, height: 30, focused: true, originRow: 1, originCol: 1 } as never;
    const lines = playgroundWidget.render(s, ctx, 'Widget Playground');
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join('\n');
    expect(joined).toContain('Scenario YAML');
    expect(joined).toContain('Preview');
    expect(joined).toContain('Scenario Palette');
    expect(joined).toContain('Visual Console');
    expect(joined).toContain('Showcase Rail');
    expect(joined).toContain('no embedded rail for Showcase 1');
    expect(joined).not.toContain('canvas sketch rail');
    expect(joined).toContain('Lab Feedback');
    expect(joined).toContain('dialog:confirm-flow');
  });

  test('cursor + scroll preserved across e → Esc round-trip', () => {
    const s = mkState({ cursor: 7, browserScroll: 3 });
    const logged: string[] = [];
    playgroundWidget.onKey!({ name: 'e' } as never, s, mkCtx(logged));
    expect(s.mode).toBe('edit');
    playgroundWidget.onKey!({ name: 'escape' } as never, s, mkCtx(logged));
    expect(s.mode).toBe('browse');
    expect(s.cursor).toBe(7);
    expect(s.browserScroll).toBe(3);
  });

  test('edit mode inserts printable characters into YAML source', () => {
    const s = mkState({ mode: 'edit', editSource: 'id: demo', editCursor: 8 });
    const r = playgroundWidget.onKey!({ name: 'x', sequence: 'x' } as never, s, mkCtx([]));
    expect(r).toEqual({ type: 'refresh' });
    expect(s.editSource).toBe('id: demox');
    expect(s.editCursor).toBe(9);
    expect(s.editResult?.scenario?.id).toBe('demox');
  });

  test('edit mode handles backspace', () => {
    const s = mkState({ mode: 'edit', editSource: 'id: demo', editCursor: 8 });
    const r = playgroundWidget.onKey!({ name: 'backspace' } as never, s, mkCtx([]));
    expect(r).toEqual({ type: 'refresh' });
    expect(s.editSource).toBe('id: dem');
    expect(s.editCursor).toBe(7);
  });

  test('ctrl+j / ctrl+k move the in-lab scenario palette cursor', () => {
    const s = mkState({
      mode: 'edit',
      scenarioPalette: mkPalette(['a', 'b', 'c']),
      scenarioPaletteCursor: 0,
    });
    playgroundWidget.onKey!({ name: 'j', ctrl: true } as never, s, mkCtx([]));
    expect(s.scenarioPaletteCursor).toBe(1);
    playgroundWidget.onKey!({ name: 'k', ctrl: true } as never, s, mkCtx([]));
    expect(s.scenarioPaletteCursor).toBe(0);
  });

  test('ctrl+r / ctrl+s / ctrl+o queue lab actions', () => {
    const s = mkState({
      mode: 'edit',
      scenarioPalette: mkPalette(['a']),
    });
    playgroundWidget.onKey!({ name: 'r', ctrl: true } as never, s, mkCtx([]));
    playgroundWidget.onKey!({ name: 's', ctrl: true } as never, s, mkCtx([]));
    playgroundWidget.onKey!({ name: 'o', ctrl: true } as never, s, mkCtx([]));
    expect(typeof s.runRequestedAt).toBe('number');
    expect(typeof s.saveRequestedAt).toBe('number');
    expect(typeof s.loadRequestedAt).toBe('number');
  });

  test('ctrl+t / ctrl+y / ctrl+p / ctrl+m / ctrl+a update visual console state', () => {
    const s = mkState({
      mode: 'edit',
      themeOptions: mkThemes(['catppuccin-mocha', 'elanous-pastel-default']),
      presetOptions: mkPresets(['newsroom', 'coding-focus']),
      showcaseOptions: mkShowcases(['canvas-sketch', 'runtime-signals']),
      chromeAffectiveState: 'neutral',
      chromeMotionDisabled: true,
      chromeMotionMode: 'off',
    });
    playgroundWidget.onKey!({ name: 't', ctrl: true } as never, s, mkCtx([]));
    expect(s.themeCursor).toBe(1);
    playgroundWidget.onKey!({ name: 'y', ctrl: true } as never, s, mkCtx([]));
    expect(s.themeCursor).toBe(0);
    playgroundWidget.onKey!({ name: 'p', ctrl: true } as never, s, mkCtx([]));
    expect(s.presetCursor).toBe(1);
    playgroundWidget.onKey!({ name: 'm', ctrl: true } as never, s, mkCtx([]));
    expect(s.chromeMotionMode).toBe('auto');
    expect(s.chromeMotionDisabled).toBe(false);
    playgroundWidget.onKey!({ name: 'v', ctrl: true } as never, s, mkCtx([]));
    expect(s.chromeVariantOverride).toBe('rounded');
    playgroundWidget.onKey!({ name: 'x', ctrl: true } as never, s, mkCtx([]));
    expect(s.chromeTargetOverride).toBe('title-bar');
    playgroundWidget.onKey!({ name: 'a', ctrl: true } as never, s, mkCtx([]));
    expect(s.chromeAffectiveState).not.toBe('neutral');
  });

  test('ctrl+g / ctrl+h / ctrl+l update showcase lane state', () => {
    const s = mkState({
      mode: 'edit',
      showcaseOptions: mkShowcases(['canvas-sketch', 'runtime-signals']),
      showcaseCursor: 0,
    });
    playgroundWidget.onKey!({ name: 'g', ctrl: true } as never, s, mkCtx([]));
    expect(s.showcaseCursor).toBe(1);
    playgroundWidget.onKey!({ name: 'h', ctrl: true } as never, s, mkCtx([]));
    expect(s.showcaseCursor).toBe(0);
    playgroundWidget.onKey!({ name: 'l', ctrl: true } as never, s, mkCtx([]));
    expect(typeof s.launchShowcaseRequestedAt).toBe('number');
  });

  test('ctrl+i / ctrl+u / ctrl+n drive materialize-capture-compare loop', () => {
    const s = mkState({
      mode: 'edit',
      lastWidth: 100,
      lastHeight: 30,
      themeOptions: mkThemes(['catppuccin-mocha', 'elanous-pastel-default']),
      presetOptions: mkPresets(['newsroom', 'coding-focus']),
      showcaseOptions: mkShowcases(['canvas-sketch', 'runtime-signals']),
      showcaseCursor: 1,
    });
    playgroundWidget.onKey!({ name: 'i', ctrl: true } as never, s, mkCtx([]));
    expect(s.labFeedback?.title).toContain('Materialize intent');
    expect(s.labFeedback?.lines?.join('\n')).toContain(
      'Use runtime rail as baseline → launch showcase when the signal mix looks right',
    );
    expect(s.labFeedback?.lines?.join('\n')).not.toContain('Launch canvas sketch');
    playgroundWidget.onKey!({ name: 'u', ctrl: true } as never, s, mkCtx([]));
    expect(s.lastRailCapture).not.toBeNull();
    expect(s.lastRailCapture?.lines.join('\n')).toContain('no embedded rail for Showcase 2');
    expect(s.labFeedback?.title).toContain('captured');
    playgroundWidget.onKey!({ name: 'p', ctrl: true } as never, s, mkCtx([]));
    playgroundWidget.onKey!({ name: 'u', ctrl: true } as never, s, mkCtx([]));
    expect(s.previousRailCapture).not.toBeNull();
    playgroundWidget.onKey!({ name: 'n', ctrl: true } as never, s, mkCtx([]));
    expect(s.labFeedback?.title).toContain('compare');
  });
});

describe('retired plugin-id dead branches (source guard)', () => {
  const widgetSrc = readFileSync(join(import.meta.dir, '..', 'src/playground/widget.ts'), 'utf-8');

  test('drops widget-demo and iul-canvas branches and renderCanvasSketchRail', () => {
    expect(widgetSrc).not.toContain('widget-demo');
    expect(widgetSrc).not.toContain('iul-canvas');
    expect(widgetSrc).not.toMatch(/\brenderCanvasSketchRail\b/);
    expect(widgetSrc).not.toMatch(/pluginId === ['"]widget-demo['"]/);
    expect(widgetSrc).not.toMatch(/pluginId === ['"]iul-canvas['"]/);
  });

  test('keeps renderRuntimeSignalsRailForPreset definition and live call', () => {
    expect(widgetSrc).toMatch(/function renderRuntimeSignalsRailForPreset\s*\(/);
    expect(widgetSrc).toMatch(/return renderRuntimeSignalsRailForPreset\s*\(/);
  });
});
