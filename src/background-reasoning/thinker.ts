// W6 Y4 · Thinker Agent — active background reasoning on KGS.
// Cf. ROADMAP-background-reasoning-patcher-thinker-2026-05-12.md §4 + §6 Y4.
//
// One `tickThinker(state, signals, deps)` cycle:
//   trigger.evaluate(state, signals) ?
//     · plan tasks from input bag (KGS cards + routine + feedback + intent feedback)
//     · per task → model-selector → LLM call → ThinkerOutput
//     · writer.persist(outputs) — caller decides where (KGS / workflow proposal store / persona patch store)

import type { SignalEnvelope } from '../signal-bus/types.js';
import {
  ThinkerModelSelector,
  type ThinkerTaskKind,
} from './thinker-model-selector.js';
import {
  ThinkerTrigger,
  type ThinkerTriggerState,
  type ThinkerTriggerVerdict,
} from './thinker-trigger.js';
import { runWorkflowProposal } from './thinker-tasks/workflow-proposal.js';
import { runTemplateDraft } from './thinker-tasks/template-draft.js';
import { runPatternDetect } from './thinker-tasks/pattern-detect.js';
import { runPersonalization } from './thinker-tasks/personalization.js';
import { runPromptPatch } from './thinker-tasks/prompt-patch.js';
import type {
  IntentFeedback,
  KgsCardRef,
  RoutineSnapshot,
  ThinkerLlmCallable,
  ThinkerOutput,
} from './thinker-tasks/types.js';

export interface ThinkerInputBag {
  /** KGS cards drained since last tick. */
  cards: KgsCardRef[];
  /** Rolling routine snapshot. */
  routine?: RoutineSnapshot;
  /** Recent intent feedback (motion / gesture outcomes). */
  intentFeedback?: IntentFeedback[];
  /** Workflow names touched in the window — for pattern-detect. */
  recentWorkflowNames?: string[];
  /** Personas/skills failing recently — drives prompt-patch. */
  failingTargets?: Array<{ target: 'skill' | 'persona'; targetName: string; currentPrompt: string; failures: KgsCardRef[] }>;
}

export interface ThinkerWriter {
  persist(outputs: ThinkerOutput[]): Promise<void>;
}

export interface ThinkerTickResult {
  fired: boolean;
  reason: ThinkerTriggerVerdict['reason'];
  outputs: ThinkerOutput[];
  /** Task kinds attempted (in case caller wants per-kind metrics). */
  attempted: ThinkerTaskKind[];
}

export interface ThinkerDeps {
  trigger: ThinkerTrigger;
  selector: ThinkerModelSelector;
  callable: ThinkerLlmCallable;
  writer: ThinkerWriter;
  /** Caller decides which task kinds to run based on the input bag.
   *  Default heuristic: workflow_proposal when ≥3 cards · template_draft
   *  when ≥10 routine events · pattern_detect when ≥2 workflows · etc. */
  taskKindsFor?: (bag: ThinkerInputBag) => ThinkerTaskKind[];
  signal?: AbortSignal;
}

function defaultTaskKindsFor(bag: ThinkerInputBag): ThinkerTaskKind[] {
  const kinds: ThinkerTaskKind[] = [];
  if (bag.cards.length >= 3) kinds.push('workflow_proposal');
  if ((bag.routine?.events.length ?? 0) >= 10) kinds.push('template_draft');
  if ((bag.recentWorkflowNames?.length ?? 0) >= 2) kinds.push('pattern_detect');
  if ((bag.intentFeedback?.length ?? 0) >= 1) kinds.push('personalization');
  if ((bag.failingTargets?.length ?? 0) >= 1) kinds.push('prompt_patch');
  return kinds;
}

export async function tickThinker(
  state: ThinkerTriggerState,
  signals: SignalEnvelope[],
  bag: ThinkerInputBag,
  deps: ThinkerDeps,
): Promise<ThinkerTickResult> {
  const verdict = deps.trigger.evaluate(state, signals);
  if (!verdict.fire) {
    return { fired: false, reason: verdict.reason, outputs: [], attempted: [] };
  }

  const kinds = (deps.taskKindsFor ?? defaultTaskKindsFor)(bag);
  const outputs: ThinkerOutput[] = [];

  for (const kind of kinds) {
    const modelSpec = deps.selector.select(kind);
    try {
      if (kind === 'workflow_proposal') {
        outputs.push(await runWorkflowProposal(
          { cards: bag.cards, modelSpec, ...(deps.signal ? { signal: deps.signal } : {}) },
          deps.callable,
        ));
      } else if (kind === 'template_draft' && bag.routine) {
        outputs.push(await runTemplateDraft(
          {
            routine: bag.routine,
            recentCards: bag.cards,
            modelSpec,
            ...(deps.signal ? { signal: deps.signal } : {}),
          },
          deps.callable,
        ));
      } else if (kind === 'pattern_detect' && bag.routine) {
        outputs.push(await runPatternDetect(
          {
            routine: bag.routine,
            recentWorkflowNames: bag.recentWorkflowNames ?? [],
            modelSpec,
            ...(deps.signal ? { signal: deps.signal } : {}),
          },
          deps.callable,
        ));
      } else if (kind === 'personalization' && bag.intentFeedback && bag.intentFeedback.length > 0) {
        // Group by intentKind prefix (e.g. `tui.utterance` · `wrist`) — caller may provide explicit target via bag in the future.
        const target = bag.intentFeedback[0]!.intentKind.split('.').slice(0, 2).join('.');
        outputs.push(await runPersonalization(
          { target, feedback: bag.intentFeedback, modelSpec, ...(deps.signal ? { signal: deps.signal } : {}) },
          deps.callable,
        ));
      } else if (kind === 'prompt_patch' && bag.failingTargets && bag.failingTargets.length > 0) {
        for (const ft of bag.failingTargets) {
          outputs.push(await runPromptPatch(
            { ...ft, modelSpec, ...(deps.signal ? { signal: deps.signal } : {}) },
            deps.callable,
          ));
        }
      }
    } catch {
      // Per-task error must not abort the whole tick — caller logs via writer eventually.
    }
  }

  if (outputs.length > 0) {
    await deps.writer.persist(outputs);
  }

  return { fired: true, reason: verdict.reason, outputs, attempted: kinds };
}
