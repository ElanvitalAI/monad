/**
 * Board ANSI renderer.
 *
 * Origin: 내부 문서 `PLAN-session-tox-board-ansi`.
 *
 * Turns a `BoardLayout` (from computeBoard) into a terminal-ready
 * string. Pure function — no IO, no theme module, no external deps.
 * Hardcoded 6-color palette keeps the module portable across terminals
 * + safe to import from anywhere (no circular risk with theme-tokens).
 */
import type { BoardLayout, BoardColumn, BoardColumnKey } from './layout.js';
import type { BoardCard } from './card.js';

// ───────────────────────── Options + palette ──────────────────────

export interface RenderOptions {
  /** Emit ANSI color escape sequences. Default true — callers writing
   *  to a file or log should pass false. */
  color?: boolean;
  /** Include badges (retry/goal/estimate/feature/generated) on the
   *  second card line. Default true. */
  showBadges?: boolean;
  /** Bottom summary bar ("📊 total: N · oldest: Xh ago · mode: wide").
   *  Default true. */
  showSummary?: boolean;
  /** Lines per card. 1 = id/title only; 2 = +badges; 3 = +age.
   *  Default 2. */
  cardLines?: 1 | 2 | 3;
  /** Indent inside a column body. Default two spaces. */
  indent?: string;
}

const DEFAULT_CARD_LINES = 2;

/** Hardcoded 16-color ANSI palette. Bright colors (90-97) render well
 *  on most terminals (light + dark). */
const PALETTE = {
  columnHeader: 94,  // bright blue
  backlog: 90,       // dim
  ready: 92,         // bright green
  running: 93,       // bright yellow
  review: 95,        // bright magenta
  failed: 91,        // bright red
  done: 90,          // dim
  urgent: 91,
  high: 93,
  medium: 97,
  low: 90,
  muted: 90,
  overflow: 36,      // cyan
} as const;

// ───────────────────────── Public entry ───────────────────────────

export function renderBoardAnsi(layout: BoardLayout, opts: RenderOptions = {}): string {
  const color = opts.color ?? true;
  const showBadges = opts.showBadges ?? true;
  const showSummary = opts.showSummary ?? true;
  const cardLines = (opts.cardLines ?? DEFAULT_CARD_LINES) as 1 | 2 | 3;
  const indent = opts.indent ?? '  ';

  let body: string;
  switch (layout.mode) {
    case 'wide':
      body = renderWide(layout, { color, showBadges, cardLines, indent });
      break;
    case 'grid':
      body = renderGrid(layout, { color, showBadges, cardLines, indent });
      break;
    case 'compact':
    default:
      body = renderCompact(layout, { color, showBadges, cardLines, indent });
      break;
  }

  if (!showSummary) return body;
  const summary = renderSummary(layout, color);
  return body + '\n' + summary;
}

// ───────────────────────── Wide layout (4 columns) ────────────────

interface RenderCtx {
  color: boolean;
  showBadges: boolean;
  cardLines: 1 | 2 | 3;
  indent: string;
}

function renderWide(layout: BoardLayout, ctx: RenderCtx): string {
  const colCount = layout.columns.length;
  const colWidth = Math.max(20, Math.floor(layout.viewport.width / colCount) - 1);
  const lines: string[] = [];

  // Header row
  const headers = layout.columns
    .map((c) => formatHeader(c.title, c.total, colWidth, ctx.color))
    .join('│');
  lines.push('┌' + '─'.repeat(colWidth) + (('┬' + '─'.repeat(colWidth)).repeat(colCount - 1)) + '┐');
  lines.push('│' + headers + '│');
  lines.push('├' + '─'.repeat(colWidth) + (('┼' + '─'.repeat(colWidth)).repeat(colCount - 1)) + '┤');

  // Card rows — build per-column rendered line arrays then zip.
  const perColumn = layout.columns.map((c) => {
    const rows: string[] = [];
    for (const card of c.cards) {
      rows.push(...renderCardLines(card, colWidth - 2, ctx));
    }
    const overflow = layout.overflow[c.key];
    if (overflow > 0) {
      rows.push(ansiize(ctx.color, PALETTE.overflow, ` + ${overflow} more`).padEnd(colWidth));
    }
    return rows;
  });
  const maxRows = Math.max(...perColumn.map((r) => r.length), 1);
  for (let i = 0; i < maxRows; i++) {
    const row = perColumn
      .map((col) => padDisplay(col[i] ?? '', colWidth))
      .join('│');
    lines.push('│' + row + '│');
  }
  lines.push('└' + '─'.repeat(colWidth) + (('┴' + '─'.repeat(colWidth)).repeat(colCount - 1)) + '┘');
  return lines.join('\n');
}

// ───────────────────────── Grid layout (2x2) ──────────────────────

function renderGrid(layout: BoardLayout, ctx: RenderCtx): string {
  const colWidth = Math.max(20, Math.floor(layout.viewport.width / 2) - 1);
  const cols = layout.columns;
  const topPair = [cols[0]!, cols[1]!];
  const bottomPair = [cols[2]!, cols[3]!];
  const top = renderPair(topPair, colWidth, ctx);
  const bottom = renderPair(bottomPair, colWidth, ctx);
  return top + '\n' + bottom;
}

