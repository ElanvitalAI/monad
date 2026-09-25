// WT-C-2 — screenshot LLM tool.
//
// SVG generator + sharp PNG conversion. Tests focus on:
//   - SVG shape (svg root, embedded font-family, viewBox dims)
//   - cell-grid lookup (no overrun, blank rows OK)
//   - args validation (sessionId / terminalId required)
//   - dispatch error path (unknown terminal)
// PNG conversion is exercised through dispatchWebTerminalScreenshot
// since it composes loadSharp + svgToPngBuffer.

import { describe, expect, test } from 'bun:test';

import {
  buildWebTerminalScreenshotTool,
  dispatchWebTerminalScreenshot,
  renderTerminalSvg,
  svgToPngBuffer,
} from '../../src/tool-runtime/web-terminal-screenshot.js';

// Minimal terminal-like fake — just enough for renderTerminalSvg to
// walk a tiny grid. Cells return a getChars + width but no SGR, so the
// SVG falls back to the canvas <rect> + default-fg <text>.
function fakeTerm(text: string[]): import('../../src/tool-runtime/web-terminal-screenshot.js') extends infer _T ? unknown : never {
  const rows = text.length;
  const cols = Math.max(...text.map((l) => l.length));

  function makeCellRef(): unknown {
    let cur = ' ';
    return {
      getChars: () => cur,
      getWidth: () => 1,
      isFgRGB: () => false,
      isFgPalette: () => false,
      isBgRGB: () => false,
      isBgPalette: () => false,
      isBold: () => 0,
      isDim: () => 0,
      isItalic: () => 0,
      isUnderline: () => 0,
      isBlink: () => 0,
      isInverse: () => 0,
      isInvisible: () => 0,
      isStrikethrough: () => 0,
      _setChar: (c: string): void => { cur = c; },
    };
  }

  function getLine(y: number): unknown {
    const line = text[y] ?? '';
    return {
      getCell(x: number, ref: unknown): unknown {
        const c = line[x] ?? ' ';
        const r = ref as ReturnType<typeof makeCellRef>;
        r._setChar(c);
        return r;
      },
    };
  }

  return {
    cols,
    rows,
    buffer: {
      active: {
        viewportY: 0,
        cursorX: -1,
        cursorY: -1,
        getNullCell: () => makeCellRef(),
        getLine,
      },
    },
  } as unknown;
}

describe('renderTerminalSvg', () => {
  test('emits self-contained SVG with viewBox and font-family', () => {
    const term = fakeTerm(['hello', 'world']) as Parameters<typeof renderTerminalSvg>[0];
    const out = renderTerminalSvg(term);
    expect(out.cols).toBe(5);
    expect(out.rows).toBe(2);
    expect(out.svg).toMatch(/^<svg /);
    expect(out.svg).toContain('viewBox="0 0 ');
    expect(out.svg).toContain('JetBrainsMono Nerd Font');
    // Default scale = 2 → 8*2=16 px per col, 16*2=32 px per row.
    expect(out.width).toBe(5 * 16);
    expect(out.height).toBe(2 * 32);
  });

  test('respects scale option', () => {
    const term = fakeTerm(['x']) as Parameters<typeof renderTerminalSvg>[0];
    const small = renderTerminalSvg(term, { scale: 1 });
    const big = renderTerminalSvg(term, { scale: 3 });
    expect(small.width).toBe(8);
    expect(big.width).toBe(24);
  });

  test('escapes XML-special chars in glyphs', () => {
    const term = fakeTerm(['<&>']) as Parameters<typeof renderTerminalSvg>[0];
    const { svg } = renderTerminalSvg(term);
    // Should not contain literal `<` from glyph (only structural).
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&gt;');
  });
});

describe('svgToPngBuffer', () => {
  test('produces a valid PNG buffer (PNG magic prefix)', async () => {
    const tinySvg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#000"/></svg>';
    const png = await svgToPngBuffer(tinySvg);
    expect(png.length).toBeGreaterThan(50);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });
});

describe('buildWebTerminalScreenshotTool', () => {
  // Image-pipeline followup #1 (2026-05-05) — sessionId no longer
  // in `required`; daemon-tools wrapper auto-injects from ctx.
  test('spec: only terminalId required, sessionId optional, scale default = 2', () => {
    const tool = buildWebTerminalScreenshotTool();
    expect(tool.name).toBe('WebTerminalScreenshot');
    const params = tool.parameters as {
      required?: string[];
      properties?: Record<string, { default?: number }>;
    };
    expect(params.required).toEqual(['terminalId']);
    // sessionId still listed in properties so explicit override works.
    expect(params.properties?.sessionId).toBeDefined();
    expect(params.properties?.scale?.default).toBe(2);
  });
});

describe('dispatchWebTerminalScreenshot', () => {
  test('rejects when neither args.sessionId nor opts.sessionId present', async () => {
    await expect(dispatchWebTerminalScreenshot({})).rejects.toThrow(/sessionId required/);
  });

  test('rejects when terminalId missing', async () => {
    await expect(
      dispatchWebTerminalScreenshot({ sessionId: 'sess-1' }),
    ).rejects.toThrow(/terminalId required/);
  });

  test('rejects unknown terminal', async () => {
    await expect(
      dispatchWebTerminalScreenshot({ sessionId: 'sess-no-such', terminalId: 'no-such' }),
    ).rejects.toThrow(/unknown terminal/);
  });

  test('opts.sessionId fills in when args.sessionId missing — error path proves resolution', async () => {
    // No terminal registered for sess-from-ctx, so we hit the "unknown
    // terminal" branch — proves the sessionId resolved via opts.
    await expect(
      dispatchWebTerminalScreenshot({ terminalId: 'preview-1' }, { sessionId: 'sess-from-ctx' }),
    ).rejects.toThrow(/unknown terminal/);
  });
});
