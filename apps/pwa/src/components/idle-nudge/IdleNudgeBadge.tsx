'use client';

// W9c Z13-c · Idle nudge badge — shown on TaskCard when the surface
// suspects the task may be stalling. Cf. Z7 substrate (#2440).

import { useEffect, useState, type ReactElement } from 'react';
import {
  createIdleNudgeApi,
  IdleNudgeApiError,
  type IdleNudgeApiClient,
  type IdleNudgeDecisionWire,
  type IdleNudgeRecordWire,
  type IdleNudgeRequest,
} from '@/lib/idle-nudge-api';

export interface IdleNudgeBadgeProps {
  request: IdleNudgeRequest;
  api?: IdleNudgeApiClient;
  /** Called when the user clicks "view nudge" — the surface jumps to
   *  the spawned showroom session. */
  onOpenShowroom?: (sessionId: string) => void;
}

export function IdleNudgeBadge(props: IdleNudgeBadgeProps): ReactElement | null {
  const [state, setState] = useState<BadgeState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const api = props.api ?? createIdleNudgeApi({ baseUrl: window.location.origin });
    api.preview(props.request)
      .then((result) => {
        if (cancelled) return;
        if (result.decision.kind === 'nudge' && result.record) {
          setState({ kind: 'nudge', decision: result.decision, record: result.record });
        } else if (result.decision.kind === 'defer') {
          setState({ kind: 'defer', nextAt: result.decision.nextEligibleAt });
        } else {
          setState({ kind: 'idle' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof IdleNudgeApiError
          ? `Idle-nudge error (${err.status})`
          : err instanceof Error ? err.message : String(err);
        setState({ kind: 'error', message: msg });
      });
    return () => { cancelled = true; };
  }, [props.api, props.request.taskId, props.request.observedAt, props.request.status, props.request.enteredStatusAt]);

  if (state.kind === 'loading') return null;
  if (state.kind === 'idle') return null;
  if (state.kind === 'defer') {
    return <span className="text-[10px] opacity-60">nudge deferred until {new Date(state.nextAt).toLocaleTimeString()}</span>;
  }
  if (state.kind === 'error') {
    return <span className="text-[10px] text-rose-700">{state.message}</span>;
  }
  const hours = Math.round(state.decision.idleMs / (60 * 60 * 1000));
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900 hover:bg-amber-100"
      onClick={() => props.onOpenShowroom?.(state.record.showroomSessionId)}
      title={`Idle ${hours}h · click to open nudge room`}
      data-task-id={state.record.taskId}
    >
      <span aria-hidden>⏳</span>
      idle {hours}h · {state.record.lanes.length} lanes
    </button>
  );
}

type BadgeState =
  | { kind: 'loading' }
  | { kind: 'idle' }
  | { kind: 'defer'; nextAt: number }
  | { kind: 'nudge'; decision: Extract<IdleNudgeDecisionWire, { kind: 'nudge' }>; record: IdleNudgeRecordWire }
  | { kind: 'error'; message: string };
