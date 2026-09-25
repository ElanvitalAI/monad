// ── VW-term-infra Bundle B-9-α — InspectPane shim tests ──
//
// `dispatchInspectPane` is now a thin projection over
// `dispatchDescribeSurface({addr:{kind:'pane',ref}})`. These tests
// verify: (1) shim carries chords/tools through unchanged, (2) a wired
// PaneVisualStateStore surfaces as the additive `visualState` field,
// (3) unknown pane → found:false path is preserved, (4) runnerLabel
// survives the round-trip.

import { afterEach, describe, expect, test } from 'bun:test';

import { dispatchInspectPane } from '../src/capture/capture-tools.js';
import { __setDefaultPaneFactory, PaneFactory } from '../src/panes/index.js';
import {
  createVisualStateStore,
  DEFAULT_VISUAL_STATE,
  PANE_FOCUS_POLICY,
} from '../src/panes/visual-state.js';
import type { Pane, PaneDescription, PaneRef } from '../src/panes/types.js';

const REF: PaneRef = { windowId: 'w:b9a', paneId: 'p:b9a' };
const REF_RL: PaneRef = { windowId: 'w:b9a', paneId: 'p:b9a', runnerLabel: 'rl' };

function makeFakePane(
  ref: PaneRef = REF,
  descOverrides: Partial<PaneDescription> = {},
): Pane {
  const desc: PaneDescription = {
    ref,
    kind: { kind: 'terminal', terminalId: 'term:fake' },
    title: 'fake-term',
    summary: 'fake terminal pane',
    supportedTaps: ['raw', 'frame'],
    chords: [],
    tools: [],
    ...descOverrides,
  };
  return {
    ref,
    kind: desc.kind,
    render: () => [],
    onKey: () => 'passthrough',
    onMouse: () => 'passthrough',
    describe: () => desc,
    snapshot: async () => ({
      ref,
      kind: desc.kind,
      capturedAt: 0,
      dims: { row: 0, col: 0, width: 80, height: 24 },
      ansi: '',
      meta: {},
    }),
    addTap: () => () => {},
    mount: () => {},
    unmount: () => {},
  };
}

function installFakeFactory(pane: Pane | null): void {
  const factory = new PaneFactory();
  (factory as unknown as { peek: () => Pane | undefined }).peek = () =>
    pane ?? undefined;
  __setDefaultPaneFactory(factory);
}

afterEach(() => {
  __setDefaultPaneFactory(null);
});

describe('B-9-α · InspectPane shim over DescribeSurface', () => {
  test('delegates chords + tools arrays without losing structure', () => {
    installFakeFactory(makeFakePane(REF, {
      chords: [
        { chord: '^B d', label: 'describe', mirrorTool: 'DescribePane' },
        { chord: '^B p', label: 'policy' }, // mirrorTool omitted
      ],
      tools: [
        { tool: 'DescribePane', label: 'describe', mirrorChord: '^B d' },
        { tool: 'SetFocusPolicy', label: 'policy' }, // mirrorChord omitted
      ],
    }));
    const out = dispatchInspectPane({ windowId: REF.windowId, paneId: REF.paneId });
    expect(out.found).toBe(true);
    expect(out.kind).toBe('terminal');
    expect(out.chords).toEqual([
      { chord: '^B d', label: 'describe', mirrorTool: 'DescribePane' },
      { chord: '^B p', label: 'policy' },
    ]);
    expect(out.tools).toEqual([
      { tool: 'DescribePane', label: 'describe', mirrorChord: '^B d' },
      { tool: 'SetFocusPolicy', label: 'policy' },
    ]);
    // No store wired · shim preserves the pre-B-9 shape.
    expect(out.visualState).toBeUndefined();
  });

  test('store deps → InspectPane carries default visualState', () => {
    installFakeFactory(makeFakePane());
    const store = createVisualStateStore();
    const out = dispatchInspectPane(
      { windowId: REF.windowId, paneId: REF.paneId },
      { store },
    );
    expect(out.visualState).toEqual(DEFAULT_VISUAL_STATE);
  });

  test('store.setState(focusPolicy=skip) propagates to InspectPane', () => {
    installFakeFactory(makeFakePane());
    const store = createVisualStateStore();
    store.setState(REF, { focusPolicy: PANE_FOCUS_POLICY.skip });
    const out = dispatchInspectPane(
      { windowId: REF.windowId, paneId: REF.paneId },
      { store },
    );
    expect(out.visualState?.focusPolicy).toBe('skip');
  });

  test('unknown pane → found:false · note preserved', () => {
    installFakeFactory(null);
    const out = dispatchInspectPane({ windowId: 'w:ghost', paneId: 'p:ghost' });
    expect(out.found).toBe(false);
    // Shim preserves the pre-B-9 note format (not DescribeSurface's).
    expect(out.note).toBe('pane not found: w:ghost::p:ghost');
  });

  test('runnerLabel survives round-trip', () => {
    installFakeFactory(makeFakePane(REF_RL));
    const out = dispatchInspectPane({
      windowId: REF_RL.windowId,
      paneId: REF_RL.paneId,
      runnerLabel: 'rl',
    });
    expect(out.found).toBe(true);
    expect(out.ref?.runnerLabel).toBe('rl');
  });
});
