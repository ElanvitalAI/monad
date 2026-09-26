// Markdown renderer — pure fn `renderMarkdown(spec, profile, opts) → string`.
//
// Glamour-inspired subset: heading h1-h6, paragraph + inline (bold /
// italic / code / strike / link), bullet + numbered lists, blockquote,
// fenced code block, horizontal rule. Self-implemented to keep the
// expression layer dep-free — elanous's markdown surface is short slash
// payloads, not full CommonMark.
//
// Two-stage pipeline:
//  1. parseBlocks(body) — line-based block grouping (paragraph runs,
//     fence pairs, list runs, quote runs).
//  2. renderBlock(block, theme, profile) — each block emits its own
//     ANSI string. Adjacent BlankBlock entries become empty lines so
//     the join-with-newline pass produces the right vertical spacing.
//
// Inline parsing happens inside text-bearing blocks (paragraph, list
// item, quote line) via `renderInline()`. Headings strip inline syntax
// markers (no nested SGR — keeps colour/bold semantics clean) but
// retain the raw text content.
//
// Renderer is pure: no fs, no env reads, no global state. Hosts that
// want to load `spec.path` must inline-resolve the file before calling.

import type { MarkdownSpec } from '../spec/types.js';
import { type ColorProfile, paint } from '../color.js';
import { Style } from '../style.js';
import {
  MARKDOWN_THEMES,
  type MarkdownTheme,
  pickMarkdownTheme,
} from '../themes/markdown.js';
import { renderTable } from './table.js';

export interface RenderMarkdownOpts {
  /** Theme override. Falls back to `MARKDOWN_THEMES.default`. */
  theme?: MarkdownTheme;
  /** Cell budget for HR + heading underlines. Default 72. */
  width?: number;
  /** PR-Δ25d (Sprint 18 · 2026-04-30) — opt-in: when true AND profile
   *  is `'mono'`, attribute SGRs (bold / italic / faint / underline /
   *  strikethrough) survive even though color SGRs are still stripped.
   *  Default false preserves the legacy mono = zero-CSI contract for
   *  tests that assert markdown body emits no SGR under mono. Hosts
   *  that want visual hierarchy on NO_COLOR / pipe / CI logs (chat
   *  output · agent message stream · markdown helper bodies) flip
   *  this on. Pattern mirrors Δ25 (status-module + picker). */
  keepAttrsInMono?: boolean;
}

export type ParsedMarkdownBlock = Block;

export interface RenderedMarkdownBlock {
  kind: ParsedMarkdownBlock['kind'];
  text: string;
}

const DEFAULT_WIDTH = 72;

