import { describe, expect, test } from 'bun:test';

import {
  browserWidgetInstanceIdForView,
  createPaneModalChord,
  PANE_MODAL_CHORD_TIMEOUT_MS,
  paneForShortcut,
  renderPaneModalHint,
  shortcutFor,
} from '../src/dashboard/modals/pane.js';
import type { PaneVisibility } from '../src/views/pane-policy.js';

describe('shortcut map', () => {
  test('common panes have stable one-char shortcuts', () => {
    expect(shortcutFor('browser')).toBe('b');
    expect(shortcutFor('preview')).toBe('p');
    expect(shortcutFor('log')).toBe('l');
    expect(shortcutFor('scratch')).toBe('c');
    expect(shortcutFor('obsidian')).toBe('o');
  });

  test('paneForShortcut resolves back', () => {
    expect(paneForShortcut('p', ['preview', 'log'])).toBe('preview');
    expect(paneForShortcut('z', ['preview'])).toBeNull();
  });
});

describe('renderPaneModalHint', () => {
  test('returns null on wide viewports', () => {
    const v: PaneVisibility = {
      view: 1, compactLevel: 'wide', primary: 'browser', visible: ['browser', 'preview'], omitted: [], modalDeferred: [],
    };
    expect(renderPaneModalHint(v, 100)).toBeNull();
  });

  test('returns null when nothing deferred', () => {
    const v: PaneVisibility = {
      view: 1, compactLevel: 'tabletMini', primary: 'browser', visible: ['browser'], omitted: [], modalDeferred: [],
    };
    expect(renderPaneModalHint(v, 40)).toBeNull();
  });

  test('renders comma-separated shortcuts for tabletMini', () => {
    const v: PaneVisibility = {
      view: 1, compactLevel: 'tabletMini', primary: 'browser',
      visible: ['browser'], omitted: [],
      modalDeferred: ['preview', 'log', 'scratch'],
    };
    const hint = renderPaneModalHint(v, 80);
    expect(hint).not.toBeNull();
    expect(hint).toContain('Ctrl+M');
    expect(hint).toContain('p=preview');
    expect(hint).toContain('l=log');
    expect(hint).toContain('c=scratch');
  });

  test('truncates on very narrow terminal', () => {
    const v: PaneVisibility = {
      view: 1, compactLevel: 'tabletMini', primary: 'browser',
      visible: ['browser'], omitted: [],
      modalDeferred: ['preview', 'log', 'scratch', 'obsidian', 'agent-roster', 'debug-events'],
    };
    const hint = renderPaneModalHint(v, 30);
    expect(hint).not.toBeNull();
    expect(hint).toContain('…');
  });

  test('T-3 · appends B=browser+preview when both panes are deferred', () => {
    const v: PaneVisibility = {
      view: 1, compactLevel: 'tabletMini', primary: 'log',
      visible: ['log'], omitted: [],
      modalDeferred: ['browser', 'preview', 'scratch'],
    };
    const hint = renderPaneModalHint(v, 120);
    expect(hint).toContain('b=browser');
    expect(hint).toContain('p=preview');
    expect(hint).toContain('B=browser+preview');
  });

  test('T-3 · skips B= suffix when only one of browser/preview is deferred', () => {
    const v: PaneVisibility = {
      view: 1, compactLevel: 'tabletMini', primary: 'log',
      visible: ['log', 'preview'], omitted: [],
      modalDeferred: ['browser', 'scratch'],
    };
    const hint = renderPaneModalHint(v, 120);
    expect(hint).toContain('b=browser');
    expect(hint).not.toContain('B=browser+preview');
  });

  test('T-3 · tabletModeActive=true overrides wide-viewport null', () => {
    // Manual `/tablet on` on a wide terminal — the hint should still
    // render so the user finds the Ctrl+M shortcut set.
    const v: PaneVisibility = {
      view: 1, compactLevel: 'wide', primary: 'log',
      visible: ['log'], omitted: [],
      modalDeferred: ['browser', 'preview', 'scratch'],
    };
    expect(renderPaneModalHint(v, 140, false)).toBeNull();
    const hint = renderPaneModalHint(v, 140, true);
    expect(hint).not.toBeNull();
    expect(hint).toContain('B=browser+preview');
  });
});

describe('browserWidgetInstanceIdForView', () => {
  test('uses the working browser surface on view 3', () => {
    expect(browserWidgetInstanceIdForView(3)).toBe('wd-working-browser');
  });

  test('uses the canonical browser surface on other views', () => {
    expect(browserWidgetInstanceIdForView(1)).toBe('wd-browser');
    expect(browserWidgetInstanceIdForView(2)).toBe('wd-browser');
    expect(browserWidgetInstanceIdForView(4)).toBe('wd-browser');
  });
});

describe('pane modal chord', () => {
  test('bare key → passthrough', () => {
    const chord = createPaneModalChord();
    expect(chord.handleKey({ name: 'a' }, { deferred: ['preview'], openPane: () => {} })).toBe('passthrough');
  });

  test('Ctrl+M arms', () => {
    const chord = createPaneModalChord();
    expect(chord.handleKey({ name: 'm', ctrl: true }, { deferred: ['preview'], openPane: () => {} })).toBe('armed');
    expect(chord.state.armed).toBe(true);
  });

  test('Ctrl+M then matching shortcut → consumed + openPane called', () => {
    const chord = createPaneModalChord();
    let opened = '';
    chord.handleKey({ name: 'm', ctrl: true }, { deferred: ['preview', 'log'], openPane: () => {} });
    const r = chord.handleKey({ name: 'p' }, { deferred: ['preview', 'log'], openPane: (p) => { opened = p; } });
    expect(r).toBe('consumed');
    expect(opened).toBe('preview');
    expect(chord.state.armed).toBe(false);
  });

  test('Ctrl+M then unknown → cancelled', () => {
    const chord = createPaneModalChord();
    chord.handleKey({ name: 'm', ctrl: true }, { deferred: ['preview'], openPane: () => {} });
    const r = chord.handleKey({ name: 'z' }, { deferred: ['preview'], openPane: () => {} });
    expect(r).toBe('cancelled');
    expect(chord.state.armed).toBe(false);
  });

  test('chord timeout disarms', () => {
    let time = 1000;
    const chord = createPaneModalChord(() => time);
    chord.handleKey({ name: 'm', ctrl: true }, { deferred: ['preview'], openPane: () => {} });
    time += PANE_MODAL_CHORD_TIMEOUT_MS + 100;
    expect(chord.handleKey({ name: 'p' }, { deferred: ['preview'], openPane: () => {} })).toBe('passthrough');
  });

  test('Korean ㅡ jamo also arms', () => {
    const chord = createPaneModalChord();
    expect(chord.handleKey({ name: 'ㅡ', ctrl: true }, { deferred: ['preview'], openPane: () => {} })).toBe('armed');
  });
});
