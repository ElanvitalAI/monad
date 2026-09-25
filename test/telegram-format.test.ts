// Telegram markdown → HTML conversion.
//
// The user hit this with a numbered list of Joseon kings where every
// name was wrapped in `**…**`. Telegram rendered the asterisks literally
// because the bot was sending plain text. After the port from openclaw's
// format.ts, the same input should produce `<b>태조</b>` etc.

import { describe, it, expect } from 'bun:test';
import {
  markdownToTelegramHtml,
  splitMarkdownForTelegram,
  isTelegramParseEntityError,
  escapeHtml,
} from '../src/telegram-format.js';

describe('markdownToTelegramHtml — inline', () => {
  it('converts **bold** and __bold__ to <b>', () => {
    expect(markdownToTelegramHtml('**hi**')).toBe('<b>hi</b>');
    expect(markdownToTelegramHtml('__hi__')).toBe('<b>hi</b>');
  });

  it('converts *italic* and _italic_ to <i>', () => {
    expect(markdownToTelegramHtml('*hi*')).toBe('<i>hi</i>');
    expect(markdownToTelegramHtml('_hi_')).toBe('<i>hi</i>');
  });

  it('converts ~~strike~~ to <s>', () => {
    expect(markdownToTelegramHtml('~~gone~~')).toBe('<s>gone</s>');
  });

  it('renders Joseon-king list as bold numbered items (regression)', () => {
    const md = '1. **태조**\n2. **정종**\n3. **태종**';
    const html = markdownToTelegramHtml(md);
    expect(html).toBe('1. <b>태조</b>\n2. <b>정종</b>\n3. <b>태종</b>');
  });

  it('does not italicize across newlines', () => {
    const md = '*foo\nbar*';
    // No italic wrap because the regex rejects \n inside the emphasis run.
    expect(markdownToTelegramHtml(md)).toBe('*foo\nbar*');
  });

  it('does not italicize `_` inside identifiers like `foo_bar`', () => {
    // `_` prefixed/suffixed by a word character is left alone.
    expect(markdownToTelegramHtml('call foo_bar_baz here')).toBe('call foo_bar_baz here');
  });

  it('preserves literal * and _ inside inline code', () => {
    expect(markdownToTelegramHtml('use `**literal**` please'))
      .toBe('use <code>**literal**</code> please');
  });
});

describe('markdownToTelegramHtml — code', () => {
  it('fences a triple-backtick block with language', () => {
    const md = '```ts\nconst x = 1;\n```';
    expect(markdownToTelegramHtml(md))
      .toBe('<pre><code class="language-ts">const x = 1;</code></pre>');
  });

  it('fences a bare triple-backtick block', () => {
    const md = '```\nplain\n```';
    expect(markdownToTelegramHtml(md)).toBe('<pre><code>plain</code></pre>');
  });

  it('escapes < > & inside code blocks', () => {
    const md = '```\nif (a < b && c > 0)\n```';
    expect(markdownToTelegramHtml(md))
      .toBe('<pre><code>if (a &lt; b &amp;&amp; c &gt; 0)</code></pre>');
  });

  it('keeps fenced-block contents opaque to italic / bold passes', () => {
    const md = '```\n*not italic* **not bold**\n```';
    expect(markdownToTelegramHtml(md))
      .toBe('<pre><code>*not italic* **not bold**</code></pre>');
  });
});

describe('markdownToTelegramHtml — blocks', () => {
  it('flattens headings to <b>', () => {
    expect(markdownToTelegramHtml('# Title')).toBe('<b>Title</b>');
    expect(markdownToTelegramHtml('### Sub')).toBe('<b>Sub</b>');
  });

  it('replaces - / * bullets with •', () => {
    const md = '- apple\n- banana\n* cherry';
    expect(markdownToTelegramHtml(md)).toBe('• apple\n• banana\n• cherry');
  });

  it('preserves leading indent on bullets', () => {
    const md = '  - nested';
    expect(markdownToTelegramHtml(md)).toBe('  • nested');
  });

  it('keeps numbered lists numeric', () => {
    const md = '1. first\n2. second';
    expect(markdownToTelegramHtml(md)).toBe('1. first\n2. second');
  });

  it('converts > quote to <blockquote>', () => {
    expect(markdownToTelegramHtml('> pithy'))
      .toBe('<blockquote>pithy</blockquote>');
  });

  it('nested bold inside bullet is preserved', () => {
    expect(markdownToTelegramHtml('- **태조** founded Joseon'))
      .toBe('• <b>태조</b> founded Joseon');
  });
});

