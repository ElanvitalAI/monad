// R6 Task 5 · §6.1 LLM-judge — REST endpoint (2026-05-09).
//
// `POST /v1/showroom/role-judge` accepts `{ prompt, availableRoles? }`
// and returns the hybrid-classifier output. The daemon owns the
// model selection (config + fallback chain) so the PWA doesn't need
// LM Studio knowledge — it just calls this endpoint when its own
// local keyword classifier returns null.

import { hybridClassify, type HybridClassifyResult } from '../../showroom/role-judge/index.js';
import type { RoleLabel } from '../../showroom/role-judge/prompt-template.js';

/** Mirror of the PWA's `classifyPromptRole`. Daemon side keeps a
 *  thin re-implementation so `src/showroom/role-judge` doesn't pull
 *  in PWA-only modules; the keyword tables themselves are tiny. */
function keywordClassify(text: string): RoleLabel | null {
  const lower = text.toLowerCase();
  // Order = priority (reflect > review > plan > exec) so ambiguous
  // prompts pick the higher-leverage role.
  const TABLE: ReadonlyArray<[RoleLabel, RegExp]> = [
    ['reflect', /\breflect\b|회고|돌아보|되돌아|다시 생각/i],
    ['review', /\breview\b|리뷰|봐줘|봐 줘|살펴/i],
    ['plan', /\bplan\b|\bdesign\b|\bspec\b|계획|설계|기획|어떻게 할/i],
    ['exec', /\bimplement\b|\brun\b|\bbuild\b|\bdo\b|구현|실행|작성|만들/i],
  ];
  for (const [role, pattern] of TABLE) {
    if (pattern.test(lower)) return role;
  }
  return null;
}

export interface RoleJudgeRouteOpts {
  /** Optional auth check — production routes through the same shape
   *  as `/v1/personas`. Tests pass undefined to skip. */
  checkAuth?: (req: Request) => boolean;
  /** Backend selector — defaults to 'keyword' (opt-in safe). When
   *  'local-llm', the handler hits the LM Studio endpoint configured
   *  via env or defaults. */
  backend?: 'keyword' | 'local-llm';
  /** Override the default LM Studio model id — falls back to the
   *  HANDOFF-recommended `google/gemma-4-e4b`. */
  model?: string;
  /** Override the default LM Studio endpoint URL. */
  endpoint?: string;
  /** Override the wall-clock timeout. */
  timeoutMs?: number;
}

interface RequestBody {
  prompt?: string;
  availableRoles?: readonly string[];
  /** R6 FU.5 (2026-05-09) — per-call backend override. PWA toggle UI
   *  passes this so the user can flip between keyword-only and
   *  local-llm without restarting the daemon. */
  backend?: 'keyword' | 'local-llm';
  /** Per-call model override; only consulted when the resolved
   *  backend is `local-llm`. Falls back to `ELANOUS_SHOWROOM_ROLE_
   *  JUDGE_MODEL` env or the default `google/gemma-4-e4b`. */
  model?: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // R6 Task 5 verify (2026-05-09) — PWA dev mode runs on a
      // different port from the daemon, so cross-origin POST is
      // blocked without an explicit allow header. Mirrors the SSE
      // endpoint's CORS posture.
      'access-control-allow-origin': '*',
    },
  });
}

/** Resolve the backend a single request will use — env var
 *  `ELANOUS_SHOWROOM_ROLE_JUDGE_BACKEND` overrides opts which
 *  overrides the 'keyword' default. Exported for tests. */
export function resolveRoleJudgeBackend(
  opts: RoleJudgeRouteOpts,
): 'keyword' | 'local-llm' {
  const env = process.env.ELANOUS_SHOWROOM_ROLE_JUDGE_BACKEND;
  if (env === 'keyword' || env === 'local-llm') return env;
  return opts.backend ?? 'keyword';
}

/** Resolve the model id for the local-llm backend — env var
 *  `ELANOUS_SHOWROOM_ROLE_JUDGE_MODEL` overrides opts which overrides
 *  the HANDOFF default `google/gemma-4-e4b`. Falls back to the
 *  already-loaded `gemma-4-26b-a4b-it` (HANDOFF §6.2 fallback note)
 *  when an explicit `ELANOUS_SHOWROOM_ROLE_JUDGE_MODEL_FALLBACK` is set
 *  and the primary fetch fails — that branch is wired in the handler
 *  loop below. */
