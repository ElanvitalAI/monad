// PR-Δ25d (Sprint 18 · 2026-04-30) — markdown renderer mono emphasis.
//
// Δ25 (#1024) introduced `keepAttrsInMono` on status-module + picker.
// The markdown renderer (13 .render() callsites · highest-visibility
// surface — chat output, agent message stream, ?-key help body) was
// intentionally split out: Δ25 stayed bounded, Δ25d ships the same
// pattern across heading / quote / list / inline (bold / italic /
// strike / link / code) so NO_COLOR / pipe / CI environments keep
// markdown's visual hierarchy.
//
// Default off preserves the legacy mono = zero-CSI contract that
// expression-mono-fallback.test.ts asserts on the markdown body.

import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '../src/expression/renderer/markdown.js';
import type { MarkdownSpec } from '../src/expression/spec/types.js';

const SGR_BOLD = '\x1b[1m';
const SGR_FAINT = '\x1b[2m';
const SGR_ITALIC = '\x1b[3m';
const SGR_UNDERLINE = '\x1b[4m';
const SGR_STRIKE = '\x1b[9m';
const SGR_RESET = '\x1b[0m';

const md = (body: string, title?: string): MarkdownSpec => ({
  kind: 'markdown',
  body,
  ...(title ? { title } : {}),
});

describe('Δ25d · markdown mono emphasis (default off)', () => {
  test('mono profile + default opts: heading / bold / italic strip all SGR', () => {
    const out = renderMarkdown(
      md('# Heading\n\n**bold** and *italic* and ~~strike~~'),
      'mono',
    );
    // Visible glyphs preserved.
    expect(out).toContain('Heading');
    expect(out).toContain('bold');
    expect(out).toContain('italic');
    expect(out).toContain('strike');
    // No attribute SGR under default mono (legacy contract).
    expect(out).not.toContain(SGR_BOLD);
    expect(out).not.toContain(SGR_ITALIC);
    expect(out).not.toContain(SGR_STRIKE);
    expect(out).not.toContain(SGR_FAINT);
  });

  test('mono profile strips inline code background even when default off', () => {
    const out = renderMarkdown(md('use `npm install`'), 'mono');
    expect(out).toContain('npm install');
    expect(out).not.toContain('48;'); // background SGR
  });
});

describe('Δ25d · markdown mono emphasis (opt-in on)', () => {
  test('heading bold survives mono when keepAttrsInMono is true', () => {
    const out = renderMarkdown(md('# Heading'), 'mono', { keepAttrsInMono: true });
    expect(out).toContain('Heading');
    expect(out).toContain(SGR_BOLD);
    expect(out).toContain(SGR_RESET);
    // Color SGR still stripped.
    expect(out).not.toMatch(/\x1b\[38;[25];/);
  });

  test('paragraph bold + italic + strike all keep attrs in mono', () => {
    const out = renderMarkdown(
      md('**bold**, *italic*, ~~strike~~'),
      'mono',
      { keepAttrsInMono: true },
    );
    expect(out).toContain(SGR_BOLD);
    expect(out).toContain(SGR_ITALIC);
    expect(out).toContain(SGR_STRIKE);
  });

  test('blockquote text keeps italic in mono with opt-in', () => {
    const out = renderMarkdown(md('> a quote line'), 'mono', { keepAttrsInMono: true });
    expect(out).toContain('a quote line');
    expect(out).toContain(SGR_ITALIC);
  });

  test('checked task keeps faint emphasis in mono', () => {
    const out = renderMarkdown(
      md('- [x] done item\n- [ ] todo item'),
      'mono',
      { keepAttrsInMono: true },
    );
    // The completed item should carry faint (de-emphasised); todo uses
    // accent (no faint). Mono+opt-in preserves the faint attr.
    expect(out).toContain('done item');
    expect(out).toContain(SGR_FAINT);
  });

  test('inline link keeps underline + faint url in mono with opt-in', () => {
    const out = renderMarkdown(
      md('see [docs](https://example.com)'),
      'mono',
      { keepAttrsInMono: true },
    );
    expect(out).toContain('docs');
    expect(out).toContain('https://example.com');
    expect(out).toContain(SGR_UNDERLINE);
    expect(out).toContain(SGR_FAINT);
  });

  test('title (top-level spec.title) keeps bold in mono with opt-in', () => {
    const out = renderMarkdown(md('body text', 'My Title'), 'mono', {
      keepAttrsInMono: true,
    });
    expect(out).toContain('My Title');
    expect(out).toContain(SGR_BOLD);
  });
});

describe('Δ25d · truecolor profile unaffected by toggle', () => {
  test('truecolor output identical regardless of keepAttrsInMono', () => {
    const off = renderMarkdown(
      md('# H\n\n**bold** *italic*'),
      'truecolor',
      { keepAttrsInMono: false },
    );
    const on = renderMarkdown(
      md('# H\n\n**bold** *italic*'),
      'truecolor',
      { keepAttrsInMono: true },
    );
    expect(off).toBe(on);
  });
});

describe('Δ25d · all 13 callsites covered (smoke)', () => {
  // Hits every Style.render() callsite the helper now routes through
  // r(): title, fallback msg (path w/o body), heading bold, quote
  // muted+italic, checked task, inline code, link label, link url,
  // bold (** + __), italic (* + _), strike. Validates that opt-in
  // mono produces visible attr SGRs across the full markdown surface.
  test('rich markdown body emits bold + italic + strike + faint + underline under mono opt-in', () => {
    const richBody = [
      '# Top heading',
      '',
      '## Sub heading',
      '',
      '> a quote with **bold** inside',
      '',
      '- [x] done',
      '- [ ] todo with `code`',
      '',
      '1. number with __bold__ word',
      '',
      'Paragraph with *italic*, _italic2_, ~~strike~~, [link](https://x.io).',
    ].join('\n');
    const out = renderMarkdown(md(richBody, 'Doc Title'), 'mono', {
      keepAttrsInMono: true,
    });
    // All key attribute SGRs present.
    expect(out).toContain(SGR_BOLD);
    expect(out).toContain(SGR_ITALIC);
    expect(out).toContain(SGR_STRIKE);
    expect(out).toContain(SGR_FAINT);
    expect(out).toContain(SGR_UNDERLINE);
    // No color SGR (mono).
    expect(out).not.toMatch(/\x1b\[38;[25];/);
  });

  test('fallback hint (body missing + path set) keeps italic in mono opt-in', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '', path: 'docs/missing.md' },
      'mono',
      { keepAttrsInMono: true },
    );
    expect(out).toContain('host must read docs/missing.md');
    expect(out).toContain(SGR_ITALIC);
  });
});
