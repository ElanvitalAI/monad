// ── Presentation P4c · modal-adapter decoration full render ──
//
// Unit-level tests for the pure helpers exported alongside
// mountViewAsModalSurface — computeInnerDims, hasRenderableChrome, and
// composeDecorationFrame. These give us high confidence the framing
// math is correct without booting a full mount + paint cycle.

import { describe, test, expect } from 'bun:test';
import {
  hasRenderableChrome,
  computeInnerDims,
  composeDecorationFrame,
} from '../src/ui/modal-adapter.js';
import {
  BoxDecoration,
  BorderSpec,
  BorderRadius,
  EdgeInsets,
  BoxShadow,
} from '../src/ui/attributes/index.js';
import { DEFAULT_THEME_TOKENS } from '../src/theme/tokens.js';

const theme = DEFAULT_THEME_TOKENS;

function strip(s: string): string {
  return s.replace(/\u001b\[[^m]*m/g, '');
}

describe('hasRenderableChrome', () => {
  test('undefined / null → false', () => {
    expect(hasRenderableChrome(undefined)).toBe(false);
    expect(hasRenderableChrome(null)).toBe(false);
  });

  test('empty decoration → false', () => {
    expect(hasRenderableChrome(new BoxDecoration())).toBe(false);
  });

  test('boxShadow alone → false (handled by P4b shim path)', () => {
    const d = new BoxDecoration({
      boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 1 } })],
    });
    expect(hasRenderableChrome(d)).toBe(false);
  });

  test('border present → true', () => {
    const d = new BoxDecoration({ border: BorderSpec.all({ color: 'text' }) });
    expect(hasRenderableChrome(d)).toBe(true);
  });

  test('padding present → true', () => {
    const d = new BoxDecoration({ padding: EdgeInsets.all(1) });
    expect(hasRenderableChrome(d)).toBe(true);
  });

  test('color present → true', () => {
    const d = new BoxDecoration({ color: 'surface' });
    expect(hasRenderableChrome(d)).toBe(true);
  });
});

describe('computeInnerDims', () => {
  const outer = { row: 1, col: 1, width: 20, height: 10 } as const;

  test('no chrome → inner equals outer · offsets 0', () => {
    const inner = computeInnerDims(outer, undefined);
    expect(inner.width).toBe(20);
    expect(inner.height).toBe(10);
    expect(inner.offsetRow).toBe(0);
    expect(inner.offsetCol).toBe(0);
  });

  test('full border shrinks inner by 2 in each dim · offset 1,1', () => {
    const d = new BoxDecoration({ border: BorderSpec.all({ color: 'text' }) });
    const inner = computeInnerDims(outer, d);
    expect(inner.width).toBe(18);
    expect(inner.height).toBe(8);
    expect(inner.offsetRow).toBe(1);
    expect(inner.offsetCol).toBe(1);
  });

  test('padding shrinks and offsets accordingly', () => {
    const d = new BoxDecoration({
      padding: EdgeInsets.only({ top: 2, left: 3, right: 1, bottom: 1 }),
    });
    const inner = computeInnerDims(outer, d);
    expect(inner.width).toBe(20 - 3 - 1);
    expect(inner.height).toBe(10 - 2 - 1);
    expect(inner.offsetRow).toBe(2);
    expect(inner.offsetCol).toBe(3);
  });

  test('border + padding compose', () => {
    const d = new BoxDecoration({
      border: BorderSpec.all({ color: 'text' }),
      padding: EdgeInsets.all(1),
    });
    const inner = computeInnerDims(outer, d);
    // border 1 + pad 1 on each side
    expect(inner.width).toBe(20 - 2 - 2);
    expect(inner.height).toBe(10 - 2 - 2);
    expect(inner.offsetRow).toBe(2);
    expect(inner.offsetCol).toBe(2);
  });
});

