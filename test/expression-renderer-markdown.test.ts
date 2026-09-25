import { describe, expect, test } from 'bun:test';
import {
  renderMarkdown,
  renderMarkdownInline,
  stripMarkdownInline,
  parseMarkdownBlocks,
  MARKDOWN_THEMES,
  pickMarkdownTheme,
} from '../src/expression/index.js';
import type { MarkdownSpec } from '../src/expression/index.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('expression/renderer/markdown · mono profile', () => {
  test('h1 heading renders text + underline (mono = no SGR)', () => {
    const spec: MarkdownSpec = { kind: 'markdown', body: '# Hello' };
    const out = renderMarkdown(spec, 'mono');
    expect(out).not.toContain('\x1b[');
    expect(out).toContain('Hello');
    expect(out).toContain('═');
  });

  test('h2 uses dash underline · h3+ uses # marker prefix', () => {
    const out2 = renderMarkdown({ kind: 'markdown', body: '## Sub' }, 'mono');
    expect(out2).toContain('─');
    const out3 = renderMarkdown({ kind: 'markdown', body: '### Tiny' }, 'mono');
    expect(out3).toMatch(/^### Tiny/);
  });

  test('paragraph inlines bold + italic + code + strike (markers stripped)', () => {
    const body = 'Use **bold** and *italic* and `code` and ~~old~~.';
    const out = renderMarkdown({ kind: 'markdown', body }, 'mono');
    expect(out).toContain('bold');
    expect(out).toContain('italic');
    expect(out).toContain('code');
    expect(out).toContain('old');
    expect(out).not.toContain('**');
    expect(out).not.toContain('~~');
  });

  test('bullet list emits • marker per item', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '- one\n- two\n- three' }, 'mono');
    expect(out).toContain('• one');
    expect(out).toContain('• two');
    expect(out).toContain('• three');
  });

  test('numbered list preserves numbering', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '1. first\n2. second\n3. third' }, 'mono');
    expect(out).toContain('1. first');
    expect(out).toContain('2. second');
    expect(out).toContain('3. third');
  });

  test('blockquote prepends ▌ left bar', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '> say it\n> twice' }, 'mono');
    expect(out).toContain('▌ say it');
    expect(out).toContain('▌ twice');
  });

  test('horizontal rule → ─ line', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '---' }, 'mono');
    expect(out).toMatch(/^─+$/);
  });

  test('hr also accepts *** and ___', () => {
    expect(renderMarkdown({ kind: 'markdown', body: '***' }, 'mono')).toMatch(/^─+$/);
    expect(renderMarkdown({ kind: 'markdown', body: '___' }, 'mono')).toMatch(/^─+$/);
  });

  test('fenced code block frames each line with │', () => {
    const body = '```js\nconst x = 1;\nconst y = 2;\n```';
    const out = renderMarkdown({ kind: 'markdown', body }, 'mono');
    expect(out).toContain('js');
    expect(out).toContain('│ const x = 1;');
    expect(out).toContain('│ const y = 2;');
  });

  test('fenced code block without lang skips the label line', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '```\nbare\n```' }, 'mono');
    const lines = out.split('\n');
    // First line should be the code itself (no lang label).
    expect(lines[0]).toContain('│ bare');
  });

  test('link emits text + (url) annotation', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '[click](https://example.com)' },
      'mono',
    );
    expect(out).toContain('click');
    expect(out).toContain('(https://example.com)');
  });

  test('all heading levels h1..h6 render text', () => {
    const body = '# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6';
    const out = renderMarkdown({ kind: 'markdown', body }, 'mono');
    for (const h of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
      expect(out).toContain(h);
    }
  });

  test('nested indented bullet list preserves indent', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '- top\n  - nested\n- back' },
      'mono',
    );
    expect(out).toContain('  • top'); // outer indent = 2
    expect(out).toContain('    • nested'); // 2 + indent 2
  });

  test('paragraph with multi-line soft-wrap joins on space', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: 'first line\nsecond line\nthird' },
      'mono',
    );
    expect(out).toContain('first line second line third');
  });

  test('title prefix renders heading + double-line underline', () => {
    const out = renderMarkdown(
      { kind: 'markdown', title: 'Manual', body: 'body text' },
      'mono',
    );
    expect(out).toContain('Manual');
    expect(out).toContain('═');
    expect(out).toContain('body text');
  });

  test('empty body → empty string', () => {
    expect(renderMarkdown({ kind: 'markdown', body: '' }, 'mono')).toBe('');
  });

  test('path without inlined body → friendly hint', () => {
    const out = renderMarkdown({ kind: 'markdown', path: '/etc/help.md' }, 'mono');
    expect(out).toContain('/etc/help.md');
    expect(out).toContain('host must');
  });
});

