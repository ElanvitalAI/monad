import { displayConversationBrand } from './conversation-widget-open.js';
import type { EmbodiedAgentSession, EmbodiedSessionStatus } from '../agent/embodiment.js';
import type { AgentStatusRecord } from '../agent-status/store.js';
import type { TransportObserver } from '../agent/transport-observer.js';
import type { MessageBlock } from '../conv-substrate/message-block.js';
import { renderMarkdown as renderRichMarkdown } from '../expression/renderer/markdown.js';
import { stripAnsi } from '../tui.js';

export interface ConversationWidgetConfig {
  sessionId: string;
  brand: string;
  title?: string;
  status: EmbodiedSessionStatus;
  startedAt?: number;
  finishedAt?: number;
  updatedAt?: number;
  lastEvent?: string;
  transports: readonly {
    kind: string;
    id: string;
    label?: string;
  }[];
  snapshotChannels?: readonly string[];
  channelSnapshots?: Readonly<Record<string, string>>;
  snapshotText?: string;
  /** PR-CL3 (B.3) — surface-neutral message-block stream snapshot.
   *  ACP-backed session 인 경우 caller (conversation-widget-live) 가
   *  router stream snapshot 을 여기로 전달 — 본 array 가 비어있지 않으면
   *  buildConversationTranscript 가 channel/raw snapshot path 보다
   *  우선 사용한다 (REFAC N3+N4 closure). */
  messageBlocks?: readonly MessageBlock[];
}

export interface ConversationWidgetBuildOpts {
  statusRecord?: AgentStatusRecord;
  observer?: TransportObserver;
  /** PR-CL3 — caller 가 router stream snapshot 을 명시적으로 전달.
   *  acp-vw 같은 ACP-backed lane 의 session 만 의미가 있으며, 매핑은
   *  caller 책임 (EmbodiedAgentSession.id 와 ACP client session id 가
   *  다른 경우 호출자가 lookup 후 전달). */
  messageBlocks?: readonly MessageBlock[];
}

export type ConversationMessageRole =
  | 'meta'
  | 'assistant'
  | 'reasoning'
  | 'tool'
  | 'status'
  | 'snapshot';

export interface ConversationTranscriptMessage {
  id: string;
  role: ConversationMessageRole;
  label: string;
  channel?: string;
  lineStart: number;
  lineEnd: number;
}

export interface ConversationTranscriptLine {
  text: string;
  role: ConversationMessageRole;
  emphasis: 'meta' | 'header' | 'body';
  messageId?: string;
}

export interface ConversationTranscriptModel {
  title: string;
  summary: string;
  lines: readonly ConversationTranscriptLine[];
  messages: readonly ConversationTranscriptMessage[];
}

