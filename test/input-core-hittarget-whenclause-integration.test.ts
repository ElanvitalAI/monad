// ── A-7a · HitTarget when-clause integration tests ──
//
// End-to-end proof that declarative mouse bindings match on
// `hitTargetKind` / `hitTargetPaneId` / `hitTargetWidgetInstanceId`
// after `publishMouseTargetToContextKeys` runs. This is the concrete
// value of A-7a — a user-config can now express:
//
//   { "key": "click",
//     "when": "hitTargetKind == 'pane-body' && viewModeKind == 'idle'",
//     "command": "pane.focus" }
//
// Without A-7a: resolver could match the matcher cascade
// (click:pane-body.*) via toMatcher() but couldn't combine with other
// when-clause conditions. A-7a closes that gap.

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  resolveInputEvent,
  registerAction,
  setRuntimeBinding,
  publishMouseTargetToContextKeys,
  buildMouseInputEventFromDisplay,
  createContextKeyService,
  __resetActionRegistryForTests,
  __resetBindingsForTests,
  __resetContextForTests,
} from '../src/input-core/index.js';
import type { DisplayMouseEvent } from '../src/display/types.js';

beforeEach(() => {
  __resetActionRegistryForTests();
  __resetBindingsForTests();
  __resetContextForTests();
});

const dsp = (overrides: Partial<DisplayMouseEvent> = {}): DisplayMouseEvent => ({
  type: 'click',
  row: 5,
  col: 10,
  ...overrides,
});

// ── §1 single-condition when-clause matching ─────────────

describe('A-7a integration · single-condition when-clause', () => {
  test('click:pane-body matcher + hitTargetKind check → resolves', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined, "hitTargetKind == 'pane-body'");

    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    expect(r?.actionId).toBe('A');
  });

  test('click:pane-body with wrong hitTargetKind → skipped (when-clause false)', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined, "hitTargetKind == 'pane-body'");

    const cks = createContextKeyService();
    // Event has pane-title target · hitTargetKind would be 'pane-title'
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-title', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    // Matcher 'click:pane-body' doesn't match event's matcher
    // 'click:pane-title' either way — this test is a matcher miss.
    expect(r).toBeNull();
  });

  test('pane-body click on WRONG pane → matcher matches but when-clause fails', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    // Matcher accepts any pane-body · when-clause locks paneId.
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetPaneId == 'browser'");

    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log' }, // WRONG pane
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    expect(r).toBeNull();                                // when-clause rejects
  });

  test('pane-body click on RIGHT pane → matcher + when-clause both pass', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetPaneId == 'browser'");

    const cks = createContextKeyService();
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    expect(r?.actionId).toBe('A');
  });
});

// ── §2 compound when-clause (AND) ────────────────────────

describe('A-7a integration · compound AND when-clause', () => {
  test('hitTargetKind + viewModeKind AND → resolves when both match', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetKind == 'pane-body' && viewModeKind == 'idle'");

    const cks = createContextKeyService({ viewModeKind: 'idle' });
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    expect(r?.actionId).toBe('A');
  });

  test('AND · wrong viewMode → skipped even though hitTarget matches', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetKind == 'pane-body' && viewModeKind == 'idle'");

    const cks = createContextKeyService({ viewModeKind: 'streaming' });
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    expect(r).toBeNull();
  });

  test('3-way AND · kind + paneId + viewMode all pass', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetKind == 'pane-body' && hitTargetPaneId == 'browser' && viewModeKind == 'idle'");

    const cks = createContextKeyService({ viewModeKind: 'idle' });
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser', widgetInstanceId: 'wd-browser' },
    }));
    publishMouseTargetToContextKeys(ev, cks);

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    expect(r?.actionId).toBe('A');
  });
});

// ── §3 widget scoping via hitTargetWidgetInstanceId ──────

describe('A-7a integration · widget-scoped bindings', () => {
  test('binding scoped to wd-log widget · only fires for that widget', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetWidgetInstanceId == 'wd-log'");

    const cks = createContextKeyService();
    // Click on wd-log's pane-body
    const evLog = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log', widgetInstanceId: 'wd-log' },
    }));
    publishMouseTargetToContextKeys(evLog, cks);
    expect(resolveInputEvent(evLog, { getContextKeys: () => cks.keys })?.actionId).toBe('A');

    // Click on wd-browser's pane-body · binding should NOT fire
    const evBrowser = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser', widgetInstanceId: 'wd-browser' },
    }));
    publishMouseTargetToContextKeys(evBrowser, cks);
    expect(resolveInputEvent(evBrowser, { getContextKeys: () => cks.keys })).toBeNull();
  });
});

// ── §4 live refresh · consecutive events update match ────

describe('A-7a integration · consecutive-events refresh', () => {
  test('same binding fires for event1 (matching target) · skips for event2 (non-match)', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetPaneId == 'browser'");

    const cks = createContextKeyService();

    // Event 1: target browser · should fire.
    const e1 = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(e1, cks);
    expect(resolveInputEvent(e1, { getContextKeys: () => cks.keys })?.actionId).toBe('A');

    // Event 2: target log · should NOT fire (live key update).
    const e2 = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'log' },
    }));
    publishMouseTargetToContextKeys(e2, cks);
    expect(resolveInputEvent(e2, { getContextKeys: () => cks.keys })).toBeNull();

    // Event 3: back to browser · should fire again.
    const e3 = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    publishMouseTargetToContextKeys(e3, cks);
    expect(resolveInputEvent(e3, { getContextKeys: () => cks.keys })?.actionId).toBe('A');
  });
});

// ── §5 no-publish (legacy A-1 behavior) → when-clause skip ─

describe('A-7a integration · without publish (pre-A-7a simulation)', () => {
  test('if publisher is NOT called · hitTargetKind stays null · binding skips', () => {
    // Simulates the pre-A-7a state where the input-core handler
    // didn't publish context keys. With hitTargetKind == null, any
    // when-clause referring to it as a string evaluates false.
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined,
      "hitTargetKind == 'pane-body'");

    const cks = createContextKeyService();
    // Build the event but DO NOT publish.
    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    // Skip publishMouseTargetToContextKeys.

    const r = resolveInputEvent(ev, {
      getContextKeys: () => cks.keys,
    });
    // hitTargetKind is null · "hitTargetKind == 'pane-body'" is false.
    expect(r).toBeNull();
  });
});

// ── §6 fallback when getContextKeys is absent ────────────

describe('A-7a integration · fail-closed without context keys', () => {
  test('binding with when-clause + resolver with no getContextKeys → skipped (fail-closed)', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body'], undefined, "hitTargetKind == 'pane-body'");

    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));

    // No deps provided → resolver skips bindings with when-clauses.
    const r = resolveInputEvent(ev);
    expect(r).toBeNull();
  });

  test('binding WITHOUT when-clause still fires without getContextKeys (backward compat)', () => {
    registerAction({ id: 'A', description: 'test' }, async () => {});
    setRuntimeBinding('A', ['click:pane-body']);         // no when-clause

    const ev = buildMouseInputEventFromDisplay(dsp({
      hitTarget: { kind: 'pane-body', paneId: 'browser' },
    }));
    const r = resolveInputEvent(ev);
    expect(r?.actionId).toBe('A');
  });
});
