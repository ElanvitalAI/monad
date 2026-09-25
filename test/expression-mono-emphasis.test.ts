// PR-Δ25 (Sprint 17 · 2026-04-30) — cross-surface mono emphasis tests.
//
// Δ17 introduced Style.renderWithMonoEmphasis() — opt-in renderer
// that keeps attribute SGRs (bold / faint / italic / underline /
// inverse / strikethrough) alive even when the profile is `'mono'`.
// Setup wizard's step-renderer flips this on so visual hierarchy
// (Δ17 baseline) survives on NO_COLOR / SSH / CI logs. Δ25 extends
// the same opt-in to status-module + picker — `keepAttrsInMono` on
// RenderXxxOpts. Off by default to preserve the legacy mono =
// zero-CSI contract that test/expression-mono-fallback.test.ts
// asserts; surfaces opt in explicitly when their visual hierarchy
// matters more than the zero-CSI invariant.

import { describe, expect, test } from 'bun:test';
import { renderStatusModule } from '../src/expression/renderer/status-module.js';
import { renderPicker } from '../src/expression/renderer/picker.js';

const SGR_BOLD = '\x1b[1m';
const SGR_RESET = '\x1b[0m';

describe('Δ25 · status-module mono emphasis', () => {
  test('default (keepAttrsInMono off) — mono profile emits zero CSI for text styling', () => {
    const out = renderStatusModule(
      { kind: 'status-module', id: 's', text: 'hello', style: { bold: true, fg: '#89b4fa' } },
      'mono',
    );
    // Bold SGR (\x1b[1m) is stripped under the legacy contract.
    expect(out).toContain('hello');
    expect(out).not.toContain(SGR_BOLD);
  });

  test('keepAttrsInMono on — mono profile keeps bold SGR alive', () => {
    const out = renderStatusModule(
      { kind: 'status-module', id: 's', text: 'hello', style: { bold: true, fg: '#89b4fa' } },
      'mono',
      { keepAttrsInMono: true },
    );
    expect(out).toContain(SGR_BOLD);
    expect(out).toContain('hello');
    expect(out).toContain(SGR_RESET);
    // Color SGR is still stripped (paint() is profile=mono → identity).
    expect(out).not.toContain('38;2;');
    expect(out).not.toContain('38;5;');
  });

  test('truecolor profile unaffected by keepAttrsInMono toggle', () => {
    const off = renderStatusModule(
      { kind: 'status-module', id: 's', text: 'hello', style: { bold: true, fg: '#89b4fa' } },
      'truecolor',
      { keepAttrsInMono: false },
    );
    const on = renderStatusModule(
      { kind: 'status-module', id: 's', text: 'hello', style: { bold: true, fg: '#89b4fa' } },
      'truecolor',
      { keepAttrsInMono: true },
    );
    // Both render identically under truecolor — emphasis is mono-only.
    expect(off).toBe(on);
  });
});

describe('Δ25 · picker mono emphasis', () => {
  const baseSpec = {
    kind: 'picker',
    id: 'pick',
    items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Bravo' },
      { id: 'c', label: 'Charlie' },
    ],
    cursor: 1,           // Bravo selected — gets bold under emphasis
    title: 'Pick one',
  } as const;

  test('default (keepAttrsInMono off) — mono profile strips cursor bold', () => {
    const out = renderPicker(baseSpec, 'mono');
    expect(out).toContain('Bravo');
    expect(out).not.toContain(SGR_BOLD);
  });

  test('keepAttrsInMono on — cursor row + title keep bold under mono', () => {
    const out = renderPicker(baseSpec, 'mono', { keepAttrsInMono: true });
    // Title (bold) + cursor row label (bold) — at least one bold SGR.
    expect(out).toContain(SGR_BOLD);
    expect(out).toContain('Bravo');
    expect(out).toContain('Pick one');
    // No color SGR (color stays stripped under mono).
    expect(out).not.toContain('38;2;');
  });

  test('disabled item strikethrough survives mono with emphasis on', () => {
    const out = renderPicker(
      {
        ...baseSpec,
        items: [
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Bravo (legacy)', disabled: true, disabled_reason: 'deprecated' },
          { id: 'c', label: 'Charlie' },
        ],
      },
      'mono',
      { keepAttrsInMono: true },
    );
    // Strikethrough SGR (\x1b[9m) for disabled item.
    expect(out).toContain('\x1b[9m');
    // Faint+italic for disabled_reason (\x1b[2m \x1b[3m).
    expect(out).toContain('\x1b[2m');
    expect(out).toContain('\x1b[3m');
  });

  test('mono with emphasis off — disabled strikethrough is also stripped (legacy contract)', () => {
    const out = renderPicker(
      {
        ...baseSpec,
        items: [
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Bravo (legacy)', disabled: true, disabled_reason: 'deprecated' },
          { id: 'c', label: 'Charlie' },
        ],
      },
      'mono',
    );
    expect(out).not.toContain('\x1b[9m');
    expect(out).not.toContain('\x1b[2m');
  });
});
