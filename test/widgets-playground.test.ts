// ── Presentation P5b · playground widget ──
//
// Unit tests around the pure parts of the playground widget — state
// transitions + render output structure. Full mount-cycle tests live
// under integration coverage (test/scenarios/integration.test.ts
// already exercises the materializeScenario path the widget consumes).

import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import playground, {
  type PlaygroundState,
  type PlaygroundConfig,
} from '../widgets/playground/widget.js';
import type { KeyEvent, WidgetContext } from '../src/widgets/types.js';
import {
  _resetWidgetSchemaRegistryForTest,
  registerWidgetSchema,
} from '../src/ui/declarative/index.js';

interface MockCtx {
  state: PlaygroundState;
  ctx: WidgetContext<PlaygroundState>;
  setStateCalls: Array<Partial<PlaygroundState>>;
  dismissed: boolean;
  renders: number;
  tweens: Array<{ key: string; durationMs: number; curve?: unknown }>;
  progressMap: Map<string, number>;
}

function mkCtx(state: PlaygroundState): MockCtx {
  let current = state;
  const setStateCalls: Array<Partial<PlaygroundState>> = [];
  let renders = 0;
  let dismissed = false;
  const tweens: Array<{ key: string; durationMs: number; curve?: unknown }> = [];
  const progressMap = new Map<string, number>();
  const ctx: WidgetContext<PlaygroundState> = {
    widgetId: 'pg-1',
    widgetType: 'playground',
    character: 'Playground',
    get state() { return current; },
    setState: (patch) => {
      setStateCalls.push(patch);
      current = { ...current, ...(patch as PlaygroundState) };
    },
    requestRender: () => { renders++; },
    dismiss: () => { dismissed = true; },
    log: () => {},
    animate: {
      tween: (spec) => {
        tweens.push({ key: spec.key, durationMs: spec.durationMs, curve: spec.curve });
      },
      progress: (key) => progressMap.get(key) ?? 1,
      isDone: (key) => (progressMap.get(key) ?? 1) >= 1,
      hasActive: () => [...progressMap.values()].some(v => v < 1),
      cancel: (key) => { progressMap.delete(key); },
    },
  };
  return {
    get state() { return current; },
    set state(s: PlaygroundState) { current = s; },
    ctx,
    setStateCalls,
    get dismissed() { return dismissed; },
    get renders() { return renders; },
    tweens,
    progressMap,
  } as unknown as MockCtx;
}

function mkKey(name: string, opts: { ctrl?: boolean; alt?: boolean; sequence?: string } = {}): KeyEvent {
  return {
    name,
    sequence: opts.sequence ?? name,
    ctrl: opts.ctrl,
    alt: opts.alt,
    shift: false,
    meta: false,
  } as unknown as KeyEvent;
}

beforeEach(() => {
  _resetWidgetSchemaRegistryForTest();
  for (const type of ['log', 'list', 'dialog', 'tooltip', 'toast-stack']) {
    registerWidgetSchema({
      type,
      description: type,
      configSchema: { type: 'object', additionalProperties: true },
    });
  }
});

