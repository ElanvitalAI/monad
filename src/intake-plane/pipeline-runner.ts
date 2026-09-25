/**
 * FU-I7c (2026-05-12) — shared Phase 1 pipeline runner.
 *
 * Both `/v1/intake/pipeline-preview` (FU3 · in-memory only) and
 * `/v1/intake/pipeline-commit` (FU-I7c · real TaskStore + saveWorkflow)
 * need the same 5-phase upstream: decompose → enrich → categorize →
 * align → synth. Factoring it into a helper keeps the endpoints thin
 * and ensures the two paths stay in lock-step.
 *
 * Each callable seam (decompose / categorize / align / synth) is
 * optional. When omitted the SHARED_THROW skeleton fallback kicks in,
 * exercising the D4 defensive paths each phase already implements.
 *
 * Cross-ref:
 *   src/intake-plane/runtime-callables.ts (FU-I7a · real LLM builder)
 *   src/nexus/api/intake-pipeline-preview.ts (FU3 endpoint consumer)
 *   src/nexus/api/intake-pipeline-commit.ts (FU-I7c endpoint consumer)
 */
import {
  decomposeMemo,
  type DecomposeMemoCallable,
  type MemoDecomposition,
} from './decompose.js';
import {
  enrichDecomposition,
  type EnrichedDecomposition,
  type EnrichPlugins,
} from './enrich.js';
import {
  categorizeDecomposition,
  type CategorizeCallable,
  type CategorizeResult,
} from './categorize.js';
import {
  alignDecomposition,
  type AlignCallable,
  type GoalAlignResult,
} from './goal-align.js';
import {
  synthMultiSpecs,
  type SingleSynthCallable,
  type MultiSynthResult,
} from './multi-spec.js';

export interface PipelinePhaseCallables {
  decompose?: DecomposeMemoCallable;
  categorize?: CategorizeCallable;
  align?: AlignCallable;
  synth?: SingleSynthCallable;
  /** FU-I7b (2026-05-12) — production enrichment plugins. When
   *  omitted, the I2 orchestrator falls back to its per-row
   *  "no plugin" diagnostic. */
  enrichPlugins?: EnrichPlugins;
}

export interface PipelineRunInput {
  rawText: string;
  intakeId: string;
  refinementHint?: string;
  priorDecomposition?: Pick<MemoDecomposition, 'missions'>;
}

export interface PipelineRunResult {
  intakeId: string;
  decomposition: MemoDecomposition;
  enriched: EnrichedDecomposition;
  categorize: CategorizeResult;
  align: GoalAlignResult;
  synth: MultiSynthResult;
}

/** Thunk surface for the skeleton fallback. Each phase's callable
 *  throws on first use; the phase's own D4 path catches and falls
 *  back to the deterministic skeleton output. */
function skeletonThrow(): never {
  throw new Error('pipeline-runner: no real LLM/plugin wired (use skeleton fallback)');
}

const SKELETON_PROMPT_CALLABLE: DecomposeMemoCallable = async () => {
  skeletonThrow();
};

const SKELETON_SYNTH_CALLABLE: SingleSynthCallable = async () => {
  skeletonThrow();
};

export async function runIntakePipelinePhases(
  input: PipelineRunInput,
  callables: PipelinePhaseCallables = {},
): Promise<PipelineRunResult> {
  // 1. Decompose — refinementHint + priorDecomposition forwarded when
  // present (FU-I7e). Real LLM wire when callables.decompose set.
  const decomposition = await decomposeMemo(
    {
      rawText: input.rawText,
      intakeId: input.intakeId,
      ...(input.refinementHint ? { refinementHint: input.refinementHint } : {}),
      ...(input.priorDecomposition ? { priorDecomposition: input.priorDecomposition } : {}),
    },
    { callable: callables.decompose ?? SKELETON_PROMPT_CALLABLE },
  );

  // 2. Enrich — FU-I7b (2026-05-12) wires URL / Repo / (deferred)
  // Keyword plugins here. When `enrichPlugins` is omitted, the I2
  // orchestrator's per-row "no plugin" diagnostic stays in effect.
  const enriched = await enrichDecomposition(decomposition, {
    plugins: callables.enrichPlugins ?? {},
  });

  // 3. Categorize — D4 fallback = pessimistic all-cognitive.
  const categorize = await categorizeDecomposition(enriched, {
    callable: callables.categorize ?? SKELETON_PROMPT_CALLABLE,
  });

  // 4. Goal align — heuristic baseline always runs; LLM refine layered
  //    on top when callable provided.
  const align = await alignDecomposition(
    { decomposition: enriched, categorize },
    callables.align ? { callable: callables.align } : {},
  );

  // 5. Multi-spec — synth throws → skeleton YAML per eligible task.
  const synth = await synthMultiSpecs(enriched, categorize, align, {
    callable: callables.synth ?? SKELETON_SYNTH_CALLABLE,
  });

  return { intakeId: input.intakeId, decomposition, enriched, categorize, align, synth };
}
