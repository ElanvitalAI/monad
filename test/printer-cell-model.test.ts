// Phase D-1 of PLAN-printer-cell-structured-sgr.md. Unit tests for
// the structured-style model. Every merge rule is pinned here
// because Phase D-2 will rely on this model being behaviour-stable;
// any change in merge semantics must update both the test and the
// caller expectations together.

import { describe, expect, test } from 'bun:test';
import {
  ATTR,
  ATTR_ALL_MASK,
  ATTR_UNDERLINE_MASK,
  COLOR_DEFAULT,
  Cell,
  EMPTY_CELL,
  FLAG,
  STYLE_EMPTY,
  StructuredStyle,
  colorEqual,
  emitStyleDiff,
  isCleared,
  isCont,
  mergeStyle,
  paletteColor,
  sgrToStyle,
  styleEqual,
  styleToSGR,
  truecolor,
} from '../src/ui/printer-cell-model.js';

describe('Color helpers', () => {
  test('COLOR_DEFAULT is frozen default-kind', () => {
    expect(COLOR_DEFAULT.kind).toBe('default');
    expect(Object.isFrozen(COLOR_DEFAULT)).toBe(true);
  });

  test('paletteColor clamps out-of-range indices', () => {
    expect(paletteColor(-5)).toEqual({ kind: 'palette', idx: 0 });
    expect(paletteColor(300)).toEqual({ kind: 'palette', idx: 255 });
    expect(paletteColor(42.7)).toEqual({ kind: 'palette', idx: 42 });
  });

  test('truecolor clamps each channel 0..255', () => {
    expect(truecolor(-1, 999, 128)).toEqual({ kind: 'truecolor', r: 0, g: 255, b: 128 });
  });

  test('colorEqual honours null + kind + field-by-field', () => {
    expect(colorEqual(null, null)).toBe(true);
    expect(colorEqual(null, COLOR_DEFAULT)).toBe(false);
    expect(colorEqual(COLOR_DEFAULT, COLOR_DEFAULT)).toBe(true);
    expect(colorEqual(paletteColor(5), paletteColor(5))).toBe(true);
    expect(colorEqual(paletteColor(5), paletteColor(6))).toBe(false);
    expect(colorEqual(truecolor(1, 2, 3), truecolor(1, 2, 3))).toBe(true);
    expect(colorEqual(truecolor(1, 2, 3), truecolor(1, 2, 4))).toBe(false);
    expect(colorEqual(paletteColor(1), truecolor(1, 0, 0))).toBe(false);
  });
});

describe('ATTR / FLAG constants', () => {
  test('ATTR bits are distinct non-overlapping singletons', () => {
    const bits = [
      ATTR.BOLD, ATTR.DIM, ATTR.ITALIC, ATTR.UNDERLINE,
      ATTR.UNDERLINE_2, ATTR.UNDERLINE_3, ATTR.UNDERLINE_4, ATTR.UNDERLINE_5,
      ATTR.BLINK, ATTR.REVERSE, ATTR.HIDDEN, ATTR.STRIKETHROUGH, ATTR.OVERLINE,
    ];
    const seen = new Set(bits);
    expect(seen.size).toBe(bits.length);
    // Each bit is a single power of two.
    for (const b of bits) expect(b & (b - 1)).toBe(0);
  });

  test('ATTR_ALL_MASK covers every defined bit', () => {
    const all = ATTR.BOLD | ATTR.DIM | ATTR.ITALIC | ATTR.UNDERLINE
      | ATTR.UNDERLINE_2 | ATTR.UNDERLINE_3 | ATTR.UNDERLINE_4 | ATTR.UNDERLINE_5
      | ATTR.BLINK | ATTR.REVERSE | ATTR.HIDDEN | ATTR.STRIKETHROUGH | ATTR.OVERLINE;
    expect(ATTR_ALL_MASK).toBe(all);
  });

  test('ATTR_UNDERLINE_MASK only covers underline variants', () => {
    expect(ATTR_UNDERLINE_MASK & ~(
      ATTR.UNDERLINE | ATTR.UNDERLINE_2 | ATTR.UNDERLINE_3
      | ATTR.UNDERLINE_4 | ATTR.UNDERLINE_5
    )).toBe(0);
    // None of the non-underline attrs leak in.
    expect(ATTR_UNDERLINE_MASK & ATTR.BOLD).toBe(0);
    expect(ATTR_UNDERLINE_MASK & ATTR.OVERLINE).toBe(0);
  });

  test('FLAG.CONT and FLAG.CLEARED distinct', () => {
    expect(FLAG.CONT).not.toBe(FLAG.CLEARED);
    expect(FLAG.CONT & FLAG.CLEARED).toBe(0);
  });
});

