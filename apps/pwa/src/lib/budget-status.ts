// M3-1 (PLAN-friction-free-model-selection-ux-2026-05-12 · Phase 3) —
// PWA client for the BudgetGuard endpoint + fallback application.
//
// Talks to:
//   GET /v1/budget/status        — daemon evaluation (BudgetGuard helper)
//   PUT /v1/config/model-tier    — existing route used to apply the
//                                  recommended fallback to STT/LLM/TTS.
//
// Dismissal state lives in localStorage so the modal doesn't nag for
// the same threshold + month after the user picks "Continue". The key
// includes both the YYYY-MM and the status so a `warning → cap-exceeded`
// escalation re-opens the modal in the same month.

import {
  pushLlmTierToDaemon,
  pushSttTierToDaemon,
  pushTtsTierToDaemon,
  type DaemonHttpConfig,
  type SyncStatus,
} from './model-tier-sync';
import type { ModelTier } from './model-tier-spec';

export type BudgetStatus = 'ok' | 'warning' | 'cap-exceeded';

export interface BudgetStatusBody {
  status: BudgetStatus;
  percent: number | null;
  monthlyUsdCap?: number;
  recommendedFallback?: ModelTier;
  notifyAtPct: number;
  monthSoFarUsd: number;
  monthYYYYMM: string;
}

function buildHeaders(cfg: DaemonHttpConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  return headers;
}

function buildUrl(cfg: DaemonHttpConfig, path: string): string {
  const root = cfg.baseUrl.replace(/\/$/, '');
  return root + path;
}

export async function fetchBudgetStatus(
  cfg: DaemonHttpConfig,
): Promise<BudgetStatusBody | null> {
  if (!cfg.baseUrl) return null;
  try {
    const res = await fetch(buildUrl(cfg, '/v1/budget/status'), {
      headers: buildHeaders(cfg),
    });
    if (!res.ok) return null;
    return (await res.json()) as BudgetStatusBody;
  } catch {
    return null;
  }
}

/** Apply the recommended fallback tier to all three voice surfaces.
 *  We push three independent PUTs (vs. one composite) because each
 *  helper preserves its own localStorage state. Returns the worst
 *  sync status across the three so the modal can show a single badge. */
export async function applyBudgetFallback(
  cfg: DaemonHttpConfig,
  tier: ModelTier,
): Promise<SyncStatus> {
  const [stt, llm, tts] = await Promise.all([
    pushSttTierToDaemon(cfg, tier),
    pushLlmTierToDaemon(cfg, tier),
    pushTtsTierToDaemon(cfg, tier),
  ]);
  const order: SyncStatus[] = ['error', 'offline', 'syncing', 'idle', 'synced'];
  return [stt, llm, tts].reduce<SyncStatus>((worst, next) => {
    return order.indexOf(next) < order.indexOf(worst) ? next : worst;
  }, 'synced');
}

// ── Dismissal (localStorage) ────────────────────────────────────────

const DISMISS_KEY_PREFIX = 'monad.budget.dismissed.';

export function budgetDismissalKey(monthYYYYMM: string, status: BudgetStatus): string {
  return `${DISMISS_KEY_PREFIX}${monthYYYYMM}.${status}`;
}

export function isBudgetDismissed(monthYYYYMM: string, status: BudgetStatus): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(budgetDismissalKey(monthYYYYMM, status)) === '1';
  } catch {
    return false;
  }
}

export function dismissBudget(monthYYYYMM: string, status: BudgetStatus): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(budgetDismissalKey(monthYYYYMM, status), '1');
  } catch { /* quota — ignore */ }
}

/** Whether the modal should mount given a fresh status read. Hides when:
 *   - status is 'ok'
 *   - the same month + status was already dismissed
 *   - no `recommendedFallback` was returned (defensive · should never
 *     happen for warning / cap-exceeded). */
export function shouldShowBudgetModal(body: BudgetStatusBody): boolean {
  if (body.status === 'ok') return false;
  if (!body.recommendedFallback) return false;
  if (isBudgetDismissed(body.monthYYYYMM, body.status)) return false;
  return true;
}
