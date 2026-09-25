'use client';

import { useEffect, useState } from 'react';
import { SubjectList } from '@/components/observatory/SubjectList';
import { openObservatoryTerminal, subjectProgressBySubject, terminalsQueryUrl, type ObservatoryScope, type ObservatorySubject, type RunningRunsSummary } from '@/components/observatory/subject-list';
import { ptyProgressByTerminal } from '@/components/terminal/pty-terminal-list';
import { DaemonClient } from '@/lib/daemon-client';

type TerminalsResponse = { subjects?: ObservatorySubject[]; runningRuns?: RunningRunsSummary; scope?: ObservatoryScope };

const observatoryClient = new DaemonClient({ baseUrl: '', token: '', provider: '' });

export default function ObservatoryPage(): React.ReactNode {
  const [subjects, setSubjects] = useState<ObservatorySubject[] | null>(null);
  const [runningRuns, setRunningRuns] = useState<RunningRunsSummary | undefined>();
  const [scope, setScope] = useState<ObservatoryScope | undefined>();
  const [includeIsolatedInstances, setIncludeIsolatedInstances] = useState(false);
  const [progressBySubject, setProgressBySubject] = useState<ReturnType<typeof subjectProgressBySubject>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const handleOpenTerminal = () => {
    openObservatoryTerminal();
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [response, progressResponse] = await Promise.all([
          fetch(terminalsQueryUrl(includeIsolatedInstances)).then(async (terminalResponse) => {
            if (!terminalResponse.ok) throw new Error(`GET ${terminalsQueryUrl(includeIsolatedInstances)} failed (${terminalResponse.status})`);
            return terminalResponse.json() as Promise<TerminalsResponse>;
          }),
          observatoryClient.listProgressFrames().catch(() => null),
        ]);
        if (cancelled) return;
        const nextSubjects = response.subjects ?? [];
        setError(null);
        setSubjects(nextSubjects);
        setRunningRuns(response.runningRuns);
        setScope(response.scope);
        setProgressBySubject(subjectProgressBySubject(
          nextSubjects,
          progressResponse ? ptyProgressByTerminal(progressResponse.logs ?? []) : new Map(),
        ));
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load observation subjects');
      }
    })();
    return () => { cancelled = true; };
  }, [includeIsolatedInstances, refreshToken]);

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Observatory</h1>
        <p className="text-sm text-muted-foreground">Subject-level view of talk, screen, and agent observation surfaces.</p>
        <button type="button" className="text-sm underline" onClick={handleOpenTerminal}>
          Open new terminal
        </button>
      </header>
      {error ? (
        <div className="space-y-1">
          <p role="alert" className="rounded-md border border-error/40 bg-error/5 p-3 text-sm text-error">{error}</p>
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeIsolatedInstances}
              onChange={(event) => setIncludeIsolatedInstances(event.target.checked)}
              aria-label="Include isolated instances"
            />
            Include isolated instances: {includeIsolatedInstances ? 'included' : 'local only'}
          </label>
        </div>
      ) : subjects === null ? (
        <p className="text-sm text-muted-foreground">Loading observation subjects…</p>
      ) : (
        <SubjectList
          subjects={subjects}
          runningRuns={runningRuns}
          scope={scope}
          includeIsolatedInstances={includeIsolatedInstances}
          onIncludeIsolatedInstancesChange={setIncludeIsolatedInstances}
          progressBySubject={progressBySubject}
          onRefresh={() => setRefreshToken((current: number) => current + 1)}
        />
      )}
    </main>
  );
}
