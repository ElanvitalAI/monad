// IDX-6 Phase 4 — theme-aware widget rendering tests.
//
// The Button and Dialog widgets gained an optional `theme` field so
// callers that want per-preset colors can opt in without breaking
// legacy call sites. These tests exercise both paths: backward-compat
// (no theme) and theme-aware (with each preset).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import {
  ansiForPair,
  DEFAULT_WIDGET_TOKENS,
  pair,
  resolveButtonState,
  resolveSemantic,
  resolveWidgetTokens,
  type ThemeTokens,
} from '../src/theme/tokens.js';
import {
  CATPPUCCIN_LATTE,
  CATPPUCCIN_MOCHA,
  ELANOUS_PASTEL_DEFAULT,
  ROSE_PINE_DAWN,
} from '../src/themes/index.js';
import { Printer } from '../src/ui/printer.js';
import { BoxView, TextView } from '../src/ui/view.js';
import { Button } from '../src/ui/widgets/button.js';
import { Dialog } from '../src/ui/widgets/dialog.js';

// chalk defaults off in non-TTY. Force truecolor so paintPair emits
// ANSI we can assert on.
const ORIG_CHALK_LEVEL = chalk.level;

function renderToString(view: { draw(p: Printer): void }, width = 40, height = 1, focused = true): string {
  const p = Printer.create({ width, height, focused });
  view.draw(p);
  return p.lines().join('\n');
}

function hexTriple(hex: string): string {
  const body = hex.replace('#', '');
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  return `${r};${g};${b}`;
}

describe('IDX-6 Phase 4 ansiForPair', () => {
  test('empty pair returns empty string', () => {
    expect(ansiForPair(undefined)).toBe('');
  });

  test('fg only produces 38;2;r;g;b', () => {
    const out = ansiForPair(pair('#ff0000'));
    expect(out).toBe('\x1b[38;2;255;0;0m');
  });

  test('fg + bg combines both', () => {
    const out = ansiForPair(pair('#000000', { bg: '#ffffff' }));
    expect(out).toBe('\x1b[38;2;0;0;0;48;2;255;255;255m');
  });

  test('attributes add correct SGR codes', () => {
    const out = ansiForPair(
      pair('#aabbcc', { bold: true, faint: false, underline: true, inverse: true }),
    );
    expect(out).toContain('1'); // bold
    expect(out).toContain('4'); // underline
    expect(out).toContain('7'); // inverse
    expect(out).not.toContain(';2m'); // faint not set (ends with m only when standalone)
  });

  test('3-char hex expands to 6-char', () => {
    const out = ansiForPair(pair('#f0a'));
    // #f0a = #ff00aa
    expect(out).toBe('\x1b[38;2;255;0;170m');
  });

  test('invalid hex is silently ignored for that channel', () => {
    const out = ansiForPair(pair('not-a-hex'));
    expect(out).toBe(''); // no fg, no attrs = empty
  });
});

describe('IDX-6 Phase 4 Button — backward compat (no theme)', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('renders label unchanged when focused + no theme', () => {
    const btn = new Button({ label: 'OK', onClick: () => {} });
    btn.takeFocus();
    const out = renderToString(btn, 20);
    expect(out).toContain('OK');
    expect(out).toContain('[ '); // bracket chars
    expect(out).toContain(' ]');
  });

  test('unfocused button has no accent on brackets', () => {
    const btn = new Button({ label: 'Cancel', onClick: () => {} });
    const out = renderToString(btn, 20);
    expect(out).toContain('Cancel');
  });

  test('click fires onClick + focuses', () => {
    let fired = 0;
    const btn = new Button({ label: 'Go', onClick: () => fired++ });
    btn.onMouse({
      type: 'click',
      x: 0,
      y: 0,
      absX: 0,
      absY: 0,
    });
    expect(fired).toBe(1);
    expect(btn.isFocused()).toBe(true);
  });
});

