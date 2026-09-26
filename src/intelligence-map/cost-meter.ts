// ── PFC-S5 P2: cost meter ──
//
// JSONL event log at ~/.elanous/cost-events.jsonl — one line per paid
// LLM call. snapshotCost() streams the file and computes total /
// weekly / monthly rollups on demand (no cache; events are capped
// by file rotation in a follow-up session).
//
// Auto-attribution (DD-S5-MVP-3): when logUsage() is called without
// an explicit goalSlug AND an S4 auto-mode session is active, the
// event is tagged with that goal + dispatchBudget({action:'add'}) is
// called automatically. Import direction is uni-directional — S4
// does not know about cost-meter, only cost-meter knows about S4.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  CostCapConfig,
  CostCapStatus,
  CostPerGoal,
  CostPerModel,
  CostSnapshot,
  UsageEvent,
} from './types.js';
import { getAutoModeState } from '../auto-research/auto-mode/index.js';
import { dispatchBudget } from '../auto-research/tools/budget.js';

// ── Paths ──────────────────────────────────────────────────────────────

export function getCostEventPath(home: string = homedir()): string {
  return join(home, '.elanous', 'cost-events.jsonl');
}

export function getCostConfigPath(home: string = homedir()): string {
  return join(home, '.elanous', 'cost-config.json');
}

interface PathOpts {
  env?: NodeJS.ProcessEnv;
  home?: string;
  path?: string;
}

function resolveEventPath(opts: PathOpts = {}): string {
  const env = opts.env ?? process.env;
  if (opts.path) return opts.path;
  const override = env.ELANOUS_COST_EVENTS?.trim();
  if (override) return override;
  return getCostEventPath(opts.home);
}

function resolveConfigPath(opts: PathOpts = {}): string {
  const env = opts.env ?? process.env;
  if (opts.path) return opts.path;
  const override = env.ELANOUS_COST_CONFIG?.trim();
  if (override) return override;
  return getCostConfigPath(opts.home);
}

// ── Config ─────────────────────────────────────────────────────────────

export function loadCostConfig(opts: PathOpts = {}): CostCapConfig {
  const path = resolveConfigPath(opts);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as CostCapConfig;
    const out: CostCapConfig = {};
    if (typeof raw.weeklyCapUsd === 'number' && raw.weeklyCapUsd >= 0) out.weeklyCapUsd = raw.weeklyCapUsd;
    if (typeof raw.monthlyCapUsd === 'number' && raw.monthlyCapUsd >= 0) out.monthlyCapUsd = raw.monthlyCapUsd;
    return out;
  } catch {
    return {};
  }
}

export function persistCostConfig(config: CostCapConfig, opts: PathOpts = {}): void {
  const path = resolveConfigPath(opts);
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
}

// ── Log ────────────────────────────────────────────────────────────────

export interface LogUsageInput {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  goalSlug?: string;
  taskId?: string;
  /** Test seam / override — skip auto-attribution entirely. */
  skipAutoAttribution?: boolean;
}

export interface LogUsageOpts extends PathOpts {
  now?: number;
  /** Test seam — inject a resolver that returns the active goalSlug. */
  autoModeResolver?: () => string | undefined;
  /** Test seam — inject a Budget.add handler. */
  budgetDispatch?: (goalSlug: string, tokens: number, usd: number) => Promise<void>;
}

