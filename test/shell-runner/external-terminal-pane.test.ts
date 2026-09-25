import { describe, test, expect } from 'bun:test';

import { createExternalTerminalPaneContent } from '../../src/shell-runner/external-terminal-pane.js';
import { INTERRUPT_CHORDS } from '../../src/shell-runner/types.js';
import type { PreviewTerminal } from '../../src/preview/terminal.js';

function fakePreview(): PreviewTerminal & { writes: string[]; resizes: Array<[number, number]> } {
  const writes: string[] = [];
  const resizes: Array<[number, number]> = [];
  const mouse: Array<unknown> = [];
  let alive = true;
  return {
    get isAlive() { return alive; },
    start() { /* noop */ },
    stop() { alive = false; },
    write(b: string) { writes.push(b); },
    resize(c: number, r: number) { resizes.push([c, r]); },
    render() { return 'GRID\n'; },
    forwardMouse(ev: unknown) { mouse.push(ev); },
    get cols() { return 80; },
    get rows() { return 24; },
    get writes() { return writes; },
    get resizes() { return resizes; },
    get mouse() { return mouse; },
  } as any;
}

function keyEv(name: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}) {
  return {
    name,
    ctrl: mods.ctrl ?? false,
    meta: mods.meta ?? false,
    shift: mods.shift ?? false,
    raw: '',
    seq: '',
  } as any;
}

const renderCtx = (focused: boolean = false) => ({
  cols: 80, rows: 24, focused,
  theme: {}, draw: () => {},
} as any);

