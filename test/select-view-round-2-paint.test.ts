// IDX-6 SelectView round-2 paint-path tests.
//
// Round-1 (FU I) only themed the cursor glyph + bolded label. Round-2
// extends to title / query / preview / footer / disabled / placeholder /
// separator / description paint paths. All new painters fall back
// along: round-2 slot → selectView muted / cursor → legacy C.* (only
// when no theme).
//
// Each test mounts a SelectView with a controlled spec, drives
// `draw()` through a Printer, and asserts:
//   1. backward compat — no theme preserves legacy glyphs
//   2. themed output differs from legacy (ANSI prefix changes)
//   3. crossing presets (MOCHA vs LATTE vs DAWN) yields divergent
//      output so theme switches actually repaint

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  ROSE_PINE_DAWN,
  ELANOUS_PASTEL_DEFAULT,
} from '../src/themes/index.js';
import { SelectView } from '../src/ui/widgets/select-view.js';
import { Printer } from '../src/ui/printer.js';

const ORIG_CHALK_LEVEL = chalk.level;

function renderSelectView<T>(
  spec: ConstructorParameters<typeof SelectView<T>>[0],
  width = 60,
  height = 12,
  focused = true,
): string {
  const p = Printer.create({ width, height, focused });
  const view = new SelectView<T>(spec);
  view.layout({ width, height });
  view.takeFocus();
  view.draw(p);
  return p.lines().join('\n');
}

beforeEach(() => { chalk.level = 3; });
afterEach(() => { chalk.level = ORIG_CHALK_LEVEL; });

describe('Title painter', () => {
  test('bolded title in legacy path', () => {
    const out = renderSelectView({
      title: 'Pick something',
      options: [{ value: 'a', label: 'Alpha' }],
      onSubmit: () => {},
    });
    expect(out).toContain('Pick something');
  });

  test('theme changes the ANSI prefix on title', () => {
    const mk = (theme: typeof CATPPUCCIN_MOCHA | undefined) =>
      renderSelectView({
        title: 'Title',
        options: [{ value: 'a', label: 'Alpha' }],
        onSubmit: () => {},
        theme,
      });
    const none = mk(undefined);
    const mocha = mk(CATPPUCCIN_MOCHA);
    expect(mocha).not.toBe(none);
    expect(mocha).toContain('Title');
  });

  test('different themes produce different title ANSI', () => {
    const mocha = renderSelectView({
      title: 'Title',
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    const latte = renderSelectView({
      title: 'Title',
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
      theme: CATPPUCCIN_LATTE,
    });
    expect(mocha).not.toBe(latte);
  });
});

describe('Query painter (searchable mode)', () => {
  test('legacy path renders `/ ` prefix (no crash)', () => {
    const out = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      searchable: true,
      onSubmit: () => {},
    });
    expect(out).toContain('/ ');
  });

  test('themed query prefix uses a different ANSI than legacy', () => {
    const none = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      searchable: true,
      onSubmit: () => {},
    });
    const mocha = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      searchable: true,
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    expect(none).toContain('/ ');
    expect(mocha).toContain('/ ');
    expect(none).not.toBe(mocha);
  });

  test('theme also styles the typed query body, not only the prefix', () => {
    const view = new SelectView<string>({
      options: [{ value: 'a', label: 'Alpha' }],
      searchable: true,
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    view.takeFocus();
    view.onEvent({ name: 'a', ctrl: false, alt: false, shift: false });
    const p = Printer.create({ width: 60, height: 12, focused: true });
    view.draw(p);
    const out = p.lines().join('\n');
    expect(out).toContain('a');
    expect(out).toContain('38;2;');
  });
});

describe('Footer painter', () => {
  test('legacy footer renders default hint', () => {
    const out = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
    });
    expect(out).toContain('Enter');
    expect(out).toContain('Esc');
  });

  test('custom footerHint surfaces through themed painter', () => {
    const out = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
      footerHint: 'CUSTOM FOOTER',
      theme: CATPPUCCIN_MOCHA,
    });
    expect(out).toContain('CUSTOM FOOTER');
  });

  test('theme changes footer ANSI', () => {
    const none = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
      footerHint: 'HINT',
    });
    const latte = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      onSubmit: () => {},
      footerHint: 'HINT',
      theme: CATPPUCCIN_LATTE,
    });
    expect(none).not.toBe(latte);
  });
});