describe('expression/renderer/markdown · truecolor SGR emission', () => {
  test('h1 heading paints with foreground SGR', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '# Hello' }, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('\x1b[1m'); // bold
  });

  test('inline code emits both fg and bg SGR', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: 'use `bun test`' },
      'truecolor',
    );
    expect(out).toContain('\x1b[38;2;'); // fg
    expect(out).toContain('\x1b[48;2;'); // bg
  });

  test('code block bar carries accent SGR', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '```\nfoo\n```' }, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('│');
  });

  test('hr line is colored', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '---' }, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('─');
  });

  test('quote bar carries quote color', () => {
    const out = renderMarkdown({ kind: 'markdown', body: '> hi' }, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('▌');
  });

  test('link underlines the label', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '[here](https://x.dev)' },
      'truecolor',
    );
    expect(out).toContain('\x1b[4m'); // underline
    expect(out).toContain('\x1b[2m'); // faint url
  });
});

describe('expression/themes/markdown · presets', () => {
  test('all six theme names present', () => {
    expect(MARKDOWN_THEMES.default).toBeDefined();
    expect(MARKDOWN_THEMES.dark).toBeDefined();
    expect(MARKDOWN_THEMES.light).toBeDefined();
    expect(MARKDOWN_THEMES.nord).toBeDefined();
    expect(MARKDOWN_THEMES.gruvbox).toBeDefined();
    expect(MARKDOWN_THEMES.mono).toBeDefined();
  });

  test('every theme exposes a 6-color heading palette', () => {
    for (const name of Object.keys(MARKDOWN_THEMES) as Array<keyof typeof MARKDOWN_THEMES>) {
      expect(MARKDOWN_THEMES[name].headings.length).toBe(6);
    }
  });

  test('every theme defines text/muted/accent/code/codeBg/link/quote/hr', () => {
    for (const name of Object.keys(MARKDOWN_THEMES) as Array<keyof typeof MARKDOWN_THEMES>) {
      const t = MARKDOWN_THEMES[name];
      expect(t.text).toBeDefined();
      expect(t.muted).toBeDefined();
      expect(t.accent).toBeDefined();
      expect(t.code).toBeDefined();
      expect(t.codeBg).toBeDefined();
      expect(t.link).toBeDefined();
      expect(t.quote).toBeDefined();
      expect(t.hr).toBeDefined();
    }
  });

  test('pickMarkdownTheme returns named theme or falls back to default', () => {
    expect(pickMarkdownTheme('nord')).toBe(MARKDOWN_THEMES.nord);
    expect(pickMarkdownTheme('does-not-exist')).toBe(MARKDOWN_THEMES.default);
    expect(pickMarkdownTheme(undefined)).toBe(MARKDOWN_THEMES.default);
  });

  test('renderMarkdown honours opts.theme override over spec.theme field', () => {
    const a = renderMarkdown(
      { kind: 'markdown', body: '# Title', theme: 'gruvbox' },
      'truecolor',
    );
    const b = renderMarkdown(
      { kind: 'markdown', body: '# Title', theme: 'gruvbox' },
      'truecolor',
      { theme: MARKDOWN_THEMES.nord },
    );
    expect(a).not.toBe(b);
  });
});

