// Inline markdown renderer (applyInlineStyles via renderMarkdown).
//
// Covers the features ported from the telegram formatter: underscore
// bold/italic variants and bare file-reference highlighting. The
// existing asterisk / backtick / tilde paths get a baseline pass too
// so a regression in one wouldn't hide behind the ported work.
//
// `stripAnsi` lets us assert the PLAIN payload that lands in the
// user's clipboard when they select+copy — that's the "what does the
// user actually see vs. what do they paste" invariant the user
// flagged: display gains ANSI styling, copy gets raw.

import { describe, it, expect, beforeAll } from 'bun:test';
import chalk from 'chalk';
import { renderMarkdown } from '../src/render.js';
import { stripAnsi } from '../src/tui.js';

// bun test runs with chalk.level=0 by default (non-TTY), which makes
// every chalk.x(…) call return raw text — that defeats any check for
// "was styling applied?". Force level=1 so chalk emits SGR codes we
// can assert on; stripAnsi round-trip still validates the clipboard
// invariant (display = styled, copy = raw).
beforeAll(() => { chalk.level = 1; });

describe('renderMarkdown — underscore variants', () => {
  it('renders __bold__ the same as **bold**', () => {
    const a = renderMarkdown('__hi__');
    const b = renderMarkdown('**hi**');
    expect(stripAnsi(a)).toBe('hi');
    expect(stripAnsi(b)).toBe('hi');
    expect(a).toContain('\x1b[1m'); // chalk.bold
    expect(b).toContain('\x1b[1m');
  });

  it('renders _italic_ the same as *italic*', () => {
    const a = renderMarkdown('_hi_');
    const b = renderMarkdown('*hi*');
    expect(stripAnsi(a)).toBe('hi');
    expect(stripAnsi(b)).toBe('hi');
    expect(a).toContain('\x1b[3m'); // chalk.italic
    expect(b).toContain('\x1b[3m');
  });

  it('leaves identifiers like foo_bar_baz alone', () => {
    const out = renderMarkdown('call foo_bar_baz here');
    expect(stripAnsi(out)).toBe('call foo_bar_baz here');
    // No italic SGR applied — identifiers with underscores are safe.
    expect(out).not.toContain('\x1b[3m');
  });
});

describe('renderMarkdown — file-reference highlighting', () => {
  it('styles a bare filename with known extension', () => {
    const out = renderMarkdown('see README.md for details');
    expect(stripAnsi(out)).toBe('see README.md for details');
    // Styling was applied (some SGR escape inside the string).
    expect(out).toMatch(/\x1b\[/);
  });

  it('styles a path-shaped filename', () => {
    const out = renderMarkdown('edit src/server.ts please');
    expect(stripAnsi(out)).toBe('edit src/server.ts please');
    expect(out).toMatch(/\x1b\[/);
  });

  it('does NOT style TLD-like extensions (vercel.io, x.ai)', () => {
    const a = renderMarkdown('hosted at vercel.io');
    const b = renderMarkdown('built by x.ai');
    // No SGR anywhere — the plain sentences are byte-identical.
    expect(a).toBe('hosted at vercel.io');
    expect(b).toBe('built by x.ai');
  });

  it('does NOT double-style filenames already in backticks', () => {
    const out = renderMarkdown('use `src/foo.ts` here');
    expect(stripAnsi(out)).toBe('use src/foo.ts here');
    // Inline code stash runs before file-ref pass, so we should see
    // one styled run around the filename — not nested SGR layers.
    // Count open SGR codes: `use `, then one styled span, then ` here`.
    const sgrs = out.match(/\x1b\[\d+(;\d+;\d+)?m/g) ?? [];
    // Bounded — filename span opens + closes at most twice, not N×2.
    expect(sgrs.length).toBeLessThanOrEqual(4);
  });

  it('preserves the leading boundary char', () => {
    const out = renderMarkdown('(see foo.py)');
    expect(stripAnsi(out)).toBe('(see foo.py)');
  });

  it('copy-invariant: stripped output equals the raw markdown minus syntax markers', () => {
    // User explicitly flagged this: display gets ANSI, copy/paste
    // produces the raw glyphs (no `<code>` tags, no SGR, no
    // file-ref backtick noise added by our renderer).
    const md = 'edit src/server.ts and update **foo** — see README.md';
    const out = renderMarkdown(md);
    expect(stripAnsi(out)).toBe('edit src/server.ts and update foo — see README.md');
  });
});

describe('renderMarkdown — table (sprint 5C box-drawing)', () => {
  // ASCII pipe/dash output left visible gaps between cells. Sprint 5C
  // (2026-04-28) switched the markdown table renderer to Unicode box-
  // drawing characters so the strokes are continuous.
  function renderTable(md: string): string {
    return stripAnsi(renderMarkdown(md));
  }

  it('emits ┌┬┐ top, ├┼┤ middle, └┴┘ bottom borders', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const out = renderTable(md);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^┌─+┬─+┐$/);
    expect(lines[2]).toMatch(/^├─+┼─+┤$/);
    expect(lines[4]).toMatch(/^└─+┴─+┘$/);
  });

  it('uses │ as the vertical gutter, not the ASCII | pipe', () => {
    const md = '| col |\n|---|\n| x |';
    const out = renderTable(md);
    // Every non-border row starts and ends with the box-drawing │.
    const dataRow = out.split('\n').find((l) => l.includes('x'))!;
    expect(dataRow.startsWith('│')).toBe(true);
    expect(dataRow.endsWith('│')).toBe(true);
    // Make sure no stray ASCII pipes leak from the renderer body.
    expect(dataRow.includes('|')).toBe(false);
  });

  it('top / middle / bottom borders all share the same column boundaries', () => {
    // The 3 borders must agree on where the junctions land — otherwise
    // the strokes would look misaligned and the "continuous box" goal
    // breaks down.
    const md = '| number | name | year |\n|---|---|---|\n| 1 | A | 2025 |\n| 2 | B | 2026 |';
    const out = renderTable(md);
    const lines = out.split('\n');
    const top = lines[0]!;
    const mid = lines[2]!;
    const bot = lines[lines.length - 1]!;
    // Same length + same junction columns for every border.
    expect(top.length).toBe(mid.length);
    expect(mid.length).toBe(bot.length);
    const findJunctions = (s: string, ch: string) =>
      [...s].map((c, i) => (c === ch ? i : -1)).filter((i) => i !== -1);
    expect(findJunctions(top, '┬')).toEqual(findJunctions(mid, '┼'));
    expect(findJunctions(mid, '┼')).toEqual(findJunctions(bot, '┴'));
  });

  it('CJK headers + bodies still align (visibleWidth handles double-width cells)', () => {
    // Korean strings are double-width — the column width math has to
    // account for that or the bottom border lands shifted from the
    // header cells, leaving the gap the user originally complained about.
    const md = '| 번호 | 왕 | 재위 기간 |\n|---|---|---|\n| 1 | 태조 | 1392-1398 |';
    const out = renderTable(md);
    const lines = out.split('\n');
    expect(lines[0]!.length).toBe(lines[2]!.length);
    expect(lines[0]!.length).toBe(lines[lines.length - 1]!.length);
  });
});
