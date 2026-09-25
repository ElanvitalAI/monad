// W9 Z4 · GET /v1/runs/:runId/approval-showroom endpoint.

import {
  runApprovalShowroom,
  type ApprovalLaneInput,
  type ApprovalShowroomDeps,
  type ApprovalShowroomReport,
} from '../../showroom/approval-showroom.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export interface ApprovalShowroomRouteOpts {
  /** Resolve approval message + workflow name from the run id (lookup
   *  into the workflow-runtime persistence layer). */
  resolveRun: (runId: string) => Promise<{
    workflowName: string;
    approvalMessage: string;
    context?: string;
  } | null>;
  /** Lane config — daemon boot supplies (model pins · role list).
   *  Defaults to 3 lanes (plan / review / reflect) using local-light. */
  lanes?: ApprovalLaneInput[];
  showroomDeps: ApprovalShowroomDeps;
  /** Optional audit writer; report is persisted when wired. */
  auditWriter?: { write(report: ApprovalShowroomReport): Promise<void> };
  checkAuth?: (req: Request) => boolean;
}

const DEFAULT_LANES: ApprovalLaneInput[] = [
  { role: 'plan', model: 'lm-studio/qwen-7b' },
  { role: 'review', model: 'lm-studio/qwen-7b' },
  { role: 'reflect', model: 'lm-studio/qwen-7b' },
];

export function approvalShowroomPath(runId: string): string {
  return `/v1/runs/${encodeURIComponent(runId)}/approval-showroom`;
}

const RUN_ID_RE = /^\/v1\/runs\/([^/]+)\/approval-showroom$/;

export function parseApprovalShowroomPath(pathname: string): string | null {
  const m = pathname.match(RUN_ID_RE);
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function handleApprovalShowroom(
  req: Request,
  runId: string,
  opts: ApprovalShowroomRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  const meta = await opts.resolveRun(runId);
  if (!meta) {
    return jsonResponse({ error: 'run-not-found', runId }, 404);
  }
  const report = await runApprovalShowroom(
    {
      runId,
      workflowName: meta.workflowName,
      approvalMessage: meta.approvalMessage,
      ...(meta.context ? { context: meta.context } : {}),
      lanes: opts.lanes ?? DEFAULT_LANES,
    },
    opts.showroomDeps,
  );
  if (opts.auditWriter) {
    try { await opts.auditWriter.write(report); } catch { /* best-effort */ }
  }
  return jsonResponse(report, 200);
}