describe('STYLE_EMPTY + styleEqual', () => {
  test('STYLE_EMPTY is frozen with all-null style', () => {
    expect(STYLE_EMPTY.fg).toBeNull();
    expect(STYLE_EMPTY.bg).toBeNull();
    expect(STYLE_EMPTY.bgAlpha).toBe(1);
    expect(STYLE_EMPTY.us).toBeNull();
    expect(STYLE_EMPTY.attrs).toBe(0);
    expect(STYLE_EMPTY.link).toBeNull();
    expect(Object.isFrozen(STYLE_EMPTY)).toBe(true);
  });

  test('styleEqual is structural', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1), attrs: ATTR.BOLD };
    const b: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1), attrs: ATTR.BOLD };
    const c: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(2), attrs: ATTR.BOLD };
    expect(styleEqual(a, b)).toBe(true);
    expect(styleEqual(a, c)).toBe(false);
    expect(styleEqual(STYLE_EMPTY, STYLE_EMPTY)).toBe(true);
  });
});

describe('mergeStyle — Rich Style.__add__ semantics', () => {
  const RED_FG: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1) };
  const BLUE_BG: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(4) };
  const FG_AND_BG: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1), bg: paletteColor(4) };

  test('core case: fg-only over bg-having preserves the parent bg', () => {
    // This is the bg-loss bug: chalk output wraps text in fg only.
    // mergeStyle MUST NOT drop the parent bg when child omits it.
    const base: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(240), bgAlpha: 1 };
    const over: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1) };
    const out = mergeStyle(base, over);
    expect(out.fg).toEqual(paletteColor(1));
    expect(out.bg).toEqual(paletteColor(240));
    expect(out.bgAlpha).toBe(1);
  });

  test('child with bgAlpha=0 leaves parent bg intact (Rich a==0 guard)', () => {
    const base: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(240) };
    const over: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1), bg: paletteColor(2), bgAlpha: 0 };
    const out = mergeStyle(base, over);
    // Even though `over.bg` is non-null, its transparent alpha marks
    // it as "don't override". Base bg wins.
    expect(out.bg).toEqual(paletteColor(240));
    expect(out.bgAlpha).toBe(1);
    expect(out.fg).toEqual(paletteColor(1));
  });

  test('child opaque bg overrides parent bg', () => {
    const out = mergeStyle(BLUE_BG, { ...STYLE_EMPTY, bg: paletteColor(9) });
    expect(out.bg).toEqual(paletteColor(9));
    expect(out.bgAlpha).toBe(1);
  });

  test('child null fg inherits parent fg', () => {
    const out = mergeStyle(RED_FG, { ...STYLE_EMPTY, bg: paletteColor(2) });
    expect(out.fg).toEqual(paletteColor(1));
    expect(out.bg).toEqual(paletteColor(2));
  });

  test('attrs combine additively (bitwise OR)', () => {
    const base: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.BOLD | ATTR.ITALIC };
    const over: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.UNDERLINE | ATTR.BOLD };
    const out = mergeStyle(base, over);
    expect(out.attrs).toBe(ATTR.BOLD | ATTR.ITALIC | ATTR.UNDERLINE);
  });

  test('us inheritance: child null → parent value', () => {
    const base: StructuredStyle = { ...STYLE_EMPTY, us: paletteColor(5) };
    const out = mergeStyle(base, STYLE_EMPTY);
    expect(out.us).toEqual(paletteColor(5));
  });

  test('link inheritance: child null → parent value', () => {
    const base: StructuredStyle = { ...STYLE_EMPTY, link: 'https://x' };
    const out = mergeStyle(base, STYLE_EMPTY);
    expect(out.link).toBe('https://x');
    // Explicit override wins.
    const out2 = mergeStyle(base, { ...STYLE_EMPTY, link: 'https://y' });
    expect(out2.link).toBe('https://y');
  });

  test('STYLE_EMPTY over anything is identity (up to null-coalesce)', () => {
    expect(mergeStyle(FG_AND_BG, STYLE_EMPTY)).toEqual(FG_AND_BG);
  });

  test('anything over STYLE_EMPTY is the overlay itself', () => {
    expect(mergeStyle(STYLE_EMPTY, FG_AND_BG)).toEqual(FG_AND_BG);
  });

  test('returns new object — never mutates inputs', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1) };
    const b: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(2) };
    const _ = mergeStyle(a, b);
    expect(a.bg).toBeNull();
    expect(b.fg).toBeNull();
  });
});