export interface ConversationWidgetStateLike {
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

export async function buildConversationWidgetConfig(
  session: EmbodiedAgentSession,
  opts: ConversationWidgetBuildOpts = {},
): Promise<ConversationWidgetConfig> {
  const state = session.state();
  const hasMessageBlocks = (opts.messageBlocks?.length ?? 0) > 0;
  const channels = opts.observer?.snapshotChannels() ?? {};
  const hasChannels = Object.keys(channels).length > 0;
  // PR-CL3 — message-block stream wins over channel/raw snapshot.
  // ACP-backed session 는 stream 의 structured event 가 fragmentation
  // 없는 single source of truth. Channel/raw path 는 PTY-only session
  // 에서만 활용된다.
  let snapshotText: string | undefined;
  if (!hasMessageBlocks && !hasChannels) {
    try {
      snapshotText = await session.snapshot();
    } catch (err) {
      snapshotText = `[snapshot unavailable]\n${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return {
    sessionId: session.id,
    brand: displayConversationBrand(session.launchSpec.brand),
    title: state.title,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    updatedAt: opts.statusRecord?.updatedAt,
    lastEvent: opts.statusRecord?.lastEvent,
    transports: session.transports,
    snapshotChannels: session.snapshotChannels,
    channelSnapshots: !hasMessageBlocks && hasChannels ? channels : undefined,
    snapshotText,
    ...(hasMessageBlocks ? { messageBlocks: opts.messageBlocks } : {}),
  };
}

export function buildConversationTranscript(
  config: ConversationWidgetConfig,
): ConversationTranscriptModel {
  const lines: ConversationTranscriptLine[] = [];
  const messages: ConversationTranscriptMessage[] = [];

  pushMeta(lines, `session ${config.sessionId} · ${config.brand} · ${config.status}`);
  if (config.lastEvent) {
    pushMeta(lines, `last event: ${config.lastEvent}`);
  }
  if (config.startedAt !== undefined) {
    pushMeta(lines, `started ${formatTs(config.startedAt)}`);
  }
  const transportSummary = config.transports
    .map((transport) => transport.label ? `${transport.kind}:${transport.label}` : transport.kind)
    .join(', ');
  if (transportSummary.length > 0) {
    pushMeta(lines, `transports: ${transportSummary}`);
  }
  lines.push({ text: '', role: 'meta', emphasis: 'meta' });

  // PR-CL3 (B.3) — message-block stream path wins. ACP-backed session
  // 의 structured event 가 channel/raw snapshot 의 단일 string 이 아닌
  // discrete block list 로 도착. 하나의 block 이 한 ConversationMessage.
  if (config.messageBlocks && config.messageBlocks.length > 0) {
    for (const block of config.messageBlocks) {
      const transformed = transformMessageBlock(block);
      if (!transformed) continue;
      pushMessage(lines, messages, transformed);
    }
    if (messages.length === 0) {
      // All blocks filtered out (e.g. blank assistant chunks) — fall
      // through to the empty-state placeholder so the widget shows
      // something useful instead of just the meta header.
      pushMessage(lines, messages, {
        id: 'snapshot:empty',
        role: 'status',
        label: 'Waiting for output',
        body: ['No conversation output captured yet.'],
      });
    }
    return {
      title: config.title?.trim().length ? config.title! : `${config.brand} conversation`,
      summary: `${messages.length} block${messages.length === 1 ? '' : 's'} · ${config.status}`,
      lines,
      messages,
    };
  }

  const channelEntries = Object.entries(config.channelSnapshots ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
  if (channelEntries.length > 0) {
    for (const [channel, value] of channelEntries) {
      pushMessage(lines, messages, {
        id: `channel:${channel}`,
        role: roleFromChannel(channel),
        label: labelFromChannel(channel),
        channel,
        body: normalizeBody(value),
      });
    }
  } else if (config.snapshotText && config.snapshotText.trim().length > 0) {
    pushMessage(lines, messages, {
      id: 'snapshot:raw',
      role: 'snapshot',
      label: 'Raw snapshot',
      body: normalizeBody(config.snapshotText),
    });
  } else {
    pushMessage(lines, messages, {
      id: 'snapshot:empty',
      role: 'status',
      label: 'Waiting for output',
      body: ['No conversation output captured yet.'],
    });
  }

  return {
    title: config.title?.trim().length ? config.title! : `${config.brand} conversation`,
    summary: `${messages.length} block${messages.length === 1 ? '' : 's'} · ${config.status}`,
    lines,
    messages,
  };
}

/** PR-CL3 (B.3) — block kind → ConversationMessage 변환.
 *
 *  body normalize 결정:
 *  - assistant + markdown: rich markdown renderer 통과 후 ANSI strip
 *    (widget transcript line 은 plain string · 시각 hierarchy 는
 *    Codex A.2 의 block-aware wrap 이 머지된 후 채색 가능)
 *  - assistant 일반 / user / thought / status / error: text 를 그대로
 *    line split
 *  - tool-call: title + status 로 single line summary
 *  - plan: ref 로 single line
 *
 *  null 반환 시 block 은 transcript 에서 skip (e.g. 빈 text). */
function transformMessageBlock(
  block: MessageBlock,
):
  | {
      id: string;
      role: ConversationMessageRole;
      label: string;
      body: readonly string[];
    }
  | null {
  switch (block.body.kind) {
    case 'user': {
      const text = block.body.text;
      if (text.trim().length === 0) return null;
      return {
        id: block.id,
        role: 'meta',
        label: 'You',
        body: normalizeBody(text),
      };
    }
    case 'assistant': {
      const text = block.body.text;
      if (text.trim().length === 0) return null;
      const renderedRaw = block.body.markdown
        ? renderRichMarkdown(
            { kind: 'markdown', body: text },
            'truecolor',
            { keepAttrsInMono: true },
          )
        : text;
      return {
        id: block.id,
        role: 'assistant',
        label: 'Assistant',
        body: normalizeBody(stripAnsi(renderedRaw)),
      };
    }
    case 'thought': {
      const text = block.body.text;
      if (text.trim().length === 0) return null;
      const reasoning = block.body.reasoning === true;
      return {
        id: block.id,
        role: 'reasoning',
        label: reasoning ? 'Reasoning' : 'Thought',
        body: normalizeBody(text),
      };
    }
    case 'tool-call': {
      const title = block.body.title || block.body.toolCallId;
      const status = block.body.status ? ` · ${block.body.status}` : '';
      return {
        id: block.id,
        role: 'tool',
        label: 'Tool call',
        body: [`${title}${status}`],
      };
    }
    case 'plan': {
      return {
        id: block.id,
        role: 'reasoning',
        label: 'Plan',
        body: [`ref: ${block.body.ref}`],
      };
    }
    case 'status': {
      const text = block.body.text;
      if (text.trim().length === 0) return null;
      return {
        id: block.id,
        role: 'status',
        label: 'Status',
        body: normalizeBody(text),
      };
    }
    case 'error': {
      const text = block.body.text;
      if (text.trim().length === 0) return null;
      return {
        id: block.id,
        role: 'status',
        label: 'Error',
        body: normalizeBody(text),
      };
    }
  }
}

export function applyConversationWidgetConfig<S extends ConversationWidgetStateLike>(
  prev: S,
  config: ConversationWidgetConfig,
): S {
  const transcript = buildConversationTranscript(config);
  return {
    ...prev,
    sessionId: config.sessionId,
    brand: config.brand,
    title: transcript.title,
    summary: transcript.summary,
    lines: transcript.lines,
    messages: transcript.messages,
    scroll: Math.max(0, Math.min(prev.scroll, Math.max(0, transcript.lines.length - 1))),
  };
}

function pushMeta(lines: ConversationTranscriptLine[], text: string): void {
  lines.push({ text, role: 'meta', emphasis: 'meta' });
}

function pushMessage(
  lines: ConversationTranscriptLine[],
  messages: ConversationTranscriptMessage[],
  input: {
    id: string;
    role: ConversationMessageRole;
    label: string;
    channel?: string;
    body: readonly string[];
  },
): void {
  const lineStart = lines.length;
  lines.push({
    text: `${roleGlyph(input.role)} ${input.label}`,
    role: input.role,
    emphasis: 'header',
    messageId: input.id,
  });
  for (const row of input.body) {
    lines.push({
      text: `  ${row}`,
      role: input.role,
      emphasis: 'body',
      messageId: input.id,
    });
  }
  const lineEnd = lines.length - 1;
  messages.push({
    id: input.id,
    role: input.role,
    label: input.label,
    ...(input.channel ? { channel: input.channel } : {}),
    lineStart,
    lineEnd,
  });
  lines.push({ text: '', role: 'meta', emphasis: 'meta' });
}

function normalizeBody(text: string): string[] {
  const rows = text.replace(/\r\n/g, '\n').split('\n');
  while (rows.length > 0 && rows[0]?.trim() === '') rows.shift();
  while (rows.length > 0 && rows[rows.length - 1]?.trim() === '') rows.pop();
  return rows.length > 0 ? rows : [''];
}

function roleFromChannel(channel: string): ConversationMessageRole {
  switch (channel) {
    case 'reasoning':
    case 'plan':
      return 'reasoning';
    case 'tool-call':
    case 'tool-result':
      return 'tool';
    case 'status':
      return 'status';
    case 'message':
    case 'output':
      return 'assistant';
    default:
      return 'assistant';
  }
}

function labelFromChannel(channel: string): string {
  switch (channel) {
    case 'tool-call':
      return 'Tool call';
    case 'tool-result':
      return 'Tool result';
    case 'reasoning':
      return 'Reasoning';
    case 'plan':
      return 'Plan';
    case 'message':
      return 'Assistant';
    case 'output':
      return 'Output';
    case 'status':
      return 'Status';
    default:
      return channel;
  }
}

function roleGlyph(role: ConversationMessageRole): string {
  switch (role) {
    case 'assistant':
      return '◉';
    case 'reasoning':
      return '◌';
    case 'tool':
      return '◆';
    case 'status':
      return '△';
    case 'snapshot':
      return '□';
    case 'meta':
      return '·';
  }
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toISOString();
  } catch {
    return String(ts);
  }
}