describe('markdownToTelegramHtml — links', () => {
  it('converts [text](url) to <a href>', () => {
    expect(markdownToTelegramHtml('see [docs](https://example.com/x)'))
      .toBe('see <a href="https://example.com/x">docs</a>');
  });

  it('escapes href attribute', () => {
    expect(markdownToTelegramHtml('[x](https://e.com/"onerror=alert(1))'))
      .toContain('&quot;');
  });

  it('leaves raw [ ] alone outside of link syntax', () => {
    expect(markdownToTelegramHtml('[just a tag]')).toBe('[just a tag]');
  });
});

describe('markdownToTelegramHtml — escape', () => {
  it('escapes & < > outside code', () => {
    expect(markdownToTelegramHtml('a < b & c > d'))
      .toBe('a &lt; b &amp; c &gt; d');
  });

  it('does not double-escape &amp; inside converted output', () => {
    const html = markdownToTelegramHtml('pre & post');
    expect(html).toBe('pre &amp; post');
    expect(html).not.toContain('&amp;amp;');
  });

  it('escapeHtml is the canonical helper', () => {
    expect(escapeHtml('<x>&')).toBe('&lt;x&gt;&amp;');
  });
});

describe('markdownToTelegramHtml — spoiler', () => {
  it('converts ||text|| to <tg-spoiler>', () => {
    expect(markdownToTelegramHtml('||hidden||')).toBe('<tg-spoiler>hidden</tg-spoiler>');
  });

  it('does not spoiler across newlines', () => {
    const md = '||first\nsecond||';
    expect(markdownToTelegramHtml(md)).toBe(md);
  });

  it('escapes & < > inside spoiler content', () => {
    expect(markdownToTelegramHtml('||<script>||'))
      .toBe('<tg-spoiler>&lt;script&gt;</tg-spoiler>');
  });
});

describe('markdownToTelegramHtml — file-ref wrapping', () => {
  it('wraps a bare filename with known extension in <code>', () => {
    expect(markdownToTelegramHtml('see README.md for details'))
      .toBe('see <code>README.md</code> for details');
  });

  it('wraps a path-shaped filename', () => {
    expect(markdownToTelegramHtml('edit src/server.ts please'))
      .toBe('edit <code>src/server.ts</code> please');
  });

  it('does NOT wrap TLD-like extensions (vercel.io, x.ai)', () => {
    expect(markdownToTelegramHtml('hosted at vercel.io'))
      .toBe('hosted at vercel.io');
    expect(markdownToTelegramHtml('built by x.ai'))
      .toBe('built by x.ai');
  });

  it('does NOT double-wrap when already inside inline code', () => {
    // Inline code is extracted first, so foo.ts inside backticks
    // stays inside one <code> span, not two.
    const html = markdownToTelegramHtml('use `src/foo.ts` here');
    expect(html).toBe('use <code>src/foo.ts</code> here');
    expect(html).not.toContain('<code><code>');
  });

  it('does NOT wrap when the filename is a link label', () => {
    // Links are stashed before file-ref wrap runs; the inner label
    // stays wrapped as the link, not re-wrapped as <code>.
    const html = markdownToTelegramHtml('[README.md](https://x.com)');
    expect(html).toBe('<a href="https://x.com">README.md</a>');
  });

  it('leaves the leading boundary character untouched', () => {
    // The regex captures the boundary (space / `(` / punctuation)
    // so it isn't consumed as part of the match.
    expect(markdownToTelegramHtml('(see foo.py)'))
      .toBe('(see <code>foo.py</code>)');
  });
});

