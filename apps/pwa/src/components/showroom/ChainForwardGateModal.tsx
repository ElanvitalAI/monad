// D3 (BACKLOG · 2026-05-11) — HITL gate for §6.7 chain forward.
//
// When a ChainEdge has `hitl: true` set, the ShowroomLayout finalize
// watcher pushes a `PendingChainForward` onto a queue instead of
// firing autoForwardToPanel immediately. This modal renders one queue
// head at a time: from/to panel labels + forward-text preview + two
// buttons (Forward · Cancel).
//
// Pattern lifted from CostGateModal (PR #2192) — closure-resume keeps
// the modal stateless (parent owns the queue); cancel is harmless
// (ephemeral context survives).
//
// Cross-ref:
//   apps/pwa/src/components/showroom/ShowroomLayout.tsx (finalize
//     watcher 가 enqueue · handleChainForwardConfirm/Cancel)
//   apps/pwa/src/lib/showroom/types.ts (ChainEdge.hitl 필드)

import { Fragment } from 'react';
import { ArrowRight, Send, X } from 'lucide-react';

export interface PendingChainForwardSummary {
  from: { id: string; label: string };
  to: { id: string; label: string };
  forwardText: string;
}

interface ChainForwardGateModalProps {
  /** Queue head — null/undefined means no modal renders. */
  pending: PendingChainForwardSummary | undefined;
  /** Total queue length (head + tail) for the "N more queued" hint
   *  shown next to the buttons. */
  queueLength: number;
  /** Fire the queued forward + pop the head. */
  onConfirm: () => void;
  /** Skip the queued forward + pop the head. */
  onCancel: () => void;
}

const PREVIEW_MAX_CHARS = 600;

/** Build a single-line summary suitable for screen-reader announce. */
function announceSummary(pending: PendingChainForwardSummary): string {
  const bytes = pending.forwardText.length;
  return `Chain forward gate: ${pending.from.label} to ${pending.to.label}, ${bytes} characters pending confirm`;
}

export function ChainForwardGateModal({
  pending,
  queueLength,
  onConfirm,
  onCancel,
}: ChainForwardGateModalProps) {
  if (!pending) return null;

  const truncated = pending.forwardText.length > PREVIEW_MAX_CHARS;
  const preview = truncated
    ? `${pending.forwardText.slice(0, PREVIEW_MAX_CHARS)}…`
    : pending.forwardText;
  const morePending = Math.max(0, queueLength - 1);

  return (
    <Fragment>
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chain forward confirmation"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-lg rounded-lg border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          {/* aria-live announcer — separate node so screen readers
              announce on mount (modal heading lacks live semantics). */}
          <p className="sr-only" aria-live="polite">
            {announceSummary(pending)}
          </p>

          <header className="mb-3 flex items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Confirm chain forward
            </h2>
            <span className="ml-auto text-[10px] text-zinc-500">
              §6.7 HITL gate
            </span>
          </header>

          <div className="mb-3 flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <span
              className="truncate font-medium text-zinc-900 dark:text-zinc-100"
              data-testid="chain-forward-gate-from"
            >
              {pending.from.label}
            </span>
            <ArrowRight
              className="size-3.5 shrink-0 text-zinc-500"
              aria-hidden
            />
            <span
              className="truncate font-medium text-zinc-900 dark:text-zinc-100"
              data-testid="chain-forward-gate-to"
            >
              {pending.to.label}
            </span>
            <span className="ml-auto text-[10px] text-zinc-500">
              {pending.forwardText.length} chars
            </span>
          </div>

          <div className="mb-4">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
              Forward text
            </p>
            <pre
              className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              data-testid="chain-forward-gate-preview"
            >
              {preview}
            </pre>
            {truncated && (
              <p className="mt-1 text-[10px] text-zinc-500">
                Truncated for preview · the full text will be forwarded.
              </p>
            )}
          </div>

          <footer className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              data-testid="chain-forward-gate-cancel"
              className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              <X className="size-3.5" aria-hidden />
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              data-testid="chain-forward-gate-confirm"
              className="ml-auto inline-flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              autoFocus
            >
              <Send className="size-3.5" aria-hidden />
              Forward
            </button>
            {morePending > 0 && (
              <span
                className="text-[10px] text-zinc-500"
                data-testid="chain-forward-gate-queue-hint"
              >
                +{morePending} queued
              </span>
            )}
          </footer>
        </div>
      </div>
    </Fragment>
  );
}
