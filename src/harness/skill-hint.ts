// 하니스 결정론 skill 힌트 (H3 · 상황부 seam · 2026-07-21)
//
// DESIGN-cross-surface-autonomy-membrane §14f H3(상황부 seam: skill). objective 의 **explicit 트리거**가
// 특정 skill 을 강하게·명확히 가리키면 Planner grounding 에 힌트 1줄을 얹어 Executor 가 그 도메인 지식을
// 인지하게 한다.
//
// ★ 왜 "실행"이 아니라 "힌트"인가 (조사 실측):
//   - executeSkill 은 무겁다(에이전트 배치 spawn·stochastic-* 류는 10~12 에이전트). 하니스 plan 단계에서
//     임의 skill 을 돌리면 비용/부작용 폭발 → 강한 allowlist 필요. H3 의 값은 "이 작업에 X skill 관련"이라는
//     **힌트**이고, 그건 index+router 로 실행 없이 충분히 얻는다(비용 0·부작용 0·offline-safe).
//   - luna 의미매칭(groundMissionInSkills)이 이미 skillFacts 를 grounding 에 제공하나, **LLM 호출**이라
//     실패/오프라인 가능. 이 결정론 트리거 매칭은 그 **cost-0 보완축**(explicit 트리거 히트는 luna 가 놓쳐도 잡음).
//
// ★ 실행 안 함 — executeSkill 무접촉. detectSkillTrigger(순수 함수)만.

import { detectSkillTrigger } from '../skills/router.js';
import type { SkillIndexEntry } from '../skills/index.js';

/** shouldAutoRoute 와 동일 임계(session 21·오탐 방지). 단일 explicit 트리거(1.0)로는 안 뜬다. */
export const SKILL_HINT_MIN_SCORE = 2.0;

/**
 * objective 의 explicit 트리거가 skill 을 강하게·명확히 가리킬 때만 grounding 힌트 1줄(아니면 null).
 * 보수 게이트: top 존재 + unambiguous(단독 최고점) + score>=2.0 + **명시 트리거 히트**(설명-단어 보너스만으론
 * 안 뜸). 순수 함수 — index 는 호출측이 getSkillIndex 로 로드해 주입(테스트는 fake index).
 */
export function buildSkillHint(objective: string, index: readonly SkillIndexEntry[]): string | null {
  if (!objective.trim() || index.length === 0) return null;
  const detect = detectSkillTrigger(objective, index as SkillIndexEntry[]);
  const top = detect.top;
  if (!top || !detect.unambiguous) return null;
  if (top.score < SKILL_HINT_MIN_SCORE) return null;
  if (!top.matchedTriggers || top.matchedTriggers.length === 0) return null; // 명시 트리거만(오탐 차단)
  const desc = (top.description ?? '').slice(0, 160).trim();
  return `[skill 힌트(결정론 트리거)] '${top.name}'${desc ? ` — ${desc}` : ''} (참고 — 필요 시 이 skill 의 접근/도구를 고려)`;
}
