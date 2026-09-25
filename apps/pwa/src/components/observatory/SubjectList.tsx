'use client';

import { useEffect, useRef, useState } from 'react';
import {
  classifySubject,
  requestTerminalTakeover,
  subjectSurfaces,
  terminalFrameUrl,
  terminalsViewUrl,
  type TerminalTakeoverResult,
  visibleSubjects,
  type ObservatoryScope,
  type ObservatorySubject,
  type RunningRunsSummary,
  type SubjectProgress,
  type SubjectRunStatus,
  type SubjectStatus,
} from './subject-list';

const STATUS_LABEL: Record<SubjectStatus, string> = {
  live: 'live',
  unknown: 'unknown',
  inactive: 'inactive',
};

const RUN_STATUS_LABEL: Record<SubjectRunStatus, string> = {
  running: 'running',
  'probable-running': 'probably running',
  'ended-unclosed': 'ended, not closed',
  unknown: 'run state unknown',
};

type FrameState =
  | { kind: 'loading'; ptyId: string }
  | { kind: 'success'; ptyId: string; frame: string }
  | { kind: 'error'; ptyId: string; message: string };

type TakeoverState =
  | { kind: 'idle' }
  | { kind: 'pending'; ptyId: string }
  | { kind: 'success'; ptyId: string }
  | { kind: 'error'; ptyId: string; failureKind: Exclude<TerminalTakeoverResult, { ok: true }>['kind']; message: string };

export function SurfaceBadge({ label, present }: { label: string; present: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] ${present ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
      {label}: {present ? 'present' : 'absent'}
    </span>
  );
}

function TerminalFramePanel({ ptyIds, onRefresh }: { ptyIds: readonly string[]; onRefresh?: () => void }) {
  const [selectedPtyId, setSelectedPtyId] = useState(ptyIds[0] ?? '');
  const [frameState, setFrameState] = useState<FrameState>({ kind: 'loading', ptyId: ptyIds[0] ?? '' });
  const [frameRefresh, setFrameRefresh] = useState(0);
  const [takeoverState, setTakeoverState] = useState<TakeoverState>({ kind: 'idle' });
  const takeoverAbortRef = useRef<AbortController | null>(null);
  const visiblePtyId = ptyIds.includes(selectedPtyId) ? selectedPtyId : (ptyIds[0] ?? '');
  const visibleFrameState = frameState.ptyId === visiblePtyId ? frameState : { kind: 'loading', ptyId: visiblePtyId } as const;
  const takeoverPending = takeoverState.kind === 'pending';
  const visibleTakeoverState = takeoverState.kind === 'idle' || takeoverState.ptyId === visiblePtyId
    ? takeoverState
    : { kind: 'idle' } as const;
  const visibleTakeoverPending = visibleTakeoverState.kind === 'pending';

  useEffect(() => {
    setSelectedPtyId((current: string) => ptyIds.includes(current) ? current : (ptyIds[0] ?? ''));
  }, [ptyIds]);

  useEffect(() => {
    if (!visiblePtyId) return;
    const controller = new AbortController();
    setFrameState({ kind: 'loading', ptyId: visiblePtyId });
    void fetch(terminalFrameUrl(visiblePtyId), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`GET ${terminalFrameUrl(visiblePtyId)} failed (${response.status})`);
        const body = await response.json() as { frame?: unknown };
        if (typeof body.frame !== 'string') throw new Error('Terminal frame response did not contain text.');
        if (controller.signal.aborted) return;
        setFrameState({ kind: 'success', ptyId: visiblePtyId, frame: body.frame });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFrameState({ kind: 'error', ptyId: visiblePtyId, message: error instanceof Error ? error.message : 'Terminal frame request failed.' });
      });
    return () => controller.abort();
  }, [visiblePtyId, frameRefresh]);

  useEffect(() => {
    setTakeoverState((current: TakeoverState) =>
      current.kind === 'pending' && current.ptyId !== visiblePtyId ? { kind: 'idle' } : current,
    );
    return () => {
      takeoverAbortRef.current?.abort();
      takeoverAbortRef.current = null;
    };
  }, [visiblePtyId]);

  const takeOverSelectedPty = () => {
    if (!visiblePtyId || takeoverPending) return;
    takeoverAbortRef.current?.abort();
    const controller = new AbortController();
    takeoverAbortRef.current = controller;
    setTakeoverState({ kind: 'pending', ptyId: visiblePtyId });
    void requestTerminalTakeover(visiblePtyId, globalThis.fetch, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setTakeoverState({ kind: 'success', ptyId: result.ptyId });
        setFrameRefresh((current: number) => current + 1);
        onRefresh?.();
        return;
      }
      setTakeoverState({
        kind: 'error',
        ptyId: result.ptyId,
        failureKind: result.kind,
        message: result.message,
      });
    });
  };

  return (
    <div className="space-y-2 rounded-md bg-surface-elevated p-3" data-testid="terminal-frame-panel">
      {ptyIds.length > 1 && (
        <label className="flex w-fit items-center gap-2 text-xs">
          PTY
          <select
            value={visiblePtyId}
            onChange={(event) => setSelectedPtyId(event.target.value)}
            aria-label="Select terminal PTY"
            disabled={takeoverPending}
          >
            {ptyIds.map((ptyId) => <option key={ptyId} value={ptyId}>{ptyId}</option>)}
          </select>
        </label>
      )}
      {visiblePtyId && (
        <div className="space-y-1" data-testid="terminal-takeover">
          <button
            type="button"
            className="text-xs underline"
            aria-label="Take over PTY ownership"
            data-testid="terminal-takeover-button"
            disabled={visibleTakeoverPending}
            onClick={takeOverSelectedPty}
          >
            {visibleTakeoverPending ? 'Taking over ownership…' : 'Take over ownership'}
          </button>
          {visibleTakeoverState.kind === 'pending' && (
            <p className="text-xs text-muted-foreground" role="status" data-testid="terminal-takeover-pending">
              Taking over ownership…
            </p>
          )}
          {visibleTakeoverState.kind === 'success' && (
            <p className="text-xs text-muted-foreground" role="status" data-testid="terminal-takeover-success">
              Ownership transferred. Observation refreshed.
            </p>
          )}
          {visibleTakeoverState.kind === 'error' && (
            <p
              className="text-xs text-destructive"
              role="alert"
              data-testid="terminal-takeover-error"
              data-takeover-kind={visibleTakeoverState.failureKind}
            >
              {visibleTakeoverState.message}
            </p>
          )}
        </div>
      )}
      {visibleFrameState.kind === 'loading' && <p className="text-xs text-muted-foreground" role="status">Loading terminal frame…</p>}
      {visibleFrameState.kind === 'error' && <p className="text-xs text-destructive" role="alert">Unable to load terminal frame: {visibleFrameState.message}</p>}
      {visibleFrameState.kind === 'success' && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 font-mono text-xs" data-testid="terminal-frame">
          {visibleFrameState.frame || '(Terminal frame is empty.)'}
        </pre>
      )}
    </div>
  );
}