describe('Placeholder painter (empty list + feedback / input banners)', () => {
  test('empty placeholder renders in legacy path', () => {
    const out = renderSelectView({
      options: [],
      searchable: true,
      emptyPlaceholder: 'Nothing matches',
      onSubmit: () => {},
    });
    expect(out).toContain('Nothing matches');
  });

  test('theme changes placeholder ANSI', () => {
    const none = renderSelectView({
      options: [],
      emptyPlaceholder: 'Nothing',
      onSubmit: () => {},
    });
    const mocha = renderSelectView({
      options: [],
      emptyPlaceholder: 'Nothing',
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    expect(none).not.toBe(mocha);
  });
});

describe('Disabled row painter', () => {
  test('legacy disabled row renders dimmed label', () => {
    const out = renderSelectView({
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta', disabled: true, disabledReason: 'Locked' },
      ],
      onSubmit: () => {},
    });
    expect(out).toContain('Beta');
  });

  test('theme changes disabled-row ANSI + disabled-reason ANSI', () => {
    const none = renderSelectView({
      options: [{ value: 'b', label: 'Beta', disabled: true, disabledReason: 'Locked' }],
      onSubmit: () => {},
    });
    const mocha = renderSelectView({
      options: [{ value: 'b', label: 'Beta', disabled: true, disabledReason: 'Locked' }],
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    expect(none).toContain('Beta');
    expect(mocha).toContain('Beta');
    expect(none).not.toBe(mocha);
    expect(mocha).toContain('Locked');
  });
});

describe('Description painter (per-row secondary text)', () => {
  test('description surfaces in legacy path', () => {
    const out = renderSelectView({
      options: [{ value: 'a', label: 'Alpha', description: 'first letter' }],
      onSubmit: () => {},
    });
    expect(out).toContain('first letter');
  });

  test('theme changes description ANSI', () => {
    const none = renderSelectView({
      options: [{ value: 'a', label: 'A', description: 'desc' }],
      onSubmit: () => {},
    });
    const mocha = renderSelectView({
      options: [{ value: 'a', label: 'A', description: 'desc' }],
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    expect(none).not.toBe(mocha);
  });

  test('focused cursor row lifts description into the selected rail', () => {
    const out = renderSelectView({
      options: [
        { value: 'a', label: 'Alpha', description: 'selected desc' },
        { value: 'b', label: 'Beta', description: 'other desc' },
      ],
      onSubmit: () => {},
      theme: CATPPUCCIN_LATTE,
    });
    expect(out).toContain('selected desc');
    expect(out).toContain('other desc');
    expect(out).toContain('38;2;');
    expect(out).not.toBe(renderSelectView({
      options: [
        { value: 'a', label: 'Alpha', description: 'selected desc' },
        { value: 'b', label: 'Beta', description: 'other desc' },
      ],
      onSubmit: () => {},
    }));
  });
});

describe('Preview + separator painter (side-by-side)', () => {
  test('legacy preview renders body + │ separator', () => {
    const out = renderSelectView({
      options: [{ value: 'a', label: 'Alpha' }],
      preview: (opt) => `preview for ${String(opt.value)}`,
      onSubmit: () => {},
    }, 80, 10);
    expect(out).toContain('preview for a');
    expect(out).toContain('│');
  });

  test('theme changes preview body + separator ANSI', () => {
    const none = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      preview: (opt) => `preview for ${String(opt.value)}`,
      onSubmit: () => {},
    }, 80, 10);
    const dawn = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      preview: (opt) => `preview for ${String(opt.value)}`,
      onSubmit: () => {},
      theme: ROSE_PINE_DAWN,
    }, 80, 10);
    expect(none).not.toBe(dawn);
    expect(dawn).toContain('preview for a');
    expect(dawn).toContain('│');
  });
});

describe('Separator painter (upward mode)', () => {
  test('legacy separator renders ─', () => {
    const out = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      direction: 'up',
      onSubmit: () => {},
    });
    expect(out).toContain('─');
  });

  test('theme changes separator ANSI', () => {
    const none = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      direction: 'up',
      onSubmit: () => {},
    });
    const mocha = renderSelectView({
      options: [{ value: 'a', label: 'A' }],
      direction: 'up',
      onSubmit: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    expect(none).not.toBe(mocha);
    expect(mocha).toContain('─');
  });
});

describe('Cross-preset divergence — full render', () => {
  test('the same spec under 4 presets produces 4 distinct ANSI strings', () => {
    const spec = {
      title: 'Multi-part select',
      options: [
        { value: 'a', label: 'Alpha', description: 'A desc' },
        { value: 'b', label: 'Beta',  description: 'B desc', disabled: true, disabledReason: 'Beta' },
      ],
      searchable: true,
      onSubmit: () => {},
      footerHint: 'Testing footer hint',
    };

    const outputs = new Set([
      renderSelectView({ ...spec, theme: CATPPUCCIN_MOCHA }),
      renderSelectView({ ...spec, theme: CATPPUCCIN_LATTE }),
      renderSelectView({ ...spec, theme: ROSE_PINE_DAWN }),
      renderSelectView({ ...spec, theme: ELANOUS_PASTEL_DEFAULT }),
    ]);

    expect(outputs.size).toBe(4);
  });
});