describe('styleToSGR — emit', () => {
  test('STYLE_EMPTY → empty string', () => {
    expect(styleToSGR(STYLE_EMPTY)).toBe('');
  });

  test('fg default → SGR 39', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, fg: COLOR_DEFAULT }))
      .toBe('\x1b[39m');
  });

  test('bg default → SGR 49', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, bg: COLOR_DEFAULT }))
      .toBe('\x1b[49m');
  });

  test('palette fg 0-7 → 3-bit basic (30-37)', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, fg: paletteColor(1) })).toBe('\x1b[31m');
    expect(styleToSGR({ ...STYLE_EMPTY, fg: paletteColor(7) })).toBe('\x1b[37m');
  });

  test('palette fg 8-15 → 3-bit bright (90-97)', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, fg: paletteColor(8) })).toBe('\x1b[90m');
    expect(styleToSGR({ ...STYLE_EMPTY, fg: paletteColor(15) })).toBe('\x1b[97m');
  });

  test('palette fg 16+ → SGR 38;5;n', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, fg: paletteColor(42) }))
      .toBe('\x1b[38;5;42m');
  });

  test('palette bg 0-7 / 8-15 / 16+ follow the same tiered form', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, bg: paletteColor(2) })).toBe('\x1b[42m');
    expect(styleToSGR({ ...STYLE_EMPTY, bg: paletteColor(10) })).toBe('\x1b[102m');
    expect(styleToSGR({ ...STYLE_EMPTY, bg: paletteColor(240) })).toBe('\x1b[48;5;240m');
  });

  test('truecolor bg → SGR 48;2;r;g;b', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, bg: truecolor(10, 20, 30) }))
      .toBe('\x1b[48;2;10;20;30m');
  });

  test('bgAlpha=0 suppresses the bg emit', () => {
    // An explicit but transparent bg should not end up in the ANSI
    // output — caller intent was "don't paint this slot".
    expect(styleToSGR({ ...STYLE_EMPTY, bg: paletteColor(1), bgAlpha: 0 }))
      .toBe('');
  });

  test('attr bold + underline + strikethrough combined (attrs-first order)', () => {
    const out = styleToSGR({
      ...STYLE_EMPTY,
      attrs: ATTR.BOLD | ATTR.UNDERLINE | ATTR.STRIKETHROUGH,
    });
    expect(out).toBe('\x1b[1;4;9m');
  });

  test('attrs emit BEFORE fg — chalk convention `\\x1b[1;31m` preserved', () => {
    // Regression guard for ui-printer.test.ts which relies on this
    // exact byte layout when comparing chalk output.
    const out = styleToSGR({
      ...STYLE_EMPTY,
      fg: paletteColor(1),
      attrs: ATTR.BOLD,
    });
    expect(out).toBe('\x1b[1;31m');
  });

  test('underline variant priority: higher variant wins', () => {
    const out = styleToSGR({
      ...STYLE_EMPTY,
      attrs: ATTR.UNDERLINE | ATTR.UNDERLINE_3 | ATTR.UNDERLINE_5,
    });
    // Expect UNDERLINE_5 (dashed, 4:5) to win.
    expect(out).toBe('\x1b[4:5m');
  });

  test('us default → SGR 59, us truecolor → SGR 58;2;r;g;b', () => {
    expect(styleToSGR({ ...STYLE_EMPTY, us: COLOR_DEFAULT }))
      .toBe('\x1b[59m');
    expect(styleToSGR({ ...STYLE_EMPTY, us: truecolor(1, 2, 3) }))
      .toBe('\x1b[58;2;1;2;3m');
  });

  test('full style emits ordered attrs;fg;bg;us', () => {
    const out = styleToSGR({
      fg: paletteColor(9),       // bright → 91
      bg: truecolor(1, 2, 3),
      bgAlpha: 1,
      us: paletteColor(5),       // basic (us still uses 58;5 — sub-param form)
      attrs: ATTR.BOLD | ATTR.ITALIC,
      link: null,
    });
    // Bold(1) + italic(3) + fg bright(91) + bg truecolor + us 58;5;5.
    expect(out).toBe('\x1b[1;3;91;48;2;1;2;3;58;5;5m');
  });
});

