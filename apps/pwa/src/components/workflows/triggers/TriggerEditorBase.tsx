// Surface-unification ROADMAP §B0 (2026-05-11) — Common base for the
// trigger node variant editors (B1-B7). Pulls the shared header chrome
// + Field grid layout out of WorkflowNodeEditor so each variant form
// only authors its variant-specific inputs.
//
// The base intentionally does NOT own auto-save debounce / draft state
// — that belongs to each variant form (they shape their own patch type).
// What lives here is purely the visual frame: variant label badge,
// validation status pill, dense grid for inputs.

'use client';

import type { ReactNode } from 'react';

export type TriggerValidationStatus = 'valid' | 'warning' | 'error' | null;

interface TriggerEditorBaseProps {
  /** Short variant label rendered as a chip (e.g. "Schedule", "Webhook"). */
  variantLabel: string;
  /** Validation state of the current form — drives the right-side pill.
   *  `null` hides the pill (initial / not-yet-validated state). */
  validationStatus?: TriggerValidationStatus;
  /** Short human-readable message paired with the validation pill. */
  validationMessage?: string;
  /** The variant-specific input grid (use `TriggerField` for rows). */
  children: ReactNode;
}

const STATUS_CLASSES: Record<Exclude<TriggerValidationStatus, null>, string> = {
  valid: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  error: 'bg-error/10 text-error border-error/30',
};

export function TriggerEditorBase({
  variantLabel,
  validationStatus = null,
  validationMessage,
  children,
}: TriggerEditorBaseProps) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-tertiary">
          {variantLabel}
        </span>
        {validationStatus && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${STATUS_CLASSES[validationStatus]}`}
            role="status"
          >
            {validationMessage ?? validationStatus}
          </span>
        )}
      </header>
      <div className="grid grid-cols-1 gap-2 px-3 py-3 md:grid-cols-2">{children}</div>
    </div>
  );
}

interface TriggerFieldProps {
  label: string;
  /** Span the full grid width (use for textareas, long inputs). */
  full?: boolean;
  /** Optional inline hint rendered under the label. */
  hint?: string;
  children: ReactNode;
}

export function TriggerField({ label, full, hint, children }: TriggerFieldProps) {
  return (
    <label className={`flex flex-col gap-1 ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-text-tertiary">{hint}</span>}
    </label>
  );
}
