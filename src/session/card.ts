// ── Session Card — unified session abstraction (ST2) ──
//
// SessionCard flattens the heterogeneous sources of "what's running"
// (PTY terminals from TerminalMatrix, ACP client/server sessions, cron
// triggers from scheduler) into a single row-shaped record the
// sessions-sidebar widget can render uniformly.
//
// Design choices:
// - `agentKind` is the orthogonal axis to `source`. A PTY can host
//   claude-code (agentKind='claude-code', source='pty'); an ACP
//   session can host codex (agentKind='codex', source='acp'). UI
//   icons and the agent-toolbelt bar key off `agentKind`, while
//   operations (kill / move / focus) key off `source` + `id`.
// - `status` is the 4-state machine populated by US1 (AgentStatusStore).
//   Default is 'idle' until a parser emits a transition.
// - metadata is read-only to the card's consumer — mutations happen
//   at the source (TerminalMatrix.metadata etc.).
//
// ACP and scheduler are stubbed in session M — the shape is in place
// so later sessions can fill them without touching the sidebar UI.

import type { TerminalInstance } from '../terminal-matrix/types.js';

/** Which coding agent (or plain shell) is hosted inside a session.
 *  Populated by UA1 (agent-detect) during spawn, flows into the
 *  SessionCard here, and drives badge icons + toolbelt conditional
 *  render (UB2). */
export type AgentKind =
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'aider'
  | 'shell'
  | 'background'
  | 'other';

/** Which subsystem owns the session. `pty` = TerminalMatrix;
 *  `acp` = AgentClientProtocol client or server; `scheduler` = a
 *  scheduled trigger that the user may want to peek at. The source
 *  also narrows what operations are valid (e.g. `acp` sessions are
 *  not attached via terminal focus). */
export type SessionSource = 'pty' | 'acp' | 'scheduler';

/** 4-state status machine maintained by US1. `idle` is the default
 *  immediately after spawn; transitions are emitted by US2 (claude-
 *  code JSONL parser) and US3 (codex heuristic). `awaiting` marks a
 *  session blocked on user approval (claude-code tool_use gate).
 *  `done` / `err` are terminal unless the session re-enters working. */
export type SessionStatus = 'idle' | 'working' | 'awaiting' | 'done' | 'err';

