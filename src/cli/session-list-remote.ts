import { RemotesStore } from './remotes.js';
import { bookmarkAttachDefaults } from './remote-resolve.js';

/** ⛔ 상한이 없으면 무응답 원격을 「느리다」로 읽게 된다. */
export const DEFAULT_REMOTE_SESSION_LIST_TIMEOUT_MS = 20_000;

/** On-disk session store — not the in-memory `GET /v1/sessions` history axis. */
export const REMOTE_SESSIONS_STORE_PATH = '/v1/sessions/store';

export type SessionListRemoteClassification =
  | 'ok'
  | 'session-list-usage-error'
  | 'session-list-remote-error'
  | 'session-list-http-error'
  | 'session-list-timeout-error'
  | 'session-list-transport-error'
  | 'session-list-server-error';

export interface SessionListRemoteResult {
  exitCode: number;
  classification: SessionListRemoteClassification;
  message: string;
}

export interface SessionListRemoteOpts {
  /** `true` = value-less `-r` (default bookmark). string = `--remote <name>`. */
  remote: string | boolean;
  allInstances?: boolean;
  json?: boolean;
  timeoutMs?: number;
  remotesStore?: () => RemotesStore;
  fetchRemoteSessions?: (
    url: string,
    token: string,
    timeoutMs: number,
  ) => Promise<RemoteSessionsFetchResult>;
  out?: { log: (line: string) => void; error: (line: string) => void };
}

/** Wire-side `/v1/sessions/store` card. Only server-provided keys are present. */
export interface RemoteSessionSummary {
  readonly id: string;
  readonly title?: string;
  readonly source?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly messageCount?: number;
  readonly preview?: string;
}

export type RemoteSessionsFetchResult =
  | { readonly ok: true; readonly sessions: readonly RemoteSessionSummary[] }
  | { readonly ok: false; readonly status: number; readonly reason: string; readonly timeout?: boolean };

/** `-r` is value-less (default bookmark). Names go on `--remote <name>`. */
export function resolveSessionListRemoteFlag(opts: {
  r?: boolean;
  remote?: string;
}): string | boolean | undefined {
  if (opts.remote !== undefined) return opts.remote;
  if (opts.r === true) return true;
  return undefined;
}

