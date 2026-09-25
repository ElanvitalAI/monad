// PWA · Workflow hooks (Archon-port T2A · 2026-05-08)
//
// Mirrors the use-templates.ts pattern but with the T2.3 surface.
// `useWorkflowRun` polls every 1s while a run is unsettled
// (`ok === undefined`), then stops. Caller passes runId from the
// `useStartWorkflow` mutation result.

'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import { subscribeSharedEventSource } from '@/lib/shared-event-source';
import type {
  GenerateWorkflowBody,
  GenerateWorkflowResponse,
  PendingApproval,
  SaveWorkflowBody,
  SynthesizeWorkflowBody,
  SynthesizeWorkflowResponse,
  WorkflowDetail,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from '../client';

export function useWorkflows() {
  const client = useNexusClient();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: nexusKeys.workflows(),
    queryFn: () => client.getWorkflows(),
    // D4 (2026-05-11) — refetchInterval safety net stays at 60s in
    // case the SSE stream below is unavailable (older daemon · network
    // proxy stripping text/event-stream · SSR). When SSE is live the
    // server-driven invalidation typically refreshes within <500ms so
    // 60s is plenty as a fallback.
    refetchInterval: 60_000,
  });

  // D4 · §6.4 SSE — subscribe to `/v1/workflows/events` and invalidate
  // the cached list on every `change` frame. Reconnect on transient
  // errors is left to the EventSource native retry policy; permanent
  // failures fall back to the 60s refetchInterval above.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = client.workflowsEventsUrl();
    if (!url) return;
    const invalidate = (): void => {
      qc.invalidateQueries({ queryKey: nexusKeys.workflows() });
    };
    // ⛔⭐⭐⭐ **공유 구독** — 이 훅은 `SidebarWorkflowInvoker` 와 `WorkflowsPanel` 둘이 쓰고,
    //   `AppShell` 이 사이드바를 «세 자리»에 마운트한다. 각자 `new EventSource` 를 열면
    //   ***끝나지 않는 연결이 사본 수만큼 쌓여 HTTP/1.1 한도(6)를 먹는다***
    //   — 실측으로 그 줄에 관측 업로드가 갇혔다(`shared-event-source.ts` 머리말).
    // hello frame is just a baseline (no list change) — skip it.
    return subscribeSharedEventSource(url, { events: { change: invalidate } });
  }, [client, qc]);

  return query;
}

export function useWorkflow(name: string, opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery<WorkflowDetail>({
    queryKey: nexusKeys.workflow(name),
    queryFn: () => client.getWorkflow(name),
    enabled: opts.enabled ?? name.length > 0,
  });
}

export function useSaveWorkflow() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, body }: { name: string; body: SaveWorkflowBody }) =>
      client.saveWorkflow(name, body),
    onSuccess: (_data, { name }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.workflows() });
      qc.invalidateQueries({ queryKey: nexusKeys.workflow(name) });
    },
  });
}

export function useDeleteWorkflow() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, scope }: { name: string; scope?: 'project' | 'global' }) =>
      client.deleteWorkflow(name, scope ? { scope } : undefined),
    onSuccess: (_data, { name }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.workflows() });
      qc.invalidateQueries({ queryKey: nexusKeys.workflow(name) });
    },
  });
}

export function useValidateWorkflow() {
  const client = useNexusClient();
  return useMutation({
    mutationFn: ({ yaml, signal }: { yaml: string; signal?: AbortSignal }) =>
      client.validateWorkflow(yaml, signal ? { signal } : undefined),
  });
}

/** ROADMAP Tier 1 W1 — natural-language → workflow YAML mutation.
 *  Caller (WorkflowNLPrompt) reads `data.yaml` + `data.warnings` to
 *  populate the panel's draft editor. No cache invalidation: the
 *  generated yaml isn't persisted until the user hits Save (which
 *  goes through `useSaveWorkflow`). */
export function useGenerateWorkflow() {
  const client = useNexusClient();
  return useMutation<GenerateWorkflowResponse, Error, GenerateWorkflowBody>({
    mutationFn: (body) => client.generateWorkflow(body),
  });
}

