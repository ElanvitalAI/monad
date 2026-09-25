#!/usr/bin/env bun

import { isAbsolute } from 'node:path';
import { decidePwaRebuild, type PwaRebuildDecision } from './pwa-rebuild-decide.js';

export type PwaRebuildBuildRunner = (target: string) => Promise<void>;
export type PwaRebuildDecider = (target: string) => Promise<PwaRebuildDecision>;

export type PwaRebuildApplyResult =
  | { outcome: 'rebuilt'; decision: Extract<PwaRebuildDecision, { action: 'rebuild' }>; durationMs: number; message: string }
  | { outcome: 'build-failed'; decision: Extract<PwaRebuildDecision, { action: 'rebuild' }>; durationMs: number; message: string }
  | { outcome: 'not-needed'; decision: Extract<PwaRebuildDecision, { action: 'not-needed' }>; message: string }
  | { outcome: 'unavailable'; decision?: Extract<PwaRebuildDecision, { action: 'unavailable' }>; message: string };

async function runNexusBuild(target: string): Promise<void> {
  const child = Bun.spawn({ cmd: [process.execPath, 'bin/monad.mjs', 'nexus', 'build'], cwd: target, stdout: 'inherit', stderr: 'inherit' });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`nexus build exited ${exitCode}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Applies the decision owner's structured result. The target must be supplied explicitly as an absolute tree path.
// Cron example (after tree-sync's every-20-minute run; registration remains the operator's responsibility):
// `*/20 * * * * cd /absolute/monad-agent && bun scripts/cron-run.ts scripts/pwa-rebuild-apply.ts /absolute/monad-agent >> /tmp/pwa-rebuild-apply.log 2>&1`
export async function applyPwaRebuild(
  target: string | undefined,
  { decider = decidePwaRebuild, buildRunner = runNexusBuild }: { decider?: PwaRebuildDecider; buildRunner?: PwaRebuildBuildRunner } = {},
): Promise<PwaRebuildApplyResult> {
  if (!target || !isAbsolute(target)) {
    return { outcome: 'unavailable', message: 'pwa rebuild unavailable: an explicit absolute target tree path is required; refusing to infer it from process.cwd()' };
  }

  const decision = await decider(target);
  if (decision.action === 'not-needed') {
    return { outcome: 'not-needed', decision, message: `pwa rebuild not needed: apps/pwa/out is current in ${decision.path}; nexus build was not run` };
  }
  if (decision.action === 'unavailable') {
    return { outcome: 'unavailable', decision, message: `pwa rebuild unavailable (${decision.reason}): ${decision.error}; nexus build was not run` };
  }

  const startedAt = performance.now();
  try {
    await buildRunner(target);
    const durationMs = Math.round(performance.now() - startedAt);
    return { outcome: 'rebuilt', decision, durationMs, message: `pwa rebuild succeeded (${decision.reason}) in ${durationMs}ms: nexus build completed for ${target}` };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    return { outcome: 'build-failed', decision, durationMs, message: `pwa rebuild failed (${decision.reason}) after ${durationMs}ms: nexus build failed for ${target}: ${errorMessage(error)}` };
  }
}

export async function main(target: string | undefined = process.argv[2]): Promise<PwaRebuildApplyResult> {
  const result = await applyPwaRebuild(target);
  console.log(result.message);
  return result;
}

if (import.meta.main) {
  const result = await main();
  if (result.outcome === 'build-failed' || result.outcome === 'unavailable') process.exitCode = 1;
}
