'use client';

// C1 (CV-3 BACKLOG §3.3 · 2026-05-11) — broadcast cost warning gate.
//
// Surfaces the per-panel + total token estimate before a multi-LLM
// broadcast crosses the warn threshold (default 50_000 tokens). The
// user can confirm ("Send anyway") or cancel · cancel returns to the
// composer with state intact (the dispatch was paused, not aborted).
//
// Modal pattern follows the existing Save Showroom modal in
// ShowroomLayout.tsx — same z-index / aria-modal / focus-trap shape so
// keyboard + screen-reader behavior matches.

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { BroadcastCostEstimate } from '@/lib/showroom/cost-estimator';

export interface CostGateModalProps {
  estimate: BroadcastCostEstimate;
  onConfirm: () => void;
  onCancel: () => void;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function CostGateModal({ estimate, onConfirm, onCancel }: CostGateModalProps): React.ReactNode {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Auto-focus the confirm button so keyboard users can Enter / Esc
  // their answer without a Tab. Cancel still wins on Esc (handler
  // below + ShowroomLayout 의 outer useFocusTrap pattern 에 맞춤).
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  const totalLabel = fmtTokens(estimate.totalTokens);
  const thresholdLabel = fmtTokens(estimate.warnThreshold);
  const overByPct = Math.round(((estimate.totalTokens - estimate.warnThreshold) / estimate.warnThreshold) * 100);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="showroom-cost-gate-title"
      aria-describedby="showroom-cost-gate-summary"
      data-testid="showroom-cost-gate-modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-amber-300 bg-white p-4 shadow-xl dark:border-amber-700 dark:bg-zinc-900">
        <h2
          id="showroom-cost-gate-title"
          className="mb-2 text-sm font-medium text-amber-700 dark:text-amber-300"
        >
          ⚠️ Broadcast cost warning
        </h2>
        <p
          id="showroom-cost-gate-summary"
          className="mb-3 text-xs text-zinc-700 dark:text-zinc-300"
        >
          예상 token <strong data-testid="showroom-cost-gate-total">{totalLabel}</strong>
          {' · 임계값 '}
          <strong>{thresholdLabel}</strong>
          {' 을 '}
          <strong>{overByPct}%</strong>
          {' 초과합니다. multi-LLM broadcast 는 모든 panel 의 input 을 합산.'}
        </p>

        {/* Per-panel breakdown — input + sibling priors (mixed mode 시).
            screen-reader 친화 sr-only summary 를 모달 진입 시 announce. */}
        <div
          className="mb-3 max-h-56 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
          data-testid="showroom-cost-gate-breakdown"
        >
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 font-medium text-zinc-600 dark:text-zinc-400">
            <span>panel</span>
            <span className="text-right">input</span>
            <span className="text-right">prior</span>
            <span className="text-right">total</span>
          </div>
          {estimate.perPanel.map((p) => (
            <div
              key={p.panelId}
              className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 py-0.5 font-mono text-zinc-700 dark:text-zinc-300"
              data-testid={`showroom-cost-gate-row-${p.panelId}`}
            >
              <span className="truncate">{p.displayName}</span>
              <span className="text-right">{fmtTokens(p.inputTokens)}</span>
              <span className="text-right">{p.priorTokens > 0 ? fmtTokens(p.priorTokens) : '—'}</span>
              <span className="text-right font-semibold">{fmtTokens(p.totalTokens)}</span>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            data-testid="showroom-cost-gate-cancel"
          >
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            size="sm"
            onClick={onConfirm}
            data-testid="showroom-cost-gate-confirm"
            className="bg-amber-600 text-white hover:bg-amber-700"
          >
            Send anyway
          </Button>
        </div>

        {/* aria-live announcer — assistive tech reads the cost on mount. */}
        <span
          className="sr-only"
          aria-live="assertive"
          data-testid="showroom-cost-gate-announcer"
        >
          Broadcast cost {estimate.totalTokens} tokens, confirming
        </span>
      </div>
    </div>
  );
}
