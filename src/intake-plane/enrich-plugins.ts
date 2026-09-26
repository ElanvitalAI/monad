/**
 * FU-I7b (2026-05-12) — production enrichment plugin adapters.
 *
 * I2 (`intake.enrich_background`) ships with an open `EnrichPlugins`
 * seam — `digestUrl` / `fetchRepo` / `crawlKeyword`. This module
 * wires the seam to real surfaces the daemon already owns:
 *
 *   URL  → `fetchUrlText()` (re-uses `context-url`'s `htmlToText` +
 *          `extractTitle`, lives inline so we don't need a HTTP
 *          roundtrip back through the daemon's own /v1 path).
 *   Repo → shell `gh repo view <slug>` (and `gh api repos/<slug>`
 *          for structured fields). elanous already depends on `gh`
 *          for HITL flows + workflows; reusing it keeps the
 *          attack surface unchanged.
 *   Keyword → not wired in this PR. The PR deliberately leaves a
 *          `nullCrawlKeyword` adapter that emits a transparent
 *          "keyword search not wired yet" summary so the user sees
 *          the gap rather than a silent skip. Real crawl plugs in
 *          via FU-I7b.2 (firecrawl / grok-web).
 *
 * Every callable degrades to `{ summary, raw? }` even on failure so
 * the I2 enrichment loop can keep walking the task list. Errors are
 * surfaced via the summary text + the per-callable debug log key.
 *
 * Test seams: every external call (fetch / spawn) is injectable so
 * unit tests stay hermetic.
 *
 * Cross-ref:
 *   src/intake-plane/enrich.ts (I2 orchestrator)
 *   src/nexus/api/context-url.ts (htmlToText + extractTitle origin)
 *   src/intake-plane/runtime-callables.ts (FU-I7a sibling — LLM seam)
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import { extractTitle, htmlToText } from '../nexus/api/context-url.js';
import {
  dispatchSkillExec,
  type SkillExecArgs,
  type SkillExecResult,
} from '../tool-runtime/skill-exec-runtime.js';
import { getSkillIndex } from '../skills/index.js';
import type { SkillIndexEntry } from '../skills/index.js';
import type {
  UrlDigestCallable,
  RepoFetchCallable,
  KeywordCrawlCallable,
  EnrichPlugins,
} from './enrich.js';
import {
  buildKgsKeywordCrawlCallable,
  type KgsKeywordLookup,
} from './keyword-crawl-kgs.js';

// ──────────────────── Tunables ──────────────────────────────────────

/** Cap the digest text we return — the LLM prompt summariser only
 *  needs the first paragraph or two. 800 chars is enough for most
 *  README intros + omni-digest's own first-page summary length. */
const DEFAULT_SUMMARY_BYTES = 800;
/** Cap the raw HTML we fetch. Mirrors `/v1/context/fetch-url` MAX_BYTES
 *  so enrich behaviour is consistent with the showroom paste path. */
const DEFAULT_FETCH_BYTES = 50_000;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_REPO_TIMEOUT_MS = 10_000;

// ──────────────────── Injection seams ───────────────────────────────

export interface FetchUrlFn {
  (url: string, opts: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    text: string;
    title: string | null;
    contentType: string;
    status: number;
    statusText: string;
  }>;
}

export interface SpawnGhFn {
  (
    args: readonly string[],
    opts: { timeoutMs?: number; signal?: AbortSignal },
  ): SpawnSyncReturns<string>;
}

/** Injectable `skill_exec` seam; defaults to the existing tool-runtime dispatcher. */
export interface DispatchSkillExecFn {
  (args: SkillExecArgs): Promise<SkillExecResult>;
}

/** Injectable installed-skill lookup; tests supply this seam to stay hermetic. */
export interface ListInstalledSkillsFn {
  (): readonly Pick<SkillIndexEntry, 'name'>[];
}

