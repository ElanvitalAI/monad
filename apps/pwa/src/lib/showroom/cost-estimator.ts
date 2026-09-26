// C1 (CV-3 BACKLOG §3.3 · 2026-05-11) — broadcast cost estimator.
//
// `estimateBroadcastCost` returns a per-panel + total token estimate
// for a multi-LLM broadcast so `<CostGateModal>` can warn the user
// before a token-spend spike. Token counting uses the char/4 heuristic
// (industry rule-of-thumb · zero deps · ≤25% off vs tiktoken on Korean
// + English mixed text · sufficient for "is this above 50k?" gate).
//
// DM Stage 4 mixed mode (#2122) prepends each panel's sibling
// `<prior_answer>` block — the estimator includes them so the user
// sees the real cost (32KB × N siblings is the BACKLOG §3.5 risk
// vector).
//
// Threshold:
//   - default 50_000 (matches BACKLOG §3.3 spec)
//   - build-time override `NEXT_PUBLIC_ELANOUS_SHOWROOM_BROADCAST_COST_WARN_TOKENS`
//   - runtime override via localStorage (settings card · future axis)

import type { ShowroomPanel } from './types';
import { panelDisplayName } from './runtime';

export const DEFAULT_BROADCAST_COST_WARN_TOKENS = 50_000;

/** char/4 heuristic — cheap upper-bound that overestimates for ASCII
 *  and roughly matches tiktoken on mixed English/CJK. */
export function estimateTokensFromChars(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export interface PanelCostBreakdown {
  panelId: string;
  displayName: string;
  provider: string;
  /** dispatchText 가 모든 panel 에 동일하게 prepend 되므로 보통 같음. */
  inputTokens: number;
  /** Mixed mode 시 sibling lastAssistant 의 추산. isolated mode 시 0. */
  priorTokens: number;
  /** inputTokens + priorTokens. */
  totalTokens: number;
}

export interface BroadcastCostEstimate {
  totalTokens: number;
  perPanel: PanelCostBreakdown[];
  /** 활성 multiplier (env / localStorage / default). */
  warnThreshold: number;
  /** total > warnThreshold 일 때 `<CostGateModal>` 가 fire. */
  exceedsWarnThreshold: boolean;
}

export interface EstimateBroadcastCostOpts {
  /** Final dispatch text (terminal/url/clipboard/prior prefixes 포함). */
  dispatchText: string;
  /** Plan-resolved target panels (broadcast 시 모든 live panel · mention 시 specific). */
  dmTargets: readonly ShowroomPanel[];
  /** All panels — `panelDisplayName` 의 D12 numeric suffix 결정에 필요. */
  allPanels: readonly ShowroomPanel[];
  /** Mixed mode 의 panelId → sibling lastAssistant text map. undefined =
   *  isolated mode (legacy DM-1/2/3 shape). */
  lastAssistantByPanelId?: Record<string, string>;
  /** Override threshold. undefined = use resolveCostWarnThreshold(). */
  warnThreshold?: number;
}

/** Build-time + runtime threshold resolver. SSR-safe. */
export function resolveCostWarnThreshold(): number {
  // Build-time env (Next.js NEXT_PUBLIC_*).
  const envRaw = typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_ELANOUS_SHOWROOM_BROADCAST_COST_WARN_TOKENS : undefined;
  const envParsed = envRaw ? Number(envRaw) : Number.NaN;
  if (Number.isFinite(envParsed) && envParsed > 0) return envParsed;
  return DEFAULT_BROADCAST_COST_WARN_TOKENS;
}

export function estimateBroadcastCost(opts: EstimateBroadcastCostOpts): BroadcastCostEstimate {
  const inputTokens = estimateTokensFromChars(opts.dispatchText);
  const perPanel: PanelCostBreakdown[] = opts.dmTargets.map((panel) => {
    const lastAssistant = opts.lastAssistantByPanelId?.[panel.id] ?? '';
    const priorTokens = estimateTokensFromChars(lastAssistant);
    return {
      panelId: panel.id,
      displayName: panelDisplayName(panel, opts.allPanels),
      provider: panel.provider || 'default',
      inputTokens,
      priorTokens,
      totalTokens: inputTokens + priorTokens,
    };
  });
  const totalTokens = perPanel.reduce((acc, p) => acc + p.totalTokens, 0);
  const warnThreshold = opts.warnThreshold ?? resolveCostWarnThreshold();
  return {
    totalTokens,
    perPanel,
    warnThreshold,
    exceedsWarnThreshold: totalTokens > warnThreshold,
  };
}
