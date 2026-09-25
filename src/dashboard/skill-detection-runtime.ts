import {
  detectLLM,
  detectSkillTrigger,
  parseClassifierJson,
  type DetectResult,
  type LLMClassifyResult,
} from '../skills/router.js';
import type { SkillIndexEntry } from '../skills/index.js';
import type { SkillTier } from '../skills/runner.js';
import type { LLMMessage } from '../llm.js';

export interface DashboardSkillDetectionRuntimeDeps {
  llmFallback: boolean;
  keywordScoreThreshold: number;
  llmConfidenceThreshold: number;
  streamLLM: (
    messages: LLMMessage[],
    onDelta: (chunk: string, full: string) => void,
    opts: { signal?: AbortSignal; maxTokens?: number; temperature?: number },
  ) => Promise<string>;
  /** Active model tier — enables tier-aware full-menu LLM routing in
   *  detectLLM (T1 frontier models route the whole menu when keyword is
   *  weak/empty; weaker models stay tiebreaker-only). Undefined = legacy. */
  activeTier?: SkillTier;
  /** Min tier that unlocks full-menu routing (config skillRouter.fullMenuTier). */
  fullMenuTier?: SkillTier;
  /** Confidence floor for full-menu picks (config skillRouter.fullMenuConfidenceThreshold). */
  fullMenuConfidenceThreshold?: number;
  signal?: AbortSignal;
  detectKeyword?: typeof detectSkillTrigger;
  detectWithLLM?: typeof detectLLM;
  parseClassifier?: typeof parseClassifierJson;
}

const EMPTY_DETECTION: DetectResult = { candidates: [], top: null, unambiguous: false };

export interface AbortableDashboardSkillRouteDeps {
  attachKeys: (controller: AbortController) => () => void;
  detect: (signal: AbortSignal) => Promise<DetectResult>;
}

export async function runAbortableDashboardSkillRoute(
  { attachKeys, detect }: AbortableDashboardSkillRouteDeps,
): Promise<{ detection: DetectResult; aborted: boolean }> {
  const controller = new AbortController();
  const cleanup = attachKeys(controller);
  try {
    const detection = await detect(controller.signal);
    return { detection, aborted: controller.signal.aborted };
  } catch (error) {
    if (controller.signal.aborted) {
      return { detection: EMPTY_DETECTION, aborted: true };
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function detectDashboardSkillRoute(
  userText: string,
  visibleIndex: SkillIndexEntry[],
  deps: DashboardSkillDetectionRuntimeDeps,
): Promise<DetectResult> {
  const detectKeyword = deps.detectKeyword ?? detectSkillTrigger;
  const detectWithLLM = deps.detectWithLLM ?? detectLLM;
  const parseClassifier = deps.parseClassifier ?? parseClassifierJson;
  const keywordDetection = detectKeyword(userText, visibleIndex, {});
  if (!deps.llmFallback) return keywordDetection;

  const classify = async (prompt: string, signal?: AbortSignal): Promise<LLMClassifyResult> => {
    const raw = await deps.streamLLM(
      [{ role: 'user', content: prompt }],
      () => {},
      { signal, maxTokens: 120, temperature: 0 },
    );
    return parseClassifier(raw);
  };

  return detectWithLLM(userText, visibleIndex, {
    classify,
    keywordScoreThreshold: deps.keywordScoreThreshold,
    llmConfidenceThreshold: deps.llmConfidenceThreshold,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.activeTier ? { activeTier: deps.activeTier } : {}),
    ...(deps.fullMenuTier ? { fullMenuTier: deps.fullMenuTier } : {}),
    ...(deps.fullMenuConfidenceThreshold != null ? { fullMenuConfidenceThreshold: deps.fullMenuConfidenceThreshold } : {}),
  });
}