/** Render a `MarkdownSpec` to a multi-line ANSI string. */
export function renderMarkdown(
  spec: MarkdownSpec,
  profile: ColorProfile = 'truecolor',
  opts: RenderMarkdownOpts = {},
): string {
  const theme = opts.theme ?? pickMarkdownTheme(spec.theme) ?? MARKDOWN_THEMES.default;
  const width = Math.max(20, opts.width ?? DEFAULT_WIDTH);
  const keepAttrs = opts.keepAttrsInMono ?? false;
  // PR-Δ25d — single helper for the 13 render() callsites. Routes to
  // renderWithMonoEmphasis when keepAttrs is on so mono profile keeps
  // bold/italic/faint/strikethrough; otherwise plain render() (legacy
  // mono = zero-CSI contract for tests that pin markdown body output).
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  const body = spec.body ?? '';
  if (!body && spec.path) {
    // Renderer can't read files (would break purity); host must
    // pre-inline. We surface a friendly faint hint.
    return r(
      Style.empty().foreground(theme.muted).italic(),
      `(markdown body not inlined — host must read ${spec.path})`,
    );
  }

  const blocks = parseBlocks(body);
  const lines: string[] = [];

  if (spec.title) {
    const titleColor = theme.headings[0] ?? theme.text;
    lines.push(r(Style.empty().foreground(titleColor).bold(), spec.title));
    lines.push(paint(titleColor, profile)('═'.repeat(Math.min(width, spec.title.length))));
    lines.push('');
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    lines.push(renderBlock(block, theme, profile, width, keepAttrs));
  }

  // Trim trailing empty lines so consumers can wrap freely.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/** Render pre-parsed markdown blocks individually so callers can
 *  preserve block boundaries during later wrapping/layout phases. */
export function renderParsedBlocks(
  blocks: ReadonlyArray<ParsedMarkdownBlock>,
  profile: ColorProfile = 'truecolor',
  opts: RenderMarkdownOpts = {},
): ReadonlyArray<RenderedMarkdownBlock> {
  const theme = opts.theme ?? MARKDOWN_THEMES.default;
  const width = Math.max(20, opts.width ?? DEFAULT_WIDTH);
  const keepAttrs = opts.keepAttrsInMono ?? false;
  return blocks.map((block) => ({
    kind: block.kind,
    text: renderBlock(block, theme, profile, width, keepAttrs),
  }));
}

// ── Block parser ────────────────────────────────────────────────────

interface HeadingBlock {
  kind: 'heading';
  level: number;
  text: string;
}
interface ParagraphBlock {
  kind: 'paragraph';
  text: string;
}
interface BlockQuote {
  kind: 'quote';
  lines: ReadonlyArray<string>;
}
interface CodeBlockBlock {
  kind: 'code';
  lang: string;
  lines: ReadonlyArray<string>;
}
interface BulletList {
  kind: 'list-bullet';
  items: ReadonlyArray<ListItem>;
}
interface NumberedList {
  kind: 'list-numbered';
  items: ReadonlyArray<ListItem>;
}
interface HrBlock {
  kind: 'hr';
}
interface BlankBlock {
  kind: 'blank';
}

interface ListItem {
  indent: number;
  marker: string;
  text: string;
  /** Task-list state: undefined = ordinary bullet · false = `[ ]` ·
   *  true = `[x]` / `[X]`. Renderer swaps the bullet marker glyph
   *  for ☐ / ☑ when set. */
  checked?: boolean;
}

interface GfmTableBlock {
  kind: 'gfm-table';
  /** Header cells (one per column). */
  headers: ReadonlyArray<string>;
  /** Per-column alignment from the separator row (`:---`, `---:`,
   *  `:---:`) — falls back to 'left' when omitted. */
  alignments: ReadonlyArray<'left' | 'center' | 'right'>;
  /** Body rows · same length as headers (short rows are padded with
   *  empty strings; over-long are truncated). */
  rows: ReadonlyArray<ReadonlyArray<string>>;
}

type Block =
  | HeadingBlock
  | ParagraphBlock
  | BlockQuote
  | CodeBlockBlock
  | BulletList
  | NumberedList
  | GfmTableBlock
  | HrBlock
  | BlankBlock;

const RE_FENCE = /^```\s*(\S*)\s*$/;
const RE_FENCE_CLOSE = /^```\s*$/;
const RE_HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const RE_HR = /^\s*(\*{3,}|-{3,}|_{3,})\s*$/;
const RE_QUOTE = /^>\s?/;
const RE_BULLET = /^(\s*)([-*+])\s+(.*)$/;
const RE_NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
/** Task-list checkbox prefix inside a bullet item — `[ ]` / `[x]` /
 *  `[X]` followed by at least one space. */
const RE_TASK_PREFIX = /^\[([ xX])\]\s+(.*)$/;
/** GFM table — header line begins + ends with `|` (with possible
 *  whitespace) and contains at least one inner pipe. The separator
 *  line that follows must consist of pipe-delimited dash sequences
 *  (with optional `:` alignment markers). */
const RE_TABLE_LINE = /^\s*\|.+\|\s*$/;
const RE_TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function parseBlocks(body: string): ReadonlyArray<Block> {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Code fence.
    const fenceOpen = RE_FENCE.exec(line);
    if (fenceOpen) {
      const lang = fenceOpen[1] ?? '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !RE_FENCE_CLOSE.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length) i++; // consume closing fence
      blocks.push({ kind: 'code', lang, lines: codeLines });
      continue;
    }

    // ATX heading.
    const heading = RE_HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }

    // Horizontal rule (must come before list — `- - -` / `* * *` could
    // ambiguously look like list markers, but the regex requires 3+
    // consecutive same chars).
    if (RE_HR.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Blank line.
    if (/^\s*$/.test(line)) {
      blocks.push({ kind: 'blank' });
      i++;
      continue;
    }

    // Blockquote run.
    if (RE_QUOTE.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i]!)) {
        quoteLines.push(lines[i]!.replace(RE_QUOTE, ''));
        i++;
      }
      blocks.push({ kind: 'quote', lines: quoteLines });
      continue;
    }

    // GFM table — header + separator + body rows. Must be detected
    // BEFORE bullet/paragraph since the header line is ambiguous with
    // an inline-pipe-bearing paragraph until the separator confirms.
    if (RE_TABLE_LINE.test(line) && i + 1 < lines.length && RE_TABLE_SEPARATOR.test(lines[i + 1]!)) {
      const headers = splitTableRow(line);
      const alignments = parseTableAlignments(lines[i + 1]!, headers.length);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && RE_TABLE_LINE.test(lines[i]!)) {
        rows.push(padRowTo(splitTableRow(lines[i]!), headers.length));
        i++;
      }
      blocks.push({ kind: 'gfm-table', headers, alignments, rows });
      continue;
    }

    // Bullet list run.
    if (RE_BULLET.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = RE_BULLET.exec(lines[i]!);
        if (!m) break;
        const rawText = m[3]!;
        const taskMatch = RE_TASK_PREFIX.exec(rawText);
        if (taskMatch) {
          const checked = taskMatch[1] !== ' ';
          items.push({
            indent: m[1]!.length,
            marker: checked ? '☑' : '☐',
            text: taskMatch[2]!,
            checked,
          });
        } else {
          items.push({ indent: m[1]!.length, marker: '•', text: rawText });
        }
        i++;
      }
      blocks.push({ kind: 'list-bullet', items });
      continue;
    }

    // Numbered list run.
    if (RE_NUMBERED.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = RE_NUMBERED.exec(lines[i]!);
        if (!m) break;
        items.push({ indent: m[1]!.length, marker: `${m[2]!}.`, text: m[3]! });
        i++;
      }
      blocks.push({ kind: 'list-numbered', items });
      continue;
    }

    // Paragraph: collect consecutive non-block-boundary lines and join
    // them with a single space (markdown soft-wraps).
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !isBlockBoundary(lines[i]!)) {
      paraLines.push(lines[i]!);
      i++;
    }
    blocks.push({ kind: 'paragraph', text: paraLines.join(' ') });
  }
  return blocks;
}