export function resolveRoleJudgeModel(opts: RoleJudgeRouteOpts): string {
  const env = process.env.ELANOUS_SHOWROOM_ROLE_JUDGE_MODEL;
  if (env && env.length > 0) return env;
  // micro.2a (2026-05-09) — swap default from `google/gemma-4-e4b`
  // to `mlx-community/gemma-4-26b-a4b-it`. Live measurement on
  // M5 Max 128GB:
  //   * gemma-4-e4b   = reasoning enabled · 2400ms warm · accurate
  //   * gemma-4-26b-a4b-it = non-reasoning · 267ms warm · 4/4 accurate
  // The 26B variant is heavier on disk (16GB vs 5.9GB) but the user
  // already has it deployed; warm latency drops 10x while accuracy
  // holds. Operators on smaller hosts can fall back to the e4b via
  // `ELANOUS_SHOWROOM_ROLE_JUDGE_MODEL=google/gemma-4-e4b`.
  return opts.model ?? 'mlx-community/gemma-4-26b-a4b-it';
}

/** Optional override of the wall-clock timeout via env. Honoured only
 *  when the value parses as a positive finite integer (ms). */
export function resolveRoleJudgeTimeoutMs(opts: RoleJudgeRouteOpts): number | undefined {
  const env = process.env.ELANOUS_SHOWROOM_ROLE_JUDGE_TIMEOUT_MS;
  if (env) {
    const n = Number.parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return opts.timeoutMs;
}

export async function handleRoleJudge(
  req: Request,
  opts: RoleJudgeRouteOpts = {},
): Promise<Response> {
  const method = req.method.toUpperCase();
  // CORS preflight — the PWA in dev mode runs on a different port
  // and `content-type: application/json` triggers a browser OPTIONS
  // preflight. We answer it before the auth gate so unauthenticated
  // origins still get the correct CORS posture (auth runs on the
  // actual POST anyway).
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-max-age': '600',
      },
    });
  }
  if (opts.checkAuth && !opts.checkAuth(req)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  if (method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: 'invalid json body' }, 400);
  }
  const prompt = (body.prompt ?? '').trim();
  if (!prompt) {
    return jsonResponse({ error: 'prompt required' }, 400);
  }
  // FU.5 — body override > env > opts > default for both backend
  // and model. The body override gives the PWA a per-call switch
  // without daemon restart.
  const backend = body.backend === 'keyword' || body.backend === 'local-llm'
    ? body.backend
    : resolveRoleJudgeBackend(opts);
  const model = body.model && body.model.length > 0
    ? body.model
    : resolveRoleJudgeModel(opts);
  const timeoutMs = resolveRoleJudgeTimeoutMs(opts);
  const localLlmOpts = {
    model,
    ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
  let result: HybridClassifyResult = await hybridClassify({
    userPrompt: prompt,
    keywordClassifier: keywordClassify,
    useLocalLlm: backend === 'local-llm',
    localLlm: localLlmOpts,
  });
  // HANDOFF §6.2 — graceful fallback to the larger 26B-A4B when the
  // small E4B isn't available (download in progress / different host
  // model name). One retry only; further failures degrade to the
  // 'fallback' source = broadcast.
  if (
    backend === 'local-llm' &&
    result.source === 'fallback' &&
    result.llm &&
    !result.llm.ok &&
    process.env.ELANOUS_SHOWROOM_ROLE_JUDGE_MODEL_FALLBACK
  ) {
    const fallbackModel = process.env.ELANOUS_SHOWROOM_ROLE_JUDGE_MODEL_FALLBACK!;
    if (fallbackModel !== model) {
      result = await hybridClassify({
        userPrompt: prompt,
        keywordClassifier: keywordClassify,
        useLocalLlm: true,
        localLlm: { ...localLlmOpts, model: fallbackModel },
      });
    }
  }
  return jsonResponse({
    role: result.role,
    source: result.source,
    backend,
    model: backend === 'local-llm' ? model : undefined,
    llm: result.llm
      ? {
          ok: result.llm.ok,
          latencyMs: result.llm.latencyMs,
          ...(result.llm.ok ? {} : { reason: result.llm.reason, detail: result.llm.detail }),
        }
      : undefined,
  }, 200);
}
