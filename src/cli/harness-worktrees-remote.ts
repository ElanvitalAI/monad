import { RemotesStore } from './remotes.js';
import { bookmarkAttachDefaults } from './remote-resolve.js';

/** ⛔ 상한이 없으면 무응답 원격을 「느리다」로 읽게 된다 — 시간 실패는 다른 실패와 문면을 가른다. */
export const DEFAULT_REMOTE_WORKTREES_TIMEOUT_MS = 20_000;

export type HarnessWorktreesRemoteClassification =
  | 'ok'
  | 'usage-error'
  | 'remote-error'
  | 'http-error'
  | 'transport-error'
  | 'timeout';

export interface HarnessWorktreesRemoteResult {
  exitCode: number;
  classification: HarnessWorktreesRemoteClassification;
  message: string;
}

export interface HarnessWorktreesRemoteOpts {
  /** `true` = value-less `-r` (default bookmark). string = `--remote <name>`. */
  remote: string | boolean;
  json?: boolean;
  remove?: boolean;
  timeoutMs?: number;
  out?: { log: (line: string) => void; error: (line: string) => void };
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  remotesStore?: () => RemotesStore;
}

export type RemoteTriState<T> =
  | { status: 'value'; value: T }
  | { status: 'absent' }
  | { status: 'unknown' };

export interface RemoteWorktreeSessionView {
  sessionId: RemoteTriState<string>;
  enteredAt: RemoteTriState<number>;
  previousCwd: RemoteTriState<string>;
  alive: RemoteTriState<boolean>;
}

export interface RemoteWorktreeRow {
  path: string;
  branch: RemoteTriState<string>;
  sha: RemoteTriState<string>;
  isMain: RemoteTriState<boolean>;
  isLocked: RemoteTriState<boolean>;
  isDetached: RemoteTriState<boolean>;
  session: RemoteTriState<RemoteWorktreeSessionView>;
  orphan: RemoteTriState<boolean>;
}

export interface RemoteOrphanedSessionRow {
  sessionId: RemoteTriState<string>;
  worktreePath: RemoteTriState<string>;
  branch: RemoteTriState<string>;
  enteredAt: RemoteTriState<number>;
  alive: RemoteTriState<boolean>;
}

export interface RemoteWorktreesView {
  bookmark: string;
  url: string;
  repoRoot: RemoteTriState<string>;
  worktrees: RemoteWorktreeRow[];
  orphanedSessions: RemoteTriState<RemoteOrphanedSessionRow[]>;
}

interface ResolvedEndpoint {
  url: string;
  token: string;
  label: string;
}