function SubjectScreen({ subject, onRefresh }: { subject: ObservatorySubject; onRefresh?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = `terminal-frame-${encodeURIComponent(subject.id)}`;
  const ptyIds = subject.screen.ptyIds;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">screen: {ptyIds.length} PTY · {subject.screen.liveCount} live</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="text-xs underline" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Hide terminal frame' : 'Show terminal frame'}
        </button>
        <a className="text-xs underline" href={terminalsViewUrl()}>Open terminal inspector</a>
      </div>
      {expanded && <div id={panelId}><TerminalFramePanel ptyIds={ptyIds} onRefresh={onRefresh} /></div>}
    </div>
  );
}

export function SubjectList({
  subjects,
  runningRuns,
  scope,
  includeIsolatedInstances = false,
  onIncludeIsolatedInstancesChange,
  progressBySubject = new Map(),
  onRefresh,
}: {
  subjects: readonly ObservatorySubject[];
  runningRuns?: RunningRunsSummary;
  scope?: ObservatoryScope;
  includeIsolatedInstances?: boolean;
  onIncludeIsolatedInstancesChange?: (include: boolean) => void;
  progressBySubject?: ReadonlyMap<string, SubjectProgress>;
  onRefresh?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = visibleSubjects(subjects, showAll);

  return (
    <section className="space-y-3" aria-label="Observatory subjects">
      {runningRuns && (
        <p className="text-sm text-muted-foreground" data-testid="running-runs-summary">
          Server run count: {runningRuns.running} running, {runningRuns['probable-running']} probable-running
          {' '}(counted statuses: {runningRuns.countedStatuses.join(', ')})
        </p>
      )}
      <div className="space-y-1">
        <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeIsolatedInstances}
            onChange={(event) => onIncludeIsolatedInstancesChange?.(event.target.checked)}
            aria-label="Include isolated instances"
          />
          Include isolated instances: {includeIsolatedInstances ? 'included' : 'local only'}
        </label>
        {scope && (
          <p className="text-xs text-muted-foreground" data-testid="observatory-scope">
            Observation scope: {scope.domain}; {scope.roots} root{scope.roots === 1 ? '' : 's'}; {scope.federated ? 'federated' : 'local only'}; {scope.hiddenDead} dead hidden
            {scope.hiddenSubAgentRuns === undefined ? '' : `; ${scope.hiddenSubAgentRuns} sub-agent runs hidden`}
          </p>
        )}
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
        Show all subjects
      </label>
      {visible.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground" data-testid="subject-list-empty">
          {subjects.length === 0 ? 'No observation subjects reported.' : 'No live or unknown subjects. Turn on Show all subjects to include inactive subjects.'}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="subject-list">
          {visible.map((subject) => {
            const surfaces = subjectSurfaces(subject);
            const status = classifySubject(subject);
            const progress = progressBySubject.get(subject.id);
            return (
              <li key={subject.id} className="space-y-2 rounded-md border border-border p-3" data-status={status}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm">{subject.runId || subject.id}</p>
                    <p className="text-xs text-muted-foreground">origin: {subject.origin}</p>
                  </div>
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-medium uppercase">{STATUS_LABEL[status]}</span>
                </div>
                <div className="flex flex-wrap gap-1" aria-label="Subject surfaces">
                  <SurfaceBadge label="🗣️ talk" present={surfaces.talk} />
                  <SurfaceBadge label="🖥️ screen" present={surfaces.screen} />
                  <SurfaceBadge label="🤖 agent" present={surfaces.agent} />
                </div>
                {subject.run && (
                  <p className="text-xs text-muted-foreground" data-testid="subject-run-assessment" data-run-status={subject.run.status}>
                    run: {RUN_STATUS_LABEL[subject.run.status]} — reason: {subject.run.reason} (presence: {subject.run.presence})
                  </p>
                )}
                {progress?.kind === 'no-screen' && <p className="text-xs text-muted-foreground">progress: no screen</p>}
                {progress?.kind === 'no-progress' && <p className="text-xs text-muted-foreground">progress: no progress reported</p>}
                {progress?.kind === 'progress' && (
                  <p className="text-xs text-muted-foreground">
                    progress ({progress.ptyId}): {progress.status} — {progress.line}
                    {progress.hasMissingFrames ? ' (missing frames)' : ''}
                  </p>
                )}
                {surfaces.screen && <SubjectScreen subject={subject} onRefresh={onRefresh} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
