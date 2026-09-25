// Telegram message formatter — converts LLM-emitted markdown to the
// HTML subset Telegram renders via parse_mode=HTML.
//
// Why HTML (not MarkdownV2)? Telegram's MarkdownV2 requires escaping 18
// reserved characters (_ * [ ] ( ) ~ ` > # + - = | { } . !) wherever
// they appear *outside* a formatting sequence. That's error-prone with
// LLM-generated text: any stray `.` or `!` inside a paragraph trips
// "can't parse entities". HTML only needs to escape `& < >` and that's
// much more forgiving. openclaw (extensions/telegram/src/format.ts)
// made the same call for the same reason.
//
// Transformations (matches openclaw's renderTelegramHtml mapping):
//   `**bold**`, `__bold__`      → <b>bold</b>
//   `*italic*`, `_italic_`      → <i>italic</i>
//   `~~strike~~`                → <s>strike</s>
//   `` `code` ``                → <code>code</code>
//   ``` ```lang\ncode\n``` ```  → <pre><code class="language-lang">
//   `# heading` / `## …`        → <b>heading</b>   (no <h1> in TG)
//   `- item` / `* item`         → • item
//   `1. item`                   → unchanged (TG renders numerals fine)
//   `[text](url)`               → <a href="url">text</a>
//   `> quote`                   → <blockquote>quote</blockquote>
//
// Fenced code blocks are extracted FIRST into placeholders so their
// contents don't get transformed as markdown. Inline code and links
// likewise — we don't want the italic pass to touch `_foo_` inside
// `path/to/_foo_.py`.

import { FILE_REF_RE } from './file-ref.js';

const PLACEHOLDER_PREFIX = '\u0000B';
const PLACEHOLDER_SUFFIX = '\u0000';

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/** Visible-column width of a string in a monospace font. CJK / fullwidth
 *  codepoints take 2 columns; everything else 1. Used to pad table
 *  cells so columns line up inside a <pre><code> block on mobile
 *  Telegram clients, where the monospace font is the only alignment
 *  we can rely on (HTML <table> is not in the Telegram subset).
 *
 *  Slimmed-down copy of tui.ts `visibleWidth` that avoids pulling
 *  chalk + ANSI logic into the telegram bot path. */
function cellWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (cp > 0xFFFF) i++; // skip surrogate low half
    // CJK / Hangul / fullwidth / kana — the ranges Telegram's
    // mobile monospace renderer treats as double-width.
    if (
      (cp >= 0x1100 && cp <= 0x115F) ||
      (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) ||
      (cp >= 0xAC00 && cp <= 0xD7AF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE10 && cp <= 0xFE6F) ||
      (cp >= 0xFF01 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Convert a markdown string to the Telegram HTML subset. Pure
 *  function — feed it the LLM's raw reply, pair the output with
 *  `parse_mode: 'HTML'` on sendMessage. */
export function markdownToTelegramHtml(md: string): string {
  const blocks: string[] = [];
  const stash = (html: string): string => {
    const idx = blocks.length;
    blocks.push(html);
    return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
  };

  let out = md;

  // 1. Fenced code blocks first — their contents are opaque to later
  //    passes. Handles ```lang\ncode``` and bare ```code```. Trailing
  //    newline inside the fence is dropped so <pre> doesn't gain an
  //    extra blank line.
  out = out.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    const body = escapeHtml(code.replace(/\n$/, ''));
    const cls = lang.trim() ? ` class="language-${escapeHtmlAttr(lang.trim())}"` : '';
    return stash(`<pre><code${cls}>${body}</code></pre>`);
  });

  // 1b. Markdown tables. Telegram HTML has no <table> tag, so we render
  //     tables into a padded monospace block wrapped in <pre><code> —
  //     the same pattern openclaw uses for its "code" tableMode (its
  //     default for Telegram). This preserves column alignment on both
  //     mobile and desktop clients. Runs before inline-code / escape so
  //     the stashed <pre> content sails through those passes untouched.
  out = renderMarkdownTables(out, stash);

  // 2. Inline code — single-line only (multi-line is the fenced case).
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    stash(`<code>${escapeHtml(code)}</code>`));

  // 3. Links — stash so bold/italic passes don't mangle the label and
  //    so the URL is never mistaken for markdown. Drop malformed entries
  //    (empty label or href) back into the text stream literally.
  out = out.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, (m, text: string, url: string) => {
    const safeHref = escapeHtmlAttr(url.trim());
    const safeText = escapeHtml(text);
    if (!safeHref || !safeText) return m;
    return stash(`<a href="${safeHref}">${safeText}</a>`);
  });

  // 3b. Spoiler `||text||` → <tg-spoiler>. Stashed so the inner text
  //     isn't touched by bold/italic passes, matching openclaw's
  //     enableSpoilers flow.
  out = out.replace(/\|\|([^\n|]+)\|\|/g, (_m, content: string) =>
    stash(`<tg-spoiler>${escapeHtml(content)}</tg-spoiler>`));

  // 3c. Bare file references — wrap `foo.ts`, `src/server.py`, etc. in
  //     <code> so Telegram's client doesn't auto-link them (treating
  //     them as domains like foo.tv) and so the path renders in a
  //     monospace span like inline code. Curated extension list keeps
  //     out TLD-heavy domains the user is more likely to mean as URLs
  //     (.ai, .io, .tv, .fm). openclaw's format.ts uses the same
  //     "wrap standalone file refs" approach.
  out = out.replace(FILE_REF_RE, (_m, prefix: string, filename: string) =>
    `${prefix}${stash(`<code>${escapeHtml(filename)}</code>`)}`);

  // 4. Escape the remaining text. After this, markdown operators (`*`,
  //    `_`, `~`) are still literal since escapeHtml only touches &<>;
  //    the inline passes below can still match them.
  out = escapeHtml(out);

  // 5. Inline emphasis. Order matters: run **bold** before *italic*
  //    so `**x**` doesn't get eaten as nested italic. Lookbehind/ahead
  //    keep `*` adjacent to another `*` out of the italic path.
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/__([^_\n]+?)__/g, '<b>$1</b>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>');
  out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?!_)/g, '$1<i>$2</i>');
  out = out.replace(/~~([^~\n]+?)~~/g, '<s>$1</s>');

  // 6. Block-level line transforms. `>` has already been escaped to
  //    `&gt;` by step 4, so the blockquote regex looks for that.
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      lines[i] = `<b>${heading[2]}</b>`;
      continue;
    }
    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) {
      lines[i] = `<blockquote>${bq[1]}</blockquote>`;
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      lines[i] = `${bullet[1]}• ${bullet[2]}`;
      continue;
    }
  }
  out = lines.join('\n');

  // 7. Restore stashed HTML. Placeholders are unambiguous (NUL-wrapped
   //   index) so a simple global replace is safe.
  out = out.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, 'g'),
    (_m, idx: string) => blocks[Number(idx)] ?? '',
  );

  return out;
}

// ── Markdown table → padded monospace block ──
//
// A markdown table is:
//
//   | Header1 | Header2 |
//   |---------|---------|
//   | cell a  | cell b  |
//
// Leading/trailing pipes are optional on each row. The separator row
// (line 2) carries alignment markers (`:---`, `---:`, `:---:`). We
// detect the header+separator pair, collect body rows until a
// non-table line, pad each cell to the widest in its column, and wrap
// the whole thing in <pre><code>…</code></pre>.

const TABLE_ROW_RE = /^\s*\|?.*\|.*\|?\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function isTableRow(line: string): boolean {
  // Must have at least one `|` in the interior. The row regex alone
  // would match e.g. `a|b` which is ambiguous — require the trimmed
  // string to start/end with `|` OR contain 2+ pipes (consistent with
  // openclaw's detection).
  if (!TABLE_ROW_RE.test(line)) return false;
  const trimmed = line.trim();
  if (trimmed.startsWith('|') || trimmed.endsWith('|')) return true;
  return (trimmed.match(/\|/g)?.length ?? 0) >= 2;
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(c => c.trim());
}