export async function liveFetchRemoteWorktrees(
  url: string,
  token: string,
  timeoutMs = DEFAULT_REMOTE_WORKTREES_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function runHarnessWorktreesRemote(
  opts: HarnessWorktreesRemoteOpts,
): Promise<HarnessWorktreesRemoteResult> {
  const out = opts.out ?? defaultOut();
  if (opts.remove === true) {
    return fail(out, 'usage-error', formatRemoveConflictMessage(opts));
  }

  const endpoint = resolveRemoteWorktreesEndpoint(opts);
  if (!endpoint.ok) return fail(out, endpoint.classification, endpoint.message);

  const timeoutMs = resolveTimeoutMs(opts.timeoutMs);
  try {
    const view = await fetchRemoteWorktreesView(opts, endpoint.value, timeoutMs);
    const message = opts.json === true
      ? JSON.stringify({
        _meta: { type: 'harness-worktrees-remote', bookmark: view.bookmark, url: view.url },
        repoRoot: view.repoRoot,
        worktrees: view.worktrees,
        orphanedSessions: view.orphanedSessions,
      }, null, 2)
      : renderRemoteWorktreesView(view).join('\n');
    out.log(message);
    return { exitCode: 0, classification: 'ok', message };
  } catch (err) {
    const failure = classifyFetchFailure(err, timeoutMs);
    const message = `harness worktrees: remote bookmark ${endpoint.value.label}: lookup failed for ${endpoint.value.url}: ${failure.message}`;
    return fail(out, failure.classification, message);
  }
}

export function renderRemoteWorktreesView(view: RemoteWorktreesView): string[] {
  const lines = [
    `\n━━ harness worktrees (REMOTE · ${view.bookmark}) ━━`,
    `GET /v1/worktrees · bookmark ${view.bookmark}`,
    `repoRoot=${renderTri(view.repoRoot)}`,
  ];
  if (view.worktrees.length === 0) {
    lines.push('(no remote worktrees)');
  } else {
    for (const row of view.worktrees) {
      lines.push(
        `- [remote] ${row.path}`
        + ` · branch=${renderTri(row.branch)}`
        + ` · sha=${renderTri(row.sha)}`
        + ` · main=${renderTri(row.isMain)}`
        + ` · locked=${renderTri(row.isLocked)}`
        + ` · detached=${renderTri(row.isDetached)}`
        + ` · session=${renderSession(row.session)}`
        + ` · alive=${renderAlive(row.session)}`
        + ` · orphan=${renderTri(row.orphan)}`,
      );
    }
  }
  if (view.orphanedSessions.status === 'unknown') {
    lines.push('orphanedSessions=unknown');
  } else if (view.orphanedSessions.status === 'absent') {
    lines.push('orphanedSessions=none');
  } else if (view.orphanedSessions.value.length > 0) {
    lines.push(`orphanedSessions ${view.orphanedSessions.value.length}`);
    for (const row of view.orphanedSessions.value) {
      lines.push(
        `- [remote-orphan] path=${renderTri(row.worktreePath)}`
        + ` · session=${renderTri(row.sessionId)}`
        + ` · branch=${renderTri(row.branch)}`
        + ` · alive=${renderTri(row.alive)}`,
      );
    }
  }
  return lines;
}

export function parseRemoteWorktreesBody(body: unknown, bookmark: string, url: string): RemoteWorktreesView {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('remote /v1/worktrees response is not an object');
  }
  const rec = body as Record<string, unknown>;
  const worktreesRaw = rec.worktrees;
  if (!Array.isArray(worktreesRaw)) {
    throw new Error('remote /v1/worktrees response is missing a worktrees array');
  }
  const worktrees = worktreesRaw.map((item, index) => parseWorktreeItem(item, index));
  return {
    bookmark,
    url,
    repoRoot: triString(rec, 'repoRoot'),
    worktrees,
    orphanedSessions: parseOrphanedSessionsField(rec.orphanedSessions),
  };
}

function parseWorktreeItem(value: unknown, index: number): RemoteWorktreeRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`remote /v1/worktrees worktrees[${index}] is not an object`);
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.path !== 'string' || rec.path.length === 0) {
    throw new Error(`remote /v1/worktrees worktrees[${index}] is missing a path`);
  }
  return {
    path: rec.path,
    branch: triString(rec, 'branch'),
    sha: triString(rec, 'sha'),
    isMain: triBoolean(rec, 'isMain'),
    isLocked: triBoolean(rec, 'isLocked'),
    isDetached: triBoolean(rec, 'isDetached'),
    session: triSession(rec, 'session'),
    orphan: triBoolean(rec, 'orphan'),
  };
}

export function parseOrphanedSessionsField(value: unknown): RemoteTriState<RemoteOrphanedSessionRow[]> {
  if (value === undefined) return { status: 'unknown' };
  if (value === null) return { status: 'absent' };
  if (!Array.isArray(value)) {
    throw new Error('remote /v1/worktrees orphanedSessions is not an array');
  }
  return { status: 'value', value: value.map(parseOrphanedSession) };
}

function parseOrphanedSession(value: unknown): RemoteOrphanedSessionRow {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      sessionId: { status: 'unknown' },
      worktreePath: { status: 'unknown' },
      branch: { status: 'unknown' },
      enteredAt: { status: 'unknown' },
      alive: { status: 'unknown' },
    };
  }
  const rec = value as Record<string, unknown>;
  return {
    sessionId: triString(rec, 'sessionId'),
    worktreePath: triString(rec, 'worktreePath'),
    branch: triString(rec, 'branch'),
    enteredAt: triNumber(rec, 'enteredAt'),
    alive: triBoolean(rec, 'alive'),
  };
}