describe('composeDecorationFrame · border glyphs', () => {
  test('full unicode border · corners + sides glyphs in place', () => {
    const rows = composeDecorationFrame({
      viewLines: ['aaa'],
      outerWidth: 5,
      decoration: new BoxDecoration({ border: BorderSpec.all({ color: 'text' }) }),
      theme,
    });
    expect(rows).toHaveLength(3);
    const stripped = rows.map(strip);
    expect(stripped[0]).toBe('┌───┐');
    expect(stripped[1]).toBe('│aaa│');
    expect(stripped[2]).toBe('└───┘');
  });

  test('borderRadius > 0 uses rounded corner glyphs', () => {
    const rows = composeDecorationFrame({
      viewLines: ['bbb'],
      outerWidth: 5,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        borderRadius: BorderRadius.circular(1),
      }),
      theme,
    });
    const s = rows.map(strip);
    expect(s[0]).toBe('╭───╮');
    expect(s[2]).toBe('╰───╯');
  });

  test('double style uses double-line glyphs', () => {
    const rows = composeDecorationFrame({
      viewLines: ['ccc'],
      outerWidth: 5,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text', style: 'double' }),
      }),
      theme,
    });
    const s = rows.map(strip);
    expect(s[0]).toBe('╔═══╗');
    expect(s[1]).toBe('║ccc║');
    expect(s[2]).toBe('╚═══╝');
  });
});

describe('composeDecorationFrame · padding', () => {
  test('padding rows inserted between border and view · filler spaces', () => {
    const rows = composeDecorationFrame({
      viewLines: ['x'],
      outerWidth: 5,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        padding: EdgeInsets.symmetric({ horizontal: 1, vertical: 1 }),
      }),
      theme,
    });
    // 1 top border + 1 top pad + 1 body + 1 bottom pad + 1 bottom border = 5
    expect(rows).toHaveLength(5);
    const s = rows.map(strip);
    expect(s[0]).toBe('┌───┐');
    expect(s[1]).toBe('│   │'); // top pad row · all spaces
    expect(s[2]).toBe('│ x │'); // body · left pad + view + right pad
    expect(s[3]).toBe('│   │'); // bottom pad
    expect(s[4]).toBe('└───┘');
  });
});

describe('composeDecorationFrame · partial border', () => {
  test('only left border · right side is plain · width still matches', () => {
    const rows = composeDecorationFrame({
      viewLines: ['xy'],
      outerWidth: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.only({ left: { color: 'text', width: 1 } }),
      }),
      theme,
    });
    // No top/bottom border · only left vertical on the single body row
    expect(rows).toHaveLength(1);
    expect(strip(rows[0]!)).toBe('│xy');
  });

  test('only top border · no verticals · view row preserved', () => {
    const rows = composeDecorationFrame({
      viewLines: ['zz'],
      outerWidth: 2,
      decoration: new BoxDecoration({
        border: BorderSpec.only({ top: { color: 'text', width: 1 } }),
      }),
      theme,
    });
    expect(rows).toHaveLength(2);
    expect(strip(rows[0]!)).toBe('──');
    expect(strip(rows[1]!)).toBe('zz');
  });
});

describe('composeDecorationFrame · color tinting', () => {
  test('border color emits ANSI · glyphs wrapped', () => {
    const rows = composeDecorationFrame({
      viewLines: ['a'],
      outerWidth: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'border.focused' }),
      }),
      theme,
    });
    // Border rows contain ANSI escape sequences
    expect(rows[0]).toMatch(/\u001b\[/);
    expect(rows[2]).toMatch(/\u001b\[/);
  });

  test('decoration.color fills padding cells with tinted spaces', () => {
    const rows = composeDecorationFrame({
      viewLines: [''],
      outerWidth: 4,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        color: 'surface',
        padding: EdgeInsets.symmetric({ horizontal: 1 }),
      }),
      theme,
    });
    // Body row has ANSI somewhere inside (fill cells tinted) even though
    // the view output itself was empty.
    expect(rows[1]).toMatch(/\u001b\[/);
  });
});
