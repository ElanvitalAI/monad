// H6 P1 Bundle 1 · Claude usage fetcher.
//
// Hits Anthropic's OAuth usage endpoint (omni-crawl 2026-04-22
// confirmed still operational · beta header unchanged · aggressive
// 429 even at 5-10m intervals → default refresh cadence = 15m).
//
//   GET https://api.anthropic.com/api/oauth/usage
//   Authorization: Bearer <access_token>
//   anthropic-beta: oauth-2025-04-20
//
// Response (normalized):
//   {
//     "five_hour":         { "utilization": 8.0,  "resets_at": "..." },
//     "seven_day":         { "utilization": 77.0, "resets_at": "..." },
//     "seven_day_sonnet":  { "utilization": 0.0,  "resets_at": "..." },
//     "seven_day_opus":    { "utilization": 0.0,  "resets_at": "..." },
//     "extra_usage":       { "is_enabled": false, ... }
//   }
//
// Token source (Bundle 1 keeps it simple):
//   1. `$CLAUDE_CODE_OAUTH_TOKEN` env — lets CI + tests inject
//   2. `~/.claude/.credentials.json` — CodexBar file fallback
//   3. (macOS Keychain `Claude Code-credentials` is deferred · the
//       `security` CLI prompts the user every call · needs a UX flow
//       we don't want in Bundle 1)
//
// Scope check: OAuth token must have `user:profile` · CLI-only tokens
// (`user:inference`) fail with 401. We don't pre-verify; the server
// returns a clear error and the failure-gate swallows transient
// flakes.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderFetcher } from '../usage-store.js';
import type { RateWindow, UsageProvider, UsageSnapshot, WindowKind } from '../types.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER_VALUE = 'oauth-2025-04-20';
const DEFAULT_TIMEOUT_MS = 15_000;

const FIVE_HOUR_MINUTES = 5 * 60;
const SEVEN_DAY_MINUTES = 7 * 24 * 60;

// ─── Credentials resolution ──────────────────────────────────────────

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    scopes?: readonly string[];
  };
  access_token?: string;
  // tolerate other unknown fields
  [k: string]: unknown;
}

export function resolveClaudeAccessToken(
  opts: { credentialsPath?: string; env?: NodeJS.ProcessEnv } = {},
): string | null {
  const env = opts.env ?? process.env;
  const fromEnv = env['CLAUDE_CODE_OAUTH_TOKEN'];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();

  const path = opts.credentialsPath ?? join(homedir(), '.claude', '.credentials.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as ClaudeCredentialsFile;
    const oauth = parsed.claudeAiOauth;
    if (oauth?.accessToken && oauth.accessToken.length > 0) return oauth.accessToken;
    if (typeof parsed.access_token === 'string' && parsed.access_token.length > 0) {
      return parsed.access_token;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Raw usage API shape ─────────────────────────────────────────────

interface UsageWindowRaw {
  utilization?: number;
  resets_at?: string;
  [k: string]: unknown;
}

interface UsageResponseRaw {
  five_hour?: UsageWindowRaw;
  seven_day?: UsageWindowRaw;
  seven_day_sonnet?: UsageWindowRaw;
  seven_day_opus?: UsageWindowRaw;
  extra_usage?: { is_enabled?: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

// ─── Public API ──────────────────────────────────────────────────────

export interface ClaudeFetcherOpts {
  /** Override token resolution · primary use is tests. */
  readonly accessToken?: string;
  /** Override credential file location. */
  readonly credentialsPath?: string;
  /** Fetch implementation seam (tests inject a mock). */
  readonly fetchImpl?: typeof fetch;
  /** Request timeout. Default 15s. */
  readonly timeoutMs?: number;
  /** Env lookup (tests override). */
  readonly env?: NodeJS.ProcessEnv;
}

export function createClaudeFetcher(opts: ClaudeFetcherOpts = {}): ProviderFetcher {
  return {
    async fetch(): Promise<UsageSnapshot> {
      const token =
        opts.accessToken ??
        resolveClaudeAccessToken({
          credentialsPath: opts.credentialsPath,
          env: opts.env,
        });
      if (!token) {
        throw new Error(
          'no Claude OAuth token · run `claude /login` once so credentials are written to ~/.claude/.credentials.json',
        );
      }
      const raw = await fetchUsage(token, opts);
      return mapSnapshot(raw);
    },
  };
}

// ─── HTTP call ───────────────────────────────────────────────────────

async function fetchUsage(
  token: string,
  opts: ClaudeFetcherOpts,
): Promise<UsageResponseRaw> {
  const fetcher = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(USAGE_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': BETA_HEADER_VALUE,
        Accept: 'application/json',
        'User-Agent': 'monad-agent/budget-h6-p1',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `Claude OAuth usage ${res.status} ${res.statusText}${body ? ` · ${body.slice(0, 200)}` : ''}`,
    );
  }
  return (await res.json()) as UsageResponseRaw;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// ─── Snapshot mapping ────────────────────────────────────────────────

function mapSnapshot(raw: UsageResponseRaw): UsageSnapshot {
  const windows: RateWindow[] = [];
  const fiveHour = mapWindow(raw.five_hour, 'session', FIVE_HOUR_MINUTES);
  if (fiveHour) windows.push(fiveHour);
  const weekly = mapWindow(raw.seven_day, 'weekly', SEVEN_DAY_MINUTES);
  if (weekly) windows.push(weekly);
  const sonnet = mapWindow(raw.seven_day_sonnet, 'weekly', SEVEN_DAY_MINUTES, 'sonnet');
  if (sonnet) windows.push(sonnet);
  const opus = mapWindow(raw.seven_day_opus, 'weekly', SEVEN_DAY_MINUTES, 'opus');
  if (opus) windows.push(opus);

  return {
    provider: 'claude' as UsageProvider,
    windows,
    fetchedAt: Date.now(),
    source: 'oauth-api',
  };
}

function mapWindow(
  raw: UsageWindowRaw | undefined,
  kind: WindowKind,
  windowMinutes: number,
  model?: string,
): RateWindow | null {
  if (!raw) return null;
  const utilization = clamp(Number(raw.utilization ?? 0), 0, 100);
  const resetsAt = parseIsoMs(raw.resets_at);
  return {
    kind,
    windowMinutes,
    limit: 100,
    used: utilization,
    remainingPercent: 100 - utilization,
    resetsAt,
    ...(model ? { model } : {}),
  };
}

function parseIsoMs(raw: string | undefined): number {
  if (!raw || typeof raw !== 'string') return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
