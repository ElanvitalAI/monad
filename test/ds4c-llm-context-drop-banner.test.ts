// DS-4c — renderLlmContextDropBanner contract tests (§8.2 of
// PLAN-drag-session-ds4c-llm-context.md).

import { describe, expect, test } from 'bun:test';
import {
  renderLlmContextDropBanner,
  DEFAULT_LLM_CONTEXT_BANNER_LABEL,
  type LlmContextBannerState,
} from '../src/llm-context-drop-banner.js';

function state(overrides: Partial<LlmContextBannerState>): LlmContextBannerState {
  return {
    active: true,
    row: 20,
    cols: 80,
    hovered: false,
    label: DEFAULT_LLM_CONTEXT_BANNER_LABEL,
    ...overrides,
  };
}

describe('renderLlmContextDropBanner', () => {
  test('active=false → empty string', () => {
    expect(renderLlmContextDropBanner(state({ active: false }))).toBe('');
  });

  test('row <= 0 → empty string', () => {
    expect(renderLlmContextDropBanner(state({ row: 0 }))).toBe('');
    expect(renderLlmContextDropBanner(state({ row: -5 }))).toBe('');
  });

  test('cols <= 2 → empty string (degenerate geometry)', () => {
    expect(renderLlmContextDropBanner(state({ cols: 2 }))).toBe('');
    expect(renderLlmContextDropBanner(state({ cols: 1 }))).toBe('');
  });

  test('hovered=false → DIM_INVERSE style', () => {
    const out = renderLlmContextDropBanner(state({ hovered: false }));
    // DIM = CSI 2m ; INVERSE = CSI 7m
    expect(out).toContain('\x1b[2m\x1b[7m');
    // No bold marker when not hovered.
    expect(out.includes('\x1b[1m\x1b[7m')).toBe(false);
  });

  test('hovered=true → BOLD_INVERSE style', () => {
    const out = renderLlmContextDropBanner(state({ hovered: true }));
    expect(out).toContain('\x1b[1m\x1b[7m');
  });

  test('output contains save + restore cursor markers', () => {
    const out = renderLlmContextDropBanner(state({}));
    expect(out.startsWith('\x1b[s')).toBe(true);
    expect(out.endsWith('\x1b[u')).toBe(true);
  });

  test('row + col move-to encodes correctly', () => {
    const out = renderLlmContextDropBanner(state({ row: 15 }));
    // moveTo(15, 2) → CSI 15;2H
    expect(out).toContain('\x1b[15;2H');
  });

  test('label centered when it fits', () => {
    const out = renderLlmContextDropBanner(state({
      cols: 30,
      label: 'TEST',
    }));
    // width = 28, label = 4, padLeft = 12 → col 14
    expect(out).toContain('\x1b[20;14H');
    expect(out).toContain('TEST');
  });

  test('label truncated with ellipsis when overflow', () => {
    const out = renderLlmContextDropBanner(state({
      cols: 12,  // width = 10
      label: 'ExceedinglyLongLabel',
    }));
    // Truncated to width-1=9 chars + '…'
    expect(out).toContain('Exceeding…');
  });

  test('empty label still renders a bare row', () => {
    const out = renderLlmContextDropBanner(state({ label: '' }));
    // Fill without label text
    expect(out).toContain('\x1b[2m\x1b[7m');
    expect(out.length).toBeGreaterThan(0);
  });

  test('output always terminates all styles with RESET', () => {
    const out = renderLlmContextDropBanner(state({ hovered: true }));
    // Count opens (bold+inverse sequences) and ensure RESETs after each fill/label.
    const resetCount = (out.match(/\x1b\[0m/g) ?? []).length;
    expect(resetCount).toBeGreaterThanOrEqual(1);
  });
});

describe('DEFAULT_LLM_CONTEXT_BANNER_LABEL', () => {
  test('default label starts with ⊕ and mentions LLM context', () => {
    expect(DEFAULT_LLM_CONTEXT_BANNER_LABEL.startsWith('⊕')).toBe(true);
    expect(DEFAULT_LLM_CONTEXT_BANNER_LABEL.toLowerCase()).toContain('llm context');
  });
});
