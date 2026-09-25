// Surface-unification v2.2 V2.2-5 (2026-05-11) — `listSchedulerJobs` /
// `mapSchedulerJob` deps removed together with the `context.jobs.list`
// LLM tool retirement. The legacy `getScheduledJobs` shape is no longer
// surfaced to context-runtime callers; LLMs read scheduled work from
// the workflows surface (`scheduleTrigger` nodes · `~/.monad/workflows-runs/`).

export interface DashboardContextRuntimeBootDeps<Session> {
  setContextRuntimeDeps: (deps: {
    cwd: string;
    getTerminalSessions: () => Array<{ id: string; title: string; state: string }>;
  }) => void;
  cwd: string;
  listTerminalSessions: () => Session[];
  mapTerminalSession: (session: Session) => { id: string; title: string; state: string };
}

export function bootDashboardContextRuntime<Session>(
  deps: DashboardContextRuntimeBootDeps<Session>,
): void {
  deps.setContextRuntimeDeps({
    cwd: deps.cwd,
    getTerminalSessions: () => {
      try { return deps.listTerminalSessions().map((session) => deps.mapTerminalSession(session)); }
      catch { return []; }
    },
  });
}