describe('playground · initialState', () => {
  test('default config · uses DEFAULT_SOURCE + parses successfully', () => {
    const state = playground.initialState!();
    expect(state.source.length).toBeGreaterThan(0);
    expect(state.cursor).toBe(0);
    expect(state.mode).toBe('edit');
    expect(state.title).toBe('scratch');
    expect(state.current).not.toBeNull();
    expect(state.previewIndex).toBe(0);
  });

  test('custom source + title', () => {
    const state = playground.initialState!({
      source: 'id: x\ntitle: X\nlayout: []\n',
      title: 'custom',
      previewTheme: 'rose-pine-dawn',
    });
    expect(state.title).toBe('custom');
    expect(state.source).toContain('id: x');
    expect(state.previewThemeName).toBe('rose-pine-dawn');
  });

  test('initialPreset seeds the editor from the lab preset rack', () => {
    const state = playground.initialState!({
      initialPreset: 'approval-dialog',
      previewTheme: 'catppuccin-mocha',
    });
    expect(state.source).toContain('widget: dialog');
    expect(state.source).toContain('Approve patch?');
    expect(state.presetName).toBe('approval-dialog');
  });

  test('initialPreset can seed the editor as a compact preset reference', () => {
    const state = playground.initialState!({
      initialPreset: 'approval-dialog',
      presetSourceMode: 'reference',
    });
    expect(state.source).toContain('preset: approval-dialog');
    expect(state.presetSourceMode).toBe('reference');
  });

  test('empty source · current is null · no panic', () => {
    const state = playground.initialState!({ source: '' });
    expect(state.source).toBe('');
    expect(state.current).toBeNull();
  });

  test('filePath loads the bound source from disk when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-playground-'));
    const file = join(dir, 'lab.yaml');
    try {
      writeFileSync(file, 'preset: approval-dialog\n', 'utf8');
      const state = playground.initialState!({ filePath: file });
      expect(state.source).toContain('preset: approval-dialog');
      expect(state.boundFilePath).toBe(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('playground · render dimensions', () => {
  test('render returns exactly ctx.height rows', () => {
    const state = playground.initialState!();
    const rows = playground.render(state, { width: 60, height: 20, focused: true } as never, 'PG');
    expect(rows).toHaveLength(20);
  });

  test('each row fits within width bounds', () => {
    const state = playground.initialState!();
    const rows = playground.render(state, { width: 40, height: 12, focused: true } as never, 'PG');
    for (const r of rows) {
      // strip ANSI for width check
      const stripped = r.replace(/\u001b\[[^m]*m/g, '');
      expect(stripped.length).toBeLessThanOrEqual(40);
    }
  });

  test('preview renders declarative chrome card for selected widget', () => {
    const state = playground.initialState!();
    const rows = playground.render(state, { width: 60, height: 20, focused: true } as never, 'PG');
    const plain = rows.map(r => r.replace(/\u001b\[[^m]*m/g, '')).join('\n');
    expect(plain).toContain('Telemetry');
    expect(plain).toContain('Ctrl+P preview');
    expect(plain).toContain('chrome:window');
    expect(plain).toContain('materialized:');
  });

  test('render header includes preview theme name', () => {
    const state = playground.initialState!({ previewTheme: 'rose-pine-dawn' });
    const rows = playground.render(state, { width: 60, height: 20, focused: true } as never, 'PG');
    const plain = rows[0]!.replace(/\u001b\[[^m]*m/g, '');
    expect(plain).toContain('rose-pine-dawn');
  });

  test('render header includes preset title when active', () => {
    const state = playground.initialState!({ initialPreset: 'telemetry-stack' });
    const rows = playground.render(state, { width: 80, height: 20, focused: true } as never, 'PG');
    const plain = rows[0]!.replace(/\u001b\[[^m]*m/g, '');
    expect(plain).toContain('Telemetry Stack');
    expect(plain).toContain('expanded');
  });

  test('render starts declarative preview motion tween when spec declares motion', () => {
    const state = playground.initialState!();
    const m = mkCtx(state);
    playground.render(state, { width: 60, height: 20, focused: true, animate: m.ctx.animate, theme: undefined } as never, 'PG');
    expect(m.tweens.length).toBeGreaterThan(0);
    expect(m.tweens[0]?.key).toContain('playground.preview.');
  });
});

describe('playground · onKey · cursor navigation', () => {
  test('arrow right advances cursor', () => {
    const state = playground.initialState!({ source: 'abc' });
    const m = mkCtx(state);
    playground.onKey!(mkKey('right'), state, m.ctx);
    expect(m.setStateCalls[0]).toEqual({ cursor: 1, editorScrollTop: 0 });
  });

  test('arrow left at cursor=0 clamps to 0', () => {
    const state = { ...playground.initialState!({ source: 'abc' }), cursor: 0 };
    const m = mkCtx(state);
    playground.onKey!(mkKey('left'), state, m.ctx);
    expect(m.setStateCalls[0]).toEqual({ cursor: 0, editorScrollTop: 0 });
  });

  test('home + end jump to line bounds', () => {
    const state = { ...playground.initialState!({ source: 'abc\ndefgh' }), cursor: 6 };  // mid 2nd line
    const m = mkCtx(state);
    playground.onKey!(mkKey('home'), state, m.ctx);
    // line 1 start = 4 (after 'abc\n')
    expect(m.setStateCalls[0]).toEqual({ cursor: 4, editorScrollTop: 0 });
  });
});

describe('playground · onKey · editing', () => {
  test('printable char inserts at cursor + re-materializes', () => {
    const state = { ...playground.initialState!({ source: '' }), cursor: 0 };
    const m = mkCtx(state);
    playground.onKey!(mkKey('a', { sequence: 'a' }), state, m.ctx);
    const patch = m.setStateCalls[0]!;
    expect(patch.source).toBe('a');
    expect(patch.cursor).toBe(1);
    expect(patch.current).toBeDefined();
    expect(patch.presetName).toBeUndefined();
  });

  test('backspace deletes char before cursor', () => {
    const state = { ...playground.initialState!({ source: 'abc' }), cursor: 3 };
    const m = mkCtx(state);
    playground.onKey!(mkKey('backspace'), state, m.ctx);
    expect(m.setStateCalls[0]?.source).toBe('ab');
    expect(m.setStateCalls[0]?.cursor).toBe(2);
  });

  test('enter inserts newline', () => {
    const state = { ...playground.initialState!({ source: 'abc' }), cursor: 3 };
    const m = mkCtx(state);
    playground.onKey!(mkKey('return'), state, m.ctx);
    expect(m.setStateCalls[0]?.source).toBe('abc\n');
    expect(m.setStateCalls[0]?.cursor).toBe(4);
  });
});

describe('playground · onKey · mode toggle', () => {
  test('Ctrl+P toggles edit ↔ preview', () => {
    const state = playground.initialState!();
    const m = mkCtx(state);
    playground.onKey!(mkKey('p', { ctrl: true }), state, m.ctx);
    expect(m.setStateCalls[0]).toEqual({ mode: 'preview' });
  });

  test('preview mode arrow keys cycle the selected widget', () => {
    const state = {
      ...playground.initialState!({ initialPreset: 'telemetry-stack' }),
      mode: 'preview' as const,
      previewIndex: 0,
    };
    const m = mkCtx(state);
    const action = playground.onKey!(mkKey('down'), state, m.ctx);
    expect(action).toEqual({ type: 'refresh' });
    expect(m.setStateCalls[0]).toEqual({ previewIndex: 1 });
  });

  test('Ctrl+T cycles preview theme', () => {
    const state = playground.initialState!({ previewTheme: 'catppuccin-mocha' });
    const m = mkCtx(state);
    playground.onKey!(mkKey('t', { ctrl: true }), state, m.ctx);
    expect(m.setStateCalls[0]?.previewThemeName).not.toBe('catppuccin-mocha');
  });

  test('Ctrl+Y cycles the active lab preset and replaces source', () => {
    const state = playground.initialState!({ initialPreset: 'telemetry-stack' });
    const m = mkCtx(state);
    playground.onKey!(mkKey('y', { ctrl: true }), state, m.ctx);
    expect(m.setStateCalls[0]?.presetName).not.toBe('telemetry-stack');
    expect(m.setStateCalls[0]?.source).toContain('widget:');
  });

  test('Ctrl+Y preserves compact preset-reference mode', () => {
    const state = playground.initialState!({
      initialPreset: 'telemetry-stack',
      presetSourceMode: 'reference',
    });
    const m = mkCtx(state);
    playground.onKey!(mkKey('y', { ctrl: true }), state, m.ctx);
    expect(m.setStateCalls[0]?.source).toContain('preset:');
    expect(m.setStateCalls[0]?.presetSourceMode).toBe('reference');
  });

  test('Ctrl+R toggles preset source mode and reloads the active preset', () => {
    const state = playground.initialState!({ initialPreset: 'approval-dialog' });
    const m = mkCtx(state);
    playground.onKey!(mkKey('r', { ctrl: true }), state, m.ctx);
    expect(m.setStateCalls[0]?.presetSourceMode).toBe('reference');
    expect(m.setStateCalls[0]?.source).toContain('preset: approval-dialog');
  });

  test('Ctrl+R toggles source mode even when no preset is active', () => {
    const state = playground.initialState!();
    const m = mkCtx(state);
    playground.onKey!(mkKey('r', { ctrl: true }), state, m.ctx);
    expect(m.setStateCalls[0]).toEqual({ presetSourceMode: 'reference' });
  });

  test('Ctrl+S writes the current source to the bound file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-playground-'));
    const file = join(dir, 'lab.yaml');
    try {
      const state = playground.initialState!({ source: 'preset: approval-dialog\n', filePath: file });
      const m = mkCtx(state);
      const action = playground.onKey!(mkKey('s', { ctrl: true }), state, m.ctx);
      expect(action).toEqual({ type: 'refresh' });
      expect(readFileSync(file, 'utf8')).toBe('preset: approval-dialog\n');
      expect(m.setStateCalls[0]?.statusNote).toContain('saved:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Ctrl+L reloads the bound file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monad-playground-'));
    const file = join(dir, 'lab.yaml');
    try {
      writeFileSync(file, 'preset: approval-dialog\n', 'utf8');
      const state = playground.initialState!({ source: 'preset: telemetry-stack\n', filePath: file });
      const m = mkCtx(state);
      const action = playground.onKey!(mkKey('l', { ctrl: true }), state, m.ctx);
      expect(action).toEqual({ type: 'refresh' });
      expect(m.setStateCalls[0]?.source).toContain('preset: approval-dialog');
      expect(m.setStateCalls[0]?.statusNote).toContain('loaded:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('preview mode swallows editor keys (no state mutation)', () => {
    const state = { ...playground.initialState!(), mode: 'preview' as const };
    const m = mkCtx(state);
    const action = playground.onKey!(mkKey('a', { sequence: 'a' }), state, m.ctx);
    expect(action).toEqual({ type: 'none' });
    expect(m.setStateCalls).toHaveLength(0);
  });
});

describe('playground · onKey · escape dismisses', () => {
  test('escape calls ctx.dismiss', () => {
    const state = playground.initialState!();
    const m = mkCtx(state);
    playground.onKey!(mkKey('escape'), state, m.ctx);
    expect(m.dismissed).toBe(true);
  });
});

describe('playground · decode integration', () => {
  test('valid YAML → current.ok === true · lastValid tracks it', () => {
    const state = playground.initialState!({
      source: 'id: ok\ntitle: OK\nlayout:\n  - widget: log\n    config: { lines: [] }\n',
    });
    expect(state.current?.ok).toBe(true);
    expect(state.lastValid).toBe(state.current);
  });

  test('malformed YAML → current has errors · current.ok === false', () => {
    const state = playground.initialState!({ source: 'id: [broken\n' });
    expect(state.current?.ok).toBe(false);
    expect(state.current?.errors.length).toBeGreaterThan(0);
  });
});

describe('playground · describeSurface', () => {
  test('surface summary reflects line count + widget count + error count', () => {
    const state = playground.initialState!({
      source: 'id: x\ntitle: X\nlayout:\n  - widget: log\n',
    });
    const desc = playground.describeSurface!(state, { character: 'PG' } as never);
    expect(desc).toContain('lines');
    expect(desc).toContain('widgets');
    expect(desc).toContain('errors');
  });
});

describe('playground · configSchema', () => {
  test('schema declares source + title fields', () => {
    const s = playground.configSchema!() as { properties: Record<string, unknown> };
    expect(s.properties.source).toBeDefined();
    expect(s.properties.title).toBeDefined();
    expect(s.properties.previewTheme).toBeDefined();
    expect(s.properties.initialPreset).toBeDefined();
    expect(s.properties.presetSourceMode).toBeDefined();
    expect(s.properties.filePath).toBeDefined();
  });
});

describe('playground · onMouse', () => {
  test('editor click moves cursor and keeps edit mode', () => {
    const state = {
      ...playground.initialState!({ source: 'alpha\nbeta\ngamma' }),
      mode: 'preview' as const,
    };
    const m = mkCtx(state);
    const action = playground.onMouse!(
      { type: 'click', row: 2, col: 7 } as never,
      state,
      { ...m.ctx, height: 12, width: 40 } as never,
    );

    expect(action).toEqual({ type: 'refresh' });
    expect(m.setStateCalls[0]).toEqual({ mode: 'edit', cursor: 8 });
  });

  test('preview click switches to preview mode', () => {
    const state = playground.initialState!();
    const m = mkCtx(state);
    const action = playground.onMouse!(
      { type: 'click', row: 6, col: 4 } as never,
      state,
      { ...m.ctx, height: 12, width: 50 } as never,
    );

    expect(action).toEqual({ type: 'refresh' });
    expect(m.setStateCalls[0]).toEqual({ mode: 'preview', previewIndex: 0 });
  });

  test('preview click on secondary row selects another widget in the preset', () => {
    const state = playground.initialState!({ initialPreset: 'telemetry-stack' });
    const m = mkCtx(state);
    const action = playground.onMouse!(
      { type: 'click', row: 16, col: 4 } as never,
      state,
      { ...m.ctx, height: 20, width: 60 } as never,
    );

    expect(action).toEqual({ type: 'refresh' });
    expect(m.setStateCalls[0]).toEqual({ mode: 'preview', previewIndex: 1 });
  });

  test('scroll wheel moves cursor by line and updates editor scroll', () => {
    const state = {
      ...playground.initialState!({ source: 'a\nb\nc\nd\ne\nf\ng' }),
      cursor: 0,
      editorScrollTop: 0,
    };
    const m = mkCtx(state);
    const action = playground.onMouse!(
      { type: 'scroll-down', row: 2, col: 0 } as never,
      state,
      { ...m.ctx, height: 10, width: 40 } as never,
    );

    expect(action).toEqual({ type: 'refresh' });
    expect(m.setStateCalls[0]).toEqual({ cursor: 2, editorScrollTop: 0 });
  });

  test('click on padded empty editor row is ignored', () => {
    const state = playground.initialState!({ source: 'one' });
    const m = mkCtx(state);
    const action = playground.onMouse!(
      { type: 'click', row: 4, col: 5 } as never,
      state,
      { ...m.ctx, height: 12, width: 40 } as never,
    );

    expect(action).toEqual({ type: 'none' });
    expect(m.setStateCalls).toHaveLength(0);
  });
});