/** Surface-unification §C1 (2026-05-11) — trigger-aware natural-language
 *  → workflow YAML via the R3 native skill. `WorkflowNLPrompt` uses this
 *  by default; the C2 preview modal renders the response (`triggerSummary`
 *  + `workflowName` + yaml) for the user to Apply / Refine / Cancel. */
export function useSynthesizeWorkflow() {
  const client = useNexusClient();
  return useMutation<SynthesizeWorkflowResponse, Error, SynthesizeWorkflowBody>({
    mutationFn: (body) => client.synthesizeWorkflow(body),
  });
}

export function useStartWorkflow() {
  const client = useNexusClient();
  return useMutation({
    mutationFn: ({ name, args, dryRun }: { name: string; args: string; dryRun?: boolean }) =>
      client.runWorkflow(name, args, dryRun ? { dryRun: true } : undefined),
  });
}

/** Disk-backed run history listing — newest-first. Stale-running
 *  entries promoted to `orphaned` server-side (#1977).
 *
 *  Refetch cadence: 30s safety net. `useWorkflowRunEvents` (§15.8(b))
 *  invalidates this query within ~200ms of every executor frame, so
 *  the previous 5s poll is no longer needed for freshness — the
 *  remaining poll just covers SSE-disconnect / background-throttle /
 *  server-restart cases. */
export function useWorkflowRuns(opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery<{ runs: WorkflowRunSummary[] }>({
    queryKey: nexusKeys.workflowRuns(),
    queryFn: () => client.getWorkflowRuns(),
    enabled: opts.enabled ?? true,
    refetchInterval: 30_000,
  });
}

/** §5.1 — pending-approvals poller. 1s interval (cheap GET against
 *  an in-memory registry). Filtered to a specific runId via opts. */
export function usePendingApprovals(opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery<{ pending: PendingApproval[] }>({
    queryKey: nexusKeys.pendingApprovals(),
    queryFn: () => client.getPendingApprovals(),
    enabled: opts.enabled ?? true,
    refetchInterval: 1_000,
  });
}

export function useApproveRun() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, response }: { runId: string; response?: string }) =>
      client.approveRun(runId, response ? { response } : {}),
    onSuccess: (_data, { runId }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.pendingApprovals() });
      qc.invalidateQueries({ queryKey: nexusKeys.workflowRun(runId) });
    },
  });
}

export function useRejectRun() {
  const client = useNexusClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason?: string }) =>
      client.rejectRun(runId, reason ? { reason } : {}),
    onSuccess: (_data, { runId }) => {
      qc.invalidateQueries({ queryKey: nexusKeys.pendingApprovals() });
      qc.invalidateQueries({ queryKey: nexusKeys.workflowRun(runId) });
    },
  });
}

// HANDOFF §4.2 follow-up — `installWorkflowEventStream` (below)
// replaces the previously separate `installWorkflowApprovalEventStream`
// + `installWorkflowRunEventStream`. One EventSource per panel mount
// instead of two; same wire shape, fan-out by event name on the
// client side.

export function useWorkflowRun(runId: string | null) {
  const client = useNexusClient();
  return useQuery<WorkflowRunDetail>({
    queryKey: runId ? nexusKeys.workflowRun(runId) : ['nexus', 'workflow-run', '__none__'],
    queryFn: () => {
      if (!runId) throw new Error('runId required');
      return client.getWorkflowRun(runId);
    },
    enabled: !!runId,
    // §15.8(b) — `useWorkflowRunEvents` invalidates this query within
    // ~200ms of every executor lifecycle frame, so we don't need to
    // hammer the API at 1Hz anymore. Keep a 30s poll as safety net
    // for SSE disconnects / tab-backgrounded EventSource throttling /
    // server restarts. Stop polling once the run settles.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 30_000;
      return data.ok === undefined ? 30_000 : false;
    },
  });
}

/** HANDOFF §4.2 follow-up — unified workflow event stream. ONE
 *  EventSource per panel mount (was two: a `workflow.` topic for
 *  approval frames + a `workflow.run.` topic for run frames; the
 *  `workflow.` topic was already a superset). Same wire format —
 *  fan-out by event name on the client side.
 *
 *  Server (`src/nexus/api/events.ts`) emits each frame as
 *  `event: <kind>\ndata: <json>\n\n` so we attach named listeners
 *  per kind (named-event dispatch only fires on `addEventListener`
 *  for that exact kind — `'message'` listeners alone would miss
 *  every frame because each frame has an explicit `event:` field).
 *
 *  Returns teardown that closes the EventSource. No-op teardown when
 *  no EventSource implementation is available (SSR / older browsers
 *  / `EventSource` constructor throws). */
