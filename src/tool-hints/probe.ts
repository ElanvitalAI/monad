// Capability probe layer.
//
// Each native-tool-catalog entry can declare a ProbeSpec; the gate
// (P4) calls probeOk() each turn to filter the catalog. Probe kinds:
//
//   env    — sync process.env check; runs immediately on first ask.
//   cli    — spawn `cmd [args]` with timeout; ok iff exit code 0.
//   http   — fetch URL with timeout; ok iff response.ok.
//   custom — run a boolean-returning function (sync or async).
//
// Caching is in-process only (not persisted). env probes have TTL
// Infinity by default (keys rarely flip mid-session); cli/http/custom
// default to 5 minutes. Override via probe.ttlMs.
//
// Sync probeOk semantics: env always runs in-line. cli/http/custom
// return false on cache miss and kick off an async refresh — so the
// first catalog draw after startup shows the paid tool absent, the
// second (once the probe resolves) shows it present. This one-turn
// grace period preserves the fail-closed invariant.

import { spawn } from 'node:child_process';

import type { ProbeFailMode, ProbeSpec } from '../native-tool-catalog.js';

export interface ProbeResult {
  ok: boolean;
  reason?: string;
  lastRunAt: number;
  durationMs: number;
  onFail: ProbeFailMode;
}

// ─── Cache ───────────────────────────────────────────────────────

/** env/cli/http — keyable by stringified spec. */
const stringKeyCache = new Map<string, ProbeResult>();
/** custom probes — function identity is the stable key across calls. */
const customCache = new WeakMap<object, ProbeResult>();
/** In-flight dedup; concurrent callers share one probe run. */
const inflight = new Map<string, Promise<ProbeResult>>();
/** Custom inflight (keyed by function reference). */
const customInflight = new WeakMap<object, Promise<ProbeResult>>();

function probeKey(probe: ProbeSpec): string | null {
  if (probe.kind === 'env') return `env:${probe.env}`;
  if (probe.kind === 'cli') return `cli:${probe.cli.cmd}\u0000${(probe.cli.args ?? []).join('\u0000')}`;
  if (probe.kind === 'http') return `http:${probe.http.method ?? 'GET'}:${probe.http.url}`;
  return null;  // custom
}

function getCached(probe: ProbeSpec): ProbeResult | undefined {
  if (probe.kind === 'custom') return customCache.get(probe.custom as unknown as object);
  const key = probeKey(probe);
  return key ? stringKeyCache.get(key) : undefined;
}

function setCached(probe: ProbeSpec, result: ProbeResult): void {
  if (probe.kind === 'custom') {
    customCache.set(probe.custom as unknown as object, result);
    return;
  }
  const key = probeKey(probe);
  if (key) stringKeyCache.set(key, result);
}

function defaultTtlMs(probe: ProbeSpec): number {
  if (probe.kind === 'env') return Infinity;
  return 300_000;
}

function isFresh(probe: ProbeSpec, result: ProbeResult, now: number): boolean {
  const ttl = probe.ttlMs ?? defaultTtlMs(probe);
  if (!Number.isFinite(ttl)) return true;  // Infinity or very large
  return now - result.lastRunAt < ttl;
}

// ─── Public API ──────────────────────────────────────────────────

/** Gate-facing sync check. env probes run in-line; cli/http/custom
 *  return the cached result (or false, kicking off a refresh) so the
 *  gate evaluator can stay synchronous. */
export function probeOk(probe: ProbeSpec, now: number = Date.now()): boolean {
  const cached = getCached(probe);
  if (cached && isFresh(probe, cached, now)) return cached.ok;

  if (probe.kind === 'env') {
    const result = runEnvProbeSync(probe);
    setCached(probe, result);
    return result.ok;
  }
  // Async kinds: fail-closed right now, schedule refresh.
  void ensureProbed(probe).catch(() => { /* swallowed; next call will retry */ });
  return false;
}

/** Async variant used by startup priming and /probe refresh <tool>. */
export async function ensureProbed(probe: ProbeSpec): Promise<ProbeResult> {
  if (probe.kind === 'env') {
    const result = runEnvProbeSync(probe);
    setCached(probe, result);
    return result;
  }
  const key = probeKey(probe);
  if (key && inflight.has(key)) return inflight.get(key)!;
  if (probe.kind === 'custom') {
    const existing = customInflight.get(probe.custom as unknown as object);
    if (existing) return existing;
  }

  const p = doRunProbe(probe);
  if (key) inflight.set(key, p);
  if (probe.kind === 'custom') customInflight.set(probe.custom as unknown as object, p);
  try {
    const result = await p;
    setCached(probe, result);
    return result;
  } finally {
    if (key) inflight.delete(key);
    if (probe.kind === 'custom') customInflight.delete(probe.custom as unknown as object);
  }
}