function triString(rec: Record<string, unknown>, key: string): RemoteTriState<string> {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return { status: 'unknown' };
  const value = rec[key];
  if (value === null) return { status: 'absent' };
  if (typeof value === 'string') return { status: 'value', value };
  return { status: 'unknown' };
}

function triBoolean(rec: Record<string, unknown>, key: string): RemoteTriState<boolean> {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return { status: 'unknown' };
  const value = rec[key];
  if (value === null) return { status: 'absent' };
  if (typeof value === 'boolean') return { status: 'value', value };
  return { status: 'unknown' };
}

function triNumber(rec: Record<string, unknown>, key: string): RemoteTriState<number> {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return { status: 'unknown' };
  const value = rec[key];
  if (value === null) return { status: 'absent' };
  if (typeof value === 'number' && Number.isFinite(value)) return { status: 'value', value };
  return { status: 'unknown' };
}

function triSession(
  rec: Record<string, unknown>,
  key: string,
): RemoteTriState<RemoteWorktreeSessionView> {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return { status: 'unknown' };
  const value = rec[key];
  if (value === null) return { status: 'absent' };
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) return { status: 'unknown' };
  const session = value as Record<string, unknown>;
  return {
    status: 'value',
    value: {
      sessionId: triString(session, 'sessionId'),
      enteredAt: triNumber(session, 'enteredAt'),
      previousCwd: triString(session, 'previousCwd'),
      alive: triBoolean(session, 'alive'),
    },
  };
}

function renderTri<T>(field: RemoteTriState<T>): string {
  if (field.status === 'unknown') return 'unknown';
  if (field.status === 'absent') return 'none';
  if (typeof field.value === 'boolean') return field.value ? 'true' : 'false';
  return String(field.value);
}

function renderSession(session: RemoteTriState<RemoteWorktreeSessionView>): string {
  if (session.status === 'unknown') return 'unknown';
  if (session.status === 'absent') return 'none';
  return renderTri(session.value.sessionId);
}

function renderAlive(session: RemoteTriState<RemoteWorktreeSessionView>): string {
  if (session.status === 'unknown') return 'unknown';
  if (session.status === 'absent') return 'n/a';
  return renderTri(session.value.alive);
}

function formatRemoveConflictMessage(opts: HarnessWorktreesRemoteOpts): string {
  const store = (opts.remotesStore ?? (() => new RemotesStore()))();
  const named = namedRemote(opts.remote);
  const defaultName = named ? undefined : defaultBookmarkName(store);
  const target = named
    ? `--remote ${named}`
    : defaultName
      ? `-r / --remote (default bookmark ${defaultName})`
      : '-r / --remote';
  return `harness worktrees: --remove is a local reclaim judgment and has no meaning with ${target}; drop it (this landing does not dispose remote worktrees).`;
}

function namedRemote(remote: string | boolean): string | undefined {
  return typeof remote === 'string' && remote.length > 0 ? remote : undefined;
}

function defaultBookmarkName(store: RemotesStore): string | undefined {
  return store.listRemotes().find((row) => row.isDefault)?.name;
}

