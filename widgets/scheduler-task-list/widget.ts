import type { Widget } from '../../src/widgets/types.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import {
  cursorable,
  hoverTint,
  applyHoverableListRowEvent,
} from '../../src/widget-behaviors/index.js';

export interface SchedulerTaskCard {
  taskId: string;
  title: string;
  status: string;
  targetType: string;
  taskType?: string;
  triggerType?: string;
  schedule: string;
  nextRunAt?: string;
  assignee?: string;
  tags?: string[];
  selected?: boolean;
}

export interface SchedulerTaskListState {
  cards: SchedulerTaskCard[];
  cursor: number;
  offset: number;
  focused: boolean;
  emptyLabel?: string;
  hoveredItemIndex?: number | null;
}

export interface SchedulerTaskListConfig {
  cards?: SchedulerTaskCard[];
  emptyLabel?: string;
}

const CARD_H = 4;

/** Shared by onMouse(click/double-click) and describeHit. Fixed title
 *  offset + scroll offset + CARD_H grouping in one pure helper so the
 *  click handler and the drag / hover metadata path always agree on
 *  which card is under (localRow, localCol). */
function rowToCardIndex(
  state: { offset: number; cards: readonly unknown[] },
  localRow: number,
): number | null {
  const bodyRow = localRow - 1;
  if (bodyRow < 0) return null;
  const cardIdx = state.offset + Math.floor(bodyRow / CARD_H);
  if (cardIdx < 0 || cardIdx >= state.cards.length) return null;
  return cardIdx;
}

const schedulerTaskListWidget: Widget<SchedulerTaskListState, SchedulerTaskListConfig> = {
  type: 'scheduler-task-list',
  description: 'Scheduler task cards with title, target, tags, schedule, and assignment metadata',
  defaultCharacter: 'Scheduler',

  // Phase 3c — Cursorable owns j/k/↑↓/g/G/Home/End against state.cursor
  // with item count derived from state.cards.length. Widget's own onKey
  // keeps only the Enter action (submit the focused card's taskId).
  behaviors: [
    cursorable<SchedulerTaskListState>({ getItemCount: (s) => s.cards.length }),
  ],

  initialState(config) {
    return {
      cards: config?.cards ?? [],
      cursor: 0,
      offset: 0,
      focused: false,
      emptyLabel: config?.emptyLabel,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1) return lines;

    const hasTitle = h >= 2;
    const titleRow = hasTitle ? paneTitle(character, ctx.focused, w) : '';
    if (titleRow) lines.push(titleRow);
    const bodyH = Math.max(0, h - lines.length);
    if (bodyH === 0) return lines;

    const cards = state.cards;
    if (cards.length === 0) {
      const label = C.muted(state.emptyLabel ?? '(empty)');
      lines.push(pad(` ${label}`, w));
      while (lines.length < h) lines.push(' '.repeat(w));
      return lines;
    }

    const visibleCards = Math.max(1, Math.floor(bodyH / CARD_H));
    let offset = state.offset;
    if (state.cursor < offset) offset = state.cursor;
    if (state.cursor >= offset + visibleCards) offset = state.cursor - visibleCards + 1;
    offset = Math.max(0, Math.min(offset, Math.max(0, cards.length - visibleCards)));
    state.offset = offset;

    for (let i = 0; lines.length < h && i < visibleCards; i++) {
      const idx = offset + i;
      const card = cards[idx];
      if (!card) break;
      const isCursor = idx === state.cursor;
      const isHovered = !isCursor && !card.selected && state.hoveredItemIndex === idx;
      for (const row of renderCard(card, Math.max(10, w), isCursor, ctx.focused, isHovered)) {
        if (lines.length < h) lines.push(row);
      }
    }

    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  // Phase 3c — Cursorable handles cursor nav. Widget onKey keeps only
  // the Enter action since cards[cursor].taskId is widget-specific.
  onKey(ev, state) {
    if (ev.name !== 'enter') return { type: 'none' };
    const card = state.cards[state.cursor];
    return card ? { type: 'submit', text: `scheduler:${card.taskId}` } : { type: 'none' };
  },

  /** MD6 — scroll + click + double-click. Each card occupies CARD_H
   *  rows (4) after the 1-row title, so card index for a click at
   *  widget-local row R is `offset + floor((R - 1) / CARD_H)`. */
  onMouse(ev, state) {
    const max = state.cards.length - 1;
    if (max < 0) return { type: 'none' };
    if (ev.type === 'scroll-up') {
      state.cursor = Math.max(0, state.cursor - 1);
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      state.cursor = Math.min(max, state.cursor + 1);
      return { type: 'refresh' };
    }
    if (ev.type === 'click' || ev.type === 'double-click') {
      const cardIdx = rowToCardIndex(state, ev.row);
      if (cardIdx === null) return { type: 'none' };
      state.cursor = cardIdx;
      if (ev.type === 'double-click') {
        const card = state.cards[cardIdx]!;
        return { type: 'submit', text: `scheduler:${card.taskId}` };
      }
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  /** IDX-F5d Phase 2 (2026-04-22) — hit refinement for card-shaped
   *  rows. Cards are CARD_H terminal rows tall, so one body row maps
   *  to `offset + floor(bodyRow / CARD_H)`. Returns `list-row` kind
   *  (re-used for card lists — the descriptor is row-indexed; CARD_H
   *  internals are a render detail consumers don't need). */
  describeHit(state, _ctx, localRow, _localCol) {
    const idx = rowToCardIndex(state, localRow);
    if (idx === null) return null;
    return { kind: 'list-row', itemIndex: idx };
  },

  onHover(ev, state, ctx) {
    applyHoverableListRowEvent(ev, state, ctx, 'scheduler-task-list');
  },

  // WR-4 (S3.B · 2026-04-27 · UI Core closure) — opt-in state observation.
  // Cursor + card-set size are the meaningful transitions for an LLM
  // watching the scheduler surface. focused is included in the hash so
  // a recorder marks focus enter/leave even when no row changes; it's
  // not telemetry-emitted because focus toggles fire from a separate
  // host-level event already. replayState omitted (Plan B · peer
  // pattern) — pure data state, host default suffices.
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'scheduler-task-list.cursor.change',
        data: { from: prev.cursor, to: next.cursor, total: next.cards.length },
      });
    }
    if (prev.cards.length !== next.cards.length) {
      ctx.telemetry?.emit({
        kind: 'scheduler-task-list.cards.change',
        data: { from: prev.cards.length, to: next.cards.length },
      });
    }
  },

  snapshotHash(state): string {
    return `${state.cursor}:${state.cards.length}:${state.focused ? 1 : 0}`;
  },

  // One-line LLM summary — task count + cursor + focus bit. Empty-label
  // surfaces when the list is empty so an agent reading the surface
  // sees "(no tasks)" instead of just "0 tasks".
  describeSurface(state, ctx): string {
    if (state.cards.length === 0) {
      return `${ctx.character} · ${state.emptyLabel ?? '(empty)'}`;
    }
    const parts = [ctx.character, `${state.cards.length} tasks`, `cursor ${state.cursor}`];
    if (state.focused) parts.push('focused');
    return parts.join(' · ');
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        cards: {
          type: 'array',
          description: 'Scheduler task cards shown in list order.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              taskId: { type: 'string' },
              title: { type: 'string' },
              status: { type: 'string' },
              targetType: { type: 'string' },
              taskType: { type: 'string' },
              triggerType: { type: 'string' },
              schedule: { type: 'string' },
              nextRunAt: { type: 'string' },
              assignee: { type: 'string' },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
              selected: { type: 'boolean' },
            },
            required: ['taskId', 'title', 'status', 'targetType', 'schedule'],
          },
        },
        emptyLabel: {
          type: 'string',
          description: 'Fallback label when the task list is empty.',
        },
      },
      additionalProperties: false,
    };
  },
};

