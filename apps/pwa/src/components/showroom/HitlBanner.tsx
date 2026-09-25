// CV-3 β-1a · in-app HITL banner UI.
//
// Two layers:
//   - <HitlBannerView /> — pure presenter (props in, JSX out). Unit-
//     testable via renderToStaticMarkup, mirroring the ShowroomInput
//     test pattern.
//   - <HitlBanner />     — container that wires NexusClient + daemon
//     baseUrl into useHitlBanner, then forwards the resulting state
//     into the view.
//
// Mounted at the layout level (ShowroomLayout) so every Showroom
// session shares one banner; the server-side requestId race ensures
// only one prompt is active at a time.

'use client';

import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import { useHitlBanner, type PendingHitlBanner } from './use-hitl-banner';

export interface HitlBannerViewProps {
  pending: PendingHitlBanner | null;
  submitting: boolean;
  error: string | null;
  /** Caller hands a callback that resolves the active banner. The
   *  view passes `true`/`false` based on which button the user
   *  clicked. */
  onAnswer: (answer: boolean) => void;
}

export function HitlBannerView({
  pending,
  submitting,
  error,
  onAnswer,
}: HitlBannerViewProps) {
  if (!pending) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Approval request"
      data-testid="hitl-banner"
      data-request-id={pending.requestId}
      className="fixed left-1/2 top-4 z-50 flex w-[min(calc(100vw-2rem),36rem)] -translate-x-1/2 flex-col gap-3 rounded-2xl border border-amber-300/70 bg-amber-50/95 p-4 shadow-2xl ring-1 ring-amber-400/30 backdrop-blur-sm dark:border-amber-700/60 dark:bg-amber-950/90 dark:ring-amber-700/50"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-900 dark:bg-amber-800/80 dark:text-amber-100">
          <span aria-hidden className="text-base">⚠</span>
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {pending.prompt}
          </div>
          {pending.detail && (
            <div className="mt-1 break-words text-xs text-amber-800/80 dark:text-amber-200/80">
              {pending.detail}
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onAnswer(false)}
          disabled={submitting}
          data-testid="hitl-banner-deny"
          className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-800/60"
        >
          {pending.noLabel}
        </button>
        <button
          type="button"
          onClick={() => onAnswer(true)}
          disabled={submitting}
          data-testid="hitl-banner-approve"
          className="flex-1 rounded-lg border border-amber-500 bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending.yesLabel}
        </button>
      </div>
      {error && (
        <div role="alert" data-testid="hitl-banner-error" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}

export function HitlBanner() {
  const client = useOptionalNexusClient();
  const { config } = useDaemon();
  const { pending, submitting, error, submit } = useHitlBanner({
    client,
    baseUrl: config.baseUrl,
    onDebug: (event, payload) => debugLog(event, payload),
  });
  return (
    <HitlBannerView
      pending={pending}
      submitting={submitting}
      error={error}
      onAnswer={(ans) => { void submit(ans); }}
    />
  );
}