export interface SessionCard {
  /** Stable id within its source. For `pty` it is GlobalTerminalId;
   *  for `acp` it is the ACP session id; for `scheduler` the cron id. */
  readonly id: string;
  readonly source: SessionSource;
  readonly title: string;
  readonly agentKind: AgentKind;
  readonly status: SessionStatus;
  /** False when the session has exited (PTY) or disconnected (ACP)
   *  but is still shown in the list (e.g. with a dim style). */
  readonly isAlive: boolean;
  readonly cwd?: string;
  readonly pid?: number;
  readonly attentionLevel?: 0 | 1 | 2 | 3;
  readonly lastActivityAt?: number;
  readonly createdAt?: number;
  /** NT3 — unread notification count for this session. 0 = no
   *  badge rendered on the sidebar row. Populated via
   *  `SessionCardSources.notifications.unreadCount(id)`. */
  readonly unreadCount?: number;
  /** Free-form pass-through for source-specific fields (e.g. PTY
   *  placement, ACP agent cmd). Treat as opaque from the sidebar. */
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** The four sidebar icons — one per `agentKind`. Plain shells share
 *  the generic `▫` glyph; unknown agents fall back to `●`. Icons are
 *  single-cell printable to keep sidebar width math simple. */
export const AGENT_KIND_ICON: Record<AgentKind, string> = {
  'claude-code': '◆',
  'codex':       '◇',
  'gemini-cli':  '◈',
  'aider':       '◉',
  'shell':       '▫',
  'background':  '◎',
  'other':       '●',
};

const AGENT_KIND_SET: ReadonlySet<AgentKind> = new Set<AgentKind>([
  'claude-code', 'codex', 'gemini-cli', 'aider', 'shell', 'background', 'other',
]);

export function isAgentKind(v: unknown): v is AgentKind {
  return typeof v === 'string' && AGENT_KIND_SET.has(v as AgentKind);
}

/** Resolve a terminal instance's agentKind. `metadata.agentKind`
 *  wins when UA2/UA3 has set it at spawn; otherwise fall back to the
 *  TerminalCharacter kind (which covers explicit caller intent). */
export function resolveAgentKindFromInstance(inst: TerminalInstance): AgentKind {
  const metaKind = inst.metadata?.['agentKind'];
  if (isAgentKind(metaKind)) return metaKind;
  switch (inst.character.kind) {
    case 'claude-code': return 'claude-code';
    case 'codex':       return 'codex';
    case 'shell':       return 'shell';
    case 'custom':      return 'other';
    default:            return 'other';
  }
}

export interface StatusLookup {
  get(id: string): SessionStatus | undefined;
}

export interface NotificationLookup {
  unreadCount(id: string): number;
}

export interface SessionCardSources {
  /** Pull live PTY instances. Callers usually pass the matrix
   *  registry's listUserVisible() bound function so LLM-only PTYs
   *  stay hidden from the sidebar. */
  readonly listTerminals?: () => readonly TerminalInstance[];
  /** Optional status lookup (US4). When present, each card's
   *  `status` is read from here; otherwise defaults to 'idle'. */
  readonly status?: StatusLookup;
  /** NT3 — optional notification lookup. When present, each card's
   *  `unreadCount` reflects the current NotificationStore state. */
  readonly notifications?: NotificationLookup;
  /** ACP session listing — wired in a later session. */
  readonly listAcpSessions?: () => readonly AcpSessionStub[];
  /** Scheduler trigger listing — wired in a later session. */
  readonly listSchedulerTriggers?: () => readonly SchedulerTriggerStub[];
}

/** Minimal ACP session shape the sidebar needs. Kept open-ended so
 *  future sessions can widen without a breaking change. */
export interface AcpSessionStub {
  readonly id: string;
  readonly title: string;
  readonly agentKind?: AgentKind;
  readonly isAlive: boolean;
  readonly createdAt?: number;
  readonly lastActivityAt?: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface SchedulerTriggerStub {
  readonly id: string;
  readonly title: string;
  readonly isAlive: boolean;
  readonly lastActivityAt?: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/** Convert a PTY TerminalInstance into a sidebar-ready SessionCard.
 *  Pure; no status mutation — status comes from `statusLookup` when
 *  provided, else defaults to 'idle'. */
export function terminalToSessionCard(
  inst: TerminalInstance,
  statusLookup?: StatusLookup,
  notifLookup?: NotificationLookup,
): SessionCard {
  const status = statusLookup?.get(inst.id) ?? 'idle';
  const unreadCount = notifLookup?.unreadCount(inst.id) ?? 0;
  return {
    id: inst.id,
    source: 'pty',
    title: inst.title,
    agentKind: resolveAgentKindFromInstance(inst),
    status,
    isAlive: inst.exitCode === null,
    attentionLevel: inst.attentionLevel,
    lastActivityAt: inst.lastActivityAt,
    createdAt: inst.createdAt,
    unreadCount,
    meta: inst.metadata,
  };
}

function acpToSessionCard(
  stub: AcpSessionStub,
  statusLookup?: StatusLookup,
  notifLookup?: NotificationLookup,
): SessionCard {
  const status = statusLookup?.get(stub.id) ?? 'idle';
  const unreadCount = notifLookup?.unreadCount(stub.id) ?? 0;
  return {
    id: stub.id,
    source: 'acp',
    title: stub.title,
    agentKind: stub.agentKind ?? 'other',
    status,
    isAlive: stub.isAlive,
    lastActivityAt: stub.lastActivityAt,
    createdAt: stub.createdAt,
    unreadCount,
    meta: stub.meta,
  };
}

function schedulerToSessionCard(
  stub: SchedulerTriggerStub,
  statusLookup?: StatusLookup,
  notifLookup?: NotificationLookup,
): SessionCard {
  const status = statusLookup?.get(stub.id) ?? 'idle';
  const unreadCount = notifLookup?.unreadCount(stub.id) ?? 0;
  return {
    id: stub.id,
    source: 'scheduler',
    title: stub.title,
    agentKind: 'other',
    status,
    isAlive: stub.isAlive,
    lastActivityAt: stub.lastActivityAt,
    unreadCount,
    meta: stub.meta,
  };
}

/** Build a deduplicated list of cards. Sort order (ST2 baseline):
 *  1. Alive before exited.
 *  2. Within each group, newest lastActivityAt first; fall back to
 *     createdAt so quiescent sessions still have a stable order.
 *  Source priority is not used — ST3's sidebar labels each row with
 *  its source already. */
export function listSessionCards(sources: SessionCardSources): SessionCard[] {
  const cards: SessionCard[] = [];
  if (sources.listTerminals) {
    for (const inst of sources.listTerminals()) {
      cards.push(terminalToSessionCard(inst, sources.status, sources.notifications));
    }
  }
  if (sources.listAcpSessions) {
    for (const stub of sources.listAcpSessions()) {
      cards.push(acpToSessionCard(stub, sources.status, sources.notifications));
    }
  }
  if (sources.listSchedulerTriggers) {
    for (const stub of sources.listSchedulerTriggers()) {
      cards.push(schedulerToSessionCard(stub, sources.status, sources.notifications));
    }
  }
  cards.sort((a, b) => {
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    const aTs = a.lastActivityAt ?? a.createdAt ?? 0;
    const bTs = b.lastActivityAt ?? b.createdAt ?? 0;
    return bTs - aTs;
  });
  return cards;
}