/** Latest cached result (does NOT kick off a refresh). */
export function getProbeResult(probe: ProbeSpec): ProbeResult | undefined {
  return getCached(probe);
}

/** Force a re-probe bypassing TTL. Used by `/probe refresh <tool>`. */
export async function refreshProbe(probe: ProbeSpec): Promise<ProbeResult> {
  if (probe.kind === 'env') {
    const result = runEnvProbeSync(probe);
    setCached(probe, result);
    return result;
  }
  const key = probeKey(probe);
  if (key) stringKeyCache.delete(key);
  if (probe.kind === 'custom') customCache.delete(probe.custom as unknown as object);
  return ensureProbed(probe);
}

/** Full cache clear. Used by `/hint reset probes` and tests. */
export function resetProbes(): void {
  stringKeyCache.clear();
  // WeakMap has no .clear(); values drop when the function references do.
  // For tests, setProbeResultForTesting with ok=false is the workaround.
  inflight.clear();
}

// ─── Test seams ──────────────────────────────────────────────────

/** Inject a canned result for deterministic gate/skill-runner tests. */
export function setProbeResultForTesting(probe: ProbeSpec, result: Partial<ProbeResult> & { ok: boolean }): void {
  setCached(probe, {
    ok: result.ok,
    reason: result.reason,
    lastRunAt: result.lastRunAt ?? Date.now(),
    durationMs: result.durationMs ?? 0,
    onFail: result.onFail ?? probe.onFail ?? 'hide',
  });
}

// ─── Probe runners ───────────────────────────────────────────────

function runEnvProbeSync(probe: Extract<ProbeSpec, { kind: 'env' }>): ProbeResult {
  const start = Date.now();
  const v = process.env[probe.env];
  const ok = typeof v === 'string' && v.trim().length > 0;
  return {
    ok,
    reason: ok ? undefined : `env var ${probe.env} not set`,
    lastRunAt: start,
    durationMs: Date.now() - start,
    onFail: probe.onFail ?? 'hide',
  };
}

async function doRunProbe(probe: ProbeSpec): Promise<ProbeResult> {
  const start = Date.now();
  try {
    if (probe.kind === 'cli') return await runCliProbe(probe, start);
    if (probe.kind === 'http') return await runHttpProbe(probe, start);
    if (probe.kind === 'custom') return await runCustomProbe(probe, start);
    return {
      ok: false,
      reason: 'unknown probe kind',
      lastRunAt: start,
      durationMs: Date.now() - start,
      onFail: 'hide',
    };
  } catch (err) {
    return {
      ok: false,
      reason: String(err instanceof Error ? err.message : err),
      lastRunAt: start,
      durationMs: Date.now() - start,
      onFail: probe.onFail ?? 'hide',
    };
  }
}

async function runCliProbe(probe: Extract<ProbeSpec, { kind: 'cli' }>, start: number): Promise<ProbeResult> {
  const timeoutMs = probe.cli.timeoutMs ?? 3000;
  const exitCode: number | null = await new Promise((resolve) => {
    const child = spawn(probe.cli.cmd, probe.cli.args ?? [], { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, timeoutMs);
    child.once('close', (code) => { clearTimeout(timer); resolve(code); });
    child.once('error', () => { clearTimeout(timer); resolve(null); });
  });
  const ok = exitCode === 0;
  return {
    ok,
    reason: ok ? undefined : `${probe.cli.cmd} exited ${exitCode ?? 'timeout/error'}`,
    lastRunAt: start,
    durationMs: Date.now() - start,
    onFail: probe.onFail ?? 'hide',
  };
}

async function runHttpProbe(probe: Extract<ProbeSpec, { kind: 'http' }>, start: number): Promise<ProbeResult> {
  const timeoutMs = probe.http.timeoutMs ?? 3000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(probe.http.url, {
      method: probe.http.method ?? 'GET',
      signal: ctrl.signal,
    });
    const ok = resp.ok;
    return {
      ok,
      reason: ok ? undefined : `HTTP ${resp.status}`,
      lastRunAt: start,
      durationMs: Date.now() - start,
      onFail: probe.onFail ?? 'hide',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runCustomProbe(probe: Extract<ProbeSpec, { kind: 'custom' }>, start: number): Promise<ProbeResult> {
  const ok = await probe.custom();
  return {
    ok,
    reason: ok ? undefined : 'custom probe returned false',
    lastRunAt: start,
    durationMs: Date.now() - start,
    onFail: probe.onFail ?? 'hide',
  };
}
