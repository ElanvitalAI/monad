// Ergonomic-port Tier E1.1 (2026-05-11) — pure layout-state tests.
// React lifecycle is not under test (it's a thin wrapper); the
// `mergeLayout` helper is the load-bearing pure surface and gets
// exhaustive coverage here.

import { describe, expect, it } from 'bun:test';
import { DEFAULT_LAYOUT, mergeLayout } from './usePanelLayout';

describe('mergeLayout', () => {
  it('returns defaults for null / undefined / non-object', () => {
    expect(mergeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(mergeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(mergeLayout(42)).toEqual(DEFAULT_LAYOUT);
    expect(mergeLayout('string')).toEqual(DEFAULT_LAYOUT);
  });

  it('returns defaults for empty object', () => {
    expect(mergeLayout({})).toEqual(DEFAULT_LAYOUT);
  });

  it('honors valid boolean fields', () => {
    expect(mergeLayout({ leftCollapsed: true })).toMatchObject({
      leftCollapsed: true,
      rightCollapsed: DEFAULT_LAYOUT.rightCollapsed,
    });
    expect(mergeLayout({ rightCollapsed: true })).toMatchObject({
      rightCollapsed: true,
    });
    expect(mergeLayout({ canvasOnly: true })).toMatchObject({ canvasOnly: true });
  });

  it('clamps width below the minimum to the minimum', () => {
    const result = mergeLayout({ leftWidthPx: 50 });
    expect(result.leftWidthPx).toBe(160);
  });

  it('clamps width above the maximum to the maximum', () => {
    const result = mergeLayout({ rightWidthPx: 9999 });
    expect(result.rightWidthPx).toBe(640);
  });

  it('rounds fractional widths to integers', () => {
    const result = mergeLayout({ leftWidthPx: 234.7, rightWidthPx: 311.2 });
    expect(result.leftWidthPx).toBe(235);
    expect(result.rightWidthPx).toBe(311);
  });

  it('falls back to defaults when widths are non-finite', () => {
    expect(mergeLayout({ leftWidthPx: Number.NaN })).toMatchObject({
      leftWidthPx: DEFAULT_LAYOUT.leftWidthPx,
    });
    expect(mergeLayout({ rightWidthPx: Number.POSITIVE_INFINITY })).toMatchObject({
      rightWidthPx: DEFAULT_LAYOUT.rightWidthPx,
    });
  });

  it('ignores fields with the wrong type', () => {
    const result = mergeLayout({
      leftCollapsed: 'yes' as unknown as boolean,
      canvasOnly: 1 as unknown as boolean,
      leftWidthPx: 'wide' as unknown as number,
    });
    expect(result.leftCollapsed).toBe(DEFAULT_LAYOUT.leftCollapsed);
    expect(result.canvasOnly).toBe(DEFAULT_LAYOUT.canvasOnly);
    expect(result.leftWidthPx).toBe(DEFAULT_LAYOUT.leftWidthPx);
  });

  it('preserves a fully-specified valid record verbatim (after clamp)', () => {
    const input = {
      leftCollapsed: true,
      rightCollapsed: true,
      canvasOnly: false,
      leftWidthPx: 280,
      rightWidthPx: 360,
    };
    expect(mergeLayout(input)).toEqual(input);
  });
});