function renderMarkdownTables(md: string, stash: (html: string) => string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i]!;
    const sep = lines[i + 1];
    if (sep && isTableRow(header) && TABLE_SEP_RE.test(sep)) {
      const headerCells = parseTableRow(header);
      const sepCells = parseTableRow(sep);
      // Separator must have the same column count as the header —
      // otherwise it's probably just a horizontal rule that happens to
      // look like a separator. Fall back to treating the line as prose.
      if (sepCells.length === headerCells.length) {
        const bodyRows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && isTableRow(lines[j]!)) {
          bodyRows.push(parseTableRow(lines[j]!));
          j++;
        }
        const rendered = renderMonospaceTable(headerCells, bodyRows);
        out.push(stash(`<pre><code>${escapeHtml(rendered)}</code></pre>`));
        i = j;
        continue;
      }
    }
    out.push(header);
    i++;
  }
  return out.join('\n');
}

function renderMonospaceTable(headerCells: string[], bodyRows: string[][]): string {
  const numCols = headerCells.length;
  // Normalize body-row widths to the header width (pad missing cells
  // with empty strings, truncate overflow) so later padding math works.
  const normalized = bodyRows.map(row => {
    const copy = row.slice(0, numCols);
    while (copy.length < numCols) copy.push('');
    return copy;
  });

  const widths: number[] = new Array(numCols).fill(0);
  const measure = (cells: string[]) => {
    for (let c = 0; c < numCols; c++) {
      const w = cellWidth(cells[c] ?? '');
      if (w > widths[c]!) widths[c] = w;
    }
  };
  measure(headerCells);
  for (const row of normalized) measure(row);

  const padRight = (cell: string, w: number): string =>
    cell + ' '.repeat(Math.max(0, w - cellWidth(cell)));

  const renderRow = (cells: string[]): string =>
    '| ' + cells.map((c, k) => padRight(c, widths[k] ?? 0)).join(' | ') + ' |';

  const sep = '|-' + widths.map(w => '-'.repeat(w)).join('-|-') + '-|';

  const lines = [renderRow(headerCells), sep, ...normalized.map(renderRow)];
  return lines.join('\n');
}

/** Split markdown at paragraph boundaries so each chunk renders to HTML
 *  well under Telegram's 4096-char per-message cap. The HTML output
 *  inflates the text (~7 chars per <b></b> pair), so we budget the
 *  plain markdown cap conservatively below 4096. A paragraph that
 *  exceeds the budget on its own is split at line boundaries; if still
 *  too long, hard-sliced. */
export function splitMarkdownForTelegram(md: string, htmlMaxChars: number = 4096): string[] {
  if (!md) return [];
  // 0.75 gives more headroom than 0.85 did — bold-heavy prose and
  // tables (whose <pre><code> wrappers + escapeHtml expansion can
  // double the byte count) were occasionally overshooting the 4096
  // cap and falling back to the plain-text path. Lower budget keeps
  // HTML comfortably under with room for markdown-level inflation.
  const budget = Math.max(512, Math.floor(htmlMaxChars * 0.75));
  if (md.length <= budget) return [md];

  const paragraphs = md.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf) { chunks.push(buf); buf = ''; }
  };

  for (const p of paragraphs) {
    if (!p) continue;
    if (p.length > budget) {
      // Oversized paragraph — flush current buf, then split by lines.
      flush();
      const lines = p.split('\n');
      let lineBuf = '';
      for (const ln of lines) {
        if (ln.length > budget) {
          if (lineBuf) { chunks.push(lineBuf); lineBuf = ''; }
          // Hard slice as a last resort.
          for (let i = 0; i < ln.length; i += budget) {
            chunks.push(ln.slice(i, i + budget));
          }
          continue;
        }
        if (lineBuf.length + 1 + ln.length > budget) {
          chunks.push(lineBuf);
          lineBuf = ln;
        } else {
          lineBuf = lineBuf ? `${lineBuf}\n${ln}` : ln;
        }
      }
      if (lineBuf) chunks.push(lineBuf);
      continue;
    }
    if (buf.length + 2 + p.length > budget) {
      flush();
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  flush();
  return chunks;
}

/** Heuristic: does an api error response look like a "can't parse
 *  entities" failure that we should retry as plain text? Mirrors the
 *  regex openclaw uses. */
export function isTelegramParseEntityError(err: unknown): boolean {
  const desc = typeof err === 'object' && err !== null
    ? (err as { description?: unknown }).description
    : undefined;
  if (typeof desc !== 'string') return false;
  return /can't parse entities|parse entities|entity|byte offset/i.test(desc);
}