function isBlockBoundary(line: string): boolean {
  if (/^\s*$/.test(line)) return true;
  if (RE_FENCE.test(line)) return true;
  if (RE_HEADING.test(line)) return true;
  if (RE_HR.test(line)) return true;
  if (RE_QUOTE.test(line)) return true;
  if (RE_BULLET.test(line)) return true;
  if (RE_NUMBERED.test(line)) return true;
  if (RE_TABLE_LINE.test(line)) return true;
  return false;
}

/** Split a GFM-table row line into trimmed cells. Drops the leading
 *  and trailing pipes when present so `|a|b|` and `a|b` both yield
 *  `['a', 'b']`. */
function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

/** Pad / truncate a row so its cell count matches `target`. */
function padRowTo(cells: ReadonlyArray<string>, target: number): string[] {
  if (cells.length === target) return cells.slice();
  if (cells.length > target) return cells.slice(0, target);
  const out = cells.slice();
  while (out.length < target) out.push('');
  return out;
}

/** Read alignment markers from a GFM separator row. `:---` = left,
 *  `---:` = right, `:---:` = center, `---` = left default. */
function parseTableAlignments(
  separator: string,
  count: number,
): Array<'left' | 'center' | 'right'> {
  const cells = splitTableRow(separator);
  const out: Array<'left' | 'center' | 'right'> = [];
  for (let i = 0; i < count; i++) {
    const cell = (cells[i] ?? '').trim();
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) out.push('center');
    else if (right) out.push('right');
    else out.push('left');
  }
  return out;
}

// ── Block renderer ──────────────────────────────────────────────────

function renderBlock(
  block: Block,
  theme: MarkdownTheme,
  profile: ColorProfile,
  width: number,
  keepAttrs: boolean,
): string {
  switch (block.kind) {
    case 'blank':
      return '';
    case 'hr':
      return paint(theme.hr, profile)('─'.repeat(width));
    case 'heading':
      return renderHeading(block, theme, profile, width, keepAttrs);
    case 'paragraph':
      return renderInline(block.text, theme, profile, keepAttrs);
    case 'quote':
      return renderQuote(block, theme, profile, keepAttrs);
    case 'code':
      return renderCodeBlock(block, theme, profile);
    case 'list-bullet':
      return renderBulletList(block, theme, profile, keepAttrs);
    case 'list-numbered':
      return renderNumberedList(block, theme, profile, keepAttrs);
    case 'gfm-table':
      return renderGfmTable(block, theme, profile);
  }
}

