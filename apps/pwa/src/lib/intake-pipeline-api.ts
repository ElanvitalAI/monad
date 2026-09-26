/**
 * I7 (2026-05-12) — wrapper for `POST /v1/intake/pipeline-preview` (FU3).
 *
 * Mirrors the daemon-side response shape in `src/nexus/api/intake-pipeline-preview.ts`.
 * The endpoint runs the full Phase 1 pipeline (decompose → enrich → categorize
 * → goal_align → multi_spec) with skeleton fallback callables — no real LLM
 * or plugin fetch — so the PWA cards UI can dogfood the wire end-to-end
 * before FU-I7a wires real LLMs. `register: true` writes to an in-memory
 * TaskStore (does not touch the user's TOX) — final real-register surfaces
 * in FU-I7c.
 */
import type { DaemonClient } from './daemon-client';

export type ProposedConfidence = 'high' | 'medium' | 'low';
export type AlignPriority = 'high' | 'medium' | 'low';

export type TaskCategory =
  | 'research'
  | 'research-and-plan'
  | 'dev-feature'
  | 'dev-spec'
  | 'cognitive'
  | 'debug'
  | 'workflow-update';

export interface PreviewTask {
  id: string;
  taskKey: string;
  title: string;
  intent: string;
  confidence: ProposedConfidence;
  urls: string[];
  keywords: string[];
  refs: string[];
  enrichmentCount: number;
  category: TaskCategory;
  workflowEligible: boolean;
  priority: AlignPriority;
}

export interface PreviewMission {
  id: string;
  title: string;
  intent: string | null;
  taskCount: number;
  tasks: PreviewTask[];
}

export interface PreviewRegisterResult {
  missionIds: string[];
  taskIds: string[];
  workflows: Array<{ taskKey: string; skeleton: boolean }>;
  errors: Array<{ taskKey?: string; error: string }>;
  /** FU-I7d — taskKeys the filter excluded (empty when no filter). */
  skippedTaskKeys?: string[];
  /** FU-I7d — mission ids skipped because every task in the mission
   *  fell out of the filter. */
  skippedMissionKeys?: string[];
}

export interface PipelinePreviewResponse {
  intakeId: string;
  decomposition: {
    rationale: string;
    fallback: boolean;
    missionCount: number;
    taskCount: number;
    missions: PreviewMission[];
  };
  enrichmentCounts: {
    withSummary: number;
    diagnosticOnly: number;
  };
  categorize: {
    fallback: boolean;
    counts: { total: number; workflowEligible: number };
  };
  align: {
    fallback: boolean;
    dependencyCount: number;
    priorities: Record<string, number>;
  };
  synth: {
    counts: Record<string, number>;
  };
  register: PreviewRegisterResult | null;
}

export interface PipelinePreviewRequest {
  rawText: string;
  intakeId?: string;
  register?: boolean;
  /** FU-I7d — when `register: true`, restrict TaskStore writes to the
   *  listed `taskKey`s. Reject/defer cards from the swipe deck are
   *  excluded here so the in-memory store reflects the user's
   *  per-card verdict. Empty/omitted → commit every task. */
  includeTaskKeys?: string[];
  /** FU-I7e — natural-language refinement nudge on a prior
   *  decomposition (e.g. "missions 더 작게"). When set together with
   *  `priorDecomposition`, the decompose phase re-prompts the LLM
   *  in refiner mode. */
  refinementHint?: string;
  priorDecomposition?: { missions: readonly PreviewMission[] };
  /** FU-I7a — opt the endpoint into the production `streamLLM` wire
   *  (decompose · categorize · goal-align · multi-spec all switch
   *  from SHARED_THROW skeleton to real LLM calls). Default false
   *  keeps the wire smoke contract intact. */
  useRealLlm?: boolean;
  /** FU-I7a — provider override (matches `PROVIDERS` keys in
   *  `src/llm.ts`). Omit to honour user-config / env. */
  provider?: string;
  /** FU-I7a — model override. Omit to use the provider's default. */
  model?: string;
  /** FU-I7b — opt the enrich phase into the production plugin bundle
   *  (URL fetch · gh repo view · keyword stub). Default off keeps
   *  the "no plugin" diagnostic stream the FU3 e2e tests assert. */
  useRealEnrich?: boolean;
}

/** FU-I7f (2026-05-12) — response shape of `/v1/notes/from-image`. The
 *  endpoint is wired by R-OCR.1 and we reuse it for the memo-intake
 *  camera/photo input instead of standing up a duplicate path. We
 *  request `polishMode: 'minimal'` so the markdown is raw OCR output
 *  the user can correct in the memo textarea. */
export interface PhotoOcrResponse {
  ok: true;
  markdown: string;
  provider: string;
  polishMode: 'minimal' | 'enrich';
  usedLlmPolish: boolean;
  costEstimate: { ocrUsd: number; polishUsd: number };
}

export class IntakePipelineApi {
  constructor(private client: DaemonClient) {}

  preview(req: PipelinePreviewRequest): Promise<PipelinePreviewResponse> {
    return this.client.fetchJson<PipelinePreviewResponse>('/v1/intake/pipeline-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  }

  /** FU-I7c (2026-05-12) — write Mission + Task rows into the user's
   *  real `~/.elanous/tasks/tasks.db` and persist workflow YAMLs under
   *  `~/.elanous/workflows/`. Same body shape as preview minus the
   *  `register` flag (the endpoint *is* the register). The response
   *  shape mirrors preview-with-register so the PWA can swap paths
   *  without touching the parser. */
  commit(req: Omit<PipelinePreviewRequest, 'register'>): Promise<PipelinePreviewResponse> {
    return this.client.fetchJson<PipelinePreviewResponse>('/v1/intake/pipeline-commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  }

  /** FU-I7f — POST a photo blob to the existing R-OCR.1 endpoint
   *  (`/v1/notes/from-image`) and return raw OCR markdown. The PWA
   *  preview surface prepends the markdown to the memo textarea so
   *  the user can correct OCR errors before running the pipeline. */
  async submitPhotoOcr(image: Blob, filename: string): Promise<PhotoOcrResponse> {
    const form = new FormData();
    form.append('image', image, filename);
    form.append('polishMode', 'minimal');
    const res = await this.client.fetchJson<PhotoOcrResponse>(
      '/v1/notes/from-image',
      { method: 'POST', body: form },
    );
    return res;
  }
}

/** Flatten missions → cards with the mission title attached. Cards are
 *  the unit of swipe — UI rendering groups by mission via the
 *  `missionTitle` column rather than a nested loop. */
export interface MemoCard {
  missionId: string;
  missionTitle: string;
  task: PreviewTask;
}

export function flattenToCards(missions: readonly PreviewMission[]): MemoCard[] {
  const out: MemoCard[] = [];
  for (const m of missions) {
    for (const t of m.tasks) {
      out.push({ missionId: m.id, missionTitle: m.title, task: t });
    }
  }
  return out;
}