export function installWorkflowEventStream(
  baseUrl: string,
  hooks: {
    onApprovalPending: () => void;
    onApprovalResolved: (runId: string | undefined) => void;
    onRunEvent: (runId: string | undefined) => void;
  },
  opts: { EventSourceImpl?: typeof EventSource } = {},
): () => void {
  const ES = opts.EventSourceImpl ?? (globalThis as { EventSource?: typeof EventSource }).EventSource;
  if (!ES) return () => { /* no-op */ };

  const url = `${baseUrl}/v1/events?topics=${encodeURIComponent('workflow.')}`;
  let es: EventSource;
  try {
    es = new ES(url);
  } catch {
    return () => { /* construction failed — nothing to tear down */ };
  }

  const parseRunId = (e: Event): string | undefined => {
    try {
      const me = e as MessageEvent;
      const ev = JSON.parse(me.data) as { detail?: { runId?: string } };
      if (typeof ev?.detail?.runId === 'string' && ev.detail.runId.length > 0) {
        return ev.detail.runId;
      }
    } catch { /* unparseable — caller gets undefined runId */ }
    return undefined;
  };

  es.addEventListener('workflow.approval.pending', () => hooks.onApprovalPending());
  es.addEventListener('workflow.approval.resolved', (e) => hooks.onApprovalResolved(parseRunId(e)));

  // Every `workflow.run.*` kind invalidates the same query keys;
  // a single dispatch path is fine.
  const RUN_KINDS = [
    'workflow.run.started',
    'workflow.run.node-started',
    'workflow.run.node-skipped',
    'workflow.run.node-done',
    'workflow.run.completed',
    'workflow.run.failed',
  ];
  for (const k of RUN_KINDS) {
    es.addEventListener(k, (e) => hooks.onRunEvent(parseRunId(e)));
  }

  return () => { try { es.close(); } catch { /* idempotent */ } };
}

/** Unified hook — calls `installWorkflowEventStream` once and wires
 *  the standard cache-invalidation rules:
 *    - approval.pending  → invalidate pendingApprovals
 *    - approval.resolved → invalidate pendingApprovals + workflowRun(runId)
 *    - run.*             → invalidate workflowRuns + workflowRun(runId)
 *
 *  Replaces the previously separate `useWorkflowApprovalEvents` +
 *  `useWorkflowRunEvents`. WorkflowsPanel now opens 1 EventSource
 *  instead of 2 to the same endpoint.
 *
 *  Polling on the underlying queries stays as a safety net (1s for
 *  approvals, 30s for runs) for SSE disconnects / tab-backgrounded
 *  EventSource throttling / server restarts. */
export function useWorkflowEvents(opts: {
  enabled?: boolean;
  EventSourceImpl?: typeof EventSource;
} = {}): void {
  const client = useNexusClient();
  const qc = useQueryClient();
  const enabled = opts.enabled ?? true;
  const ESImpl = opts.EventSourceImpl;

  useEffect(() => {
    if (!enabled) return;
    return installWorkflowEventStream(
      client.baseUrl,
      {
        onApprovalPending: () => qc.invalidateQueries({ queryKey: nexusKeys.pendingApprovals() }),
        onApprovalResolved: (runId) => {
          qc.invalidateQueries({ queryKey: nexusKeys.pendingApprovals() });
          if (runId) qc.invalidateQueries({ queryKey: nexusKeys.workflowRun(runId) });
        },
        onRunEvent: (runId) => {
          qc.invalidateQueries({ queryKey: nexusKeys.workflowRuns() });
          if (runId) qc.invalidateQueries({ queryKey: nexusKeys.workflowRun(runId) });
        },
      },
      ESImpl ? { EventSourceImpl: ESImpl } : {},
    );
  }, [client.baseUrl, enabled, qc, ESImpl]);
}
