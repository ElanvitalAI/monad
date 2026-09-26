// M7 (2026-04-28) — Tier 1 e2e smoke test infrastructure.
//
// This module is the shared harness for `test/integration/acp-tier1-*.test.ts`
// scenarios. The Tier 1 suite spawns a REAL `codex` binary and drives
// it through elanous's CodexAppServerAgent; it is gated behind
// `ELANOUS_CODEX_TIER1_SMOKE=1` so the regular `bun test` run never picks
// it up.
//
// Run manually:
//   ELANOUS_CODEX_TIER1_SMOKE=1 bun test test/integration/acp-tier1-*.test.ts
//
// CI integration is intentionally out of scope for this PR — the repo
// has no `.github/workflows/` today. When CI is wired, a single env
// flip enables the suite (no test changes needed).

import { spawnSync } from 'node:child_process';

/** True when the host explicitly opted into Tier 1 smoke. The default
 *  is "skip" so contributors who don't have a configured codex binary
 *  / API key never see surprise failures from the suite. */
export function tier1GateEnabled(): boolean {
  const raw = process.env.ELANOUS_CODEX_TIER1_SMOKE;
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/** Detect the codex binary via `which`. Cached at module level so the
 *  7 scenarios pay the lookup cost once. Returns `null` when the
 *  binary isn't on PATH (suite is skipped). */
let _binaryCache: string | null | undefined;

export function detectCodexBinary(): string | null {
  if (_binaryCache !== undefined) return _binaryCache;
  const probe = spawnSync('which', ['codex'], { encoding: 'utf8' });
  if (probe.status === 0 && typeof probe.stdout === 'string') {
    const path = probe.stdout.trim();
    _binaryCache = path.length > 0 ? path : null;
  } else {
    _binaryCache = null;
  }
  return _binaryCache;
}

/** Combined gate — env opted in AND binary discovered AND optional
 *  extra preconditions met. Returns `null` on green, or a diagnostic
 *  string explaining why the suite is skipped. */
export function tier1SkipReason(): string | null {
  if (!tier1GateEnabled()) {
    return 'ELANOUS_CODEX_TIER1_SMOKE not set (default: skip)';
  }
  const binary = detectCodexBinary();
  if (!binary) {
    return 'codex binary not on PATH (install `codex` CLI to run Tier 1 smoke)';
  }
  return null;
}

/** Bun test convention: when a describe block should be conditionally
 *  skipped, callers use `describe.skipIf(skipReason !== null)`. This
 *  helper keeps the scenario files clean.
 *
 *  Usage:
 *      const reason = tier1SkipReason();
 *      describe.skipIf(reason !== null)('Tier 1 · S4 · codex-app-server', () => { ... });
 *
 *  The reason string is logged once at the top of each suite so a
 *  manual run quickly explains why nothing executed. */
export function logSkipReason(scenarioName: string, reason: string | null): void {
  if (reason !== null) {
    /* eslint-disable no-console */
    console.log(`  Tier 1 ${scenarioName} skipped — ${reason}`);
    /* eslint-enable no-console */
  }
}

/** Reset the module-level binary cache. Tests use this to drive the
 *  detection branch in either direction (binary found / missing) within
 *  the same process. */
export function _resetBinaryCacheForTests(): void {
  _binaryCache = undefined;
}