describe('sgrToStyle — parse', () => {
  test('empty string → STYLE_EMPTY', () => {
    expect(sgrToStyle('')).toEqual(STYLE_EMPTY);
  });

  test('plain reset (SGR 0) → STYLE_EMPTY', () => {
    expect(sgrToStyle('\x1b[0m')).toEqual(STYLE_EMPTY);
  });

  test('bare SGR m (empty body) → STYLE_EMPTY', () => {
    expect(sgrToStyle('\x1b[m')).toEqual(STYLE_EMPTY);
  });

  test('truecolor fg (chalk.hex style)', () => {
    expect(sgrToStyle('\x1b[38;2;10;20;30m').fg).toEqual(truecolor(10, 20, 30));
  });

  test('palette bg', () => {
    const s = sgrToStyle('\x1b[48;5;17m');
    expect(s.bg).toEqual(paletteColor(17));
    expect(s.bgAlpha).toBe(1);
  });

  test('3-bit basic fg (30-37) → palette 0-7', () => {
    for (let i = 0; i < 8; i++) {
      expect(sgrToStyle(`\x1b[${30 + i}m`).fg).toEqual(paletteColor(i));
    }
  });

  test('3-bit bright fg (90-97) → palette 8-15', () => {
    for (let i = 0; i < 8; i++) {
      expect(sgrToStyle(`\x1b[${90 + i}m`).fg).toEqual(paletteColor(8 + i));
    }
  });

  test('3-bit basic bg (40-47) → palette 0-7', () => {
    for (let i = 0; i < 8; i++) {
      expect(sgrToStyle(`\x1b[${40 + i}m`).bg).toEqual(paletteColor(i));
    }
  });

  test('SGR 39 / 49 / 59 reset to null slots', () => {
    // Start populated, then reset each slot individually.
    const full = sgrToStyle('\x1b[38;5;1;48;5;2;58;5;3m');
    expect(full.fg).not.toBeNull();
    expect(full.bg).not.toBeNull();
    expect(full.us).not.toBeNull();
    const fgReset = sgrToStyle('\x1b[38;5;1;48;5;2;58;5;3;39m');
    expect(fgReset.fg).toBeNull();
    expect(fgReset.bg).not.toBeNull();
    const bgReset = sgrToStyle('\x1b[38;5;1;48;5;2;58;5;3;49m');
    expect(bgReset.bg).toBeNull();
    const usReset = sgrToStyle('\x1b[38;5;1;48;5;2;58;5;3;59m');
    expect(usReset.us).toBeNull();
  });

  test('bold + italic via SGR 1 and 3', () => {
    const s = sgrToStyle('\x1b[1;3m');
    expect(s.attrs & ATTR.BOLD).toBeTruthy();
    expect(s.attrs & ATTR.ITALIC).toBeTruthy();
  });

  test('underline sub-param form 4:2 / 4:3 / 4:5', () => {
    expect(sgrToStyle('\x1b[4:2m').attrs & ATTR.UNDERLINE_2).toBeTruthy();
    expect(sgrToStyle('\x1b[4:3m').attrs & ATTR.UNDERLINE_3).toBeTruthy();
    expect(sgrToStyle('\x1b[4:5m').attrs & ATTR.UNDERLINE_5).toBeTruthy();
    // Non-underline bits stay clear.
    expect(sgrToStyle('\x1b[4:3m').attrs & ATTR.BOLD).toBe(0);
  });

  test('sequential SGRs accumulate until a reset', () => {
    // chalk.red(chalk.bold('x')) emits `\x1b[1m\x1b[31m...\x1b[39m\x1b[22m`.
    // Accumulation across runs should match.
    const s = sgrToStyle('\x1b[1m\x1b[31m');
    expect(s.attrs & ATTR.BOLD).toBeTruthy();
    expect(s.fg).toEqual(paletteColor(1));
  });

  test('reset in the middle clears prior state', () => {
    const s = sgrToStyle('\x1b[38;2;1;2;3m\x1b[0m\x1b[48;5;5m');
    expect(s.fg).toBeNull();
    expect(s.bg).toEqual(paletteColor(5));
  });

  test('unknown SGR codes are dropped silently (no throw)', () => {
    expect(() => sgrToStyle('\x1b[999;111m')).not.toThrow();
    expect(sgrToStyle('\x1b[999m')).toEqual(STYLE_EMPTY);
  });

  test('non-SGR bytes around the sequence are ignored', () => {
    const s = sgrToStyle('hello\x1b[1mworld');
    expect(s.attrs & ATTR.BOLD).toBeTruthy();
  });
});