describe('ExternalTerminalPane', () => {
  test('render resizes + delegates to preview.render', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview });
    const out = pane.render(renderCtx(true));
    expect(out).toBe('GRID\n');
    expect(preview.resizes).toEqual([[80, 24]]);
  });

  test('output-only: regular key is swallowed', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview, focusPolicy: 'output-only' });
    const r = pane.onKey!(keyEv('a'));
    expect(r).toEqual({ type: 'none' });
    expect(preview.writes).toEqual([]);
  });

  test('output-only: Ctrl+C and Ctrl+D keys pass through', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview, focusPolicy: 'output-only' });
    pane.onKey!(keyEv('c', { ctrl: true }));
    pane.onKey!(keyEv('d', { ctrl: true }));
    expect(preview.writes).toContain(INTERRUPT_CHORDS.ctrlC);
    expect(preview.writes).toContain(INTERRUPT_CHORDS.ctrlD);
  });

  test('output-only: pane.write(Ctrl+\\\\) bytes pass through', () => {
    // Ctrl+\\ key mapping depends on keyEventToTerminalBytes'
    // translation of the modifier combination, which varies by
    // terminal. We assert the byte-level policy directly through
    // pane.write() instead.
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview, focusPolicy: 'output-only' });
    pane.write!(INTERRUPT_CHORDS.ctrlBackslash);
    expect(preview.writes).toContain(INTERRUPT_CHORDS.ctrlBackslash);
    // And arbitrary bytes via pane.write are still filtered.
    pane.write!('a');
    expect(preview.writes).not.toContain('a');
  });

  test('interactive: every key byte forwards', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview, focusPolicy: 'interactive' });
    pane.onKey!(keyEv('a'));
    pane.onKey!(keyEv('return'));
    expect(preview.writes.length).toBeGreaterThan(0);
  });

  test('setFocusPolicy flips behavior at runtime', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview, focusPolicy: 'output-only' }) as any;
    pane.onKey!(keyEv('a'));
    expect(preview.writes).toEqual([]);
    const prev = pane.setFocusPolicy('interactive');
    expect(prev).toBe('output-only');
    pane.onKey!(keyEv('a'));
    expect(preview.writes.length).toBeGreaterThan(0);
  });

  test('dispose does NOT stop the external preview', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview });
    pane.dispose!();
    expect(preview.isAlive).toBe(true);
  });

  test('stop is also a no-op (caller owns lifecycle)', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview });
    pane.stop?.();
    expect(preview.isAlive).toBe(true);
  });

  test('kind is "external-terminal"', () => {
    const pane = createExternalTerminalPaneContent({ preview: fakePreview() });
    expect(pane.kind).toBe('external-terminal');
  });

  test('isAlive mirrors preview', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview });
    expect(pane.isAlive).toBe(true);
    preview.stop();
    expect(pane.isAlive).toBe(false);
  });

  test('capture returns a snapshot via preview.render(false)', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview });
    expect(pane.capture!()).toBe('GRID\n');
  });

  test('click mouse event is always forwarded regardless of policy', () => {
    const preview = fakePreview();
    const pane = createExternalTerminalPaneContent({ preview, focusPolicy: 'output-only' });
    const r = pane.onMouse!({ type: 'click', row: 5, col: 10 } as any);
    expect(r).toEqual({ type: 'refresh' });
    expect((preview as any).mouse).toEqual([{ type: 'click', row: 5, col: 10 }]);
  });

  test('output-only mouse path keeps host-visible intent but limits child transport to discrete clicks', () => {
    const preview = fakePreview();
    const intents: Array<unknown> = [];
    const pane = createExternalTerminalPaneContent({
      preview,
      focusPolicy: 'output-only',
      onTerminalMouseIntent: (ev, meta) => intents.push({ type: ev.type, paneId: meta.paneId, paneKind: meta.paneKind }),
    });

    const drag = pane.onMouse!({ type: 'drag', row: 5, col: 10 } as any);
    const rightClick = pane.onMouse!({ type: 'right-click', row: 5, col: 10 } as any);

    expect(drag).toEqual({ type: 'none' });
    expect(rightClick).toEqual({ type: 'refresh' });
    expect((preview as any).mouse).toEqual([{ type: 'right-click', row: 5, col: 10 }]);
    expect(intents).toEqual([
      { type: 'drag', paneId: pane.id, paneKind: 'external-terminal' },
      { type: 'right-click', paneId: pane.id, paneKind: 'external-terminal' },
    ]);
  });

  test('interactive mouse path drops non-PTY synthetic events', () => {
    const preview = fakePreview();
    const intents: Array<unknown> = [];
    const pane = createExternalTerminalPaneContent({
      preview,
      focusPolicy: 'interactive',
      onTerminalMouseIntent: (ev, meta) => intents.push({ type: ev.type, paneId: meta.paneId, paneKind: meta.paneKind }),
    });

    const doubleClick = pane.onMouse!({ type: 'double-click', row: 5, col: 10 } as any);
    const motion = pane.onMouse!({ type: 'motion', row: 5, col: 10 } as any);

    expect(doubleClick).toEqual({ type: 'none' });
    expect(motion).toEqual({ type: 'none' });
    expect((preview as any).mouse).toEqual([]);
    expect(intents).toEqual([
      { type: 'double-click', paneId: pane.id, paneKind: 'external-terminal' },
      { type: 'motion', paneId: pane.id, paneKind: 'external-terminal' },
    ]);
  });

  test('dead preview disables host intent visibility and child transport', () => {
    const preview = fakePreview();
    const intents: Array<unknown> = [];
    const pane = createExternalTerminalPaneContent({
      preview,
      focusPolicy: 'interactive',
      onTerminalMouseIntent: (ev, meta) => intents.push({ type: ev.type, paneId: meta.paneId, paneKind: meta.paneKind }),
    });

    preview.stop();
    expect(pane.onKey!(keyEv('a'))).toEqual({ type: 'none' });
    expect(pane.onMouse!({ type: 'click', row: 1, col: 1 } as any)).toEqual({ type: 'none' });
    expect(preview.writes).toEqual([]);
    expect((preview as any).mouse).toEqual([]);
    expect(intents).toEqual([]);
  });
});
