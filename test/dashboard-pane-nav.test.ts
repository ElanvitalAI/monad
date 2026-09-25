import { describe, expect, test } from 'bun:test';
import { renderPaneNav, paneAtColumn, paneNavLabel } from '../src/dashboard/panes/nav.js';
import { stripAnsi } from '../src/tui.js';

describe('MX9b renderPaneNav', () => {
  const entries = [
    { id: 'browser'  as const, label: 'Browser' },
    { id: 'preview'  as const, label: 'Preview' },
    { id: 'scratch'  as const, label: 'Scratch' },
    { id: 'log'      as const, label: 'Log' },
  ];

  test('emits one segment per pane with [ label ] formatting', () => {
    const { text } = renderPaneNav(entries, 'preview', 60);
    const plain = stripAnsi(text);
    expect(plain).toContain('[ Browser ]');
    expect(plain).toContain('[ Preview ]');
    expect(plain).toContain('[ Scratch ]');
    expect(plain).toContain('[ Log ]');
  });

  test('pads to the requested width', () => {
    const { text } = renderPaneNav(entries, 'browser', 80);
    const plain = stripAnsi(text);
    expect(plain.length).toBe(80);
  });

  test('hitAreas cover each segment, single-space separators between', () => {
    const { text, hitAreas } = renderPaneNav(entries, 'browser', 80);
    const plain = stripAnsi(text);
    expect(hitAreas).toHaveLength(4);
    // First segment starts at 0.
    expect(hitAreas[0]!.startCol).toBe(0);
    // Widths must match the cell widths of each '[ label ]' plus ' '.
    for (let i = 0; i < hitAreas.length - 1; i++) {
      expect(hitAreas[i + 1]!.startCol).toBe(hitAreas[i]!.endCol + 1);
      expect(hitAreas[i]!.endCol).toBeGreaterThan(hitAreas[i]!.startCol);
    }
    // Each segment should be visible in the padded output.
    for (const h of hitAreas) {
      const slice = plain.slice(h.startCol, h.endCol);
      expect(slice).toContain('[ ');
    }
  });

  test('truncates hitAreas when width is too small', () => {
    const { hitAreas } = renderPaneNav(entries, 'browser', 12);
    // Very narrow: should still include at least 1 hit area and
    // drop the overflowing ones.
    expect(hitAreas.length).toBeLessThan(entries.length);
    expect(hitAreas.length).toBeGreaterThanOrEqual(1);
    for (const h of hitAreas) expect(h.endCol).toBeLessThanOrEqual(12);
  });

  test('empty entries → empty output', () => {
    const { text, hitAreas } = renderPaneNav([], 'browser', 40);
    expect(text).toBe('');
    expect(hitAreas).toHaveLength(0);
  });

  test('width 0 → empty output', () => {
    const { text, hitAreas } = renderPaneNav(entries, 'browser', 0);
    expect(text).toBe('');
    expect(hitAreas).toHaveLength(0);
  });

  test('focused pane still appears in plain text (color stripped)', () => {
    const { text } = renderPaneNav(entries, 'log', 80);
    expect(stripAnsi(text)).toContain('[ Log ]');
  });
});

describe('MX9b paneAtColumn', () => {
  const hits = [
    { id: 'browser' as const, startCol: 0,  endCol: 11 },
    { id: 'preview' as const, startCol: 12, endCol: 23 },
    { id: 'scratch' as const, startCol: 24, endCol: 35 },
  ];

  test('inside first → browser', () => {
    expect(paneAtColumn(hits, 0)).toBe('browser');
    expect(paneAtColumn(hits, 10)).toBe('browser');
  });

  test('on the gap → null', () => {
    expect(paneAtColumn(hits, 11)).toBeNull();
  });

  test('inside middle → preview', () => {
    expect(paneAtColumn(hits, 15)).toBe('preview');
  });

  test('past last → null', () => {
    expect(paneAtColumn(hits, 35)).toBeNull();
    expect(paneAtColumn(hits, 100)).toBeNull();
  });
});

describe('MX9b paneNavLabel', () => {
  test('returns friendly names for known panes', () => {
    expect(paneNavLabel('browser')).toBe('Browser');
    expect(paneNavLabel('preview')).toBe('Preview');
    expect(paneNavLabel('skill-browser')).toBe('Skills');
    // Surface-unification v2.2 V2.2-5 Part 2 (2026-05-11) — scheduler-*
    // labels retired (scheduler view 폐기).
  });

  test('plugin: namespaced ids fall through to string coercion', () => {
    expect(paneNavLabel('plugin:foo' as never)).toBe('plugin:foo');
  });

  test('ST4 — sessions-sidebar pane has a friendly label', () => {
    expect(paneNavLabel('sessions-sidebar')).toBe('Sessions');
  });
});
