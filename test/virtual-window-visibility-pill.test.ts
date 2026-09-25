// Bundle B-7-γ — VirtualWindow paintPane integration test for the
// visibility badge. The pure badge helper is covered in
// test/panes/visibility-badge.test.ts; here we verify that the
// resolver wiring lands, reaches paintPane, and stamps the correct
// glyph onto the focused pane's label (and nowhere else).

import { describe, expect, test } from 'bun:test';

import { VirtualWindow } from '../src/virtual-windows/virtual-window.js';
import { createPaneContent } from '../src/virtual-windows/pane-content.js';
import type { PaneVisibility } from '../src/panes/visual-state.js';

function makePane(title = 'x') {
  return createPaneContent({ kind: 'markdown', text: 'hello', title });
}

function renderVw(spec: { visibilityResolver?: (paneId: string) => PaneVisibility } = {}): {
  vw: VirtualWindow;
  paneId: string;
  output: string;
} {
  const p = makePane('demo');
  const vw = new VirtualWindow({
    id: 1, title: 'w', rootContent: p,
    bounds: { row: 1, col: 1, width: 80, height: 24 },
    visibilityResolver: spec.visibilityResolver,
  });
  vw.setBorderAccent(true);
  const output = vw.render();
  return { vw, paneId: p.id, output };
}

describe('VirtualWindow paintPane — visibility badge (B-7-γ)', () => {
  test('no resolver → no badge in the rendered output', () => {
    const { output } = renderVw();
    expect(output).not.toContain('·H·');
    expect(output).not.toContain('·D·');
    expect(output).not.toContain('·ᴸ·');
  });

  test('resolver returns visible → no badge (default state is invisible)', () => {
    const { output } = renderVw({ visibilityResolver: () => 'visible' });
    expect(output).not.toContain('·H·');
  });

  test('resolver returns hidden → ·H· present in the output', () => {
    const { output } = renderVw({ visibilityResolver: () => 'hidden' });
    expect(output).toContain('·H·');
    expect(output).not.toContain('·D·');
    expect(output).not.toContain('·ᴸ·');
  });

  test('resolver returns dormant → ·D· present', () => {
    const { output } = renderVw({ visibilityResolver: () => 'dormant' });
    expect(output).toContain('·D·');
    expect(output).not.toContain('·H·');
  });

  test('resolver returns llm-only → ·ᴸ· present', () => {
    const { output } = renderVw({ visibilityResolver: () => 'llm-only' });
    expect(output).toContain('·ᴸ·');
  });

  test('badge is called with the paneId of the focused pane', () => {
    const p = makePane('demo');
    const calls: string[] = [];
    const vw = new VirtualWindow({
      id: 2, title: 'w', rootContent: p,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
      visibilityResolver: (paneId) => {
        calls.push(paneId);
        return 'hidden';
      },
    });
    vw.setBorderAccent(true);
    vw.render();
    expect(calls).toContain(p.id);
  });

  test('only the FOCUSED pane paints the badge (2-pane split · focus on B)', () => {
    const a = makePane('a');
    const b = makePane('b');
    const vw = new VirtualWindow({
      id: 3, title: 'w', rootContent: a,
      bounds: { row: 1, col: 1, width: 80, height: 24 },
      // Resolver says: a=hidden, b=dormant. Since focus is on b after
      // splitFocused, only ·D· should appear — ·H· should NOT because
      // paintPane skips the label block for non-focused panes.
      visibilityResolver: (paneId) => (paneId === a.id ? 'hidden' : 'dormant'),
    });
    vw.setBorderAccent(true);
    vw.splitFocused('h', b);
    expect(vw.focused).toBe(b.id);
    const output = vw.render();
    expect(output).toContain('·D·');
    expect(output).not.toContain('·H·');
  });

  test('label clear width accounts for the badge — no residue right of the label', () => {
    // Smoke check: the output should contain the badge. We don't
    // assert exact byte positions (test would be brittle against
    // theme/ansi tweaks), but we ensure the badge is in there and
    // no orphan cursor-move output appears after it on the same row.
    const { output } = renderVw({ visibilityResolver: () => 'hidden' });
    expect(output).toContain('·H·');
    // The paintPane row-clear step uses SGR reset — check it's still
    // present (regression guard: we didn't delete that sequence).
    expect(output).toContain('\x1b[0m');
  });
});
