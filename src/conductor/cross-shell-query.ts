// ── T5 (Phase 3 Bundle 1) — Cross-shell semantic query ──
//
// HANDOFF Phase 3 / ROADMAP §6 T5: "cross-shell 의미적 질문". 사용자가
// "지난주 prod 배포 어땠지?" 같은 질문을 하면, 여러 shell 의 누적된 output
// + result 메타를 LLM 에 컨텍스트로 합쳐서 답변.
//
// Pure orchestrator — LLM provider 주입. T4 (safe-shell-selector) 와 합쳐서
// 사용 가능 (selector 가 후보 줄이고 cross-shell-query 가 그 위에서 의미
// 합산).
//
// Per HANDOFF §6 의 PFC cache 활용 — 동일 query 가 짧은 시간 안에 다시
// 들어오면 cache hit.

export interface CrossShellRecord {
  readonly shellId: string;
  /** Command 또는 description. */
  readonly summary: string;
  /** Last ~N lines of the aggregated output. Caller ensures budget. */
  readonly tail: string;
  readonly exitCode?: number;
  readonly outcome?: string;
  /** ISO timestamp. */
  readonly endedAt?: string;
}

export interface CrossShellQueryInput {
  readonly question: string;
  readonly records: readonly CrossShellRecord[];
}

export interface CrossShellQueryAnswer {
  readonly answer: string;
  /** Which shellIds the LLM cited / used. May be empty when LLM
   *  produced a global summary. */
  readonly cited: readonly string[];
  /** Optional confidence — provider-dependent (some skip). */
  readonly confidence?: number;
}

export type CrossShellQueryProvider = (input: {
  question: string;
  records: readonly CrossShellRecord[];
}) => Promise<CrossShellQueryAnswer | null>;

export interface CrossShellQueryCache {
  get(key: string): CrossShellQueryAnswer | null;
  set(key: string, value: CrossShellQueryAnswer, ttlMs: number): void;
}

export interface CrossShellQueryDeps {
  provider: CrossShellQueryProvider;
  /** Optional cache — when set, identical queries reuse last answer
   *  for `cacheTtlMs` (default 60_000). */
  cache?: CrossShellQueryCache;
  cacheTtlMs?: number;
  /** Per-record tail truncation budget (chars). Default 2000. */
  tailMaxChars?: number;
  /** Total record count cap — when records exceeds, only the most
   *  recent are sent to LLM. Default 10. */
  maxRecords?: number;
  /** Provider call budget. Default 10000ms. */
  budgetMs?: number;
  logDebug?: (category: string, event: string, data?: unknown) => void;
}

export interface CrossShellQuery {
  ask(input: CrossShellQueryInput): Promise<CrossShellQueryAnswer | null>;
  /** Pure helper — returns the cache key the orchestrator uses. */
  cacheKey(input: CrossShellQueryInput): string;
}

const DEFAULT_TAIL_MAX = 2000;
const DEFAULT_MAX_RECORDS = 10;
const DEFAULT_CACHE_TTL = 60_000;
const DEFAULT_BUDGET = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(v);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(null);
    });
  });
}

function trimTail(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

function pickRecords(
  records: readonly CrossShellRecord[],
  max: number,
  tailMaxChars: number,
): CrossShellRecord[] {
  const sliced = records.length > max ? records.slice(records.length - max) : records.slice();
  return sliced.map((r) => ({
    ...r,
    tail: trimTail(r.tail ?? '', tailMaxChars),
  }));
}

export function createCrossShellQuery(deps: CrossShellQueryDeps): CrossShellQuery {
  const cacheTtl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL;
  const tailMax = deps.tailMaxChars ?? DEFAULT_TAIL_MAX;
  const maxRecords = deps.maxRecords ?? DEFAULT_MAX_RECORDS;
  const budget = deps.budgetMs ?? DEFAULT_BUDGET;

  const log = (category: string, event: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(category, event, data);
  };

  const cacheKey = (input: CrossShellQueryInput): string => {
    // Deterministic — question + sorted shell ids + their endedAt timestamps.
    const ids = input.records
      .slice()
      .sort((a, b) => a.shellId.localeCompare(b.shellId))
      .map((r) => `${r.shellId}@${r.endedAt ?? ''}`)
      .join('|');
    return `${input.question}::${ids}`;
  };

  return {
    cacheKey,
    async ask(input) {
      if (!input.question || typeof input.question !== 'string') {
        log('cross-shell-query.empty-question', '');
        return null;
      }
      const key = cacheKey(input);
      const cached = deps.cache?.get(key);
      if (cached) {
        log('cross-shell-query.cache-hit', key.slice(0, 40));
        return cached;
      }
      const trimmed = pickRecords(input.records, maxRecords, tailMax);
      log('cross-shell-query.dispatch', '', {
        records: trimmed.length,
        question: input.question.slice(0, 80),
      });

      const result = await withTimeout(
        deps.provider({ question: input.question, records: trimmed }),
        budget,
      );
      if (!result) {
        log('cross-shell-query.no-answer', '');
        return null;
      }
      deps.cache?.set(key, result, cacheTtl);
      log('cross-shell-query.ok', '', {
        cited: result.cited.length,
        chars: result.answer.length,
      });
      return result;
    },
  };
}

/** Default in-memory cache — replace with a persistent one in
 *  production wiring (sqlite + ttl). Pure JavaScript Map + TTL. */
export function createInMemoryQueryCache(): CrossShellQueryCache {
  const store = new Map<string, { answer: CrossShellQueryAnswer; expiresAt: number }>();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.answer;
    },
    set(key, value, ttlMs) {
      store.set(key, { answer: value, expiresAt: Date.now() + ttlMs });
    },
  };
}
