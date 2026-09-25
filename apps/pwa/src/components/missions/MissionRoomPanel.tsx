'use client';

// W9c Z13-b · Mission Deliberation Room panel.
//
// Renders the 3-persona deliberation room over the Z2 substrate
// (daemon: `src/task-orchestrator/mission-showroom.ts` ·
//          `src/nexus/api/mission-showroom.ts`).
// Surfaces: spawn / re-open · ask a new question · view persona
// opinions per decision · apply a decision (chosen option) · archive.
//
// The component owns no business logic — every action is an API call
// via `MissionRoomApiClient`. Errors surface as inline banners.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  MissionRoomApiClient,
  MissionRoomDecisionWire,
  MissionRoomStateWire,
} from '@/lib/mission-room-api';
import { MissionRoomApiError } from '@/lib/mission-room-api';

export interface MissionRoomPanelProps {
  missionId: string;
  /** Optional mission title for the header. */
  missionTitle?: string;
  api: MissionRoomApiClient;
  /** Callback when archive succeeds — surface layer can close the panel. */
  onArchived?: () => void;
}

interface PanelState {
  loading: boolean;
  error: string | null;
  state: MissionRoomStateWire | null;
}

export function MissionRoomPanel(props: MissionRoomPanelProps): ReactElement {
  const [panel, setPanel] = useState<PanelState>({ loading: true, error: null, state: null });
  const [question, setQuestion] = useState('');
  const [missionContext, setMissionContext] = useState('');
  const [deliberating, setDeliberating] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const refresh = useCallback(async () => {
    setPanel((p) => ({ ...p, loading: true, error: null }));
    try {
      const { state } = await props.api.spawn(props.missionId);
      if (!mountedRef.current) return;
      setPanel({ loading: false, error: null, state });
    } catch (err) {
      if (!mountedRef.current) return;
      setPanel({ loading: false, error: formatError(err), state: null });
    }
  }, [props.api, props.missionId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDeliberate = useCallback(async () => {
    if (!question.trim() || deliberating) return;
    setDeliberating(true);
    try {
      const decision = await props.api.deliberate(
        props.missionId,
        question.trim(),
        missionContext.trim() || undefined,
      );
      if (!mountedRef.current) return;
      setPanel((p) => p.state
        ? { ...p, state: { ...p.state, decisions: [...p.state.decisions, decision] } }
        : p);
      setQuestion('');
    } catch (err) {
      if (!mountedRef.current) return;
      setPanel((p) => ({ ...p, error: formatError(err) }));
    } finally {
      if (mountedRef.current) setDeliberating(false);
    }
  }, [props.api, props.missionId, question, missionContext, deliberating]);

  const handleDecide = useCallback(async (chosen: string) => {
    if (!chosen.trim() || deciding) return;
    setDeciding(chosen);
    try {
      const decision = await props.api.decide(props.missionId, chosen);
      if (!mountedRef.current) return;
      setPanel((p) => {
        if (!p.state) return p;
        const decisions = p.state.decisions.slice();
        const idx = decisions.findIndex((d) => d.ts === decision.ts);
        if (idx >= 0) decisions[idx] = decision;
        return { ...p, state: { ...p.state, decisions } };
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setPanel((p) => ({ ...p, error: formatError(err) }));
    } finally {
      if (mountedRef.current) setDeciding(null);
    }
  }, [props.api, props.missionId, deciding]);

  const handleArchive = useCallback(async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      const state = await props.api.archive(props.missionId);
      if (!mountedRef.current) return;
      setPanel((p) => ({ ...p, state }));
      props.onArchived?.();
    } catch (err) {
      if (!mountedRef.current) return;
      setPanel((p) => ({ ...p, error: formatError(err) }));
    } finally {
      if (mountedRef.current) setArchiving(false);
    }
  }, [props.api, props.missionId, archiving, props.onArchived]);

  const archived = panel.state?.status === 'archived';

  const sortedDecisions = useMemo(() => {
    if (!panel.state) return [];
    return [...panel.state.decisions].sort((a, b) => b.ts - a.ts);
  }, [panel.state]);

  if (panel.loading && !panel.state) {
    return <div className="p-4 text-sm opacity-70">Loading mission room…</div>;
  }

  return (
    <section className="mission-room-panel flex flex-col gap-4 p-4" data-mission-id={props.missionId}>
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {props.missionTitle ? `${props.missionTitle} · deliberation` : 'Mission Deliberation Room'}
          </h2>
          {panel.state && (
            <p className="text-xs opacity-70">
              tag: <code>{panel.state.missionTag}</code> · status:{' '}
              <span className={archived ? 'text-amber-600' : 'text-emerald-600'}>{panel.state.status}</span>
              {' · '}decisions: {panel.state.decisions.length}
            </p>
          )}
        </div>
        {!archived && panel.state && (
          <button
            type="button"
            className="text-xs underline opacity-70 hover:opacity-100"
            disabled={archiving}
            onClick={() => void handleArchive()}
          >
            {archiving ? 'archiving…' : 'archive room'}
          </button>
        )}
      </header>

      {panel.error && (
        <div role="alert" className="rounded border border-rose-400/50 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {panel.error}
        </div>
      )}

      {!archived && (
        <form
          className="flex flex-col gap-2 rounded border border-zinc-200 p-3"
          onSubmit={(e) => { e.preventDefault(); void handleDeliberate(); }}
        >
          <label className="text-xs uppercase tracking-wide opacity-70">
            New deliberation
          </label>
          <textarea
            className="min-h-[80px] w-full rounded border border-zinc-300 bg-white p-2 text-sm"
            placeholder="Describe the branch you're stuck on…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={deliberating}
          />
          <textarea
            className="min-h-[40px] w-full rounded border border-zinc-200 bg-zinc-50 p-2 text-xs"
            placeholder="Optional mission context (task list digest, etc.)"
            value={missionContext}
            onChange={(e) => setMissionContext(e.target.value)}
            disabled={deliberating}
          />
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={!question.trim() || deliberating}
            >
              {deliberating ? 'asking lanes…' : 'ask the lanes'}
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col gap-3">
        {sortedDecisions.length === 0 && (
          <p className="text-sm opacity-70">No deliberations yet.</p>
        )}
        {sortedDecisions.map((decision) => (
          <DecisionCard
            key={decision.ts}
            decision={decision}
            onDecide={archived ? undefined : handleDecide}
            decidingChoice={deciding}
          />
        ))}
      </div>
    </section>
  );
}

interface DecisionCardProps {
  decision: MissionRoomDecisionWire;
  onDecide?: (chosen: string) => void;
  decidingChoice: string | null;
}

function DecisionCard({ decision, onDecide, decidingChoice }: DecisionCardProps): ReactElement {
  const [draft, setDraft] = useState('');
  const status = decision.resolution.status;
  const chosen = decision.resolution.status === 'decided' ? decision.resolution.chosen : null;
  return (
    <article className="rounded border border-zinc-200 bg-white p-3">
      <header className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{decision.question}</p>
        <time className="shrink-0 text-xs opacity-60" dateTime={new Date(decision.ts).toISOString()}>
          {new Date(decision.ts).toLocaleString()}
        </time>
      </header>
      <ul className="mt-2 flex flex-col gap-2">
        {decision.opinions.map((op, i) => (
          <li key={`${op.role}-${i}`} className="rounded bg-zinc-50 p-2 text-xs">
            <div className="font-medium">
              {op.role}{op.modelId ? <span className="opacity-60"> · {op.modelId}</span> : null}
            </div>
            <pre className="mt-1 whitespace-pre-wrap text-xs leading-snug">{op.text}</pre>
          </li>
        ))}
      </ul>
      <footer className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs opacity-70">
          resolution:{' '}
          {status === 'decided'
            ? <span className="font-medium text-emerald-700">decided → {chosen}</span>
            : <span className="text-amber-700">open</span>}
        </span>
        {onDecide && status === 'open' && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => { e.preventDefault(); if (draft.trim()) onDecide(draft.trim()); }}
          >
            <input
              className="w-32 rounded border border-zinc-300 px-2 py-0.5 text-xs"
              placeholder="chosen…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={decidingChoice !== null}
            />
            <button
              type="submit"
              className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white disabled:opacity-50"
              disabled={!draft.trim() || decidingChoice !== null}
            >
              {decidingChoice === draft ? '…' : 'apply'}
            </button>
          </form>
        )}
      </footer>
    </article>
  );
}

function formatError(err: unknown): string {
  if (err instanceof MissionRoomApiError) {
    const detail = typeof err.body === 'object' && err.body && 'detail' in err.body
      ? (err.body as { detail: string }).detail
      : null;
    if (err.status === 404) return 'Mission room not found.';
    if (err.status === 409) return detail ? `Conflict: ${detail}` : 'Conflict — room may be archived or no open decision.';
    if (err.status === 401) return 'Authentication required.';
    return `Mission room error (${err.status}).`;
  }
  return err instanceof Error ? err.message : String(err);
}
