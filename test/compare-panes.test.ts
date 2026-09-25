// ── VW-term Bundle P7-E-α · ComparePanes dispatch tests ──

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildComparePanesTool,
  dispatchComparePanes,
} from '../src/capture/compare-panes.js';
import { __setDefaultPaneFactory, PaneFactory } from '../src/panes/index.js';
import type { Pane, PaneDescription, PaneRef } from '../src/panes/types.js';

function makePane(ref: PaneRef, ansi: string, title = 'fake'): Pane {
  const desc: PaneDescription = {
    ref,
    kind: { kind: 'terminal', terminalId: 'term:fake' },
    title,
    summary: title,
    supportedTaps: ['raw'],
    chords: [],
    tools: [],
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
      ansi,
      meta: {},
    }),
    addTap: () => () => {},
    mount: () => {},
    unmount: () => {},
  };
}

function installFactoryMap(map: ReadonlyMap<string, Pane>): void {
  const factory = new PaneFactory();
  (factory as unknown as { peek: (ref: PaneRef) => Pane | undefined }).peek = (ref) => {
    const key = `${ref.windowId}::${ref.paneId}::${ref.runnerLabel ?? ''}`;
    return map.get(key);
  };
  __setDefaultPaneFactory(factory);
}

const REF_A: PaneRef = { windowId: 'w', paneId: 'a' };
const REF_B: PaneRef = { windowId: 'w', paneId: 'b' };

afterEach(() => {
  __setDefaultPaneFactory(null);
});

// ── Tool spec ────────────────────────────────────────────────────

describe('ComparePanes · tool spec', () => {
  test('spec has expected name + required fields', () => {
    const spec = buildComparePanesTool();
    expect(spec.name).toBe('ComparePanes');
    expect(typeof spec.description).toBe('string');
    const p = spec.parameters as Record<string, unknown>;
    expect(p.type).toBe('object');
    expect(p.required).toEqual(['refA', 'refB']);
  });
});

// ── Dispatch: arg parsing ────────────────────────────────────────

describe('ComparePanes · arg parsing', () => {
  test('missing refA → found:false · note tags refA', async () => {
    const out = await dispatchComparePanes({ refB: REF_B });
    expect(out.found).toBe(false);
    expect(out.note).toContain('refA');
  });

  test('missing refB → found:false · note tags refB', async () => {
    const out = await dispatchComparePanes({ refA: REF_A });
    expect(out.found).toBe(false);
    expect(out.note).toContain('refB');
  });

  test('same ref short-circuits with samePane:true · equal:true · diff empty', async () => {
    // No factory install needed — same-ref short-circuits before lookup.
    const out = await dispatchComparePanes({ refA: REF_A, refB: { ...REF_A } });
    expect(out.found).toBe(true);
    expect(out.samePane).toBe(true);
    expect(out.equal).toBe(true);
    expect(out.diff).toBe('');
  });
});

// ── Dispatch: factory lookup failures ────────────────────────────

describe('ComparePanes · factory lookup', () => {
  test('paneA not resolvable → found:false · note identifies refA', async () => {
    installFactoryMap(new Map([
      [`${REF_B.windowId}::${REF_B.paneId}::`, makePane(REF_B, 'b')],
    ]));
    const out = await dispatchComparePanes({ refA: REF_A, refB: REF_B });
    expect(out.found).toBe(false);
    expect(out.note).toContain('refA');
  });

  test('paneB not resolvable → found:false · note identifies refB', async () => {
    installFactoryMap(new Map([
      [`${REF_A.windowId}::${REF_A.paneId}::`, makePane(REF_A, 'a')],
    ]));
    const out = await dispatchComparePanes({ refA: REF_A, refB: REF_B });
    expect(out.found).toBe(false);
    expect(out.note).toContain('refB');
  });
});

// ── Dispatch: diff output ─────────────────────────────────────────

describe('ComparePanes · diff output', () => {
  test('identical text → equal:true · empty diff', async () => {
    installFactoryMap(new Map([
      [`${REF_A.windowId}::${REF_A.paneId}::`, makePane(REF_A, 'line1\nline2\nline3')],
      [`${REF_B.windowId}::${REF_B.paneId}::`, makePane(REF_B, 'line1\nline2\nline3')],
    ]));
    const out = await dispatchComparePanes({ refA: REF_A, refB: REF_B });
    expect(out.found).toBe(true);
    expect(out.equal).toBe(true);
    expect(out.diff).toBe('');
    expect(out.linesA).toBe(3);
    expect(out.linesB).toBe(3);
  });

  test('different text → equal:false · diff contains + / - lines', async () => {
    installFactoryMap(new Map([
      [`${REF_A.windowId}::${REF_A.paneId}::`, makePane(REF_A, 'alpha\nbeta\ngamma')],
      [`${REF_B.windowId}::${REF_B.paneId}::`, makePane(REF_B, 'alpha\nBETA\ngamma')],
    ]));
    const out = await dispatchComparePanes({ refA: REF_A, refB: REF_B });
    expect(out.found).toBe(true);
    expect(out.equal).toBe(false);
    expect(out.diff).toBeTruthy();
    expect(out.diff).toContain('-beta');
    expect(out.diff).toContain('+BETA');
  });

  test('ANSI stripped by default; includeAnsi:true keeps escapes', async () => {
    // Two panes with identical content WHEN ansi stripped, different raw.
    installFactoryMap(new Map([
      [`${REF_A.windowId}::${REF_A.paneId}::`, makePane(REF_A, '\x1b[31mhi\x1b[0m')],
      [`${REF_B.windowId}::${REF_B.paneId}::`, makePane(REF_B, '\x1b[32mhi\x1b[0m')],
    ]));
    // Default: strip ANSI → both look like "hi" → equal
    const stripped = await dispatchComparePanes({ refA: REF_A, refB: REF_B });
    expect(stripped.equal).toBe(true);
    // includeAnsi:true → raw strings differ → unequal + diff
    const raw = await dispatchComparePanes({ refA: REF_A, refB: REF_B, includeAnsi: true });
    expect(raw.equal).toBe(false);
    expect(raw.diff).toBeTruthy();
  });

  test('contextLines clamps to 20 · over-cap value accepted without throw', async () => {
    installFactoryMap(new Map([
      [`${REF_A.windowId}::${REF_A.paneId}::`, makePane(REF_A, 'a\nb\nc\nd\ne\nf\ng')],
      [`${REF_B.windowId}::${REF_B.paneId}::`, makePane(REF_B, 'a\nX\nc\nd\ne\nf\ng')],
    ]));
    const out = await dispatchComparePanes({ refA: REF_A, refB: REF_B, contextLines: 100 });
    expect(out.found).toBe(true);
    // Diff still produces a valid unified patch — we don't assert exact
    // context line count to avoid coupling to `diff` library internals.
    expect(out.diff).toContain('-b');
    expect(out.diff).toContain('+X');
  });
});