function renderPair(pair: BoardColumn[], colWidth: number, ctx: RenderCtx): string {
  const lines: string[] = [];
  lines.push('┌' + '─'.repeat(colWidth) + '┬' + '─'.repeat(colWidth) + '┐');
  const headers = pair.map((c) => formatHeader(c.title, c.total, colWidth, ctx.color)).join('│');
  lines.push('│' + headers + '│');
  lines.push('├' + '─'.repeat(colWidth) + '┼' + '─'.repeat(colWidth) + '┤');
  const rows = pair.map((c) => {
    const arr: string[] = [];
    for (const card of c.cards) arr.push(...renderCardLines(card, colWidth - 2, ctx));
    return arr;
  });
  const maxRows = Math.max(...rows.map((r) => r.length), 1);
  for (let i = 0; i < maxRows; i++) {
    lines.push(
      '│' + padDisplay(rows[0]![i] ?? '', colWidth) + '│' + padDisplay(rows[1]![i] ?? '', colWidth) + '│',
    );
  }
  lines.push('└' + '─'.repeat(colWidth) + '┴' + '─'.repeat(colWidth) + '┘');
  return lines.join('\n');
}

// ───────────────────────── Compact layout ─────────────────────────

function renderCompact(layout: BoardLayout, ctx: RenderCtx): string {
  const out: string[] = [];
  const width = Math.max(30, layout.viewport.width - 2);
  for (const col of layout.columns) {
    const header = `▼ ${col.title} (${col.total})`;
    out.push(ansiize(ctx.color, PALETTE.columnHeader, header));
    for (const card of col.cards) {
      for (const line of renderCardLines(card, width - ctx.indent.length, ctx)) {
        out.push(ctx.indent + line);
      }
    }
    const overflow = layout.overflow[col.key];
    if (overflow > 0) {
      out.push(ctx.indent + ansiize(ctx.color, PALETTE.overflow, `+ ${overflow} more`));
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

// ───────────────────────── Card + headers ─────────────────────────

function formatHeader(
  title: string,
  total: number,
  width: number,
  color: boolean,
): string {
  const txt = ` ${title} (${total}) `;
  return ansiize(color, PALETTE.columnHeader, padDisplay(txt, width));
}

function renderCardLines(card: BoardCard, width: number, ctx: RenderCtx): string[] {
  const lines: string[] = [];
  lines.push(renderCardLine(card, width, ctx.color));
  if (ctx.cardLines >= 2 && ctx.showBadges && card.badges.length > 0) {
    const badgeText = card.badges.map((b) => `[${b.kind}:${b.text}]`).join(' ');
    lines.push(ansiize(ctx.color, PALETTE.muted, truncateDisplay('  ' + badgeText, width)));
  }
  if (ctx.cardLines >= 3) {
    const age = formatAge(card.ageMs);
    lines.push(ansiize(ctx.color, PALETTE.muted, `  age: ${age}`));
  }
  return lines;
}

export function renderCardLine(card: BoardCard, width: number, color: boolean): string {
  const glyph = card.surfaceGlyph;
  const priorityColor = statusColor(card.status, card.priority);
  const prefix = `${glyph} ${card.id.slice(-8)} `;
  const rawLine = prefix + card.title;
  const truncated = truncateDisplay(rawLine, width);
  return ansiize(color, priorityColor, truncated);
}

// ───────────────────────── Summary bar ────────────────────────────

function renderSummary(layout: BoardLayout, color: boolean): string {
  const total = layout.stats.total;
  const ageText = layout.stats.ageOldestMs === null ? 'n/a' : formatAge(layout.stats.ageOldestMs);
  const line = `📊 total: ${total} · oldest: ${ageText} · mode: ${layout.mode}`;
  return ansiize(color, PALETTE.muted, line);
}

// ───────────────────────── helpers ────────────────────────────────

function statusColor(
  status: string,
  priority: string,
): number {
  if (priority === 'urgent') return PALETTE.urgent;
  if (priority === 'high') return PALETTE.high;
  switch (status) {
    case 'ready': return PALETTE.ready;
    case 'running': return PALETTE.running;
    case 'review': return PALETTE.review;
    case 'failed': return PALETTE.failed;
    case 'done': return PALETTE.done;
    default: return PALETTE.backlog;
  }
}

function ansiize(color: boolean, code: number, text: string): string {
  if (!color) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

/** Truncate based on displayed characters (ignoring any existing ANSI).
 *  Our helpers never nest ANSI so this is safe. */
function truncateDisplay(s: string, width: number): string {
  if (s.length <= width) return s;
  if (width <= 1) return s.slice(0, width);
  return s.slice(0, width - 1) + '…';
}

function padDisplay(s: string, width: number): string {
  // Strip ANSI for length accounting.
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  if (plain.length >= width) {
    return truncateDisplay(s, width);
  }
  return s + ' '.repeat(width - plain.length);
}

function formatAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  return `${d}d`;
}