describe('expression/renderer/markdown · purity', () => {
  test('same input → same output (truecolor)', () => {
    const body = '# Hi\n\nText with **bold** and `code`.\n\n- a\n- b\n\n> quote';
    const a = renderMarkdown({ kind: 'markdown', body }, 'truecolor');
    const b = renderMarkdown({ kind: 'markdown', body }, 'truecolor');
    expect(a).toBe(b);
  });

  test('mono = stripped truecolor for the same body', () => {
    const body = '# Hello\n\nworld with **bold** and `code`';
    const mono = renderMarkdown({ kind: 'markdown', body }, 'mono');
    const tc = renderMarkdown({ kind: 'markdown', body }, 'truecolor');
    expect(stripAnsi(tc)).toBe(mono);
  });
});

describe('expression/renderer/markdown · parser internals', () => {
  test('parseMarkdownBlocks groups paragraph runs', () => {
    const blocks = parseMarkdownBlocks('one\ntwo\nthree');
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.kind).toBe('paragraph');
  });

  test('parseMarkdownBlocks separates paragraph + list + heading', () => {
    const blocks = parseMarkdownBlocks('# Title\n\nIntro\n\n- a\n- b');
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('heading');
    expect(kinds).toContain('paragraph');
    expect(kinds).toContain('list-bullet');
  });

  test('parseMarkdownBlocks captures fenced code with lang label', () => {
    const blocks = parseMarkdownBlocks('```py\nprint(1)\n```');
    expect(blocks.length).toBe(1);
    const block = blocks[0]!;
    expect(block.kind).toBe('code');
    if (block.kind === 'code') {
      expect(block.lang).toBe('py');
      expect(block.lines).toEqual(['print(1)']);
    }
  });

  test('stripMarkdownInline removes all markdown markers', () => {
    expect(stripMarkdownInline('**bold**')).toBe('bold');
    expect(stripMarkdownInline('*italic*')).toBe('italic');
    expect(stripMarkdownInline('`code`')).toBe('code');
    expect(stripMarkdownInline('~~old~~')).toBe('old');
    expect(stripMarkdownInline('[label](url)')).toBe('label');
    expect(stripMarkdownInline('mix **a** + *b* + `c`')).toBe('mix a + b + c');
  });

  test('renderMarkdownInline is exported and idempotent on plain text', () => {
    const out = renderMarkdownInline('plain text', MARKDOWN_THEMES.default, 'mono');
    expect(out).toBe('plain text');
  });
});

describe('expression/renderer/markdown · task list', () => {
  test('parses unchecked / checked task items', () => {
    const blocks = parseMarkdownBlocks('- [ ] todo\n- [x] done\n- [X] also done');
    expect(blocks.length).toBe(1);
    const block = blocks[0]!;
    expect(block.kind).toBe('list-bullet');
    if (block.kind === 'list-bullet') {
      expect(block.items.length).toBe(3);
      expect(block.items[0]).toMatchObject({ checked: false, marker: '☐', text: 'todo' });
      expect(block.items[1]).toMatchObject({ checked: true, marker: '☑', text: 'done' });
      expect(block.items[2]).toMatchObject({ checked: true, marker: '☑', text: 'also done' });
    }
  });

  test('plain bullet (no checkbox) keeps marker = •', () => {
    const blocks = parseMarkdownBlocks('- plain item');
    if (blocks[0]!.kind === 'list-bullet') {
      const item = blocks[0]!.items[0]!;
      expect(item.checked).toBeUndefined();
      expect(item.marker).toBe('•');
    }
  });

  test('mixed plain + task items in same list run', () => {
    const blocks = parseMarkdownBlocks('- normal\n- [ ] task1\n- [x] task2\n- another');
    if (blocks[0]!.kind === 'list-bullet') {
      const items = blocks[0]!.items;
      expect(items.length).toBe(4);
      expect(items[0]!.marker).toBe('•');
      expect(items[1]!.marker).toBe('☐');
      expect(items[2]!.marker).toBe('☑');
      expect(items[3]!.marker).toBe('•');
    }
  });

  test('renders task list with ☐/☑ glyphs in mono', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '- [ ] todo\n- [x] done' },
      'mono',
    );
    expect(out).toContain('☐ todo');
    expect(out).toContain('☑ done');
  });

  test('truecolor: checked task uses muted + faint, unchecked uses accent', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '- [ ] todo\n- [x] done' },
      'truecolor',
    );
    // Both contain SGR; checked has \x1b[2m (faint).
    expect(out).toContain('\x1b[38;2;');
    expect(out).toContain('\x1b[2m');
  });

  test('inline markup inside task text still renders', () => {
    const out = renderMarkdown(
      { kind: 'markdown', body: '- [ ] **bold** task' },
      'mono',
    );
    expect(out).toContain('☐ bold task');
    expect(out).not.toContain('**');
  });
});