function renderCard(
  card: SchedulerTaskCard,
  width: number,
  isCursor: boolean,
  focused: boolean,
  isHovered: boolean,
): string[] {
  const active = focused && isCursor;
  const borderColor = active ? C.border : card.selected ? C.accent : C.muted;
  const textColor = active || card.selected ? C.text : C.subtext;
  const inner = Math.max(8, width - 2);
  const title = textColor(truncate(card.title || '(untitled)', Math.max(4, inner - 2)));
  const top = borderColor('╭') + padVisible(` ${title} `, inner, '─', borderColor) + borderColor('╮');

  const tags = normalizeTags(card);
  const tagLine = tags.map(tag => badge(tag)).join(' ');
  const statusDot = statusGlyph(card.status);
  const row1 = framed(`${tagLine} ${statusDot}`, inner, borderColor);

  const schedule = card.nextRunAt ? `${shortTime(card.nextRunAt)} · ${card.schedule}` : card.schedule || '(not scheduled)';
  const row2 = framed(C.info(truncate(schedule, inner - 2)), inner, borderColor);

  const bottom = borderColor('╰' + '─'.repeat(inner) + '╯');
  const rows = [top, row1, row2, bottom];
  return isHovered ? rows.map(hoverTint) : rows;
}

function normalizeTags(card: SchedulerTaskCard): string[] {
  const tags = [...(card.tags ?? [])];
  if (card.taskType && !tags.includes(card.taskType)) tags.unshift(card.taskType);
  if (!tags.includes(card.targetType)) tags.unshift(card.targetType);
  return tags.slice(0, 3);
}

function badge(text: string): string {
  return C.muted('[') + C.accent(truncate(text.toUpperCase(), 12)) + C.muted(']');
}

function statusGlyph(status: string): string {
  if (status === 'active') return C.warning('●');
  if (status === 'ready') return C.success('●');
  if (status === 'paused') return C.muted('Ⅱ');
  return C.info('○');
}

function framed(content: string, inner: number, borderColor: (s: string) => string): string {
  return borderColor('│') + pad(` ${content}`, inner) + borderColor('│');
}

function pad(raw: string, width: number): string {
  return raw + ' '.repeat(Math.max(0, width - visibleWidth(raw)));
}

function padVisible(raw: string, width: number, fill: string, fillColor: (s: string) => string): string {
  const padN = Math.max(0, width - visibleWidth(raw));
  return raw + fillColor(fill.repeat(padN));
}

function shortTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default schedulerTaskListWidget;
