import type { Widget } from '../../src/widgets/types.js';
import type { WidgetHoverEvent } from '../../src/widgets/types.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';
import { Scrollable, hoverTint } from '../../src/widget-behaviors/index.js';
import type {
  ConversationTranscriptLine,
  ConversationTranscriptMessage,
  ConversationWidgetStateLike,
  ConversationWidgetConfig,
} from '../../src/conv-dash/conversation-widget-model.js';
import { buildConversationTranscript } from '../../src/conv-dash/conversation-widget-model.js';

export interface ConversationWidgetState extends ConversationWidgetStateLike {
  sessionId: string;
  brand: string;
  title: string;
  summary: string;
  scroll: number;
  maxScroll?: number;
  lines: readonly ConversationTranscriptLine[];
  messages: readonly ConversationTranscriptMessage[];
  hoveredMessageId?: string | null;
}

const conversationWidget: Widget<ConversationWidgetState, ConversationWidgetConfig> = {
  type: 'conversation',
  description: 'Snapshot-backed embodied-agent conversation transcript widget',
  defaultCharacter: 'Conversation',
  behaviors: [Scrollable],

  initialState(config) {
    const transcript = buildConversationTranscript(config ?? {
      sessionId: 'unknown',
      brand: 'unknown',
      status: 'pending',
      transports: [],
    });
    return {
      sessionId: config?.sessionId ?? 'unknown',
      brand: config?.brand ?? 'unknown',
      title: transcript.title,
      summary: transcript.summary,
      scroll: 0,
      lines: transcript.lines,
      messages: transcript.messages,
      hoveredMessageId: null,
    };
  },

  render(state, ctx, character) {
    const out: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (w < 1 || h < 1) return out;

    const hasTitle = h >= 2;
    if (hasTitle) out.push(paneTitle(titleFor(character, state), ctx.focused, w));
    const bodyH = Math.max(0, h - out.length);
    if (bodyH === 0) return out;

    const maxScroll = Math.max(0, state.lines.length - bodyH);
    state.maxScroll = maxScroll;
    state.scroll = Math.max(0, Math.min(state.scroll, maxScroll));

    for (let i = 0; i < bodyH; i++) {
      const absoluteRow = state.scroll + i;
      const row = state.lines[absoluteRow];
      if (!row) {
        out.push(' '.repeat(w));
        continue;
      }
      out.push(styleLine(fit(row.text, w), row, state.hoveredMessageId));
    }
    return out;
  },

  onMouse(ev, state) {
    switch (ev.type) {
      case 'scroll-up':
        state.scroll = Math.max(0, state.scroll - 1);
        return { type: 'refresh' };
      case 'scroll-down':
        state.scroll = Math.min(state.maxScroll ?? state.scroll + 1, state.scroll + 1);
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  describeHit(state, ctx, localRow, _localCol) {
    const bodyRow = localRow - 1;
    if (bodyRow < 0) return null;
    const absoluteRow = state.scroll + bodyRow;
    const line = state.lines[absoluteRow];
    if (!line?.messageId) return null;
    const message = state.messages.find((entry) => entry.id === line.messageId);
    if (!message) return null;
    return {
      kind: 'conversation-message',
      sessionId: state.sessionId,
      messageId: message.id,
      role: message.role,
      ...(message.channel ? { channel: message.channel } : {}),
      rangeStart: message.lineStart,
      rangeEnd: message.lineEnd,
    };
  },

  onHover(ev, state, ctx) {
    applyConversationHover(ev, state, ctx.requestRender);
  },

  snapshotHash(state) {
    return `${state.sessionId}:${state.scroll}:${state.lines.length}`;
  },

  describeSurface(state, ctx) {
    return `${ctx.character} · session ${state.sessionId} · ${state.summary}`;
  },

  configSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string' },
        brand: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
        startedAt: { type: 'number' },
        finishedAt: { type: 'number' },
        updatedAt: { type: 'number' },
        lastEvent: { type: 'string' },
        transports: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string' },
              id: { type: 'string' },
              label: { type: 'string' },
            },
            required: ['kind', 'id'],
          },
        },
        snapshotChannels: {
          type: 'array',
          items: { type: 'string' },
        },
        channelSnapshots: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        snapshotText: { type: 'string' },
      },
      required: ['sessionId', 'brand', 'status', 'transports'],
    };
  },
};

function titleFor(character: string, state: ConversationWidgetState): string {
  const title = state.title.trim().length > 0 ? state.title : `${state.brand} conversation`;
  return `${character} · ${title}`;
}

function fit(line: string, width: number): string {
  const shown = visibleWidth(line) > width ? truncate(line, width) : line;
  return shown + ' '.repeat(Math.max(0, width - visibleWidth(shown)));
}

function styleLine(
  line: string,
  row: ConversationTranscriptLine,
  hoveredMessageId: string | null | undefined,
): string {
  const hovered = hoveredMessageId !== null && hoveredMessageId !== undefined && row.messageId === hoveredMessageId;
  if (row.emphasis === 'meta') return C.muted(line);
  if (row.emphasis === 'header') {
    const base = styleHeaderByRole(line, row.role);
    return hovered ? hoverTint(base) : base;
  }
  const base = styleBodyByRole(line, row.role);
  return hovered ? hoverTint(base) : base;
}

function styleHeaderByRole(line: string, role: ConversationTranscriptLine['role']): string {
  switch (role) {
    case 'assistant':
      return C.accent(line);
    case 'reasoning':
      return C.mauve(line);
    case 'tool':
      return C.peach(line);
    case 'status':
      return C.warning(line);
    case 'snapshot':
      return C.text(line);
    case 'meta':
      return C.muted(line);
  }
}

function styleBodyByRole(line: string, role: ConversationTranscriptLine['role']): string {
  switch (role) {
    case 'reasoning':
      return C.subtext(line);
    case 'tool':
      return C.text(line);
    case 'status':
      return C.warning(line);
    case 'snapshot':
      return C.subtext(line);
    case 'assistant':
      return C.text(line);
    case 'meta':
      return C.muted(line);
  }
}

function applyConversationHover(
  ev: WidgetHoverEvent,
  state: ConversationWidgetState,
  requestRender: () => void,
): void {
  if (ev.hit.kind !== 'conversation-message') return;
  if (ev.kind === 'hover-enter') {
    if (state.hoveredMessageId !== ev.hit.messageId) {
      state.hoveredMessageId = ev.hit.messageId;
      requestRender();
    }
    return;
  }
  if (ev.kind === 'hover-leave') {
    if (state.hoveredMessageId !== null && state.hoveredMessageId !== undefined) {
      state.hoveredMessageId = null;
      requestRender();
    }
  }
}

export default conversationWidget;
