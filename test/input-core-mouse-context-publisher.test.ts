// ── A-7a · publishMouseTargetToContextKeys unit tests ──
//
// Validates the pure projection from `MouseInputEvent.target` to
// three context keys — `hitTargetKind` / `hitTargetPaneId` /
// `hitTargetWidgetInstanceId` — with:
//
//   * all 8 HitTarget kinds mapped correctly (7 concrete + 'unknown')
//   * pane/widget fields reset to null between events of different kinds
//     (no stale leak)
//   * ContextKeyService's equality skip preserved (repeated same-target
//     events don't fire subscribers)
//   * isolated from the dashboard / resolver (publisher is a pure fn)

import { describe, expect, test } from 'bun:test';
import {
  publishMouseTargetToContextKeys,
  createContextKeyService,
  buildMouseInputEventFromDisplay,
  type ContextKeys,
  type ContextKeyName,
} from '../src/input-core/index.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

// ── Fixtures ──────────────────────────────────────────────

const dsp = (overrides: Partial<DisplayMouseEvent> = {}): DisplayMouseEvent => ({
  type: 'click',
  row: 5,
  col: 10,
  ...overrides,
});

// ── §1 8 HitTarget kinds mapped ──────────────────────────

describe('publishMouseTargetToContextKeys · all HitTarget kinds', () => {
  test('pill → hitTargetKind=pill · paneId/widgetId null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pill', name: 'model' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('pill');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('pane-nav-tab → kind=pane-nav-tab · paneId set · widgetId null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-nav-tab', paneId: 'scheduler' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('pane-nav-tab');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBe('scheduler');
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('pane-title with widgetInstanceId → all three set', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-title', paneId: 'browser', widgetInstanceId: 'wd-browser-1' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('pane-title');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBe('browser');
    expect(cks.keys.hitTargetWidgetInstanceId).toBe('wd-browser-1');
  });

  test('pane-title without widgetInstanceId → widgetId null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-title', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('pane-title');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBe('browser');
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('pane-body with widgetInstanceId → all three set', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log', widgetInstanceId: 'wd-log' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('pane-body');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBe('log');
    expect(cks.keys.hitTargetWidgetInstanceId).toBe('wd-log');
  });

  test('pane-body without widgetInstanceId → paneId only', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('pane-body');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBe('log');
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('status-bar → kind only', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'status-bar' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('status-bar');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('vw-pane-title → kind + paneId · widgetId null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'vw-pane-title', windowId: '3', paneId: 'editor' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('vw-pane-title');
    expect(cks.keys.hitTargetSurfaceKind).toBe('pane');
    expect(cks.keys.hitTargetPaneId).toBe('editor');
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('vw-pane-body → kind + paneId · widgetId null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'vw-pane-body', windowId: '3', paneId: 'editor' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('vw-pane-body');
    expect(cks.keys.hitTargetSurfaceKind).toBe('pane');
    expect(cks.keys.hitTargetPaneId).toBe('editor');
  });

  test('unknown (no hitTarget on display event) → kind=unknown · rest null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp());   // no hitTarget
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('unknown');
    expect(cks.keys.hitTargetSurfaceKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
    expect(cks.keys.hitTargetInputId).toBeNull();
  });

  test('input (chat-main) → kind=input · inputId=chat-main · pane/widget null', () => {
    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'input', inputId: 'chat-main' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(cks.keys.hitTargetKind).toBe('input');
    expect(cks.keys.hitTargetSurfaceKind).toBe('input');
    expect(cks.keys.hitTargetInputId).toBe('chat-main');
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
  });

  test('input (custom inputId) round-trips verbatim', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'input', inputId: 'search-bar' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetInputId).toBe('search-bar');
    expect(cks.keys.hitTargetSurfaceKind).toBe('input');
  });
});

// ── §2 stale leak prevention across different kinds ────

describe('publishMouseTargetToContextKeys · no stale leak', () => {
  test('pane-body(widget) → pill: widgetId resets to null', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pane-body', paneId: 'log', widgetInstanceId: 'wd-log' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetWidgetInstanceId).toBe('wd-log');

    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pill', name: 'model' },
      })),
      cks,
    );
    // widgetId resets · no stale leak from prior event
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetKind).toBe('pill');
  });

  test('input(chat-main) → pill: inputId resets to null', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'input', inputId: 'chat-main' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetInputId).toBe('chat-main');

    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pill', name: 'model' },
      })),
      cks,
    );
    // inputId resets · no stale leak when pointer leaves the input.
    expect(cks.keys.hitTargetInputId).toBeNull();
    expect(cks.keys.hitTargetKind).toBe('pill');
  });

  test('input(chat-main) → input(secondary): inputId flips cleanly', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'input', inputId: 'chat-main' },
      })),
      cks,
    );
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'input', inputId: 'secondary-input' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetKind).toBe('input');
    expect(cks.keys.hitTargetInputId).toBe('secondary-input');
  });

  test('pane-nav-tab → unknown: paneId resets', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pane-nav-tab', paneId: 'tasks' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetPaneId).toBe('tasks');

    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp()),           // unknown
      cks,
    );
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetKind).toBe('unknown');
  });

  test('pane-title(widget) → pane-body(widget) on DIFFERENT pane: paneId + widgetId update cleanly', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pane-title', paneId: 'browser', widgetInstanceId: 'wd-browser' },
      })),
      cks,
    );
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pane-body', paneId: 'log', widgetInstanceId: 'wd-log' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetKind).toBe('pane-body');
    expect(cks.keys.hitTargetPaneId).toBe('log');
    expect(cks.keys.hitTargetWidgetInstanceId).toBe('wd-log');
  });
});

