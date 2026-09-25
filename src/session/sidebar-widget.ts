// ── Sessions Sidebar (ST3 + UB) ──
//
// Vertical-tab list of live SessionCards for the dashboard's
// optional leadColumn slot (ST1). Each row shows:
//
//   <icon> <title>                 [●status]
//
// Icons map to AgentKind (◆ claude / ◇ codex / ◈ gemini / ◉ aider /
// ▫ shell / ● other). Status badge is colored by the 4-state
// machine populated by US1 (idle/working/awaiting/done/err).
//
// UB (agent toolbelt). When the cursor rests on a non-shell agent
// card the last row of the sidebar is reclaimed for a 3-button bar
//   [Attach] [Review] [Status]
// Click or `t` keypress emits `submit toolbelt:<action>:<id>` which
// the dashboard dispatches. Attach + Review are stub buttons in
// session M (toast "coming soon"); Status prints the most recent
// event summary to the log pane.

import type { WidgetDef } from '../widgets/types.js';
import type { AgentKind, SessionCard, SessionStatus } from './card.js';
import { AGENT_KIND_ICON } from './card.js';
import { C, truncate, visibleWidth } from '../tui.js';
import { paneTitle } from '../panes/pane-title.js';
import { icon as themeIcon } from '../theme/icons.js';
import {
  isClickIntentMouseEventType,
  isPrimaryClickMouseEventType,
} from '../ui/mouse-events.js';

export type ToolbeltButton = 'attach' | 'review' | 'status';

export interface ToolbeltButtonSpec {
  readonly id: ToolbeltButton;
  readonly label: string;
  /** Inclusive-exclusive [start, end) column range for hit-testing. */
  readonly startCol: number;
  readonly endCol: number;
}

const TOOLBELT_LABELS: Record<ToolbeltButton, string> = {
  attach: '[Attach]',
  review: '[Review]',
  status: '[Status]',
};

const TOOLBELT_ORDER: readonly ToolbeltButton[] = ['attach', 'review', 'status'];

export function layoutToolbelt(width: number): ToolbeltButtonSpec[] {
  const out: ToolbeltButtonSpec[] = [];
  let col = 1; // start at col 1 so there's a single-space left padding
  for (const id of TOOLBELT_ORDER) {
    const label = TOOLBELT_LABELS[id];
    const w = visibleWidth(label);
    if (col + w > width) break;
    out.push({ id, label, startCol: col, endCol: col + w });
    col += w + 1; // single-space separator
  }
  return out;
}

export function renderToolbeltLine(width: number, disabled: ReadonlySet<ToolbeltButton>): string {
  const specs = layoutToolbelt(width);
  const parts: string[] = [' '];
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i]!;
    parts.push(disabled.has(s.id) ? C.muted(s.label) : C.info(s.label));
    if (i < specs.length - 1) parts.push(' ');
  }
  const out = parts.join('');
  const pad = Math.max(0, width - visibleWidth(out));
  return out + ' '.repeat(pad);
}

export function shouldShowToolbelt(card: SessionCard | undefined): boolean {
  if (!card) return false;
  const kind: AgentKind = card.agentKind;
  return kind !== 'shell' && kind !== 'other' && kind !== 'background';
}

export interface SessionsSidebarState {
  cards: SessionCard[];
  cursor: number;
  offset: number;
}

export interface SessionsSidebarConfig {
  cards?: SessionCard[];
  cursor?: number;
}

// IDX-6 Phase 6 migration — status glyphs route through theme-icons.
// `idle` / `working` / `awaiting` have no direct IconTokens slot
// (they're session-specific), so their decorative glyphs stay inline;
// `done` → IconTokens.done (✅/[v]), `err` → IconTokens.error (❌/[E]).
// Evaluated per-call so /theme switch / MONAD_ASCII_ICONS updates
// propagate on next render without widget rebuild.
function statusGlyph(status: SessionStatus): string {
  switch (status) {
    case 'done':     return themeIcon('done');
    case 'err':      return themeIcon('error');
    case 'awaiting': return '◐';
    case 'working':  return '●';
    case 'idle':
    default:         return '○';
  }
}

