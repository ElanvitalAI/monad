#!/usr/bin/env bun
// Read-only llm.usage ledger: measurable USD + unknown-pricing remainder.
//
// Invokes the existing logs command. Does not write logs, mutate config,
// touch runRecorder, or use the network.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  estimateLlmCost,
  readLlmConfigPricing,
  type LlmCostUsage,
} from '../src/budget/llm-cost.js';

const PAGE_LIMIT = '100000';
const MAX_PAGES = 10_000;

const LOGS_ARGS = [
  'bin/elanous.mjs',
  'logs',
  '--category', 'llm.usage',
  '--all',
  '--include-test',
  '--json',
  '--json-data',
  '--limit', PAGE_LIMIT,
] as const;

export interface LlmCostLedgerSummary {
  rows: number;
  /** Priced dollars from complete rows plus the priced portion of partial rows. */
  measurableUsd: number;
  knownUsd: number;
  partialUsd: number;
  unknownRows: number;
  unknownModels: string[];
  partialRows: number;
  partialModels: string[];
  incomplete: boolean;
  failure?: string;
}

export interface UsageLogFetchResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error | null;
  signal?: NodeJS.Signals | null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function usageFromRow(row: Record<string, unknown>): LlmCostUsage | undefined {
  if (row._meta) return undefined;
  const nested = asRecord(row.data);
  const data = nested
    ?? (typeof row.model === 'string' ? row : undefined)
    ?? (row.category === 'llm.usage' ? row : undefined);
  if (!data) return undefined;
  const model = typeof data.model === 'string' ? data.model : '';
  const num = (key: keyof LlmCostUsage): number | undefined => {
    const v = data[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  return {
    model,
    inputTokens: num('inputTokens'),
    outputTokens: num('outputTokens'),
    cacheReadInputTokens: num('cacheReadInputTokens'),
    cacheCreationInputTokens: num('cacheCreationInputTokens'),
  };
}

export function limitMetaFromRow(row: Record<string, unknown>): {
  limitReached: boolean;
  nextCursor: number | null;
  nextCursors?: Record<string, number>;
} | undefined {
  const meta = asRecord(row._meta) ?? (row.type === 'log-query-limit' ? row : undefined);
  if (!meta || meta.type !== 'log-query-limit') return undefined;
  const nextCursors = asRecord(meta.nextCursors) as Record<string, number> | undefined;
  return {
    limitReached: meta.limitReached === true,
    nextCursor: typeof meta.nextCursor === 'number' ? meta.nextCursor : null,
    ...(nextCursors ? { nextCursors } : {}),
  };
}

export function spawnPageFailure(
  status: number | null,
  spawn?: { error?: Error | null; signal?: NodeJS.Signals | null },
): string | undefined {
  const error = spawn?.error;
  if (error) {
    const code = 'code' in error && error.code != null ? String(error.code) : undefined;
    return code ? `spawn error: ${code}` : `spawn error: ${error.message}`;
  }
  if (spawn?.signal) return `killed by ${spawn.signal}`;
  if (status !== 0) return status == null ? 'spawn status null' : `exit ${status}`;
  return undefined;
}

export function pageIsIncomplete(
  stdout: string,
  stderr: string,
  status: number | null,
  spawn?: { error?: Error | null; signal?: NodeJS.Signals | null },
): {
  usageLines: string[];
  limitReached: boolean;
  nextBefore?: string;
  incomplete: boolean;
  failure?: string;
} {
  const usageLines: string[] = [];
  let limitReached = false;
  let nextBefore: string | undefined;
  let unreadable = false;
  let invalidOutput = false;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      invalidOutput = true;
      continue;
    }
    const rec = asRecord(parsed);
    if (!rec) {
      invalidOutput = true;
      continue;
    }
    const metaType = asRecord(rec._meta)?.type ?? rec.type;
    if (metaType === 'log-query-unreadable-instances') {
      unreadable = true;
      continue;
    }
    const limit = limitMetaFromRow(rec);
    if (limit) {
      limitReached = limit.limitReached;
      if (limit.nextCursors && Object.keys(limit.nextCursors).length > 0) {
        nextBefore = JSON.stringify(limit.nextCursors);
      } else if (limit.nextCursor != null) {
        nextBefore = String(limit.nextCursor);
      }
      continue;
    }
    usageLines.push(trimmed);
  }
  const stderrTruncated = stderr.includes('limitReached=true');
  if (stderrTruncated) limitReached = true;
  const spawnFailure = spawnPageFailure(status, spawn);
  const failure = spawnFailure
    ?? (invalidOutput ? 'invalid-json' : undefined)
    ?? (unreadable ? 'unreadable-instances' : undefined)
    ?? (limitReached && !nextBefore ? 'truncated-without-cursor' : undefined);
  const incomplete = !!spawnFailure || unreadable || invalidOutput || (limitReached && !nextBefore);
  return {
    usageLines,
    limitReached,
    nextBefore,
    incomplete,
    ...(failure ? { failure } : {}),
  };
}