function renderHeading(
  block: HeadingBlock,
  theme: MarkdownTheme,
  profile: ColorProfile,
  width: number,
  keepAttrs: boolean,
): string {
  const idx = Math.min(block.level - 1, theme.headings.length - 1);
  const color = theme.headings[idx] ?? theme.text;
  const visibleText = stripInline(block.text);
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  const styled = r(Style.empty().foreground(color).bold(), visibleText);
  if (block.level === 1) {
    const underline = paint(color, profile)('═'.repeat(Math.min(width, visibleText.length)));
    return `${styled}\n${underline}`;
  }
  if (block.level === 2) {
    const underline = paint(color, profile)('─'.repeat(Math.min(width, visibleText.length)));
    return `${styled}\n${underline}`;
  }
  const marker = paint(color, profile)('#'.repeat(block.level));
  return `${marker} ${styled}`;
}

function renderQuote(
  block: BlockQuote,
  theme: MarkdownTheme,
  profile: ColorProfile,
  keepAttrs: boolean,
): string {
  const bar = paint(theme.quote, profile)('▌');
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  const inner = block.lines.map((raw) => {
    const inline = renderInline(raw, theme, profile, keepAttrs);
    const styled = r(Style.empty().foreground(theme.muted).italic(), inline);
    return `${bar} ${styled}`;
  });
  return inner.join('\n');
}

function renderCodeBlock(
  block: CodeBlockBlock,
  theme: MarkdownTheme,
  profile: ColorProfile,
): string {
  const bar = paint(theme.accent, profile)('│');
  const codeLines = block.lines.map((raw) => `${bar} ${paint(theme.code, profile)(raw)}`);
  if (block.lang) {
    const label = paint(theme.muted, profile)(`  ${block.lang}`);
    return [label, ...codeLines].join('\n');
  }
  return codeLines.join('\n');
}

function renderBulletList(
  block: BulletList,
  theme: MarkdownTheme,
  profile: ColorProfile,
  keepAttrs: boolean,
): string {
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  return block.items
    .map((item) => {
      const indent = ' '.repeat(item.indent + 2);
      // Task list items use the parsed marker glyph (☐ / ☑) — checked
      // boxes get the muted color (de-emphasised) and faint inline
      // text so completed work fades visually. Unchecked uses accent
      // (calls attention). Plain bullets fall through to • in accent.
      let marker: string;
      let text: string;
      if (item.checked === true) {
        marker = paint(theme.muted, profile)(item.marker);
        text = r(
          Style.empty().foreground(theme.muted).faint(),
          renderInline(item.text, theme, profile, keepAttrs),
        );
      } else if (item.checked === false) {
        marker = paint(theme.accent, profile)(item.marker);
        text = renderInline(item.text, theme, profile, keepAttrs);
      } else {
        marker = paint(theme.accent, profile)(item.marker);
        text = renderInline(item.text, theme, profile, keepAttrs);
      }
      return `${indent}${marker} ${text}`;
    })
    .join('\n');
}

function renderNumberedList(
  block: NumberedList,
  theme: MarkdownTheme,
  profile: ColorProfile,
  keepAttrs: boolean,
): string {
  return block.items
    .map((item) => {
      const indent = ' '.repeat(item.indent + 2);
      const marker = paint(theme.accent, profile)(item.marker);
      const text = renderInline(item.text, theme, profile, keepAttrs);
      return `${indent}${marker} ${text}`;
    })
    .join('\n');
}

/** Render a GFM table by delegating to the existing `renderTable`
 *  renderer. Headers + alignments + rows convert to the TableSpec
 *  shape; cell strings carry inline-rendered ANSI so bold/italic/
 *  code spans inside cells survive into the framed output. */