export interface BuildEnrichPluginsOptions {
  /** Per-callable kill switch — when false the corresponding plugin
   *  is dropped from the returned bundle so I2 falls back to its
   *  "no plugin" diagnostic. Default true for all three. */
  enableUrl?: boolean;
  enableRepo?: boolean;
  enableKeyword?: boolean;
  /** Text seam — overrides DEFAULT_SUMMARY_BYTES. */
  summaryBytes?: number;
  /** URL fetch seam (tests). */
  fetchUrl?: FetchUrlFn;
  /** Repo fetch seam (tests). Defaults to a `gh` shell wrapper. */
  spawnGh?: SpawnGhFn;
  /** Keyword crawl seam — explicit override. When provided, takes
   *  precedence over `kgsStore` (callers wiring a fully-custom
   *  adapter bypass the KGS layer). When omitted, the keyword
   *  callable falls back to `kgsStore`-backed lookup if available,
   *  else the transparent `nullCrawlKeyword` shim. */
  crawlKeyword?: KeywordCrawlCallable;
  /** FU8 PR #3 (2026-05-12) — KGS substrate for keyword cache-hit
   *  shortcut. When supplied, the default keyword adapter consults
   *  KGS first via BM25; hits skip the external crawl, misses fall
   *  through to either the transparent `nullCrawlKeyword` shim or
   *  the (deferred) external adapter. Ignored when `crawlKeyword`
   *  is explicitly set. */
  kgsStore?: KgsKeywordLookup;
  /** External crawl fallback used by the KGS-backed adapter when BM25 misses.
   *  Ignored when `crawlKeyword` is an explicit override. */
  externalKeywordCrawl?: KeywordCrawlCallable;
  /** Build the existing skill_exec-backed external fallback. It is opt-in so
   * callers without adapter configuration retain the transparent null shim. */
  skillExecKeywordCrawl?: {
    skill?: string;
    dispatchSkillExec?: DispatchSkillExecFn;
    listInstalledSkills?: ListInstalledSkillsFn;
  };
}

// ──────────────────── URL plugin ────────────────────────────────────

/** Production URL fetch — bytes capped + HTML stripped to text. */
async function productionFetchUrl(
  url: string,
  opts: { signal?: AbortSignal },
): Promise<{
  ok: boolean;
  text: string;
  title: string | null;
  contentType: string;
  status: number;
  statusText: string;
}> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  const onParentAbort = (): void => ctrl.abort();
  opts.signal?.addEventListener('abort', onParentAbort);
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'elanous-intake-enrich/1.0 (+https://github.com/ElanvitalAI/monad)',
        accept: 'text/html, text/plain;q=0.9, */*;q=0.5',
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const ctype = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      return {
        ok: false,
        text: '',
        title: null,
        contentType: ctype,
        status: res.status,
        statusText: res.statusText,
      };
    }
    let html = await res.text();
    if (html.length > DEFAULT_FETCH_BYTES) {
      html = html.slice(0, DEFAULT_FETCH_BYTES);
    }
    let text: string;
    let title: string | null = null;
    if (ctype.includes('html')) {
      title = extractTitle(html);
      text = htmlToText(html);
    } else {
      text = html.trim();
    }
    return {
      ok: true,
      text,
      title,
      contentType: ctype,
      status: res.status,
      statusText: res.statusText,
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onParentAbort);
  }
}

export function buildUrlDigestCallable(
  opts: { fetchUrl?: FetchUrlFn; summaryBytes?: number } = {},
): UrlDigestCallable {
  const fetchFn = opts.fetchUrl ?? productionFetchUrl;
  const cap = opts.summaryBytes ?? DEFAULT_SUMMARY_BYTES;
  return async (args) => {
    try {
      const res = await fetchFn(args.url, args.signal ? { signal: args.signal } : {});
      if (!res.ok) {
        return {
          summary: `URL fetch failed (${res.status} ${res.statusText}) — ${args.url}`,
        };
      }
      const head = res.text.slice(0, cap);
      const summary = res.title
        ? `${res.title}\n\n${head}`
        : head || `(empty body) — ${args.url}`;
      return res.text ? { summary, raw: res.text } : { summary };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { summary: `URL fetch threw: ${msg} — ${args.url}` };
    }
  };
}

