// PR-Δ25c (Sprint 18 · 2026-04-30) — modal renderer mono emphasis.
//
// Δ25 (#1024) introduced `keepAttrsInMono` on status-module + picker.
// Δ25d landed it on the markdown renderer. Δ25c finishes the
// expression-renderer surface by extending the same opt-in to the
// modal renderer (4 .render() callsites: title bold, destructive
// action bold, primary action bold, muted action plain).
//
// Default off preserves the legacy mono = zero-CSI contract that
// expression-mono-fallback.test.ts asserts on the modal body.
// Truecolor profile output is identical regardless of toggle.

import { describe, expect, test } from 'bun:test';
import { renderModal } from '../src/expression/renderer/modal.js';
import type { ModalSpec } from '../src/expression/spec/types.js';

const SGR_BOLD = '\x1b[1m';
const SGR_RESET = '\x1b[0m';

const baseModal = (overrides: Partial<ModalSpec> = {}): ModalSpec => ({
  kind: 'modal',
  id: 'm',
  title: 'Confirm',
  body: 'Save changes before closing?',
  variant: 'info',
  actions: [
    { id: 'ok', label: 'OK', primary: true, hotkey: '⏎' },
    { id: 'cancel', label: 'Cancel' },
  ],
  ...overrides,
});

describe('Δ25c · modal mono emphasis (default off)', () => {
  test('mono profile + default opts: title + actions strip all SGR', () => {
    const out = renderModal(baseModal(), 'mono');
    // Visible glyphs preserved.
    expect(out).toContain('Confirm');
    expect(out).toContain('Save changes');
    expect(out).toContain('[ OK [⏎] ]');
    expect(out).toContain('[ Cancel ]');
    // Legacy mono contract: no bold SGR.
    expect(out).not.toContain(SGR_BOLD);
    // No color SGR.
    expect(out).not.toMatch(/\x1b\[38;[25];/);
  });
});

describe('Δ25c · modal mono emphasis (opt-in on)', () => {
  test('title bold survives mono when keepAttrsInMono is true', () => {
    const out = renderModal(baseModal(), 'mono', { keepAttrsInMono: true });
    expect(out).toContain('Confirm');
    expect(out).toContain(SGR_BOLD);
    expect(out).toContain(SGR_RESET);
    // Color SGR still stripped under mono.
    expect(out).not.toMatch(/\x1b\[38;[25];/);
  });

  test('primary action bold survives mono with opt-in', () => {
    const out = renderModal(
      baseModal({
        title: 'Q',
        actions: [{ id: 'ok', label: 'Confirm', primary: true }],
      }),
      'mono',
      { keepAttrsInMono: true },
    );
    // Title + primary action both emit bold under opt-in. Stripped
    // version still contains visible glyphs.
    expect(out).toContain('[ Confirm ]');
    // 2 bold runs (title + primary action).
    const boldCount = out.split(SGR_BOLD).length - 1;
    expect(boldCount).toBeGreaterThanOrEqual(2);
  });

  test('destructive action bold survives mono with opt-in', () => {
    const out = renderModal(
      baseModal({
        title: 'Delete',
        body: 'Permanent.',
        actions: [
          { id: 'del', label: 'Delete', destructive: true },
          { id: 'no', label: 'Keep' },
        ],
      }),
      'mono',
      { keepAttrsInMono: true },
    );
    expect(out).toContain('[ Delete ]');
    // Title + destructive action both emit bold.
    const boldCount = out.split(SGR_BOLD).length - 1;
    expect(boldCount).toBeGreaterThanOrEqual(2);
  });

  test('non-primary muted action emits no bold (no attr to preserve)', () => {
    const out = renderModal(
      baseModal({
        title: 'Q',
        actions: [{ id: 'cancel', label: 'Cancel' }], // muted, no primary/destructive
      }),
      'mono',
      { keepAttrsInMono: true },
    );
    // Only the title carries bold; the cancel action has no bold attr.
    expect(out).toContain('[ Cancel ]');
    const boldCount = out.split(SGR_BOLD).length - 1;
    expect(boldCount).toBe(1); // exactly the title's bold
  });
});

describe('Δ25c · truecolor profile unaffected by toggle', () => {
  test('truecolor output identical regardless of keepAttrsInMono', () => {
    const off = renderModal(baseModal(), 'truecolor', { keepAttrsInMono: false });
    const on = renderModal(baseModal(), 'truecolor', { keepAttrsInMono: true });
    expect(off).toBe(on);
  });
});

describe('Δ25c · all 4 callsites covered (smoke)', () => {
  // One spec exercises all 4 Style.render() callsites: title (top
  // border), destructive action, primary action, muted action.
  test('rich modal emits bold attrs across title + 2 styled actions under mono opt-in', () => {
    const out = renderModal(
      {
        kind: 'modal',
        id: 'rich',
        title: 'Confirm Permanent Delete',
        body: 'This will remove every cached entry.',
        variant: 'destructive',
        actions: [
          { id: 'del', label: 'Delete', destructive: true, hotkey: 'd' },
          { id: 'ok', label: 'Confirm', primary: true, hotkey: '⏎' },
          { id: 'cancel', label: 'Cancel' },
        ],
      },
      'mono',
      { keepAttrsInMono: true },
    );
    // 3 bold runs: title + destructive action + primary action.
    const boldCount = out.split(SGR_BOLD).length - 1;
    expect(boldCount).toBe(3);
    // No color SGR (mono).
    expect(out).not.toMatch(/\x1b\[38;[25];/);
    // Visible labels preserved.
    expect(out).toContain('Confirm Permanent Delete');
    expect(out).toContain('[ Delete [d] ]');
    expect(out).toContain('[ Confirm [⏎] ]');
    expect(out).toContain('[ Cancel ]');
  });
});
