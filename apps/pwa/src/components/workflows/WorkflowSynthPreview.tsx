// Surface-unification ROADMAP §C2 (2026-05-11) — synth preview modal.
//
// Renders the R3 synth response so the user can Apply / Refine / Cancel
// before the YAML lands in the editor. trigger summary chip is the key
// affordance: with cron/webhook/discord/telegram/manual/chat now
// first-class, the LLM's trigger pick is the most consequential choice
// and deserves a visible badge.

'use client';

import { Check, RefreshCw, X, AlertTriangle } from 'lucide-react';
import type { SynthesizeWorkflowResponse } from '@/nexus/client';

interface WorkflowSynthPreviewProps {
  result: SynthesizeWorkflowResponse;
  /** Called when the user clicks Apply — caller pipes the YAML into
   *  the editor (typically: parent of WorkflowNLPrompt sets draftYaml). */
  onApply: (yaml: string, workflowName?: string) => void;
  /** Called when the user clicks Refine — modal closes; caller keeps
   *  the NL prompt open so the user can add a follow-up sentence. */
  onRefine: () => void;
  /** Called when the user clicks Cancel or the backdrop. */
  onCancel: () => void;
}

export function WorkflowSynthPreview({ result, onApply, onRefine, onCancel }: WorkflowSynthPreviewProps) {
  const yaml = result.yaml ?? '';
  const apply = (): void => {
    if (yaml) onApply(yaml, result.workflowName);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col gap-3 rounded-lg border border-border bg-surface-elevated p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
              Synth preview
            </span>
            {result.workflowName && (
              <span className="font-mono text-sm font-medium text-text-primary">
                {result.workflowName}
              </span>
            )}
            {result.repaired && (
              <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                self-repaired
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-text-tertiary hover:bg-surface hover:text-text-primary"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {result.triggerSummary && (
          <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
            <span className="font-medium">Trigger: </span>
            {result.triggerSummary}
          </div>
        )}

        {!result.ok && result.error && (
          <div className="flex items-start gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{result.error}</span>
          </div>
        )}

        <div className="flex-1 overflow-auto rounded-md border border-border bg-surface">
          <pre className="m-0 whitespace-pre p-3 font-mono text-[11px] leading-relaxed text-text-primary">
            {yaml || '(no yaml — synth failed)'}
          </pre>
        </div>

        <footer className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-tertiary">
            Apply writes the YAML into the editor draft. Save (panel footer) commits to disk.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefine}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              <RefreshCw className="h-3 w-3" />
              Refine
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-3 py-1 text-[11px] text-text-secondary hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!result.ok || !yaml}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              Apply
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
