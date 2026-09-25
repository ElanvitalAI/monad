/**
 * `intake.enrich_background` — Phase 1 / I2 / RESEARCH §4.3 + §8.3.
 *
 * For each task in a `MemoDecomposition`, fetch background context by
 * dispatching to the right external surface in parallel:
 *
 *   - URL                → omni-digest (web summary)
 *   - GitHub repo URL    → gh CLI (README · stars · description)
 *   - bare keyword       → omni-crawl (search → top hits)
 *
 * Each enrichment writes a `TaskContextEnrichment` row attached to the
 * task. The orchestrator does NOT mutate TOX — it returns an
 * `EnrichedDecomposition` that I8 register_all serialises. The actual
 * external callouts are injected (DI) so this module stays hermetic
 * under test.
 *
 * Failure model: any single enrichment that throws is captured as an
 * `error: string` entry and the rest continue. The pipeline must not
 * block on a flaky external service.
 */
import type {
  MemoDecomposition,
  ProposedMemoTask,
  ProposedMission,
} from './decompose.js';

// ──────────────────── Public shapes ────────────────────────────────────

export type EnrichmentKind = 'url' | 'repo' | 'keyword';

export interface TaskContextEnrichment {
  kind: EnrichmentKind;
  /** URL · `owner/repo` · keyword phrase. */
  source: string;
  /** ISO timestamp. */
  fetchedAt: string;
  summary?: string;
  raw?: string;
  /** Set when the underlying callable threw. The pipeline keeps moving. */
  error?: string;
}

export interface TaskContext {
  enrichments: TaskContextEnrichment[];
  /** User manual notes (later — wire through I7 preview UI). */
  notes?: string;
}

export interface EnrichedTask extends ProposedMemoTask {
  context: TaskContext;
}

export interface EnrichedMission extends Omit<ProposedMission, 'tasks'> {
  tasks: EnrichedTask[];
}

export interface EnrichedDecomposition extends Omit<MemoDecomposition, 'missions'> {
  missions: EnrichedMission[];
}

// ──────────────────── Callable injections ──────────────────────────────

export interface UrlDigestCallable {
  (args: { url: string; signal?: AbortSignal }): Promise<{
    summary: string;
    raw?: string;
  }>;
}

export interface RepoFetchCallable {
  (args: {
    /** `owner/repo` slug (e.g. `Q00/ouroboros`). */
    slug: string;
    signal?: AbortSignal;
  }): Promise<{
    summary: string;
    raw?: string;
  }>;
}

export interface KeywordCrawlCallable {
  (args: { keyword: string; signal?: AbortSignal }): Promise<{
    summary: string;
    raw?: string;
  }>;
}

export interface EnrichPlugins {
  digestUrl?: UrlDigestCallable;
  fetchRepo?: RepoFetchCallable;
  crawlKeyword?: KeywordCrawlCallable;
}

export interface EnrichOptions {
  plugins: EnrichPlugins;
  signal?: AbortSignal;
  now?: () => Date;
  /** Concurrency cap across the whole pipeline. Default 6 (matches
   *  omni-digest's friendly request budget). */
  maxConcurrency?: number;
}

// ──────────────────── URL classification ───────────────────────────────

const GH_REPO_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/.*)?(?:#.*)?$/i;
const BARE_GH_RE = /^github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/.*)?$/i;

/**
 * Classify a URL-like string. Returns the canonical handle the matching
 * callable expects — `{owner}/{repo}` for repos, the URL itself for
 * web articles / YouTube / etc.
 */
export function classifyEnrichSource(s: string): { kind: 'repo' | 'url'; handle: string } {
  const t = s.trim();
  const m1 = t.match(GH_REPO_RE);
  if (m1) return { kind: 'repo', handle: `${m1[1]}/${m1[2]}` };
  const m2 = t.match(BARE_GH_RE);
  if (m2) return { kind: 'repo', handle: `${m2[1]}/${m2[2]}` };
  return { kind: 'url', handle: t };
}

// ──────────────────── Concurrency limiter ──────────────────────────────

/**
 * Tiny p-limit: queue async thunks at a fixed concurrency.
 * Promise-based — no external dep.
 */
function makeLimiter(max: number): <T>(thunk: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  function next(): void {
    if (active >= max) return;
    const fn = queue.shift();
    if (!fn) return;
    active += 1;
    fn();
  }
  return <T>(thunk: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        thunk()
          .then((v) => resolve(v))
          .catch((e: unknown) => reject(e))
          .finally(() => {
            active -= 1;
            next();
          });
      };
      queue.push(run);
      next();
    });
  };
}