export function collectUsageLogPages(
  fetchPage: (before?: string) => UsageLogFetchResult,
): { lines: string[]; incomplete: boolean; failure?: string } {
  const lines: string[] = [];
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { stdout, stderr, status, error, signal } = fetchPage(before);
    const parsed = pageIsIncomplete(stdout, stderr, status, { error, signal });
    lines.push(...parsed.usageLines);
    if (parsed.incomplete) {
      return { lines, incomplete: true, ...(parsed.failure ? { failure: parsed.failure } : {}) };
    }
    if (!parsed.limitReached) return { lines, incomplete: false };
    if (!parsed.nextBefore) return { lines, incomplete: true, failure: 'truncated-without-cursor' };
    before = parsed.nextBefore;
  }
  return { lines, incomplete: true, failure: 'page-limit' };
}

export function summarizeLlmUsageRows(
  lines: readonly string[],
  configPricing = readLlmConfigPricing(),
): Omit<LlmCostLedgerSummary, 'incomplete'> {
  let rows = 0;
  let knownUsd = 0;
  let partialUsd = 0;
  let unknownRows = 0;
  let partialRows = 0;
  const unknownModels = new Set<string>();
  const partialModels = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    const rec = asRecord(parsed);
    if (!rec) continue;
    const usage = usageFromRow(rec);
    if (!usage) continue;
    rows += 1;
    const estimate = estimateLlmCost(usage, { configPricing });
    if (estimate.kind === 'known') {
      knownUsd += estimate.usd;
    } else if (estimate.kind === 'partial') {
      partialUsd += estimate.usd;
      partialRows += 1;
      partialModels.add(estimate.model);
    } else {
      unknownRows += 1;
      unknownModels.add(estimate.model);
    }
  }
  return {
    rows,
    measurableUsd: knownUsd + partialUsd,
    knownUsd,
    partialUsd,
    unknownRows,
    unknownModels: [...unknownModels].sort(),
    partialRows,
    partialModels: [...partialModels].sort(),
  };
}

export function formatLlmCostLedger(summary: LlmCostLedgerSummary): string {
  return [
    `measurableUsd ${summary.measurableUsd}`,
    `knownUsd ${summary.knownUsd}`,
    `partialUsd ${summary.partialUsd}`,
    `unknownRows ${summary.unknownRows}`,
    `unknownModels ${summary.unknownModels.join(',') || '(none)'}`,
    `partialRows ${summary.partialRows}`,
    `partialModels ${summary.partialModels.join(',') || '(none)'}`,
    `rows ${summary.rows}`,
    `incomplete ${summary.incomplete ? 'true' : 'false'}`,
    ...(summary.failure ? [`failure ${summary.failure}`] : []),
  ].join('\n');
}

function readUsageLogs(repoRoot: string): { lines: string[]; incomplete: boolean; failure?: string } {
  return collectUsageLogPages((before) => {
    const args = before ? [...LOGS_ARGS, '--before', before] : [...LOGS_ARGS];
    const result = spawnSync('bun', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      status: result.status,
      error: result.error ?? null,
      signal: result.signal ?? null,
    };
  });
}

export function main(repoRoot: string = join(import.meta.dir, '..')): LlmCostLedgerSummary {
  const { lines, incomplete, failure } = readUsageLogs(repoRoot);
  const summary: LlmCostLedgerSummary = {
    ...summarizeLlmUsageRows(lines),
    incomplete,
    ...(failure ? { failure } : {}),
  };
  console.log(formatLlmCostLedger(summary));
  return summary;
}

if (import.meta.main) {
  const summary = main();
  if (summary.incomplete) process.exit(1);
}