function renderGfmTable(
  block: GfmTableBlock,
  theme: MarkdownTheme,
  profile: ColorProfile,
): string {
  // Build TableSpec columns from headers (id = `c{n}`, align from
  // separator row, label kept inline-rendered).
  const columns = block.headers.map((header, idx) => ({
    id: `c${idx}`,
    label: stripInline(header),
    align: block.alignments[idx] ?? 'left',
  }));
  // Build rows keyed by column id, with each cell pre-rendered so
  // inline markup doesn't leak into the table layout calculation.
  const rows = block.rows.map((row) => {
    const obj: Record<string, string> = {};
    row.forEach((cell, idx) => {
      const id = columns[idx]?.id;
      if (id) obj[id] = stripInline(cell);
    });
    return obj;
  });
  return renderTable(
    {
      kind: 'table',
      columns,
      rows,
      style: { border: 'normal' },
    },
    profile,
    {
      themeAccent: theme.accent,
      themeMuted: theme.muted,
    },
  );
}

// ── Inline renderer ─────────────────────────────────────────────────
//
// Inline order matters: code spans + links extract first into NUL
// placeholders so their internals (which can contain `*`, `_`, etc)
// don't get re-processed by the bold/italic/strike passes.

const RE_INLINE_CODE = /`([^`]+)`/g;
const RE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const RE_BOLD_STAR = /\*\*([^*\n]+)\*\*/g;
const RE_BOLD_UNDER = /__([^_\n]+)__/g;
const RE_ITALIC_STAR = /(?<![*])\*([^*\n]+)\*(?![*])/g;
const RE_ITALIC_UNDER = /(?<![_])_([^_\n]+)_(?![_])/g;
const RE_STRIKE = /~~([^~\n]+)~~/g;

export function renderInline(
  text: string,
  theme: MarkdownTheme,
  profile: ColorProfile,
  keepAttrs: boolean = false,
): string {
  const r = (s: Style, t: string): string =>
    keepAttrs ? s.renderWithMonoEmphasis(t, profile) : s.render(t, profile);
  const placeholders: string[] = [];
  const ph = (rendered: string): string => {
    const idx = placeholders.length;
    placeholders.push(rendered);
    return `\x00${idx}\x00`;
  };

  let out = text;

  // 1. inline code — protect contents from later passes.
  out = out.replace(RE_INLINE_CODE, (_, code: string) => {
    return ph(
      r(
        Style.empty().foreground(theme.code).background(theme.codeBg),
        ` ${code} `,
      ),
    );
  });

  // 2. links — protect URL from underscore pass.
  out = out.replace(RE_LINK, (_, label: string, url: string) => {
    const t = r(Style.empty().foreground(theme.link).underline(), label);
    const u = r(Style.empty().foreground(theme.muted).faint(), ` (${url})`);
    return ph(t + u);
  });

  // 3. bold (** or __) BEFORE italic — `*foo*` is italic, `**foo**` is bold.
  out = out.replace(RE_BOLD_STAR, (_, t: string) =>
    r(Style.empty().bold().foreground(theme.text), t),
  );
  out = out.replace(RE_BOLD_UNDER, (_, t: string) =>
    r(Style.empty().bold().foreground(theme.text), t),
  );

  // 4. italic.
  out = out.replace(RE_ITALIC_STAR, (_, t: string) =>
    r(Style.empty().italic(), t),
  );
  out = out.replace(RE_ITALIC_UNDER, (_, t: string) =>
    r(Style.empty().italic(), t),
  );

  // 5. strikethrough.
  out = out.replace(RE_STRIKE, (_, t: string) =>
    r(Style.empty().strikethrough(), t),
  );

  // Restore placeholders.
  out = out.replace(/\x00(\d+)\x00/g, (_, n: string) => placeholders[Number(n)] ?? '');
  return out;
}

/** Strip inline markdown markers (`**`, `*`, `_`, `` ` ``, `~~`,
 *  `[..](..)`) from `text`, returning the visible character sequence.
 *  Used by headings to compute underline width and avoid nested SGR. */
export function stripInline(text: string): string {
  return text
    .replace(RE_INLINE_CODE, '$1')
    .replace(RE_LINK, '$1')
    .replace(RE_BOLD_STAR, '$1')
    .replace(RE_BOLD_UNDER, '$1')
    .replace(RE_ITALIC_STAR, '$1')
    .replace(RE_ITALIC_UNDER, '$1')
    .replace(RE_STRIKE, '$1');
}