function resolveRemoteWorktreesEndpoint(opts: HarnessWorktreesRemoteOpts):
  | { ok: true; value: ResolvedEndpoint }
  | { ok: false; classification: 'remote-error'; message: string } {
  const store = (opts.remotesStore ?? (() => new RemotesStore()))();
  const named = namedRemote(opts.remote);
  const entry = named ? store.getRemote(named) : store.getDefaultRemote();
  const label = named ?? defaultBookmarkName(store) ?? '<default>';
  if (!entry) {
    return {
      ok: false,
      classification: 'remote-error',
      message: named
        ? `--remote ${named}: unknown bookmark. Run \`elanous nexus list\` to see available remotes.`
        : 'no default remote bookmark. Run `elanous nexus connect <host> --default` to set one.',
    };
  }

  let defaults: { host: string; tokenFile: string };
  try {
    defaults = bookmarkAttachDefaults(entry);
  } catch (err) {
    return {
      ok: false,
      classification: 'remote-error',
      message: `harness worktrees: remote bookmark ${label}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const token = store.readToken(entry)?.trim();
  if (!token) {
    return {
      ok: false,
      classification: 'remote-error',
      message: `harness worktrees: remote bookmark ${label} (${entry.host}): token file is missing or empty (${defaults.tokenFile})`,
    };
  }

  let origin: string;
  try {
    origin = remoteWorktreesHttpOrigin(defaults.host);
  } catch (err) {
    return {
      ok: false,
      classification: 'remote-error',
      message: `harness worktrees: remote bookmark ${label}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { ok: true, value: { url: `${origin}/v1/worktrees`, token, label } };
}

function remoteWorktreesHttpOrigin(host: string): string {
  const raw = host.trim();
  if (!raw) throw new Error('remote bookmark host is empty');
  const parsed = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`);
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  else if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`remote bookmark host has unsupported protocol ${parsed.protocol}`);
  }
  return parsed.origin;
}

async function fetchRemoteWorktreesView(
  opts: HarnessWorktreesRemoteOpts,
  endpoint: ResolvedEndpoint,
  timeoutMs: number,
): Promise<RemoteWorktreesView> {
  const fetchFn = opts.fetchFn ?? ((input: string, init?: RequestInit) => (
    liveFetchRemoteWorktrees(input, endpoint.token, timeoutMs)
  ));
  let response: Response;
  try {
    response = await fetchFn(endpoint.url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${endpoint.token}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw wrapFetchError(err, timeoutMs);
  }

  if (!response.ok) {
    const body = await readBodyOrTimeout(response, timeoutMs);
    const error = new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`);
    (error as Error & { classification: 'http-error' }).classification = 'http-error';
    throw error;
  }

  const raw = await readBodyOrTimeout(response, timeoutMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`non-JSON response: ${raw}`);
  }
  return parseRemoteWorktreesBody(parsed, endpoint.label, endpoint.url);
}

async function readBodyOrTimeout(response: Response, timeoutMs: number): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(`no response within ${timeoutMs}ms (remote daemon unreachable or hung)`), {
        name: 'TimeoutError',
      }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([readBody(response), timeoutPromise]);
  } catch (err) {
    throw wrapFetchError(err, timeoutMs);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch (err) {
    // ⛔ AbortError/TimeoutError during body read is still a timeout.
    // Swallowing it as '' made JSON.parse fail as transport-error/non-JSON.
    if (isTimeoutError(err)) throw err;
    return '';
  }
}

function wrapFetchError(err: unknown, timeoutMs: number): Error {
  if (isTimeoutError(err)) {
    const error = new Error(`no response within ${timeoutMs}ms (remote daemon unreachable or hung)`);
    (error as Error & { classification: 'timeout' }).classification = 'timeout';
    return error;
  }
  const error = new Error(err instanceof Error ? err.message : String(err));
  (error as Error & { classification: 'transport-error' }).classification = 'transport-error';
  return error;
}

function classifyFetchFailure(
  err: unknown,
  timeoutMs: number,
): { classification: Exclude<HarnessWorktreesRemoteClassification, 'ok'>; message: string } {
  const tagged = err as { classification?: HarnessWorktreesRemoteClassification; message?: string };
  if (tagged.classification === 'timeout' || tagged.classification === 'http-error' || tagged.classification === 'transport-error') {
    return { classification: tagged.classification, message: tagged.message ?? String(err) };
  }
  if (isTimeoutError(err)) {
    return {
      classification: 'timeout',
      message: `no response within ${timeoutMs}ms (remote daemon unreachable or hung)`,
    };
  }
  return {
    classification: 'transport-error',
    message: err instanceof Error ? err.message : String(err),
  };
}

function isTimeoutError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function resolveTimeoutMs(value: number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const fromEnv = Number.parseInt(process.env.ELANOUS_HARNESS_WORKTREES_REMOTE_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_REMOTE_WORKTREES_TIMEOUT_MS;
}

function fail(
  out: NonNullable<HarnessWorktreesRemoteOpts['out']>,
  classification: Exclude<HarnessWorktreesRemoteClassification, 'ok'>,
  message: string,
): HarnessWorktreesRemoteResult {
  out.error(message);
  return { exitCode: 1, classification, message };
}

function defaultOut(): NonNullable<HarnessWorktreesRemoteOpts['out']> {
  return {
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  };
}
