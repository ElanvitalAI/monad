import { loadTabIds, nextDefaultId, saveTabIds } from '../terminal/TerminalTabs';

export type SubjectRunStatus = 'running' | 'probable-running' | 'ended-unclosed' | 'unknown';

export interface SubjectRunAssessment {
  status: SubjectRunStatus;
  presence: string;
  reason: string;
}

export interface RunningRunsSummary {
  running: number;
  'probable-running': number;
  countedStatuses: readonly SubjectRunStatus[];
}

/** Server-reported limits for the terminal observation query. */
export interface ObservatoryScope {
  roots: number;
  federated: boolean;
  hiddenDead: number;
  domain: string;
  hiddenSubAgentRuns?: number;
}

/**
 * Canonical PTY-list projection shared by Observatory and the terminal inspector.
 * A stable PTY id is the common identity: explicit `hasPty: false` is absent,
 * while a missing flag remains an unknown legacy row and is retained. The first
 * occurrence wins, preserving daemon order; run status, lineage, scope, and
 * screen presentation deliberately remain each consumer's own axis.
 */
export interface CanonicalPtyItem<T> {
  id: string;
  value: T;
}

export function canonicalPtyItems<T extends { id: string; hasPty?: boolean }>(
  candidates: readonly T[],
): CanonicalPtyItem<T>[] {
  const seen = new Set<string>();
  const items: CanonicalPtyItem<T>[] = [];
  for (const value of candidates) {
    if (value.hasPty === false || seen.has(value.id)) continue;
    seen.add(value.id);
    items.push({ id: value.id, value });
  }
  return items;
}

/** The two list surfaces share this all/includeTest request contract. */
export function terminalListRequest(includeAll: boolean): { all?: true; includeTest?: true } {
  return includeAll ? { all: true, includeTest: true } : {};
}

/** Adds one terminal to the web-terminal tab list using its canonical persistence and ID rules. */
export function openObservatoryTerminal(): string | null {
  try {
    const existing = loadTabIds();
    const terminalId = nextDefaultId(existing);
    saveTabIds([...existing, terminalId]);
    return terminalId;
  } catch {
    return null;
  }
}

/** Keeps the default query byte-for-byte stable until isolated instances are explicitly included. */
export function terminalsQueryUrl(includeIsolatedInstances = false): string {
  const request = terminalListRequest(includeIsolatedInstances);
  const query = Object.entries(request)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
  return query.length === 0 ? '/v1/terminals' : `/v1/terminals?${query}`;
}

export interface ObservatorySubject {
  id: string;
  runId: string;
  origin: 'system' | 'human';
  screen: { ptyIds: string[]; liveCount: number };
  agent: { names: string[]; controllers: string[] };
  talk: unknown[];
  /** Server-provided run assessment. Omitted by older daemons. */
  run?: SubjectRunAssessment;
}

export type SubjectStatus = 'live' | 'unknown' | 'inactive';

export interface PtyProgressSummary {
  line: string;
  status: 'running' | 'complete';
  hasMissingFrames: boolean;
}

export type SubjectProgress =
  | { kind: 'no-screen' }
  | { kind: 'no-progress' }
  | ({ kind: 'progress'; ptyId: string } & PtyProgressSummary);

interface SubjectSurfaces {
  talk: boolean;
  screen: boolean;
  agent: boolean;
}

/** Same-origin rendered terminal-frame endpoint for a single PTY. */
export function terminalFrameUrl(ptyId: string): string {
  return `/v1/terminals/${encodeURIComponent(ptyId)}/frame`;
}

/** Same-origin ownership-control endpoint for a single PTY. Terminal input stays off this surface. */
export function terminalControlUrl(ptyId: string): string {
  return `/v1/terminals/${encodeURIComponent(ptyId)}/control`;
}

/** Dedicated terminal inspector retains raw output and lineage views. */
export function terminalsViewUrl(): string {
  return '/v1/terminals/view';
}

export type TerminalTakeoverFailureKind =
  | 'unknown'
  | 'denied'
  | 'owner-unreachable'
  | 'failed'
  | 'http'
  | 'network';

