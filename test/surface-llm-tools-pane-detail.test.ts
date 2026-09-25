// ── VW-term-infra Bundle B-8-β — DescribeSurface(pane) detail test ──
//
// Asserts the `detail` block of `DescribeSurface({addr:{kind:'pane'}})`
// reaches structural equivalence with `InspectPane(windowId,paneId)`:
//   * chords: ChordHint[] (same shape as InspectPane output)
//   * tools:  ToolHint[]  (same shape)
//   * visualState: PaneVisualState (4-tuple) when a store is wired
//
// Target: B-9 shim (InspectPane → DescribeSurface delegate). B-8-β is
// the shape prerequisite — this test is the contract.

import { afterEach, describe, expect, test } from 'bun:test';

import { dispatchDescribeSurface } from '../src/surface/llm-tools.js';
import { dispatchInspectPane } from '../src/capture/capture-tools.js';
import { __setDefaultPaneFactory, PaneFactory } from '../src/panes/index.js';
import {
  createVisualStateStore,
  DEFAULT_VISUAL_STATE,
  PANE_FOCUS_POLICY,
} from '../src/panes/visual-state.js';
import type { Pane, PaneDescription, PaneRef } from '../src/panes/types.js';

const REF: PaneRef = { windowId: 'w:b8b', paneId: 'p:b8b' };

function makeFakePane(descOverrides: Partial<PaneDescription> = {}): Pane {
  const desc: PaneDescription = {
    ref: REF,
    kind: { kind: 'terminal', terminalId: 'term:fake' },
    title: 'fake-term',
    summary: 'fake terminal pane',
    supportedTaps: ['raw', 'frame', 'event'],
    chords: [],
    tools: [],
    ...descOverrides,
  };
  return {
    ref: REF,
    kind: desc.kind,
    render: () => [],
    onKey: () => 'passthrough',
    onMouse: () => 'passthrough',
    describe: () => desc,
    snapshot: async () => ({
      ref: REF,
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

function installFakeFactory(pane: Pane): void {
  const factory = new PaneFactory();
  (factory as unknown as { peek: (ref: unknown) => Pane | undefined }).peek = () => pane;
  __setDefaultPaneFactory(factory);
}

afterEach(() => {
  __setDefaultPaneFactory(null);
});

describe('B-8-β · DescribeSurface(pane) detail', () => {
  test('surfaces full chords + tools arrays (structure-equivalent to InspectPane)', () => {
    installFakeFactory(makeFakePane({
      chords: [
        { chord: '^B d', label: 'describe pane', mirrorTool: 'DescribePane' },
        { chord: '^B p', label: 'set focus policy', mirrorTool: 'SetFocusPolicy' },
      ],
      tools: [
        { tool: 'DescribePane', label: 'describe pane', mirrorChord: '^B d' },
        { tool: 'SetFocusPolicy', label: 'set focus policy', mirrorChord: '^B p' },
      ],
    }));
    const out = dispatchDescribeSurface({ addr: { kind: 'pane', ref: REF } });
    expect(out.found).toBe(true);
    const detail = out.detail as {
      chords: { chord: string; label: string; mirrorTool?: string }[];
      tools: { tool: string; label: string; mirrorChord?: string }[];
      chordCount: number;
      toolCount: number;
      visualState?: unknown;
    };
    expect(detail.chords).toHaveLength(2);
    expect(detail.chords[0]).toEqual({ chord: '^B d', label: 'describe pane', mirrorTool: 'DescribePane' });
    expect(detail.tools[0]).toEqual({ tool: 'DescribePane', label: 'describe pane', mirrorChord: '^B d' });
    expect(detail.chordCount).toBe(2);
    expect(detail.toolCount).toBe(2);
    // No store wired → visualState omitted (backward-compat).
    expect(detail.visualState).toBeUndefined();
  });

  test('attaches default visualState when store is wired', () => {
    installFakeFactory(makeFakePane());
    const store = createVisualStateStore();
    const out = dispatchDescribeSurface({ addr: { kind: 'pane', ref: REF } }, { store });
    const detail = out.detail as { visualState?: typeof DEFAULT_VISUAL_STATE };
    expect(detail.visualState).toEqual(DEFAULT_VISUAL_STATE);
  });

  test('store.setState(focusPolicy=skip) propagates to visualState', () => {
    installFakeFactory(makeFakePane());
    const store = createVisualStateStore();
    store.setState(REF, { focusPolicy: PANE_FOCUS_POLICY.skip });
    const out = dispatchDescribeSurface({ addr: { kind: 'pane', ref: REF } }, { store });
    const detail = out.detail as { visualState: { focusPolicy: string } };
    expect(detail.visualState.focusPolicy).toBe('skip');
  });

  test('chords/tools shape matches InspectPane exactly (B-9 shim precondition)', () => {
    const chordHints = [
      { chord: '^B d', label: 'describe pane', mirrorTool: 'DescribePane' },
      { chord: '^B p', label: 'set focus policy' }, // mirrorTool omitted
    ];
    const toolHints = [
      { tool: 'DescribePane', label: 'describe pane', mirrorChord: '^B d' },
      { tool: 'SetFocusPolicy', label: 'set focus policy' }, // mirrorChord omitted
    ];
    installFakeFactory(makeFakePane({ chords: chordHints, tools: toolHints }));
    const inspect = dispatchInspectPane({ windowId: REF.windowId, paneId: REF.paneId });
    const describe = dispatchDescribeSurface({ addr: { kind: 'pane', ref: REF } });
    const detail = describe.detail as {
      chords: { chord: string; label: string; mirrorTool?: string }[];
      tools: { tool: string; label: string; mirrorChord?: string }[];
    };
    // Same structural payload — the B-9 InspectPane shim can project
    // DescribeSurface(pane).detail.{chords,tools} directly.
    expect(detail.chords).toEqual(inspect.chords as unknown as typeof detail.chords);
    expect(detail.tools).toEqual(inspect.tools as unknown as typeof detail.tools);
  });
});
