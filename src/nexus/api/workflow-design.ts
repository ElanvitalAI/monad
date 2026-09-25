// W9 Z6 · POST /v1/workflows/:name/design endpoint.

import {
  runWorkflowDesignStudio,
  type DesignLaneSpec,
  type WorkflowDesignDeps,
} from '../../showroom/workflow-design-studio.js';

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export interface WorkflowDesignRouteOpts {
  /** Resolve the current workflow YAML (returns null for greenfield design). */
  loadCurrentYaml: (name: string) => Promise<string | null>;
  /** Lane spec — daemon boot supplies model pins. Defaults to 4 local lanes. */
  lanes?: DesignLaneSpec[];
  showroomDeps: WorkflowDesignDeps;
  checkAuth?: (req: Request) => boolean;
}

const DEFAULT_LANES: DesignLaneSpec[] = [
  { role: 'architect', model: 'lm-studio/qwen-14b' },
  { role: 'executor', model: 'lm-studio/qwen-14b' },
  { role: 'critic', model: 'lm-studio/qwen-7b' },
  { role: 'tester', model: 'lm-studio/qwen-7b' },
];

const ROUTE_RE = /^\/v1\/workflows\/([^/]+)\/design$/;

export function workflowDesignPath(name: string): string {
  return `/v1/workflows/${encodeURIComponent(name)}/design`;
}

export function parseWorkflowDesignPath(pathname: string): string | null {
  const m = pathname.match(ROUTE_RE);
  return m ? decodeURIComponent(m[1]!) : null;
}

export async function handleWorkflowDesign(
  req: Request,
  name: string,
  opts: WorkflowDesignRouteOpts,
): Promise<Response> {
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonResponse({ error: 'bad_request', reason: 'invalid JSON' }, 400); }
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'bad_request', reason: 'object body required' }, 400);
  }
  const b = body as Record<string, unknown>;
  if (typeof b.goal !== 'string' || !b.goal.trim()) {
    return jsonResponse({ error: 'bad_request', reason: 'goal required' }, 400);
  }

  const currentYaml = await opts.loadCurrentYaml(name);
  const report = await runWorkflowDesignStudio(
    {
      goal: b.goal,
      ...(currentYaml ? { currentYaml } : {}),
      ...(typeof b.context === 'string' ? { context: b.context } : {}),
      lanes: opts.lanes ?? DEFAULT_LANES,
    },
    opts.showroomDeps,
  );
  return jsonResponse(report, 200);
}