describe('styleToSGR ↔ sgrToStyle round-trip', () => {
  test('round-trip preserves truecolor fg', () => {
    const s: StructuredStyle = { ...STYLE_EMPTY, fg: truecolor(100, 150, 200) };
    expect(sgrToStyle(styleToSGR(s)).fg).toEqual(s.fg);
  });

  test('round-trip preserves palette bg + bold', () => {
    const s: StructuredStyle = {
      ...STYLE_EMPTY,
      bg: paletteColor(17),
      attrs: ATTR.BOLD,
    };
    const rt = sgrToStyle(styleToSGR(s));
    expect(rt.bg).toEqual(s.bg);
    expect(rt.attrs & ATTR.BOLD).toBeTruthy();
  });

  test('round-trip preserves underline variant', () => {
    const s: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.UNDERLINE_3 };
    const rt = sgrToStyle(styleToSGR(s));
    // Emit picks highest-priority variant; our input is single-bit so
    // exact same bit should survive.
    expect(rt.attrs & ATTR.UNDERLINE_3).toBeTruthy();
    expect(rt.attrs & ~ATTR.UNDERLINE_3 & ATTR_UNDERLINE_MASK).toBe(0);
  });

  test('round-trip preserves full style', () => {
    const s: StructuredStyle = {
      fg: paletteColor(9),
      bg: truecolor(1, 2, 3),
      bgAlpha: 1,
      us: paletteColor(5),
      attrs: ATTR.BOLD | ATTR.ITALIC | ATTR.UNDERLINE,
      link: null,
    };
    const rt = sgrToStyle(styleToSGR(s));
    expect(rt.fg).toEqual(s.fg);
    expect(rt.bg).toEqual(s.bg);
    expect(rt.us).toEqual(s.us);
    expect(rt.attrs).toBe(s.attrs);
  });

  test('bgAlpha=0 + bg color is suppressed in emit → round-trip loses bg', () => {
    // Documented behaviour: alpha-transparent bg doesn't survive the
    // wire. If callers need to round-trip the alpha bit they must
    // encode it out-of-band.
    const s: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(1), bgAlpha: 0 };
    const rt = sgrToStyle(styleToSGR(s));
    expect(rt.bg).toBeNull();
  });
});

