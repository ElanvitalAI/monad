// R6 Task 5 · §6.1 LLM-judge — hybrid composer (2026-05-09).
//
// keyword first → local LLM fallback. Most prompts (~70%) match a
// keyword pattern in <1ms; the remaining ambiguous slice is sent to
// the local model for a better-than-broadcast answer. The composer
// stays here so the daemon REST endpoint and any future consumer
// can share one entry point.

import {
  classifyWithLocalLlm,
  type LocalJudgeFailure,
  type LocalJudgeOpts,
  type LocalJudgeResult,
} from './local-judge.js';
import type { RoleLabel } from './prompt-template.js';

export type { RoleLabel };
export { buildJudgePromptMessages, parseJudgeReply } from './prompt-template.js';
export { classifyWithLocalLlm } from './local-judge.js';
export type { LocalJudgeFailure, LocalJudgeResult, LocalJudgeOpts };

export type ClassifySource = 'keyword' | 'local-llm' | 'fallback';

export interface HybridClassifyResult {
  /** The role we're confident about. `null` = no signal — caller
   *  broadcasts. */
  role: RoleLabel | null;
  /** Which tier produced the answer. `fallback` = keyword null +
   *  LLM judge failed (timeout / parse / network). */
  source: ClassifySource;
  /** Diagnostic — populated only when the LLM tier ran. */
  llm?: LocalJudgeResult | LocalJudgeFailure;
}

export interface HybridClassifyArgs {
  userPrompt: string;
  /** Required — caller provides the keyword classifier so we don't
   *  duplicate the table here. The PWA's `classifyPromptRole` is the
   *  canonical source; daemon side imports the same module. */
  keywordClassifier: (text: string) => RoleLabel | null;
  /** When true, route ambiguous prompts (keyword === null) to the
   *  local LLM. Caller (daemon REST handler) flips this off when
   *  `cfg.showroom.roleJudgeBackend !== 'local-llm'`. */
  useLocalLlm: boolean;
  /** Forwarded to `classifyWithLocalLlm`; only used when
   *  `useLocalLlm` is true. */
  localLlm?: LocalJudgeOpts;
}

/** Compose keyword + local-LLM tiers. Fast path: keyword hit returns
 *  immediately. Slow path (≤ ~200ms): keyword null AND local LLM
 *  enabled → ask the local model. Both paths are total — they always
 *  return a `HybridClassifyResult`. */
export async function hybridClassify(
  args: HybridClassifyArgs,
): Promise<HybridClassifyResult> {
  const keywordRole = args.keywordClassifier(args.userPrompt);
  if (keywordRole !== null) {
    return { role: keywordRole, source: 'keyword' };
  }
  if (!args.useLocalLlm || !args.localLlm) {
    return { role: null, source: 'fallback' };
  }
  const llm = await classifyWithLocalLlm(args.userPrompt, args.localLlm);
  if (llm.ok) {
    return { role: llm.role, source: 'local-llm', llm };
  }
  return { role: null, source: 'fallback', llm };
}
