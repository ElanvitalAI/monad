// M8 (2026-04-28) — unit tests for ACP capability matrix auto-generator.

import { describe, test, expect } from 'bun:test';
import {
  CAP_MATRIX_MARKER_START,
  CAP_MATRIX_MARKER_END,
  formatCapabilityMatrix,
  extractCapMatrixSection,
  replaceCapMatrixSection,
} from '../scripts/gen-acp-capability-matrix.ts';
import type { MonadCapabilities } from '../src/acp/capabilities.js';

const minimalCaps = (overrides: Partial<MonadCapabilities> = {}): MonadCapabilities => ({
  protocolVersion: 1,
  prompt: { text: true, resourceLink: true, image: false, audio: false, embeddedContext: false },
  loadSession: false,
  fileOps: { readTextFile: false, writeTextFile: false },
  planMode: false,
  ui: { showModal: false, showToast: false, updateStatusPill: false, usage: false },
  ...overrides,
});

describe('M8 · formatCapabilityMatrix', () => {
  test('emits markdown table with header + sep + every cap row', () => {
    const out = formatCapabilityMatrix([
      ['cas', minimalCaps({ planMode: true, fileOps: { readTextFile: true, writeTextFile: true } })],
      ['claude', minimalCaps()],
    ]);
    expect(out).toContain('| capability | cas | claude |');
    expect(out).toContain('|---|---|---|');
    expect(out).toContain('`planMode`');
    expect(out).toContain('`fileOps.readTextFile`');
    // Plan mode true on cas → ✅ · false on claude → ❌
    expect(out).toMatch(/`planMode` \| ✅ \| ❌/);
  });

  test('protocolVersion renders as number', () => {
    const out = formatCapabilityMatrix([['x', minimalCaps({ protocolVersion: 1 })]]);
    expect(out).toMatch(/`protocolVersion` \| 1 \|/);
  });

  test('single-backend matrix renders cleanly', () => {
    const out = formatCapabilityMatrix([['cas', minimalCaps()]]);
    expect(out).toContain('| capability | cas |');
    expect(out.split('\n').length).toBeGreaterThan(10);
  });

  test('column order matches snapshot order (stable rerun)', () => {
    const a = formatCapabilityMatrix([['a', minimalCaps()], ['b', minimalCaps()]]);
    const b = formatCapabilityMatrix([['a', minimalCaps()], ['b', minimalCaps()]]);
    expect(a).toBe(b);
  });
});

describe('M8 · extractCapMatrixSection', () => {
  test('returns null when start marker missing', () => {
    expect(extractCapMatrixSection('# doc with no markers')).toBeNull();
  });

  test('returns null when end marker missing', () => {
    expect(extractCapMatrixSection(`# ok\n${CAP_MATRIX_MARKER_START}\nstuff`)).toBeNull();
  });

  test('returns before/generated/after slices', () => {
    const doc = `Header\n${CAP_MATRIX_MARKER_START}\nold body\n${CAP_MATRIX_MARKER_END}\nFooter`;
    const ext = extractCapMatrixSection(doc);
    expect(ext).not.toBeNull();
    expect(ext!.before).toBe(`Header\n${CAP_MATRIX_MARKER_START}`);
    expect(ext!.generated).toBe('\nold body\n');
    expect(ext!.after.startsWith(CAP_MATRIX_MARKER_END)).toBe(true);
  });
});

describe('M8 · replaceCapMatrixSection', () => {
  test('null when markers missing in doc', () => {
    expect(replaceCapMatrixSection('no markers here', 'new')).toBeNull();
  });

  test('replaces only between markers · preserves surroundings', () => {
    const doc = `Header\n${CAP_MATRIX_MARKER_START}\nstale\n${CAP_MATRIX_MARKER_END}\nFooter`;
    const next = replaceCapMatrixSection(doc, '| col | val |');
    expect(next).not.toBeNull();
    expect(next!.startsWith('Header')).toBe(true);
    expect(next!.endsWith('Footer')).toBe(true);
    expect(next!).toContain('| col | val |');
    expect(next!).not.toContain('stale');
  });

  test('multiple invocations are idempotent', () => {
    const doc = `${CAP_MATRIX_MARKER_START}\nold\n${CAP_MATRIX_MARKER_END}`;
    const a = replaceCapMatrixSection(doc, '| x | y |');
    const b = replaceCapMatrixSection(a!, '| x | y |');
    expect(a).toBe(b);
  });

  test('trailing newlines are trimmed before sandwiching', () => {
    const doc = `${CAP_MATRIX_MARKER_START}\nold\n${CAP_MATRIX_MARKER_END}`;
    const next = replaceCapMatrixSection(doc, '| body |\n\n\n');
    // Single newline after body before end marker.
    expect(next).toBe(`${CAP_MATRIX_MARKER_START}\n| body |\n${CAP_MATRIX_MARKER_END}`);
  });

  test('start/end markers are preserved literally', () => {
    const doc = `${CAP_MATRIX_MARKER_START}\nold\n${CAP_MATRIX_MARKER_END}`;
    const next = replaceCapMatrixSection(doc, '| body |')!;
    expect(next).toContain(CAP_MATRIX_MARKER_START);
    expect(next).toContain(CAP_MATRIX_MARKER_END);
  });
});

describe('M8 · marker constants', () => {
  test('markers are HTML comments', () => {
    expect(CAP_MATRIX_MARKER_START).toMatch(/^<!--/);
    expect(CAP_MATRIX_MARKER_START).toMatch(/-->$/);
    expect(CAP_MATRIX_MARKER_END).toMatch(/^<!--/);
    expect(CAP_MATRIX_MARKER_END).toMatch(/-->$/);
  });

  test('markers contain stable identifier substring', () => {
    expect(CAP_MATRIX_MARKER_START).toContain('cap-matrix');
    expect(CAP_MATRIX_MARKER_END).toContain('cap-matrix');
  });
});