function colorForStatus(text: string, status: SessionStatus, focused: boolean): string {
  if (!focused) return C.subtext(text);
  switch (status) {
    case 'working':  return C.info(text);
    case 'awaiting': return C.warning(text);
    case 'done':     return C.success(text);
    case 'err':      return C.error(text);
    case 'idle':
    default:         return C.muted(text);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function formatRow(card: SessionCard, width: number): { body: string; badge: string; unread: string } {
  const icon = AGENT_KIND_ICON[card.agentKind] ?? '●';
  const titleRaw = card.title || card.id;
  const title = card.isAlive ? titleRaw : `${titleRaw} (exited)`;
  const badge = `[${statusGlyph(card.status)}${card.status}]`;
  // NT3 — unread count chip. Capped at 99 so single-cell TUI math
  // stays simple; >99 collapses to "99+".
  const n = card.unreadCount ?? 0;
  const unread = n <= 0 ? '' : ` (${n > 99 ? '99+' : String(n)})`;
  const leadLen = 1 + 1 + visibleWidth(icon) + 1; // space + icon + space
  const badgeLen = visibleWidth(badge) + 1;
  const unreadLen = visibleWidth(unread);
  const room = Math.max(1, width - leadLen - badgeLen - unreadLen);
  const shown = visibleWidth(title) > room ? truncate(title, room) : title;
  const pad = Math.max(0, width - leadLen - visibleWidth(shown) - badgeLen - unreadLen);
  const body = ` ${icon} ${shown}${unread}${' '.repeat(pad)}`;
  return { body, badge, unread };
}

const sessionsSidebarWidget: WidgetDef<SessionsSidebarState, SessionsSidebarConfig> = {
  type: 'sessions-sidebar',
  description: 'Vertical session list — PTY / ACP / scheduler sources with agentKind icon + status badge',
  defaultCharacter: 'Sessions',

  initialState(config) {
    return {
      cards: config?.cards ?? [],
      cursor: Math.max(0, config?.cursor ?? 0),
      offset: 0,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (w < 4 || h < 1) return lines;

    if (h >= 2) lines.push(paneTitle(character, ctx.focused, w));

    if (state.cards.length === 0) {
      const empty = [
        C.muted('  No sessions.'),
        '',
        C.muted('  Spawn via RunShell (vw)'),
        C.muted('  or PtyShellStart.'),
      ];
      while (lines.length < h) {
        const next = empty[lines.length - (h >= 2 ? 1 : 0)];
        lines.push(next !== undefined ? fit(next, w) : ' '.repeat(w));
      }
      return lines;
    }

    state.cursor = clamp(state.cursor, 0, state.cards.length - 1);
    const selected = state.cards[state.cursor];
    const showToolbelt = h >= 4 && shouldShowToolbelt(selected);
    const reserved = showToolbelt ? 1 : 0;
    const bodyH = Math.max(0, h - lines.length - reserved);
    if (bodyH <= 0) {
      if (showToolbelt && lines.length < h) {
        lines.push(renderToolbeltLine(w, new Set(['attach', 'review'])));
      }
      return lines;
    }

    let offset = state.offset;
    if (state.cursor < offset) offset = state.cursor;
    if (state.cursor >= offset + bodyH) offset = state.cursor - bodyH + 1;
    offset = clamp(offset, 0, Math.max(0, state.cards.length - bodyH));
    state.offset = offset;

    for (let i = 0; i < bodyH; i++) {
      const idx = offset + i;
      if (idx >= state.cards.length) {
        lines.push(' '.repeat(w));
        continue;
      }
      const card = state.cards[idx]!;
      const { body, badge } = formatRow(card, w);
      const painted = colorForStatus(badge, card.status, ctx.focused);
      const row = `${body}${painted}`;
      const isCur = idx === state.cursor;
      if (isCur && ctx.focused) lines.push(C.cursor(row));
      else if (isCur)            lines.push(C.cursorAlt(row));
      else if (!card.isAlive)    lines.push(C.muted(row));
      else if (ctx.focused)      lines.push(C.text(row));
      else                       lines.push(C.subtext(row));
    }
    if (showToolbelt) {
      // attach + review are stubs in session M — dim them so users see
      // the path is coming without thinking the click is broken.
      lines.push(renderToolbeltLine(w, new Set(['attach', 'review'])));
    }
    return lines;
  },

  onKey(ev, state) {
    const max = state.cards.length - 1;
    if (max < 0) return { type: 'none' };
    switch (ev.name) {
      case 'j': case 'down':
        state.cursor = Math.min(state.cursor + 1, max);
        return { type: 'refresh' };
      case 'k': case 'up':
        state.cursor = Math.max(state.cursor - 1, 0);
        return { type: 'refresh' };
      case 'g': case 'home':
        state.cursor = 0;
        state.offset = 0;
        return { type: 'refresh' };
      case 'G': case 'end':
        state.cursor = max;
        return { type: 'refresh' };
      case 'enter': {
        const card = state.cards[state.cursor];
        return card ? { type: 'submit', text: `session:${card.id}` } : { type: 'none' };
      }
      default:
        return { type: 'none' };
    }
  },

  onMouse(ev, state) {
    if (state.cards.length === 0) return { type: 'none' };
    if (ev.type === 'scroll-up') {
      state.cursor = Math.max(state.cursor - 1, 0);
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      state.cursor = Math.min(state.cursor + 1, state.cards.length - 1);
      return { type: 'refresh' };
    }
    if (isClickIntentMouseEventType(ev.type)) {
      if (ev.row <= 0) return { type: 'none' };
      // Card click: row 1..bodyH map to offset..offset+bodyH-1.
      const idx = state.offset + (ev.row - 1);
      if (idx >= 0 && idx < state.cards.length) {
        state.cursor = idx;
        const card = state.cards[idx]!;
        return !isPrimaryClickMouseEventType(ev.type)
          ? { type: 'submit', text: `session:${card.id}` }
          : { type: 'refresh' };
      }
      // Past the card list — could be the reserved toolbelt row when
      // the selected card is agent-typed. A card's id is embedded in
      // the action text so the dashboard action dispatcher doesn't
      // need to consult the widget state.
      const selected = state.cards[state.cursor];
      if (shouldShowToolbelt(selected)) {
        for (const s of layoutToolbelt(Number.MAX_SAFE_INTEGER)) {
          if (ev.col >= s.startCol && ev.col < s.endCol) {
            return { type: 'submit', text: `toolbelt:${s.id}:${selected!.id}` };
          }
        }
      }
      return { type: 'none' };
    }
    return { type: 'none' };
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          description: 'Visible session cards in sidebar order.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              agentKind: { type: 'string' },
              status: { type: 'string' },
              isAlive: { type: 'boolean' },
              unreadCount: { type: 'number' },
            },
            required: ['id', 'agentKind', 'status'],
          },
        },
        cursor: {
          type: 'number',
          description: 'Initial selected row index.',
        },
      },
      additionalProperties: false,
    };
  },
};

function fit(line: string, width: number): string {
  const shown = visibleWidth(line) > width ? truncate(line, width) : line;
  return shown + ' '.repeat(Math.max(0, width - visibleWidth(shown)));
}

export default sessionsSidebarWidget;
