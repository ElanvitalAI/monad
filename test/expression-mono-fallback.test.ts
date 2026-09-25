// Mono fallback contract — every renderer in `src/expression/` MUST
// emit a plain-text representation when called with `profile='mono'`.
// "Plain" here means: no ANSI CSI escapes, no SGR. Glyphs (• ▌ │ ─)
// are still allowed since they survive screen readers and copy-paste.
//
// Tests live as one consolidated file so that adding a renderer is
// "add one block here", which keeps the contract discoverable.

import { describe, expect, test } from 'bun:test';
import {
  renderProgress,
  renderSpinner,
  renderTable,
} from '../src/expression/index.js';
import type {
  ProgressSpec,
  SpinnerSpec,
  TableSpec,
} from '../src/expression/index.js';

const ANSI_CSI = /\x1b\[/;

describe('expression mono-fallback contract', () => {
  test('renderProgress emits no SGR in mono', () => {
    const spec: ProgressSpec = { kind: 'progress', value: 0.5, label: '50%' };
    const out = renderProgress(spec, 'mono');
    expect(out).not.toMatch(ANSI_CSI);
    expect(out).toContain('50%');
  });

  test('renderProgress at 0 and 1 still emits no SGR', () => {
    expect(renderProgress({ kind: 'progress', value: 0 }, 'mono')).not.toMatch(ANSI_CSI);
    expect(renderProgress({ kind: 'progress', value: 1 }, 'mono')).not.toMatch(ANSI_CSI);
  });

  test('renderSpinner emits no SGR in mono', () => {
    const spec: SpinnerSpec = { kind: 'spinner', label: 'fetching', frame: 0 };
    const out = renderSpinner(spec, 'mono');
    expect(out).not.toMatch(ANSI_CSI);
    expect(out).toContain('fetching');
  });

  test('renderTable emits no SGR in mono', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [
        { id: 'name', label: 'Name' },
        { id: 'count', label: 'Count', format: 'number' },
      ],
      rows: [
        { name: 'alpha', count: 1 },
        { name: 'beta', count: 2 },
      ],
    };
    const out = renderTable(spec, 'mono');
    expect(out).not.toMatch(ANSI_CSI);
    expect(out).toContain('Name');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  test('renderTable with row striping still emits no SGR in mono', () => {
    const spec: TableSpec = {
      kind: 'table',
      columns: [{ id: 'a', label: 'A' }],
      rows: [{ a: '1' }, { a: '2' }, { a: '3' }],
      style: { row_striped: true },
    };
    expect(renderTable(spec, 'mono')).not.toMatch(ANSI_CSI);
  });

  test('renderTable across all 9 border kinds is mono-clean', () => {
    const kinds = [
      'normal',
      'rounded',
      'thick',
      'double',
      'dotted',
      'dashed',
      'block',
      'ascii',
      'hidden',
    ] as const;
    for (const border of kinds) {
      const spec: TableSpec = {
        kind: 'table',
        columns: [{ id: 'a', label: 'A' }],
        rows: [{ a: '1' }],
        style: { border },
      };
      expect(renderTable(spec, 'mono')).not.toMatch(ANSI_CSI);
    }
  });

  test('renderSpinner across all spinner styles is mono-clean', () => {
    const styles = ['dots', 'line', 'arc', 'pulse', 'bounce'] as const;
    for (const style of styles) {
      const spec: SpinnerSpec = { kind: 'spinner', style, frame: 0 };
      expect(renderSpinner(spec, 'mono')).not.toMatch(ANSI_CSI);
    }
  });

  test('renderProgress across all bar styles is mono-clean', () => {
    const bars = ['solid', 'gradient', 'dotted'] as const;
    for (const bar of bars) {
      const spec: ProgressSpec = { kind: 'progress', value: 0.5, bar };
      expect(renderProgress(spec, 'mono')).not.toMatch(ANSI_CSI);
    }
  });
});