describe('expression/renderer/markdown · GFM table', () => {
  const TABLE_BODY = `| Name | Score | Note |
|------|------:|:----:|
| Alice | 100 | A |
| Bob   |  90 | B |
| Carol |  85 | C |`;

  test('parses GFM table with header + separator + body rows', () => {
    const blocks = parseMarkdownBlocks(TABLE_BODY);
    expect(blocks.length).toBe(1);
    const block = blocks[0]!;
    expect(block.kind).toBe('gfm-table');
    if (block.kind === 'gfm-table') {
      expect(block.headers).toEqual(['Name', 'Score', 'Note']);
      expect(block.alignments).toEqual(['left', 'right', 'center']);
      expect(block.rows.length).toBe(3);
      expect(block.rows[0]).toEqual(['Alice', '100', 'A']);
    }
  });

  test('renders GFM table to framed output (mono = no SGR)', () => {
    const out = renderMarkdown({ kind: 'markdown', body: TABLE_BODY }, 'mono');
    expect(out).toContain('Name');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).toContain('Carol');
    expect(out).not.toContain('\x1b[');
    // Frame characters from BORDER_NORMAL.
    expect(out).toContain('┌');
    expect(out).toContain('┘');
  });

  test('renders GFM table with truecolor SGR on header + frame', () => {
    const out = renderMarkdown({ kind: 'markdown', body: TABLE_BODY }, 'truecolor');
    expect(out).toContain('\x1b[38;2;');
  });

  test('alignment markers (`---`, `:---`, `---:`, `:---:`) parsed correctly', () => {
    const body = '| L | C | R |\n|:--|:-:|--:|\n| a | b | c |';
    const blocks = parseMarkdownBlocks(body);
    if (blocks[0]!.kind === 'gfm-table') {
      expect(blocks[0]!.alignments).toEqual(['left', 'center', 'right']);
    }
  });

  test('short row gets padded to header column count', () => {
    const body = '| A | B | C |\n|---|---|---|\n| only-A |';
    const blocks = parseMarkdownBlocks(body);
    if (blocks[0]!.kind === 'gfm-table') {
      expect(blocks[0]!.rows[0]).toEqual(['only-A', '', '']);
    }
  });

  test('over-long row gets truncated to header column count', () => {
    const body = '| A |\n|---|\n| 1 | 2 | 3 |';
    const blocks = parseMarkdownBlocks(body);
    if (blocks[0]!.kind === 'gfm-table') {
      expect(blocks[0]!.rows[0]).toEqual(['1']);
    }
  });

  test('inline markup inside table cells stripped (table layout stable)', () => {
    const body = '| Name |\n|---|\n| **Alice** |\n| *Bob* |';
    const out = renderMarkdown({ kind: 'markdown', body }, 'mono');
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).not.toContain('**');
    expect(out).not.toContain('*Bob*');
  });

  test('paragraph after table parses separately (table boundary respected)', () => {
    const body = '| A |\n|---|\n| 1 |\n\nFollowing paragraph.';
    const blocks = parseMarkdownBlocks(body);
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('gfm-table');
    expect(kinds).toContain('paragraph');
  });

  test('header without separator does NOT trigger table parsing', () => {
    const body = '| A | B |\nplain paragraph';
    const blocks = parseMarkdownBlocks(body);
    expect(blocks[0]!.kind).toBe('paragraph');
  });
});