// ──────────────────── Repo plugin (gh CLI) ─────────────────────────

/** Production `gh` shell wrapper — mirrors how elanous already shells
 *  out for HITL / workflow gh calls. Failure shape matches Node's
 *  `spawnSync` so callers can probe `status` + `error`. */
function productionSpawnGh(
  args: readonly string[],
  opts: { timeoutMs?: number; signal?: AbortSignal },
): SpawnSyncReturns<string> {
  return spawnSync('gh', args, {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? DEFAULT_REPO_TIMEOUT_MS,
    // Best-effort signal forwarding — spawnSync doesn't directly
    // accept AbortSignal but we keep the prop in the contract so
    // future callers can plumb it via spawn() instead.
    ...(opts.signal ? {} : {}),
  });
}

export function buildRepoFetchCallable(
  opts: { spawnGh?: SpawnGhFn } = {},
): RepoFetchCallable {
  const spawn = opts.spawnGh ?? productionSpawnGh;
  return async (args) => {
    // Validate slug shape early — `gh repo view <owner>/<repo>` will
    // accept other forms but we want to keep enrich predictable.
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.slug)) {
      return { summary: `gh: invalid slug '${args.slug}'` };
    }
    const res = spawn(
      ['repo', 'view', args.slug, '--json', 'description,stargazerCount,primaryLanguage,defaultBranchRef,updatedAt'],
      { timeoutMs: DEFAULT_REPO_TIMEOUT_MS, ...(args.signal ? { signal: args.signal } : {}) },
    );
    if (res.error) {
      return { summary: `gh repo view threw: ${res.error.message} — ${args.slug}` };
    }
    if (res.status !== 0) {
      const stderr = (res.stderr ?? '').trim().slice(0, 240);
      return { summary: `gh repo view exit ${res.status} — ${stderr || args.slug}` };
    }
    const stdout = (res.stdout ?? '').trim();
    try {
      const parsed = JSON.parse(stdout) as {
        description?: string | null;
        stargazerCount?: number;
        primaryLanguage?: { name?: string } | null;
        defaultBranchRef?: { name?: string } | null;
        updatedAt?: string;
      };
      const lines: string[] = [];
      lines.push(`${args.slug} (${parsed.primaryLanguage?.name ?? 'unknown'} · ★${parsed.stargazerCount ?? '?'})`);
      if (parsed.description) lines.push(parsed.description);
      if (parsed.defaultBranchRef?.name) {
        lines.push(`default branch: ${parsed.defaultBranchRef.name}`);
      }
      if (parsed.updatedAt) lines.push(`last updated: ${parsed.updatedAt}`);
      return { summary: lines.join('\n'), raw: stdout };
    } catch {
      // Shouldn't happen since --json is structured, but degrade
      // gracefully so the enrich loop keeps walking.
      return { summary: stdout.slice(0, DEFAULT_SUMMARY_BYTES) || `gh repo view: empty body — ${args.slug}` };
    }
  };
}

// ──────────────────── Keyword plugin ────────────────────────────────

const KEYWORD_SEARCH_SKILL_PREFERENCE = ['omni-crawl', 'omni-digest'] as const;

/**
 * Select the installed keyword skill. `omni-crawl` wins because it is a search
 * skill; `omni-digest` is retained as the installed fallback when crawl is absent.
 */
export function selectKeywordSearchSkill(
  installedSkills: readonly Pick<SkillIndexEntry, 'name'>[],
): string | undefined {
  const installed = new Set(installedSkills.map((entry) => entry.name));
  return KEYWORD_SEARCH_SKILL_PREFERENCE.find((skill) => installed.has(skill));
}

/**
 * Build a keyword crawler on the existing `skill_exec` runtime path. It checks
 * installed skills before dispatching, prefers `omni-crawl` over `omni-digest`,
 * and exposes absence or execution errors as summaries rather than throwing.
 */
