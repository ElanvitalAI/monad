// H6 P1 Bundle 2 · Gemini usage fetcher.
//
// Hits the Gemini Code Assist / Gemini CLI quota endpoint via the
// user's `oauth-personal` credentials (the only auth flow Gemini CLI
// supports for individual developers · ToS-compliant as of the
// 2026-03-23 Gemini API Additional Terms — omni-crawl 2026-04-22).
//
//   POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota
//   Authorization: Bearer <access_token>
//   Content-Type: application/json
//   Body: { project?: string }
//
// Credentials: `~/.gemini/oauth_creds.json` (`access_token`,
// `refresh_token`, `expiry_date` epoch ms, `id_token`).
//
// Token refresh is deferred to Bundle 3 — it requires extracting the
// OAUTH_CLIENT_ID/SECRET from the installed `@google/gemini-cli`
// package, which is non-trivial and better bundled with a proper
// refresh timer + Keychain-style caching. Bundle 2 throws a clear
// instruction when tokens are expired so the user runs `gemini login`.
//
// Response shape (simplified parser · we accept flexible layouts the
// Google API has shipped over time):
//   {
//     "quotas": [
//       { "modelId": "gemini-2.5-pro", "remainingFraction": 0.42, "resetTime": "2026-04-23T00:00:00Z" },
//       ...
//     ]
//   }
//   or flatter variants — we coalesce across known field names.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderFetcher } from '../usage-store.js';
import type { RateWindow, UsageProvider, UsageSnapshot } from '../types.js';

const QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const DEFAULT_TIMEOUT_MS = 15_000;
const DAY_MINUTES = 24 * 60;

// ─── OAuth creds file ────────────────────────────────────────────────

interface GeminiOAuthCreds {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expiry_date?: number;
  [k: string]: unknown;
}

export interface ResolvedGeminiCreds {
  readonly accessToken: string;
  readonly expiresAtMs: number | null;
}

export function readGeminiCreds(
  opts: { credsPath?: string } = {},
): ResolvedGeminiCreds | null {
  const path = opts.credsPath ?? join(homedir(), '.gemini', 'oauth_creds.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as GeminiOAuthCreds;
    if (!parsed.access_token || parsed.access_token.length === 0) return null;
    return {
      accessToken: parsed.access_token,
      expiresAtMs:
        typeof parsed.expiry_date === 'number' && Number.isFinite(parsed.expiry_date)
          ? parsed.expiry_date
          : null,
    };
  } catch {
    return null;
  }
}

// ─── Response shapes (lenient) ───────────────────────────────────────

interface QuotaEntryRaw {
  modelId?: string;
  remainingFraction?: number;
  resetTime?: string;
  [k: string]: unknown;
}

interface QuotaResponseRaw {
  quotas?: readonly QuotaEntryRaw[];
  modelId?: string;
  remainingFraction?: number;
  resetTime?: string;
  [k: string]: unknown;
}

// ─── Public API ──────────────────────────────────────────────────────

export interface GeminiFetcherOpts {
  readonly credsPath?: string;
  readonly accessToken?: string;
  readonly projectId?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export function createGeminiFetcher(opts: GeminiFetcherOpts = {}): ProviderFetcher {
  return {
    async fetch(): Promise<UsageSnapshot> {
      const token = opts.accessToken ?? resolveAccessToken(opts);
      const raw = await fetchQuota(token, opts);
      return mapSnapshot(raw, opts);
    },
  };
}

function resolveAccessToken(opts: GeminiFetcherOpts): string {
  const now = (opts.now ?? Date.now)();
  const creds = readGeminiCreds({
    ...(opts.credsPath ? { credsPath: opts.credsPath } : {}),
  });
  if (!creds) {
    throw new Error(
      'no Gemini OAuth credentials · run `gemini login` (oauth-personal flow) and retry',
    );
  }
  if (creds.expiresAtMs && creds.expiresAtMs <= now) {
    throw new Error(
      'Gemini access token expired · run `gemini login` to refresh (automatic refresh lands in Bundle 3)',
    );
  }
  return creds.accessToken;
}

async function fetchQuota(
  token: string,
  opts: GeminiFetcherOpts,
): Promise<QuotaResponseRaw> {
  const fetcher = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(QUOTA_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'monad-agent/budget-h6-p1',
      },
      body: JSON.stringify(opts.projectId ? { project: opts.projectId } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `Gemini retrieveUserQuota ${res.status} ${res.statusText}${body ? ` · ${body.slice(0, 200)}` : ''}`,
    );
  }
  return (await res.json()) as QuotaResponseRaw;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// ─── Snapshot mapping ────────────────────────────────────────────────

function mapSnapshot(
  raw: QuotaResponseRaw,
  opts: GeminiFetcherOpts,
): UsageSnapshot {
  const windows: RateWindow[] = [];
  const entries: QuotaEntryRaw[] = Array.isArray(raw.quotas)
    ? [...raw.quotas]
    : [raw];
  for (const entry of entries) {
    const win = mapWindow(entry, opts);
    if (win) windows.push(win);
  }
  // Deduplicate: if two rows have identical (kind, model) collapse to
  // whichever has the LOWER remaining (matches CodexBar's "lowest
  // remaining wins" rule for UI display).
  const collapsed = collapseByModel(windows);
  return {
    provider: 'gemini' as UsageProvider,
    windows: collapsed,
    fetchedAt: (opts.now ?? Date.now)(),
    source: 'oauth-api',
  };
}

function mapWindow(
  entry: QuotaEntryRaw,
  opts: GeminiFetcherOpts,
): RateWindow | null {
  if (!entry) return null;
  const remainingFraction =
    typeof entry.remainingFraction === 'number'
      ? entry.remainingFraction
      : null;
  if (remainingFraction == null) return null;
  const remainingPercent = clamp(remainingFraction * 100, 0, 100);
  const usedPercent = 100 - remainingPercent;
  const resetsAt = parseIsoMs(entry.resetTime, (opts.now ?? Date.now)());
  const modelRaw = typeof entry.modelId === 'string' ? entry.modelId : undefined;
  const model = modelRaw ? normalizeModel(modelRaw) : undefined;
  // Gemini reports per-model daily quotas · map to `session` kind
  // (their "window" is a rolling day). Bundle 2 keeps it simple · H6
  // P2 will add the weekly/monthly axis once the endpoint surfaces
  // the data.
  return {
    kind: 'session',
    windowMinutes: DAY_MINUTES,
    limit: 100,
    used: usedPercent,
    remainingPercent,
    resetsAt,
    ...(model ? { model } : {}),
  };
}

function collapseByModel(windows: readonly RateWindow[]): RateWindow[] {
  const byKey = new Map<string, RateWindow>();
  for (const w of windows) {
    const key = `${w.kind}|${w.model ?? '*'}`;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, w);
      continue;
    }
    if (w.used > prior.used) byKey.set(key, w);
  }
  return [...byKey.values()];
}

function normalizeModel(modelId: string): string {
  // Compact canonical names so the UI doesn't show full `gemini-2.5-pro-preview-03-25` strings.
  const lower = modelId.toLowerCase();
  if (lower.includes('pro')) return 'pro';
  if (lower.includes('flash')) return 'flash';
  return modelId;
}

function parseIsoMs(raw: string | undefined, fallbackNow: number): number {
  if (!raw || typeof raw !== 'string') return fallbackNow + 24 * 60 * 60 * 1000;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : fallbackNow + 24 * 60 * 60 * 1000;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
