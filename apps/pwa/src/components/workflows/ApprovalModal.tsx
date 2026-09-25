// Archon-port follow-up §5.1 PWA modal (2026-05-08).
//
// When the active run has a pending approval (server registered the
// deferred Promise via registerApproval(runId, message)), this
// modal pops over the workflows panel with the message body, an
// optional response textarea, and Approve / Reject buttons.
//
// Wired in WorkflowsPanel: it polls usePendingApprovals() every 1s
// and renders the modal when an entry exists for the active runId.
// Submitting Approve calls POST /v1/workflows/runs/<id>/approve;
// Reject calls /reject. Both unblock the executor.

'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import { useApproveRun, useRejectRun } from '@/nexus/hooks/use-workflows';

export interface ApprovalModalProps {
  runId: string;
  message: string;
  /** Closes the modal without submitting. The deferred Promise stays
   *  pending, so the executor is still parked — the user can come
   *  back later. */
  onDismiss: () => void;
  /** Fired after a successful approve / reject so the parent can
   *  invalidate caches or reset its UI. */
  onResolved?: (decision: 'approved' | 'rejected') => void;
}

export function ApprovalModal({ runId, message, onDismiss, onResolved }: ApprovalModalProps) {
  const [response, setResponse] = useState('');
  const approve = useApproveRun();
  const reject = useRejectRun();
  const busy = approve.isPending || reject.isPending;

  // ESC closes the modal (no submit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onDismiss]);

  const handleApprove = async (): Promise<void> => {
    try {
      await approve.mutateAsync({ runId, response: response.trim() ? response : undefined });
      onResolved?.('approved');
    } catch {
      // mutation surfaces error inline via approve.error
    }
  };

  const handleReject = async (): Promise<void> => {
    try {
      await reject.mutateAsync({ runId, reason: response.trim() ? response : undefined });
      onResolved?.('rejected');
    } catch {
      // mutation surfaces error inline via reject.error
    }
  };

  return (
    // Surface-unification §D2 (2026-05-11) — floating inline approval.
    // Mobile / iPad portrait: bottom sheet (slide up from bottom, full
    // width). Desktop: centered card. Both layouts share the same backdrop
    // dim + same dialog ARIA so screen readers see no difference.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-lg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="approval-modal-title"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <AlertCircle className="h-4 w-4 text-warning" />
            Approval needed
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            aria-label="Close approval modal"
            className="rounded-md p-1 text-text-tertiary hover:bg-surface-elevated disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </header>

        <div className="space-y-2 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
            run · <span className="font-mono">{runId.slice(0, 28)}</span>
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-snug">{message}</p>

          <label className="block pt-2 text-[10px] uppercase tracking-wide text-text-tertiary">
            Response (optional · captured into <code className="font-mono">$node.output</code> when capture_response: true)
          </label>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="LGTM / type a reason for rejection / leave empty for bare approval"
            rows={3}
            disabled={busy}
            className="w-full resize-none rounded-md border border-border bg-surface-elevated px-2 py-1.5 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
          />

          {(approve.error || reject.error) && (
            <p className="text-[11px] text-error">
              {(approve.error ?? reject.error) instanceof Error
                ? (approve.error ?? reject.error)!.message
                : 'request failed'}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={handleReject}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-error/40 px-3 py-1.5 text-[11px] text-error hover:bg-error/10 disabled:opacity-50"
          >
            {reject.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertCircle className="h-3 w-3" />}
            Reject
          </button>
          <button
            type="button"
            onClick={handleApprove}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            {approve.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Approve
          </button>
        </footer>
      </div>
    </div>
  );
}