describe('emitStyleDiff — minimal SGR delta', () => {
  test('no change → empty string', () => {
    expect(emitStyleDiff(STYLE_EMPTY, STYLE_EMPTY)).toBe('');
  });

  test('adding fg from empty → just the fg SGR (basic palette form)', () => {
    const out = emitStyleDiff(STYLE_EMPTY, { ...STYLE_EMPTY, fg: paletteColor(2) });
    expect(out).toBe('\x1b[32m');
  });

  test('changing only fg emits just the fg delta', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1), bg: paletteColor(240) };
    const b: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(2), bg: paletteColor(240) };
    const out = emitStyleDiff(a, b);
    expect(out).toBe('\x1b[32m');
    // bg (unchanged) is NOT re-emitted.
    expect(out).not.toContain('48;5;240');
  });

  test('adding attribute without removing any → additive delta (no reset)', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.BOLD };
    const b: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.BOLD | ATTR.ITALIC };
    const out = emitStyleDiff(a, b);
    expect(out).toBe('\x1b[3m');
    // No reset — BOLD is still set.
    expect(out).not.toContain('\x1b[0m');
  });

  test('removing an attribute forces reset + full re-emit (tmux smart-reset)', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.BOLD | ATTR.ITALIC };
    const b: StructuredStyle = { ...STYLE_EMPTY, attrs: ATTR.BOLD };
    const out = emitStyleDiff(a, b);
    // Reset + full next state.
    expect(out.startsWith('\x1b[0m')).toBe(true);
    expect(out).toContain('\x1b[1m'); // re-emit BOLD
    expect(out).not.toContain('\x1b[3m'); // ITALIC not re-emitted
  });

  test('reset when going to STYLE_EMPTY from a styled state', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, fg: paletteColor(1), attrs: ATTR.BOLD };
    const out = emitStyleDiff(a, STYLE_EMPTY);
    expect(out).toBe('\x1b[0m');
  });

  test('bg alpha toggle from opaque → transparent clears the bg', () => {
    const a: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(1), bgAlpha: 1 };
    const b: StructuredStyle = { ...STYLE_EMPTY, bg: paletteColor(1), bgAlpha: 0 };
    const out = emitStyleDiff(a, b);
    // Active→inactive transition emits SGR 49 (bg default).
    expect(out).toBe('\x1b[49m');
  });
});

describe('Cell helpers', () => {
  test('EMPTY_CELL is frozen with empty char + STYLE_EMPTY', () => {
    expect(EMPTY_CELL.char).toBe('');
    expect(EMPTY_CELL.style).toBe(STYLE_EMPTY);
    expect(EMPTY_CELL.flags).toBe(FLAG.NONE);
    expect(Object.isFrozen(EMPTY_CELL)).toBe(true);
  });

  test('isCont / isCleared bitmask readers', () => {
    const plain: Cell = { char: 'x', width: 1, style: STYLE_EMPTY, flags: FLAG.NONE };
    expect(isCont(plain)).toBe(false);
    expect(isCleared(plain)).toBe(false);

    const cont: Cell = { char: '', width: 0, style: STYLE_EMPTY, flags: FLAG.CONT };
    expect(isCont(cont)).toBe(true);
    expect(isCleared(cont)).toBe(false);

    const both: Cell = {
      char: ' ', width: 1, style: STYLE_EMPTY, flags: FLAG.CONT | FLAG.CLEARED,
    };
    expect(isCont(both)).toBe(true);
    expect(isCleared(both)).toBe(true);
  });
});