describe('markdownToTelegramHtml — tables', () => {
  it('renders a simple 2-col table as padded monospace in <pre><code>', () => {
    const md = [
      '| Name | Desc |',
      '|------|------|',
      '| foo  | bar  |',
    ].join('\n');
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<pre><code>');
    expect(html).toContain('</code></pre>');
    // Header + separator + body, padded to header width.
    expect(html).toContain('| Name | Desc |');
    expect(html).toContain('| foo  | bar  |');
    expect(html).toContain('|------|------|');
  });

  it('pads short body cells to match the widest column value', () => {
    const md = [
      '| a | b |',
      '|---|---|',
      '| x | longer |',
      '| yy | z |',
    ].join('\n');
    const html = markdownToTelegramHtml(md);
    // Column b's widest value is "longer" (6 chars); header "b" + row
    // "z" pad to 6 so the right border lines up.
    expect(html).toContain('| a  | b      |');
    expect(html).toContain('| yy | z      |');
  });

  it('accounts for CJK double-width when padding columns', () => {
    const md = [
      '| 이름 | 설명 |',
      '|------|------|',
      '| a    | b    |',
    ].join('\n');
    const html = markdownToTelegramHtml(md);
    // `이름` renders as 4 monospace columns, so body "a" pads to 4
    // spaces (1 char + 3 pad) to align with the right border.
    expect(html).toContain('| 이름 | 설명 |');
    expect(html).toContain('| a    | b    |');
  });

  it('escapes < > & inside table cells', () => {
    const md = [
      '| a | b |',
      '|---|---|',
      '| <x> | &y |',
    ].join('\n');
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('&amp;y');
    expect(html).not.toContain('<x>');
  });

  it('does NOT treat a single pipe-containing prose line as a table', () => {
    const md = 'use the a|b syntax';
    const html = markdownToTelegramHtml(md);
    expect(html).toBe('use the a|b syntax');
  });

  it('does NOT convert when header/separator column counts mismatch', () => {
    const md = [
      '| a | b | c |',
      '|---|---|',
      '| 1 | 2 | 3 |',
    ].join('\n');
    const html = markdownToTelegramHtml(md);
    // Falls back to treating each line as prose — no <pre> wrap.
    expect(html).not.toContain('<pre>');
  });

  it('preserves prose after a table', () => {
    const md = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      'trailing line.',
    ].join('\n');
    const html = markdownToTelegramHtml(md);
    expect(html).toContain('<pre><code>');
    expect(html).toContain('trailing line.');
  });
});

describe('splitMarkdownForTelegram', () => {
  it('returns the whole text when under budget', () => {
    expect(splitMarkdownForTelegram('short')).toEqual(['short']);
  });

  it('splits at paragraph boundaries', () => {
    const a = 'x'.repeat(3000);
    const b = 'y'.repeat(3000);
    const md = `${a}\n\n${b}`;
    const chunks = splitMarkdownForTelegram(md);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  it('respects a lower budget when requested', () => {
    // 512-char floor protects against absurdly small budgets, so use a
    // payload big enough that 85% * 1000 still forces a split.
    const a = 'a'.repeat(700);
    const b = 'b'.repeat(700);
    const md = `${a}\n\n${b}`;
    const chunks = splitMarkdownForTelegram(md, 1000);
    expect(chunks.length).toBe(2);
  });

  it('hard-slices a single oversized line as a last resort', () => {
    const md = 'z'.repeat(10_000);
    const chunks = splitMarkdownForTelegram(md);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(c => c.length > 0)).toBe(true);
    expect(chunks.join('')).toBe(md);
  });
});

describe('isTelegramParseEntityError', () => {
  it("matches telegram's parse-entity phrasing", () => {
    expect(isTelegramParseEntityError({ description: "Bad Request: can't parse entities: Unclosed tag" })).toBe(true);
    expect(isTelegramParseEntityError({ description: 'Bad Request: entity parse error at byte offset 42' })).toBe(true);
  });

  it('ignores non-parse errors', () => {
    expect(isTelegramParseEntityError({ description: 'forbidden' })).toBe(false);
    expect(isTelegramParseEntityError(null)).toBe(false);
    expect(isTelegramParseEntityError(new Error('x'))).toBe(false);
  });
});