export async function runSessionListRemote(opts: SessionListRemoteOpts): Promise<SessionListRemoteResult> {
  const out = opts.out ?? defaultOut();

  if (opts.allInstances === true) {
    return fail(
      out,
      'session-list-usage-error',
      'monad session list: --all-instances is a local federation scope and has no meaning with --remote; drop it (the remote daemon decides its own scope).',
    );
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_REMOTE_SESSION_LIST_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fail(out, 'session-list-usage-error', 'monad session list: --timeout must be a positive number of milliseconds');
  }

  const store = (opts.remotesStore ?? (() => new RemotesStore()))();
  const { entry, named, label } = resolveSessionListBookmark(opts.remote, store);
  if (!entry) return fail(out, 'session-list-remote-error', sessionListBookmarkError(named));

  let defaults: { host: string; tokenFile: string };
  try {
    defaults = bookmarkAttachDefaults(entry);
  } catch (err) {
    return fail(
      out,
      'session-list-remote-error',
      `monad session list: remote bookmark ${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const token = store.readToken(entry)?.trim();
  if (!token) {
    return fail(
      out,
      'session-list-remote-error',
      `monad session list: remote bookmark ${label} (${entry.host}): token file is missing or empty (${defaults.tokenFile})`,
    );
  }

  let url: string;
  try {
    url = remoteSessionsUrl(defaults.host);
  } catch (err) {
    return fail(
      out,
      'session-list-remote-error',
      `monad session list: remote bookmark ${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const fetchRemote = opts.fetchRemoteSessions ?? liveFetchRemoteSessions;
  let fetched: RemoteSessionsFetchResult;
  try {
    fetched = await fetchRemote(url, token, timeoutMs);
  } catch (err) {
    return fail(
      out,
      'session-list-transport-error',
      `monad session list: remote bookmark ${label}: lookup failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!fetched.ok) {
    const classification = classifyFetchFailure(fetched);
    return fail(
      out,
      classification,
      `monad session list: remote bookmark ${label}: lookup failed for ${url}: ${fetched.reason}`,
    );
  }

  const message = opts.json === true
    ? JSON.stringify({ bookmark: label, url, sessions: fetched.sessions }, null, 2)
    : formatRemoteSessionList(fetched.sessions, label);
  out.log(message);
  return { exitCode: 0, classification: 'ok', message };
}

export async function liveFetchRemoteSessions(
  url: string,
  token: string,
  timeoutMs = DEFAULT_REMOTE_SESSION_LIST_TIMEOUT_MS,
): Promise<RemoteSessionsFetchResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return {
        ok: false,
        status: 0,
        timeout: true,
        reason: `no response within ${timeoutMs}ms (remote daemon unreachable or hung)`,
      };
    }
    return { ok: false, status: 0, reason: (error as Error).message };
  }
  if (!response.ok) {
    const body = await readBody(response);
    return {
      ok: false,
      status: response.status,
      reason: `HTTP ${response.status}${body ? `: ${body}` : ''}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (error) {
    return { ok: false, status: response.status, reason: `invalid JSON: ${(error as Error).message}` };
  }
  try {
    return { ok: true, sessions: parseRemoteSessionsBody(parsed) };
  } catch (error) {
    return { ok: false, status: response.status, reason: (error as Error).message };
  }
}

export function formatRemoteSessionLine(row: RemoteSessionSummary, bookmark: string): string {
  const when = remoteDisplay(row, 'updatedAt');
  const source = remoteDisplay(row, 'source');
  const title = remoteDisplay(row, 'title');
  const count = Object.prototype.hasOwnProperty.call(row, 'messageCount')
    ? `${row.messageCount}msg`
    : 'unknown';
  const preview = formatRemotePreview(row);
  return [`⟨remote:${bookmark}⟩ ${row.id}`, when, source, count, title, preview].join('  ');
}

function formatRemoteSessionList(sessions: readonly RemoteSessionSummary[], bookmark: string): string {
  const header = `원격 세션 북마크 ${bookmark} · ${sessions.length}건 · GET ${REMOTE_SESSIONS_STORE_PATH}`;
  if (sessions.length === 0) return `${header}\n(세션 없음)`;
  return [header, ...sessions.map((row) => formatRemoteSessionLine(row, bookmark))].join('\n');
}

function parseRemoteSessionsBody(body: unknown): readonly RemoteSessionSummary[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`monad session list: remote ${REMOTE_SESSIONS_STORE_PATH} response is not a session store list`);
  }
  const rec = body as { ok?: unknown; sessions?: unknown };
  if (rec.ok !== true) {
    throw new Error(`monad session list: remote ${REMOTE_SESSIONS_STORE_PATH} response is not a session store list`);
  }
  if (!Array.isArray(rec.sessions)) {
    throw new Error(`monad session list: remote ${REMOTE_SESSIONS_STORE_PATH} response is not a session store list`);
  }
  return rec.sessions.map((value, index) => {
    const row = parseRemoteSessionItem(value);
    if (!row) throw new Error(`monad session list: remote ${REMOTE_SESSIONS_STORE_PATH} item ${index} is malformed`);
    return row;
  });
}

function parseRemoteSessionItem(value: unknown): RemoteSessionSummary | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  // Present-but-wrong-type is malformed — do not coerce into a store-card string/number.
  if (hasOwn(row, 'title') && typeof row.title !== 'string') return null;
  if (hasOwn(row, 'source') && typeof row.source !== 'string') return null;
  if (hasOwn(row, 'createdAt') && typeof row.createdAt !== 'string') return null;
  if (hasOwn(row, 'updatedAt') && typeof row.updatedAt !== 'string') return null;
  if (hasOwn(row, 'messageCount') && (typeof row.messageCount !== 'number' || !Number.isFinite(row.messageCount))) {
    return null;
  }
  if (hasOwn(row, 'preview') && typeof row.preview !== 'string') return null;
  const out: RemoteSessionSummary = { id: row.id };
  if (hasOwn(row, 'title')) (out as { title?: string }).title = row.title as string;
  if (hasOwn(row, 'source')) (out as { source?: string }).source = row.source as string;
  if (hasOwn(row, 'createdAt')) (out as { createdAt?: string }).createdAt = row.createdAt as string;
  if (hasOwn(row, 'updatedAt')) (out as { updatedAt?: string }).updatedAt = row.updatedAt as string;
  if (hasOwn(row, 'messageCount')) (out as { messageCount?: number }).messageCount = row.messageCount as number;
  if (hasOwn(row, 'preview')) (out as { preview?: string }).preview = row.preview as string;
  return out;
}

function hasOwn(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function formatRemotePreview(row: RemoteSessionSummary): string {
  if (!Object.prototype.hasOwnProperty.call(row, 'preview')) return 'unknown';
  const value = row.preview;
  if (typeof value !== 'string') return 'unknown';
  return value === '' ? '(empty)' : value;
}

function remoteDisplay(row: RemoteSessionSummary, key: 'updatedAt' | 'source' | 'title' | 'preview'): string {
  if (!Object.prototype.hasOwnProperty.call(row, key)) return 'unknown';
  const value = row[key];
  if (value === null || value === undefined) return 'unknown';
  return String(value);
}

function sessionListRemoteHttpOrigin(host: string): string {
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

function remoteSessionsUrl(host: string): string {
  return `${sessionListRemoteHttpOrigin(host)}${REMOTE_SESSIONS_STORE_PATH}`;
}

function resolveSessionListBookmark(
  remote: string | boolean,
  store: RemotesStore,
): { entry: ReturnType<RemotesStore['getDefaultRemote']>; named?: string; label: string } {
  const named = typeof remote === 'string' && remote.length > 0 ? remote : undefined;
  const entry = named ? store.getRemote(named) : store.getDefaultRemote();
  const defaultName = named ? undefined : store.listRemotes().find((row) => row.isDefault)?.name;
  return { entry, ...(named ? { named } : {}), label: named ?? defaultName ?? '<default>' };
}

function sessionListBookmarkError(named: string | undefined): string {
  return named
    ? `--remote ${named}: unknown bookmark. Run \`monad nexus list\` to see available remotes.`
    : 'no default remote bookmark. Run `monad nexus connect <host> --default` to set one.';
}

function classifyFetchFailure(
  fetched: Extract<RemoteSessionsFetchResult, { ok: false }>,
): Exclude<SessionListRemoteClassification, 'ok'> {
  if (fetched.timeout === true || fetched.reason.includes('no response within')) {
    return 'session-list-timeout-error';
  }
  if (fetched.status >= 400) return 'session-list-http-error';
  if (fetched.reason.startsWith('monad session list:') || fetched.reason.includes('invalid JSON')) {
    return 'session-list-server-error';
  }
  return 'session-list-transport-error';
}

async function readBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '';
  }
}

function fail(
  out: NonNullable<SessionListRemoteOpts['out']>,
  classification: Exclude<SessionListRemoteClassification, 'ok'>,
  message: string,
): SessionListRemoteResult {
  out.error(message);
  return { exitCode: 1, classification, message };
}

function defaultOut(): NonNullable<SessionListRemoteOpts['out']> {
  return {
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  };
}