// ──────────────────── Plan ─────────────────────────────────────────────

interface EnrichJob {
  missionIndex: number;
  taskIndex: number;
  kind: EnrichmentKind;
  source: string;
}

export function planEnrichJobs(decomposition: MemoDecomposition): EnrichJob[] {
  const jobs: EnrichJob[] = [];
  decomposition.missions.forEach((mission, mIdx) => {
    mission.tasks.forEach((task, tIdx) => {
      const urls = task.urls ?? [];
      for (const u of urls) {
        const c = classifyEnrichSource(u);
        jobs.push({
          missionIndex: mIdx,
          taskIndex: tIdx,
          kind: c.kind,
          source: c.handle,
        });
      }
      const keywords = task.keywords ?? [];
      for (const kw of keywords) {
        jobs.push({
          missionIndex: mIdx,
          taskIndex: tIdx,
          kind: 'keyword',
          source: kw,
        });
      }
    });
  });
  return jobs;
}

// ──────────────────── Run a single job ─────────────────────────────────

async function runJob(
  job: EnrichJob,
  plugins: EnrichPlugins,
  now: () => Date,
  signal?: AbortSignal,
): Promise<TaskContextEnrichment> {
  const fetchedAt = now().toISOString();
  try {
    if (job.kind === 'url') {
      if (!plugins.digestUrl) {
        return { kind: 'url', source: job.source, fetchedAt, error: 'no digestUrl plugin' };
      }
      const out = await plugins.digestUrl({ url: job.source, signal });
      return { kind: 'url', source: job.source, fetchedAt, summary: out.summary, raw: out.raw };
    }
    if (job.kind === 'repo') {
      if (!plugins.fetchRepo) {
        return { kind: 'repo', source: job.source, fetchedAt, error: 'no fetchRepo plugin' };
      }
      const out = await plugins.fetchRepo({ slug: job.source, signal });
      return { kind: 'repo', source: job.source, fetchedAt, summary: out.summary, raw: out.raw };
    }
    if (!plugins.crawlKeyword) {
      return { kind: 'keyword', source: job.source, fetchedAt, error: 'no crawlKeyword plugin' };
    }
    const out = await plugins.crawlKeyword({ keyword: job.source, signal });
    return { kind: 'keyword', source: job.source, fetchedAt, summary: out.summary, raw: out.raw };
  } catch (err) {
    return {
      kind: job.kind,
      source: job.source,
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ──────────────────── Public entry ─────────────────────────────────────

/**
 * Run enrichment for every task in `decomposition`. Returns a new
 * `EnrichedDecomposition` where every task has a `context.enrichments`
 * list (possibly empty). Original decomposition is not mutated.
 */
export async function enrichDecomposition(
  decomposition: MemoDecomposition,
  opts: EnrichOptions,
): Promise<EnrichedDecomposition> {
  const now = opts.now ?? (() => new Date());
  const jobs = planEnrichJobs(decomposition);
  const max = Math.max(1, opts.maxConcurrency ?? 6);
  const limit = makeLimiter(max);

  // Bucket-of-arrays accumulator (one array per task).
  const buckets: TaskContextEnrichment[][][] = decomposition.missions.map((m) =>
    m.tasks.map(() => []),
  );

  await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const result = await runJob(job, opts.plugins, now, opts.signal);
        const mBucket = buckets[job.missionIndex];
        const tBucket = mBucket ? mBucket[job.taskIndex] : undefined;
        tBucket?.push(result);
      }),
    ),
  );

  const missions: EnrichedMission[] = decomposition.missions.map((mission, mIdx) => ({
    ...mission,
    tasks: mission.tasks.map((task, tIdx) => ({
      ...task,
      context: { enrichments: buckets[mIdx]?.[tIdx] ?? [] },
    })),
  }));

  return {
    ...decomposition,
    missions,
  };
}

// ──────────────────── Convenience: per-task summary ────────────────────

/**
 * Compact a task's enrichment summaries into a single context blurb that
 * later phases (I3 categorize · I5 spec-gen) can paste straight into a
 * prompt. Skips empty / error rows.
 */
export function summariseContext(task: EnrichedTask, maxChars = 800): string {
  const lines: string[] = [];
  for (const e of task.context.enrichments) {
    if (e.error || !e.summary) continue;
    const label =
      e.kind === 'repo' ? `repo ${e.source}` : e.kind === 'url' ? e.source : `keyword "${e.source}"`;
    lines.push(`- ${label}: ${e.summary}`);
  }
  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;
  return joined.slice(0, maxChars - 1) + '…';
}