// ── §3 equality skip · subscribers don't storm ─────────

describe('publishMouseTargetToContextKeys · subscriber equality skip', () => {
  test('two consecutive same-target events → 1 prime fire + 0 additional', () => {
    const cks = createContextKeyService();
    let fireCount = 0;
    const seen: Array<readonly ContextKeyName[]> = [];
    cks.subscribe((_keys, changed) => {
      fireCount++;
      seen.push(changed);
    });
    // Initial subscribe fires once (prime).
    expect(fireCount).toBe(1);
    expect(seen[0]).toEqual([]);

    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log', widgetInstanceId: 'wd-log' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    // First publish: 3 keys change from null → values · 1 fire.
    // (hitTargetInputId stays null since target is not an input kind.)
    expect(fireCount).toBe(2);
    expect(seen[1]!.sort()).toEqual(
      ['hitTargetKind', 'hitTargetPaneId', 'hitTargetWidgetInstanceId']
        .sort() as ContextKeyName[],
    );

    // Second publish with IDENTICAL target · 0 fire (equality skip).
    publishMouseTargetToContextKeys(ev, cks);
    expect(fireCount).toBe(2);                          // still 2
  });

  test('input → same input: subscriber fires once then equality-skips', () => {
    const cks = createContextKeyService();
    let fireCount = 0;
    cks.subscribe(() => { fireCount++; });
    expect(fireCount).toBe(1);   // prime

    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'input', inputId: 'chat-main' },
    }));
    publishMouseTargetToContextKeys(ev, cks);
    expect(fireCount).toBe(2);   // kind + surfaceKind + inputId changed

    publishMouseTargetToContextKeys(ev, cks);
    expect(fireCount).toBe(2);   // identical target · equality skip
  });

  test('different paneId event fires only the changed key', () => {
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pane-body', paneId: 'log', widgetInstanceId: 'wd-log' },
      })),
      cks,
    );
    const changes: Array<readonly ContextKeyName[]> = [];
    cks.subscribe((_keys, changed) => { if (changed.length > 0) changes.push(changed); });

    // Same kind + widget, different pane.
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pane-body', paneId: 'browser', widgetInstanceId: 'wd-log' },
      })),
      cks,
    );
    expect(changes).toEqual([['hitTargetPaneId']]);
  });
});

// ── §4 null-to-value transition on first event ─────────

describe('publishMouseTargetToContextKeys · initial state transitions', () => {
  test('initial null → first event populates kind', () => {
    const cks = createContextKeyService();
    expect(cks.keys.hitTargetKind).toBeNull();
    expect(cks.keys.hitTargetPaneId).toBeNull();
    expect(cks.keys.hitTargetWidgetInstanceId).toBeNull();

    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp({
        hitTarget: { kind: 'pill', name: 'wd' },
      })),
      cks,
    );
    expect(cks.keys.hitTargetKind).toBe('pill');
  });
});

// ── §5 when-clause compatibility pin ────────────────────

describe('publishMouseTargetToContextKeys · when-clause compatibility', () => {
  test('published key names match ContextKeys type exactly · no typos', () => {
    // Compile-time protection: the test would fail type-check if
    // publisher used a key name not in ContextKeys. This runtime
    // check belt-and-suspenders with the type system.
    const cks = createContextKeyService();
    publishMouseTargetToContextKeys(
      buildMouseInputEventFromDisplay(dsp()),
      cks,
    );
    const snapshot: Readonly<ContextKeys> = cks.keys;
    expect('hitTargetKind' in snapshot).toBe(true);
    expect('hitTargetSurfaceKind' in snapshot).toBe(true);
    expect('hitTargetPaneId' in snapshot).toBe(true);
    expect('hitTargetWidgetInstanceId' in snapshot).toBe(true);
    expect('hitTargetInputId' in snapshot).toBe(true);
  });
});