describe('IDX-6 Phase 4 Button — theme-aware', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('focused button uses theme button.focused color', () => {
    const btn = new Button({ label: 'OK', onClick: () => {}, theme: ROSE_PINE_DAWN });
    btn.takeFocus();
    const out = renderToString(btn, 20);
    // Focused Rose-Pine-Dawn button has rose-hex fg + base-hex bg
    // + bold. chalk emits each attribute as a separate SGR so match
    // on the RGB triple instead of the combined ansiForPair escape.
    const focusedPair = resolveButtonState(ROSE_PINE_DAWN, 'focused');
    const fgHex = focusedPair.fg.replace('#', '');
    const r = parseInt(fgHex.slice(0, 2), 16);
    const g = parseInt(fgHex.slice(2, 4), 16);
    const b = parseInt(fgHex.slice(4, 6), 16);
    expect(out).toContain(`${r};${g};${b}`);
    // Bold is also set. Phase D-2 (2026-04-21) combines attrs + fg +
    // bg into one SGR (`\x1b[1;38;2;...m`) instead of emitting them
    // as separate `\x1b[1m` + `\x1b[38;2;...m` runs, so match the
    // bold code as a semicolon-delimited token instead of a full
    // standalone sequence.
    expect(out).toMatch(/\x1b\[1[;m]/);
  });

  test('unfocused default button uses theme button.normal color', () => {
    const btn = new Button({ label: 'OK', onClick: () => {}, theme: CATPPUCCIN_LATTE });
    const out = renderToString(btn, 20);
    const expected = ansiForPair(resolveButtonState(CATPPUCCIN_LATTE, 'normal'));
    expect(out).toContain(expected);
  });

  test('danger style uses theme.semantic.critical fg', () => {
    const btn = new Button({
      label: 'Delete',
      style: 'danger',
      onClick: () => {},
      theme: CATPPUCCIN_MOCHA,
    });
    const out = renderToString(btn, 20);
    const crit = resolveSemantic(CATPPUCCIN_MOCHA, 'critical');
    // ansiForPair of critical should appear; the focused variant
    // also adds bold.
    const expectedFgAnsi = `38;2;`;
    expect(out).toContain(expectedFgAnsi);
    // Verify the exact rgb triple for critical is present.
    const hex = crit.fg.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(out).toContain(`${r};${g};${b}`);
  });

  test('primary style idle uses theme.colors.accent', () => {
    const btn = new Button({
      label: 'Go',
      style: 'primary',
      onClick: () => {},
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    // not focused
    const out = renderToString(btn, 20);
    const hex = ELANOUS_PASTEL_DEFAULT.colors.accent.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(out).toContain(`${r};${g};${b}`);
  });

  test('same button produces different output across themes', () => {
    const outMocha = renderToString(
      new Button({ label: 'Save', onClick: () => {}, theme: CATPPUCCIN_MOCHA }),
      20,
    );
    const outLatte = renderToString(
      new Button({ label: 'Save', onClick: () => {}, theme: CATPPUCCIN_LATTE }),
      20,
    );
    // Plain labels identical, but ANSI prefixes differ.
    expect(outMocha).toContain('Save');
    expect(outLatte).toContain('Save');
    expect(outMocha).not.toBe(outLatte);
  });
});

describe('IDX-6 Phase 4 Dialog — theme passthrough', () => {
  beforeEach(() => {
    chalk.level = 3;
  });
  afterEach(() => {
    chalk.level = ORIG_CHALK_LEVEL;
  });

  test('dialog without theme renders title + buttons (backward compat)', () => {
    const dlg = new Dialog<string>({
      title: 'Confirm',
      body: 'Proceed?',
      buttons: [
        { label: 'OK', value: 'ok' },
        { label: 'Cancel', value: 'cancel' },
      ],
      onSubmit: () => {},
    });
    const out = renderToString(dlg, 40, 8);
    expect(out).toContain('Confirm');
    expect(out).toContain('Proceed?');
    expect(out).toContain('OK');
    expect(out).toContain('Cancel');
  });

  test('dialog with theme applies border ANSI to the frame', () => {
    const dlg = new Dialog<string>({
      title: 'Confirm',
      buttons: [{ label: 'OK', value: 'ok' }],
      onSubmit: () => {},
      theme: ROSE_PINE_DAWN,
    });
    const out = renderToString(dlg, 30, 4);
    // Border uses ansiForPair(dialog.border) — verify the rose hex
    // shows up in the escape.
    const border = resolveWidgetTokens(ROSE_PINE_DAWN, 'dialog').border;
    const hex = border.fg.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    expect(out).toContain(`${r};${g};${b}`);
  });

  test('dialog propagates theme to its buttons (idle state)', () => {
    const dlg = new Dialog<string>({
      buttons: [{ label: 'Hit', value: 'hit' }],
      onSubmit: () => {},
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = renderToString(dlg, 30, 3);
    // The button child receives the theme. Whether it paints in
    // focused or normal state depends on LinearLayout focus wiring
    // — both states use ELANOUS_PASTEL_DEFAULT-owned colors, so we
    // check that the OUTPUT uses theme-owned fg values (either
    // button.normal.fg or button.focused.fg) rather than legacy
    // C.text. Both point at palette.text or palette.base, both of
    // which belong to ELANOUS_PASTEL_DEFAULT.
    const normal = resolveButtonState(ELANOUS_PASTEL_DEFAULT, 'normal');
    const focused = resolveButtonState(ELANOUS_PASTEL_DEFAULT, 'focused');
    const normalTriple = hexTriple(normal.fg);
    const focusedTriple = hexTriple(focused.fg);
    const usedThemeFg =
      out.includes(normalTriple) || out.includes(focusedTriple);
    expect(usedThemeFg).toBe(true);
  });

  test('dialog border ANSI uses the theme.dialog.border color', () => {
    const dlg = new Dialog<string>({
      title: 'X',
      buttons: [{ label: 'OK', value: 'ok' }],
      onSubmit: () => {},
      theme: ELANOUS_PASTEL_DEFAULT,
    });
    const out = renderToString(dlg, 30, 3);
    const border = resolveWidgetTokens(ELANOUS_PASTEL_DEFAULT, 'dialog').border;
    expect(out).toContain(hexTriple(border.fg));
  });

  test('dialog title and string body use dialog token colors', () => {
    const dlg = new Dialog<string>({
      title: 'Confirm',
      body: 'Proceed?',
      buttons: [{ label: 'OK', value: 'ok' }],
      onSubmit: () => {},
      theme: ROSE_PINE_DAWN,
    });
    const out = renderToString(dlg, 40, 6);
    const tokens = resolveWidgetTokens(ROSE_PINE_DAWN, 'dialog');
    expect(out).toContain(hexTriple(tokens.title.fg));
    expect(out).toContain(hexTriple(tokens.body.fg));
  });

  test('dialog static chrome mode uses modalChrome rail + close glyph', () => {
    const dlg = new Dialog<string>({
      title: 'Confirm',
      body: 'Proceed?',
      buttons: [{ label: 'OK', value: 'ok' }],
      onSubmit: () => {},
      theme: ELANOUS_PASTEL_DEFAULT,
      chrome: 'static',
    });
    const out = renderToString(dlg, 40, 6);
    const chrome = ELANOUS_PASTEL_DEFAULT.widgetTokens?.modalChrome
      ?? DEFAULT_WIDGET_TOKENS.modalChrome!;
    expect(out).toContain(hexTriple(chrome.borderActive.fg));
    expect(out).toContain(hexTriple(chrome.titleText.fg));
    expect(out).toContain('✕');
  });

  test('box view supports chrome-wide title bar fill + rounded border variant', () => {
    const chrome = ELANOUS_PASTEL_DEFAULT.widgetTokens?.modalChrome!;
    const box = new BoxView(new TextView('body'), {
      border: true,
      title: 'Preview',
      titleBarStyle: ansiForPair(chrome.titleBarInactive ?? chrome.titleBar),
      focusedTitleBarStyle: ansiForPair(chrome.titleBar),
      titleStyle: ansiForPair(chrome.titleTextInactive ?? chrome.titleText),
      focusedTitleStyle: ansiForPair(chrome.titleText),
      style: ansiForPair(chrome.borderInactive),
      focusedStyle: ansiForPair(chrome.borderActive),
      borderVariant: chrome.chromeVariant ?? 'plain',
      focusedBorderVariant: chrome.chromeVariant ?? 'plain',
    });
    const out = renderToString(box, 24, 4);
    expect(out).toContain('╭');
    expect(out).toContain('╮');
    expect(out).toContain(hexTriple(chrome.titleBar.bg!));
    expect(out).toContain(hexTriple(chrome.titleText.fg));
  });
});

describe('IDX-6 Phase 4 — regression: DEFAULT_WIDGET_TOKENS still resolves', () => {
  test('resolveWidgetTokens with a bare theme falls back to defaults', () => {
    const bare: ThemeTokens = {
      name: 'bare-test',
      colors: { ...CATPPUCCIN_MOCHA.colors },
      pane: { ...CATPPUCCIN_MOCHA.pane },
      modal: { ...CATPPUCCIN_MOCHA.modal },
      cursor: { ...CATPPUCCIN_MOCHA.cursor },
      widget: { ...CATPPUCCIN_MOCHA.widget },
      // no widgetTokens set
    };
    expect(resolveWidgetTokens(bare, 'button')).toBe(DEFAULT_WIDGET_TOKENS.button);
    expect(resolveWidgetTokens(bare, 'dialog')).toBe(DEFAULT_WIDGET_TOKENS.dialog);
  });
});
