// ── MSS feature flags — single source of truth (PLAN §9.6 · DD-MSS-36) ──
//
// Defaults honour DD-MSS-33 (default-everything) and DD-MSS-38 (MVS first):
//   - MSS_ENABLED       = true   → trace_id/monad_id enrichment live
//   - MSS_LLM_JUDGE     = false  → no paid LLM on the hot path
//   - MSS_SLEEP_LLM_SUMMARY = false → same
//
// All flags are read from `process.env` on first access and cached in a
// frozen singleton so downstream code can read them without paying the
// env-lookup cost on every hot-path event. Tests can reset the cache via
// `__resetFlagsForTests` when exercising env overrides.

export type MssPhase = 'mvs' | 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6';

export type MssStderrLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface MssFlags {
  readonly enabled: boolean;
  readonly phase: MssPhase;
  readonly llmJudge: boolean;
  readonly sleepLlmSummary: boolean;
  readonly llmJudgeModel: string;
  readonly sleepLlmSummaryModel: string;
  /** Opt-in stderr mirror sink. When true, the `debug` singleton
   *  registers an additional `StderrSink` at startup so every logged
   *  record also reaches stderr as one NDJSON line. Useful for CI
   *  dumps, container log forwarders, and local `2> trace.log`
   *  redirection. Default false so interactive sessions stay clean. */
  readonly stderrSink: boolean;
  /** Minimum severity for the stderr sink. Records with a lower level
   *  are dropped. Records without a `level` field are treated as
   *  `'debug'`. Undefined → no filter (everything emits). */
  readonly stderrSinkLevel: MssStderrLevel | undefined;
  /** Log retention — max age in days for `<cwd>/log/debug-*.log`.
   *  `0` disables age-based cleanup. Default 30. */
  readonly logRetentionMaxAgeDays: number;
  /** Log retention — max total directory size in MiB. When exceeded,
   *  oldest files are deleted first until the footprint fits. `0`
   *  disables size-based cleanup. Default 100. */
  readonly logRetentionMaxTotalMb: number;
  /** Sink-level secret redaction. When true, every LogRecord has its
   *  `data` payload recursively masked before reaching file / ring /
   *  mirror / extra sinks. Opt-in so the default log path stays
   *  byte-identical to pre-M2.3. Default false. */
  readonly redactLogs: boolean;
  /** OTLP/HTTP traces endpoint for the GenAI sink (PLAN §4.6 · Arc 2.2).
   *  Set to e.g. `http://localhost:4318/v1/traces` to opt in.
   *  Empty / unset → sink not registered. */
  readonly otelEndpoint: string | undefined;
  /** `service.name` resource attribute on exported spans. Default
   *  `monad-agent`. Honoured only when `otelEndpoint` is set. */
  readonly otelServiceName: string | undefined;
  /** Spans-per-batch trigger. Default 50. */
  readonly otelBatchSize: number | undefined;
  /** ms-since-last-flush trigger. Default 5000. */
  readonly otelBatchIntervalMs: number | undefined;
  /** `service.version` resource attribute on exported spans. */
  readonly otelServiceVersion: string | undefined;
}

const VALID_PHASES: readonly MssPhase[] = ['mvs', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'];
const VALID_STDERR_LEVELS: readonly MssStderrLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'critical'];

let cached: MssFlags | null = null;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parsePhase(raw: string | undefined, fallback: MssPhase): MssPhase {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  return (VALID_PHASES as readonly string[]).includes(v) ? v as MssPhase : fallback;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseStderrLevel(raw: string | undefined): MssStderrLevel | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '') return undefined;
  return (VALID_STDERR_LEVELS as readonly string[]).includes(v)
    ? v as MssStderrLevel
    : undefined;
}

export function getFlags(): MssFlags {
  if (cached) return cached;
  const env = process.env;
  cached = Object.freeze({
    enabled: parseBool(env.MSS_ENABLED, true),
    phase: parsePhase(env.MSS_PHASE, 'mvs'),
    llmJudge: parseBool(env.MSS_LLM_JUDGE, false),
    sleepLlmSummary: parseBool(env.MSS_SLEEP_LLM_SUMMARY, false),
    llmJudgeModel: env.MSS_LLM_JUDGE_MODEL?.trim() || 'anthropic:claude-haiku',
    sleepLlmSummaryModel: env.MSS_SLEEP_LLM_SUMMARY_MODEL?.trim() || 'anthropic:claude-haiku',
    stderrSink: parseBool(env.MSS_STDERR_SINK, false),
    stderrSinkLevel: parseStderrLevel(env.MSS_STDERR_LEVEL),
    logRetentionMaxAgeDays: parseNonNegativeInt(env.MSS_LOG_RETENTION_MAX_AGE_DAYS, 30),
    logRetentionMaxTotalMb: parseNonNegativeInt(env.MSS_LOG_RETENTION_MAX_TOTAL_MB, 100),
    redactLogs: parseBool(env.MSS_REDACT_LOGS, false),
    otelEndpoint: env.MSS_OTEL_ENDPOINT?.trim() || undefined,
    otelServiceName: env.MSS_OTEL_SERVICE_NAME?.trim() || undefined,
    otelBatchSize: env.MSS_OTEL_BATCH_SIZE !== undefined
      ? parseNonNegativeInt(env.MSS_OTEL_BATCH_SIZE, 0) || undefined
      : undefined,
    otelBatchIntervalMs: env.MSS_OTEL_BATCH_INTERVAL_MS !== undefined
      ? parseNonNegativeInt(env.MSS_OTEL_BATCH_INTERVAL_MS, 0) || undefined
      : undefined,
    otelServiceVersion: env.MSS_OTEL_SERVICE_VERSION?.trim() || undefined,
  });
  return cached;
}

/** Test-only — drops the frozen cache so the next `getFlags()` reads env afresh. */
export function __resetFlagsForTests(): void {
  cached = null;
}
