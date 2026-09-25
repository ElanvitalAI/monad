// ── Presentation P4a · renderChrome ──

import { describe, test, expect } from 'bun:test';
import {
  BoxDecoration,
  BorderSpec,
  BorderRadius,
  EdgeInsets,
  BoxShadow,
} from '../../../src/ui/attributes/index.js';
import { renderChrome } from '../../../src/ui/chrome/renderer.js';
import { DEFAULT_THEME_TOKENS } from '../../../src/theme/tokens.js';

const theme = DEFAULT_THEME_TOKENS;

// Strip ANSI for dimension / glyph assertions. `visibleWidth` is
// overkill for test-only strip — a simple regex is fine here.
function strip(s: string): string {
  return s.replace(/\u001b\[[^m]*m/g, '');
}

describe('renderChrome · dimensions', () => {
  test('empty width or height yields empty array', () => {
    const empty1 = renderChrome({ width: 0, height: 5, decoration: new BoxDecoration(), theme });
    expect(empty1).toEqual([]);
    const empty2 = renderChrome({ width: 5, height: 0, decoration: new BoxDecoration(), theme });
    expect(empty2).toEqual([]);
  });

  test('no border · blank decoration · returns `height` blank rows', () => {
    const rows = renderChrome({
      width: 10,
      height: 3,
      decoration: new BoxDecoration(),
      theme,
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(strip(r)).toBe(' '.repeat(10));
  });

  test('full border · dimensions preserved', () => {
    const rows = renderChrome({
      width: 10,
      height: 4,
      decoration: new BoxDecoration({ border: BorderSpec.all({ color: 'text', width: 1 }) }),
      theme,
    });
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(strip(r).length).toBe(10);
  });
});

describe('renderChrome · border glyph families', () => {
  test('unicode family uses ┌─└┘ by default', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({ border: BorderSpec.all({ color: 'text' }) }),
      theme,
    });
    const stripped = rows.map(strip);
    expect(stripped[0]).toMatch(/^┌─+┐$/);
    expect(stripped[2]).toMatch(/^└─+┘$/);
    expect(stripped[1]?.startsWith('│')).toBe(true);
    expect(stripped[1]?.endsWith('│')).toBe(true);
  });

  test('ascii family swaps to +-|', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({ border: BorderSpec.all({ color: 'text' }) }),
      theme,
      glyphFamily: 'ascii',
    });
    const stripped = rows.map(strip);
    expect(stripped[0]).toMatch(/^\+-+\+$/);
    expect(stripped[2]).toMatch(/^\+-+\+$/);
    expect(stripped[1]?.[0]).toBe('|');
    expect(stripped[1]?.[stripped[1]!.length - 1]).toBe('|');
  });

  test('rounded family uses ╭─╮╰╯', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({ border: BorderSpec.all({ color: 'text' }) }),
      theme,
      glyphFamily: 'rounded',
    });
    const stripped = rows.map(strip);
    expect(stripped[0]?.startsWith('╭')).toBe(true);
    expect(stripped[0]?.endsWith('╮')).toBe(true);
    expect(stripped[2]?.startsWith('╰')).toBe(true);
    expect(stripped[2]?.endsWith('╯')).toBe(true);
  });

  test('borderRadius non-zero forces rounded corner glyphs even on unicode family', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        borderRadius: BorderRadius.circular(1),
      }),
      theme,
      glyphFamily: 'unicode',
    });
    const stripped = rows.map(strip);
    expect(stripped[0]?.startsWith('╭')).toBe(true);
    expect(stripped[2]?.endsWith('╯')).toBe(true);
  });
});

describe('renderChrome · border styles', () => {
  test('double style uses ═║╔╗╚╝', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text', style: 'double' }),
      }),
      theme,
    });
    const stripped = rows.map(strip);
    expect(stripped[0]).toMatch(/^╔═+╗$/);
    expect(stripped[2]).toMatch(/^╚═+╝$/);
    expect(stripped[1]?.[0]).toBe('║');
  });

  test('dashed style swaps horizontal glyph', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text', style: 'dashed' }),
      }),
      theme,
    });
    const stripped = rows.map(strip);
    expect(stripped[0]).toContain('╌');
  });

  test('none style produces blank chrome rows', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text', style: 'none' }),
      }),
      theme,
    });
    const stripped = rows.map(strip);
    for (const r of stripped) expect(r).toBe('    ');
  });
});

describe('renderChrome · padding + body', () => {
  test('padding shrinks usable inner area', () => {
    const rows = renderChrome({
      width: 8,
      height: 5,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        padding: EdgeInsets.all(1),
      }),
      body: ['xxxx'],
      theme,
    });
    // border + padding on top · 1 content row · padding + border on bottom
    expect(rows).toHaveLength(5);
    const middle = strip(rows[2] ?? '');
    // middle row has 1 border left + 1 pad + content + 1 pad + 1 border right
    expect(middle.length).toBe(8);
    expect(middle).toContain('xxxx');
  });

  test('body lines fewer than inner height · tail rows blank', () => {
    const rows = renderChrome({
      width: 6,
      height: 5,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
      }),
      body: ['aaaa'],
      theme,
    });
    const middle = rows.slice(1, -1).map(strip);
    expect(middle[0]).toContain('aaaa');
    // Filler row keeps the verticals · inner content is blank between them.
    expect(middle[1]?.slice(1, -1).trim()).toBe('');
    expect(middle[1]?.startsWith('│')).toBe(true);
    expect(middle[1]?.endsWith('│')).toBe(true);
  });
});

describe('renderChrome · shadow layer', () => {
  test('dy > 0 appends a trailing half-block row', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        boxShadow: [new BoxShadow({ offset: { dx: 0, dy: 1 }, color: 'text' })],
      }),
      theme,
    });
    // height(3) + shadow row = 4 rows
    expect(rows).toHaveLength(4);
    expect(strip(rows[3] ?? '')).toMatch(/^▀+$/);
  });

  test('dx > 0 appends a trailing column to every row', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
        boxShadow: [new BoxShadow({ offset: { dx: 1, dy: 0 }, color: 'text' })],
      }),
      theme,
    });
    for (const r of rows) expect(strip(r)).toMatch(/▌$/);
  });

  test('no shadow when boxShadow omitted', () => {
    const rows = renderChrome({
      width: 4,
      height: 3,
      decoration: new BoxDecoration({
        border: BorderSpec.all({ color: 'text' }),
      }),
      theme,
    });
    expect(rows).toHaveLength(3);
  });
});
