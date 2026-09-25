import { describe, expect, test } from 'bun:test';
import { hitTestAllSurfaces, type HitTestDeps } from '../src/input-core/hit-test.js';
import type { HitTarget } from '../src/input-core/event.js';

const pill = (name: string): HitTarget => ({ kind: 'pill', name });
const paneNav = (paneId: string): HitTarget => ({ kind: 'pane-nav-tab', paneId });
const paneBody = (paneId: string): HitTarget => ({ kind: 'pane-body', paneId });
const statusBar = (): HitTarget => ({ kind: 'status-bar' });
const unknown = (): HitTarget => ({ kind: 'unknown' });

function mkDeps(overrides: Partial<HitTestDeps> = {}): HitTestDeps {
  return {
    tryPill: () => null,
    tryPaneNavTab: () => null,
    tryPaneCell: () => null,
    tryLogZone: () => null,
    tryStatusBar: () => null,
    ...overrides,
  };
}

describe('hitTestAllSurfaces — single-layer hits', () => {
  test('pill match — returns pill target', () => {
    const hit = hitTestAllSurfaces(1, 5, mkDeps({
      tryPill: () => pill('model'),
    }));
    expect(hit).toEqual({ kind: 'pill', name: 'model' });
  });

  test('pane-nav match — returns pane-nav-tab target', () => {
    const hit = hitTestAllSurfaces(2, 10, mkDeps({
      tryPaneNavTab: () => paneNav('tasks'),
    }));
    expect(hit).toEqual({ kind: 'pane-nav-tab', paneId: 'tasks' });
  });

  test('pane-cell match — returns pane-body target', () => {
    const hit = hitTestAllSurfaces(10, 20, mkDeps({
      tryPaneCell: () => paneBody('browser'),
    }));
    expect(hit).toEqual({ kind: 'pane-body', paneId: 'browser' });
  });

  test('log-zone match — returns pane-body with log id', () => {
    const hit = hitTestAllSurfaces(25, 10, mkDeps({
      tryLogZone: () => paneBody('log'),
    }));
    expect(hit).toEqual({ kind: 'pane-body', paneId: 'log' });
  });

  test('status-bar match — returns status-bar target', () => {
    const hit = hitTestAllSurfaces(40, 1, mkDeps({
      tryStatusBar: () => statusBar(),
    }));
    expect(hit).toEqual({ kind: 'status-bar' });
  });
});

describe('hitTestAllSurfaces — priority ordering', () => {
  test('pill beats pane-nav when both match', () => {
    const hit = hitTestAllSurfaces(1, 5, mkDeps({
      tryPill: () => pill('model'),
      tryPaneNavTab: () => paneNav('tasks'),
    }));
    expect(hit?.kind).toBe('pill');
  });

  test('pane-nav beats pane-cell', () => {
    const hit = hitTestAllSurfaces(2, 5, mkDeps({
      tryPaneNavTab: () => paneNav('tasks'),
      tryPaneCell: () => paneBody('browser'),
    }));
    expect(hit?.kind).toBe('pane-nav-tab');
  });

  test('pane-cell beats log-zone', () => {
    const hit = hitTestAllSurfaces(10, 5, mkDeps({
      tryPaneCell: () => paneBody('browser'),
      tryLogZone: () => paneBody('log'),
    }));
    expect((hit as { paneId?: string }).paneId).toBe('browser');
  });

  test('log-zone beats status-bar', () => {
    const hit = hitTestAllSurfaces(20, 5, mkDeps({
      tryLogZone: () => paneBody('log'),
      tryStatusBar: () => statusBar(),
    }));
    expect(hit?.kind).toBe('pane-body');
  });

  test('full 5-layer stack — pill wins (highest priority)', () => {
    const hit = hitTestAllSurfaces(1, 1, mkDeps({
      tryPill: () => pill('topmost'),
      tryPaneNavTab: () => paneNav('a'),
      tryPaneCell: () => paneBody('b'),
      tryLogZone: () => paneBody('log'),
      tryStatusBar: () => statusBar(),
    }));
    expect(hit).toEqual({ kind: 'pill', name: 'topmost' });
  });
});

describe('hitTestAllSurfaces — null / unknown behavior', () => {
  test('all checks null → returns null', () => {
    const hit = hitTestAllSurfaces(10, 10, mkDeps());
    expect(hit).toBeNull();
  });

  test('empty deps (all callbacks undefined) → returns null', () => {
    const hit = hitTestAllSurfaces(5, 5, {});
    expect(hit).toBeNull();
  });

  test('partial deps — only some callbacks provided → walks provided ones only', () => {
    const hit = hitTestAllSurfaces(10, 10, {
      tryPaneCell: () => paneBody('only-this'),
    });
    expect(hit).toEqual({ kind: 'pane-body', paneId: 'only-this' });
  });

  test('unknown kind is skipped — walk continues to next surface', () => {
    const hit = hitTestAllSurfaces(10, 10, mkDeps({
      tryPill: () => unknown(),
      tryPaneCell: () => paneBody('actual-hit'),
    }));
    expect(hit).toEqual({ kind: 'pane-body', paneId: 'actual-hit' });
  });

  test('all unknowns → returns null (no concrete match)', () => {
    const hit = hitTestAllSurfaces(10, 10, mkDeps({
      tryPill: () => unknown(),
      tryPaneNavTab: () => unknown(),
      tryPaneCell: () => unknown(),
    }));
    expect(hit).toBeNull();
  });
});

describe('hitTestAllSurfaces — row/col passthrough', () => {
  test('coords are passed verbatim to each check', () => {
    const calls: Array<[string, number, number]> = [];
    hitTestAllSurfaces(7, 19, {
      tryPill:        (r, c) => { calls.push(['pill',     r, c]); return null; },
      tryPaneNavTab:  (r, c) => { calls.push(['pane-nav', r, c]); return null; },
      tryPaneCell:    (r, c) => { calls.push(['pane',     r, c]); return null; },
      tryLogZone:     (r, c) => { calls.push(['log',      r, c]); return null; },
      tryStatusBar:   (r, c) => { calls.push(['status',   r, c]); return null; },
    });
    expect(calls).toEqual([
      ['pill',     7, 19],
      ['pane-nav', 7, 19],
      ['pane',     7, 19],
      ['log',      7, 19],
      ['status',   7, 19],
    ]);
  });

  test('walk stops at first concrete hit — later checks NOT invoked', () => {
    let laterCalled = false;
    hitTestAllSurfaces(10, 10, {
      tryPaneCell: () => paneBody('stop-here'),
      tryLogZone: () => { laterCalled = true; return null; },
      tryStatusBar: () => { laterCalled = true; return null; },
    });
    expect(laterCalled).toBe(false);
  });
});
