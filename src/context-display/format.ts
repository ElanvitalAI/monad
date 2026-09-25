// ── Wave 1 · Context-display formatter ────────────────────────────────
//
// Build the multi-line text shown by `/context`. Reads the in-memory
// telemetry ring buffer (telemetry.ts), resolves the active model's
// context window from `BUILTIN_CATALOG`, and lays out three sections:
//
//   ① Latest call — provider/model + token breakdown + ctx %
//   ② Session aggregate — per-provider + per-role bucket
//   ③ Buffer status — captured N / max M
//
// Cost rollups are intentionally separated to a future `/cost` slash
// (Wave 6) so the line count stays tight on `/context`.

import type { ModelEntry } from '../intelligence-map/types.js';
import { BUILTIN_CATALOG } from '../intelligence-map/model-catalog.js';
import {
  getLatestCall,
  getSessionStats,
  telemetryBufferStats,
  type LlmCallTelemetry,
} from './telemetry.js';

export interface FormatContextOpts {
  /** Active model id (the one the chat layer is currently using).
   *  Used to compute ctx % and to point at the catalog entry's
   *  reservedOutputTokens / contextWindow. Optional — when absent,
   *  ctx % is omitted. */
  activeModelId?: string;
  /** Override the catalog (test injection). Defaults to BUILTIN_CATALOG. */
  catalog?: { models: readonly ModelEntry[] };
}

export interface FormattedContextSummary {
  /** Human-readable lines (joined with '\n' for terminal output). */
  lines: string[];
  /** Structured payload — useful when callers want to render via
   *  view widgets instead of plain text. */
  payload: {
    latest: LlmCallTelemetry | null;
    session: ReturnType<typeof getSessionStats>;
    buffer: ReturnType<typeof telemetryBufferStats>;
    activeModel?: ModelEntry;
    contextWindow?: number;
    reservedOutputTokens?: number;
    /** Effective input budget = contextWindow − reservedOutputTokens.
     *  This is what counts as "available for input + history" before
     *  output drains it. Auto-compact uses this same number. */
    inputBudget?: number;
    /** % of inputBudget consumed by latest call's inputTokens (+ cache
     *  read since cache reads still draw from the input slot). */
    ctxPct?: number;
  };
}

export function formatContextSummary(opts: FormatContextOpts = {}): FormattedContextSummary {
  const catalog = opts.catalog ?? BUILTIN_CATALOG;
  const latest = getLatestCall();
  const session = getSessionStats();
  const buf = telemetryBufferStats();

  const activeModel = opts.activeModelId
    ? catalog.models.find((m) => m.id === opts.activeModelId)
    : latest
      ? catalog.models.find((m) => m.id === latest.model)
      : undefined;
  const contextWindow = activeModel?.contextWindow;
  const reservedOutputTokens = activeModel?.reservedOutputTokens;
  const inputBudget = contextWindow !== undefined && contextWindow > 0
    ? contextWindow - (reservedOutputTokens ?? 0)
    : undefined;

  let ctxPct: number | undefined;
  if (latest && inputBudget !== undefined && inputBudget > 0) {
    const consumed = latest.inputTokens + latest.cacheReadInputTokens;
    ctxPct = Math.min(100, Math.round((consumed / inputBudget) * 100));
  }

  const lines: string[] = [];
  lines.push('── /context ─────────────────────────────────────────────');

  // ① Latest call
  if (latest) {
    const when = formatRelativeAge(Date.now() - latest.ts);
    lines.push(`Latest: ${latest.provider}/${latest.model}  (${when} ago)`);
    lines.push(formatTokenLine(latest));
    if (ctxPct !== undefined && contextWindow !== undefined) {
      const bar = formatProgressBar(ctxPct, 20);
      lines.push(`  ctx  ${bar}  ${ctxPct}% of ${formatNumber(inputBudget!)} in-budget (${formatNumber(contextWindow)} window − ${formatNumber(reservedOutputTokens ?? 0)} reserved out)`);
    }
  } else {
    lines.push('Latest: (no LLM calls captured yet this session)');
  }

  // ② Session aggregate
  if (session.callCount > 0) {
    lines.push('');
    lines.push(`Session: ${session.callCount} call(s)`);
    lines.push(`  total in:  ${formatNumber(session.totalInput)}    cache read: ${formatNumber(session.totalCacheRead)}    cache create: ${formatNumber(session.totalCacheCreate)}`);
    lines.push(`  total out: ${formatNumber(session.totalOutput)}    reasoning:  ${formatNumber(session.totalReasoning)}`);
    const cacheRate = session.totalInput + session.totalCacheRead > 0
      ? Math.round((session.totalCacheRead / (session.totalInput + session.totalCacheRead)) * 100)
      : 0;
    lines.push(`  cache hit rate: ${cacheRate}%`);

    const providerKeys = Object.keys(session.perProvider).sort();
    if (providerKeys.length > 1) {
      lines.push('  per provider:');
      for (const p of providerKeys) {
        const b = session.perProvider[p]!;
        lines.push(`    ${p.padEnd(12)} ${b.callCount.toString().padStart(3)} call · in ${formatNumber(b.totalInput)} · out ${formatNumber(b.totalOutput)}`);
      }
    }

    const roleKeys = Object.keys(session.perRole).filter((k) => k !== 'main' || Object.keys(session.perRole).length === 1);
    if (roleKeys.length > 0 && Object.keys(session.perRole).length > 1) {
      lines.push('  per role:');
      for (const r of Object.keys(session.perRole).sort()) {
        const b = session.perRole[r]!;
        lines.push(`    ${r.padEnd(12)} ${b.callCount.toString().padStart(3)} call · in ${formatNumber(b.totalInput)} · out ${formatNumber(b.totalOutput)}`);
      }
    }
  }

  // ③ Buffer status
  lines.push('');
  lines.push(`Buffer: ${buf.size}/${buf.max} calls captured (oldest dropped first)`);

  return {
    lines,
    payload: {
      latest,
      session,
      buffer: buf,
      ...(activeModel ? { activeModel } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(reservedOutputTokens !== undefined ? { reservedOutputTokens } : {}),
      ...(inputBudget !== undefined ? { inputBudget } : {}),
      ...(ctxPct !== undefined ? { ctxPct } : {}),
    },
  };
}

function formatTokenLine(c: LlmCallTelemetry): string {
  const parts: string[] = [
    `in ${formatNumber(c.inputTokens)}`,
    `out ${formatNumber(c.outputTokens)}`,
    `cache-r ${formatNumber(c.cacheReadInputTokens)}`,
    `cache-w ${formatNumber(c.cacheCreationInputTokens)}`,
  ];
  if (c.reasoningOutputTokens && c.reasoningOutputTokens > 0) {
    parts.push(`reasoning ${formatNumber(c.reasoningOutputTokens)}`);
  }
  return `  ${parts.join('  ·  ')}  =  total ${formatNumber(c.totalTokens)}`;
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}

export function formatProgressBar(pct: number, width: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}]`;
}

function formatRelativeAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}min`;
  const hr = Math.round(min / 60);
  return `${hr}hr`;
}