export type TerminalTakeoverResult =
  | { ok: true; ptyId: string }
  | {
      ok: false;
      ptyId: string;
      kind: TerminalTakeoverFailureKind;
      message: string;
      status?: number;
    };

export const TERMINAL_TAKEOVER_MESSAGES: Record<TerminalTakeoverFailureKind, string> = {
  unknown: 'Unknown target: this PTY was not found. Check the subject list and try again.',
  denied: 'Denied: takeover was refused. Check ownership and try again.',
  'owner-unreachable': 'Owner unreachable: could not reach the PTY owner. Check the owner process and try again.',
  failed: 'Server failed: ownership transfer did not complete. Check status and try again.',
  http: 'Takeover failed. Check status and try again.',
  network: 'Network failed: could not request takeover. Check the connection and try again.',
};

function takeoverFailureKind(status: number): TerminalTakeoverFailureKind {
  if (status === 404) return 'unknown';
  if (status === 409) return 'denied';
  if (status === 504) return 'owner-unreachable';
  if (status === 502) return 'failed';
  return 'http';
}

function takeoverFailureMessage(kind: TerminalTakeoverFailureKind, status?: number): string {
  if (kind === 'http' && status !== undefined) {
    return `Takeover failed (${status}). Check status and try again.`;
  }
  return TERMINAL_TAKEOVER_MESSAGES[kind];
}

type TerminalControlFetch = (
  input: string,
  init?: RequestInit,
) => ReturnType<typeof fetch>;

/** POST /v1/terminals/:id/control with {"action":"takeover"} — ownership only, no terminal input. */
export async function requestTerminalTakeover(
  ptyId: string,
  fetchImpl: TerminalControlFetch = globalThis.fetch,
  init: { signal?: AbortSignal } = {},
): Promise<TerminalTakeoverResult> {
  try {
    const response = await fetchImpl(terminalControlUrl(ptyId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'takeover' }),
      signal: init.signal,
    });
    if (response.status === 200) return { ok: true, ptyId };
    const kind = takeoverFailureKind(response.status);
    return {
      ok: false,
      ptyId,
      kind,
      status: response.status,
      message: takeoverFailureMessage(kind, response.status),
    };
  } catch {
    return {
      ok: false,
      ptyId,
      kind: 'network',
      message: TERMINAL_TAKEOVER_MESSAGES.network,
    };
  }
}

export function subjectSurfaces(subject: ObservatorySubject): SubjectSurfaces {
  return {
    talk: subject.talk.length > 0,
    screen: subject.screen.ptyIds.length > 0,
    agent: subject.agent.names.length > 0 || subject.agent.controllers.length > 0,
  };
}

export function classifySubject(subject: ObservatorySubject): SubjectStatus {
  const surfaces = subjectSurfaces(subject);
  if (subject.screen.liveCount > 0) return 'live';
  if (!surfaces.screen && surfaces.agent) return 'unknown';
  return 'inactive';
}

export function visibleSubjects(subjects: readonly ObservatorySubject[], showAll = false): ObservatorySubject[] {
  if (showAll) return [...subjects];
  return subjects.filter((subject) => classifySubject(subject) !== 'inactive');
}

/** Joins existing PTY progress summaries to subjects without interpreting progress-frame markers. */
export function subjectProgressBySubject(
  subjects: readonly ObservatorySubject[],
  progressByPty: ReadonlyMap<string, PtyProgressSummary>,
): ReadonlyMap<string, SubjectProgress> {
  const progressBySubject = new Map<string, SubjectProgress>();
  for (const subject of subjects) {
    const ptyItems = canonicalPtyItems(subject.screen.ptyIds.map((id) => ({ id })))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (ptyItems.length === 0) {
      progressBySubject.set(subject.id, { kind: 'no-screen' });
      continue;
    }
    // Sort canonical PTY identities so multiple progress-bearing screens choose the same source.
    const ptyId = ptyItems.find(({ id }) => progressByPty.has(id))?.id;
    const progress = ptyId === undefined ? undefined : progressByPty.get(ptyId);
    progressBySubject.set(subject.id, ptyId === undefined || progress === undefined
      ? { kind: 'no-progress' }
      : { kind: 'progress', ptyId, ...progress });
  }
  return progressBySubject;
}