export async function logUsage(
  input: LogUsageInput,
  opts: LogUsageOpts = {},
): Promise<UsageEvent> {
  if (!Number.isFinite(input.inputTokens) || input.inputTokens < 0) {
    throw new Error(`cost-meter.logUsage: invalid inputTokens=${input.inputTokens}`);
  }
  if (!Number.isFinite(input.outputTokens) || input.outputTokens < 0) {
    throw new Error(`cost-meter.logUsage: invalid outputTokens=${input.outputTokens}`);
  }
  if (!Number.isFinite(input.usd) || input.usd < 0) {
    throw new Error(`cost-meter.logUsage: invalid usd=${input.usd}`);
  }

  let goalSlug = input.goalSlug;
  if (!goalSlug && !input.skipAutoAttribution) {
    const resolver = opts.autoModeResolver ?? defaultAutoModeResolver;
    try { goalSlug = resolver(); } catch { /* swallow */ }
  }

  const event: UsageEvent = {
    ts: opts.now ?? Date.now(),
    modelId: input.modelId,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    usd: input.usd,
    ...(goalSlug ? { goalSlug } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
  };

  const path = resolveEventPath(opts);
  ensureDir(dirname(path));
  appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8');

  if (goalSlug && !input.skipAutoAttribution) {
    const budget = opts.budgetDispatch ?? defaultBudgetDispatch;
    try {
      await budget(goalSlug, input.inputTokens + input.outputTokens, input.usd);
    } catch { /* swallow — cost log already succeeded */ }
  }

  for (const sub of costMeterSubscribers) {
    try { sub(event); } catch { /* swallow — subscriber isolation */ }
  }

  return event;
}

// ── Subscribers (observer) ─────────────────────────────────────────────
//
// Lightweight observer bus so ContextKeys bridges / task-orchestrator /
// plugin stats can react to every logUsage without polling the JSONL.

export type CostMeterSubscriber = (event: UsageEvent) => void;

const costMeterSubscribers = new Set<CostMeterSubscriber>();

/** Subscribe to every logUsage event. Returns a dispose function. */
export function subscribeCostMeter(fn: CostMeterSubscriber): () => void {
  costMeterSubscribers.add(fn);
  return () => { costMeterSubscribers.delete(fn); };
}

/** Test seam — clear subscribers between tests. */
export function clearCostMeterSubscribersForTest(): void {
  costMeterSubscribers.clear();
}

function defaultAutoModeResolver(): string | undefined {
  try { return getAutoModeState().goalSlug; } catch { return undefined; }
}

async function defaultBudgetDispatch(goalSlug: string, tokens: number, usd: number): Promise<void> {
  await dispatchBudget({
    action: 'add',
    goal_slug: goalSlug,
    delta: { tokens, usd },
  });
}

// ── Snapshot ───────────────────────────────────────────────────────────

export interface SnapshotOpts extends PathOpts {
  now?: number;
}

export function snapshotCost(opts: SnapshotOpts = {}): CostSnapshot {
  const now = opts.now ?? Date.now();
  const path = resolveEventPath(opts);
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;
  const monthStart = now - 30 * 24 * 60 * 60 * 1000;

  const perModel: Record<string, CostPerModel> = {};
  const perGoal: Record<string, CostPerGoal> = {};
  let totalUsd = 0;
  let weeklyUsd = 0;
  let monthlyUsd = 0;
  let count = 0;

  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let ev: UsageEvent;
      try { ev = JSON.parse(line) as UsageEvent; }
      catch { continue; }
      if (typeof ev.usd !== 'number' || typeof ev.ts !== 'number') continue;
      count++;
      totalUsd += ev.usd;
      if (ev.ts >= weekStart) weeklyUsd += ev.usd;
      if (ev.ts >= monthStart) monthlyUsd += ev.usd;
      const mk = ev.modelId || 'unknown';
      if (!perModel[mk]) perModel[mk] = { tokens: 0, usd: 0, count: 0 };
      perModel[mk].tokens += (ev.inputTokens ?? 0) + (ev.outputTokens ?? 0);
      perModel[mk].usd += ev.usd;
      perModel[mk].count += 1;
      if (ev.goalSlug) {
        if (!perGoal[ev.goalSlug]) perGoal[ev.goalSlug] = { tokens: 0, usd: 0 };
        perGoal[ev.goalSlug].tokens += (ev.inputTokens ?? 0) + (ev.outputTokens ?? 0);
        perGoal[ev.goalSlug].usd += ev.usd;
      }
    }
  }

  return {
    totalUsd,
    weeklyUsd,
    monthlyUsd,
    perModel,
    perGoal,
    weekStart,
    monthStart,
    eventsCount: count,
    snapshotAt: now,
  };
}

// ── Cap status ─────────────────────────────────────────────────────────

export const COST_WARNING_RATIO = 0.9;

export function weeklyCapStatus(snap: CostSnapshot, config: CostCapConfig): CostCapStatus {
  if (config.weeklyCapUsd === undefined) return 'ok';
  const ratio = snap.weeklyUsd / config.weeklyCapUsd;
  if (ratio >= 1) return 'tripped';
  if (ratio >= COST_WARNING_RATIO) return 'warning';
  return 'ok';
}

export function monthlyCapStatus(snap: CostSnapshot, config: CostCapConfig): CostCapStatus {
  if (config.monthlyCapUsd === undefined) return 'ok';
  const ratio = snap.monthlyUsd / config.monthlyCapUsd;
  if (ratio >= 1) return 'tripped';
  if (ratio >= COST_WARNING_RATIO) return 'warning';
  return 'ok';
}

// ── Helpers ────────────────────────────────────────────────────────────

function ensureDir(path: string): void {
  if (existsSync(path)) return;
  mkdirSync(path, { recursive: true });
}