export function buildSkillExecKeywordCrawlCallable(
  opts: {
    skill?: string;
    dispatchSkillExec?: DispatchSkillExecFn;
    listInstalledSkills?: ListInstalledSkillsFn;
  } = {},
): KeywordCrawlCallable {
  const execute = opts.dispatchSkillExec ?? dispatchSkillExec;
  const listInstalledSkills = opts.listInstalledSkills ?? getSkillIndex;
  return async ({ keyword }) => {
    let skill = opts.skill;
    try {
      const installedSkills = listInstalledSkills();
      const installedNames = new Set(installedSkills.map((entry) => entry.name));
      skill ??= selectKeywordSearchSkill(installedSkills);
      const available = installedSkills.map((entry) => entry.name).join(', ') || 'none';
      if (!skill || !installedNames.has(skill)) {
        return {
          summary: `keyword crawl skill unavailable${skill ? `: ${skill}` : ''} — installed skills: ${available} — '${keyword}'`,
        };
      }
      const result = await execute({ skill, task: keyword });
      if (!result.ok) {
        return {
          summary: `keyword crawl via ${skill} failed: ${(result.error ?? result.output) || 'no result'} — '${keyword}'`,
        };
      }
      const output = result.output.trim();
      return output
        ? { summary: output, raw: result.output }
        : { summary: `keyword crawl via ${skill} returned empty output — '${keyword}'` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { summary: `keyword crawl${skill ? ` via ${skill}` : ''} threw: ${msg} — '${keyword}'` };
    }
  };
}

/** Transparent "not wired" adapter — surfaces the gap to the user
 *  rather than silently emitting an empty enrichment. Replace via
 *  `opts.crawlKeyword` once the firecrawl / grok-web wire ships in
 *  FU-I7b.2. */
export const nullCrawlKeyword: KeywordCrawlCallable = async (args) => ({
  summary: `keyword crawl not wired yet — '${args.keyword}'. Add a search adapter in FU-I7b.2 or wire via buildEnrichPlugins({ crawlKeyword }).`,
});

// ──────────────────── Builder ───────────────────────────────────────

export function buildEnrichPlugins(
  opts: BuildEnrichPluginsOptions = {},
): EnrichPlugins {
  const out: EnrichPlugins = {};
  if (opts.enableUrl !== false) {
    out.digestUrl = buildUrlDigestCallable({
      ...(opts.fetchUrl ? { fetchUrl: opts.fetchUrl } : {}),
      ...(opts.summaryBytes !== undefined ? { summaryBytes: opts.summaryBytes } : {}),
    });
  }
  if (opts.enableRepo !== false) {
    out.fetchRepo = buildRepoFetchCallable(
      opts.spawnGh ? { spawnGh: opts.spawnGh } : {},
    );
  }
  if (opts.enableKeyword !== false) {
    const externalKeywordCrawl = opts.externalKeywordCrawl
      ?? (opts.skillExecKeywordCrawl
        ? buildSkillExecKeywordCrawlCallable(opts.skillExecKeywordCrawl)
        : undefined);
    // Precedence:
    //   1. explicit `crawlKeyword` override (caller-wired adapter)
    //   2. KGS-backed adapter — BM25 hit returns cached card · miss
    //      routes to `externalKeywordCrawl`, including the opt-in skill_exec
    //      adapter, when wired.
    //   3. external adapter without KGS.
    //   4. transparent null shim (no adapter configuration).
    if (opts.crawlKeyword) {
      out.crawlKeyword = opts.crawlKeyword;
    } else if (opts.kgsStore) {
      out.crawlKeyword = buildKgsKeywordCrawlCallable({
        kgsStore: opts.kgsStore,
        ...(externalKeywordCrawl ? { fallback: externalKeywordCrawl } : {}),
      });
    } else if (externalKeywordCrawl) {
      out.crawlKeyword = externalKeywordCrawl;
    } else {
      out.crawlKeyword = nullCrawlKeyword;
    }
  }
  return out;
}
