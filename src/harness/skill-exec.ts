// 하니스 skill 자동 실행 (H3 실행형 · 상황부 seam · 2026-07-21)
//
// DESIGN §14f H3(상황부 seam: skill 실행). skill 힌트(skill-hint.ts·실행 안 함)의 **실행형** — objective 가
// allowlist skill 을 강하게 가리키면 그 skill 을 격리 실행(invokeResearch·Write/Edit deny)해 실제 출력을
// Planner grounding 에 얹는다("총동원" 북극성 인프라).
//
// ★★ 안전 경계 (조사 실측: executeSkill 은 무겁다 — 에이전트 배치 spawn·비용):
//   ① **allowlist** — 자동 실행은 read-only·경량·에이전트 배치 안 하는 skill 만(stochastic-*·*-panel·
//      consensus 류 제외). 나머지는 실행 안 함(skill-hint 가 힌트만 준다).
//   ② **격리** — invokeResearch 경유 = withResearchIsolation(Write/Edit/NotebookEdit deny). 부작용 봉쇄.
//   ③ **강한 게이트** — unambiguous + score>=2.0 + 명시 트리거 히트(설명 보너스만으론 안 뜸).
//   ④ **fail-soft** — 실패/빈 출력 = null(상위가 skill-hint 로 폴백·plan 안 막음).
//   ⚠️ omni-crawl 은 research seam 이 이미 커버 → allowlist 제외(중복 회피).
//   ⚠️ 코딩 objective 에선 트리거 빈도 낮음(대개 코드 변경) — 이는 북극성 "총동원" 인프라이지 상시 경로 아님.

import { detectSkillTrigger } from '../skills/router.js';
import type { SkillIndexEntry } from '../skills/index.js';
import { invokeResearch } from '../research-bridge/invoke.js';
import { SKILL_HINT_MIN_SCORE } from './skill-hint.js';

/** 하니스 plan 단계에서 **자동 실행** 허용된 skill 기본값 — read-only·경량·에이전트 배치 spawn 안 함.
 *  ⚠️ 확장 시 신중: Agent 배치/mutating/고비용 skill 금지. omni-crawl 은 research seam 이 커버(제외). */
export const HARNESS_EXEC_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  'omni-digest',   // URL/문서 요약(참조 자료 확보)
  'omni-market',   // 금융 데이터 조회(read-only)
  'kr-flow',       // 한국 시장 수급(read-only)
  // 📧 Gmail·Calendar·Drive·Sheets. ⚠️ ***읽기 전용이 «아니다»*** — 이 목록의 앞 셋과 다른 성질이다.
  //    ⛔ 그래서 SKILL.md 가 규율을 못 박았다: 사용자가 「보내라·잡아라·지워라」를 «명시»하지 않으면
  //       ***초안까지만*** 한다(메일 전송·일정 생성·삭제는 되돌릴 수 없다).
  //    📌 그 규율은 «프롬프트»에 있고 «코드»에 없다 — 다음 창이 조일 자리다.
  'google-workspace',
]);

/** ★ S2(autoTrigger 활성화·config-first·2026-07-22) — 자동실행 안전 규율 위반 skill 을 config 확장에서도
 *  거부하는 블록리스트 패턴. Agent 배치 spawn(다수 서브에이전트)·고비용·mutating 계열. 대표가 config 로
 *  allowlist 를 넓혀도 이 패턴은 강제 제외(안전 불변식). [[project_skill_router_triage_and_local_goalloop]] */
const HARNESS_EXEC_BLOCK_PATTERNS: readonly RegExp[] = [
  /stochastic/i,        // stochastic-multi-agent-consensus — N 에이전트 배치
  /-panel$/i,           // attractiveness-panel 등 — 10~12 페르소나 배치
  /consensus/i,         // *-consensus — 다수 에이전트 투표
];

/** 선언된 속성만으로 자동실행 안전한가(순수). 미선언은 false(보수 기본·fail-safe).
 * `SkillIndexEntry`의 선언값은 실행기와 같은 `parseSkillMd`가 같은 아티팩트에서 읽는다.
 * 선언은 skill 저자의 authorization 신호다. 읽기만 + 경량일 때만 true. */
export function isDeclaredAutoExecSafe(
  entry: Pick<SkillIndexEntry, 'sideEffects' | 'cost'>,
): boolean {
  return entry.sideEffects === 'none' && entry.cost === 'light';
}

/** config `skillRouter.harnessExecAllowlist`(추가 목록)와 선언 안전 인덱스를 기본 allowlist 에 병합한다.
 *  위험 패턴은 모든 편입 경로에서 강제 제외하고, 인덱스를 생략하면 종전 기본/config 동작을 유지한다.
 *  인덱스의 선언값은 실행기와 같은 `parseSkillMd` 산출이므로 `none` + `light` 항목만 자동 편입한다.
 *  onReject 로 블록 패턴 거부 사유를 관측한다(제1원칙). */
export function resolveHarnessExecAllowlist(
  extra?: readonly string[],
  onReject?: (skill: string, reason: string) => void,
  index?: readonly SkillIndexEntry[],
): ReadonlySet<string> {
  if ((!extra || extra.length === 0) && (!index || index.length === 0)) return HARNESS_EXEC_ALLOWLIST;
  const merged = new Set<string>(HARNESS_EXEC_ALLOWLIST);
  const addIfAllowed = (raw: string): void => {
    const name = raw.trim();
    if (!name) return;
    const blocked = HARNESS_EXEC_BLOCK_PATTERNS.find((p) => p.test(name));
    if (blocked) {
      onReject?.(name, `자동 실행 대상 아님: 블록패턴 ${blocked} (Agent 배치·고비용 자동실행 금지). 대신 skill-hint 경로를 사용하세요. 이 판정을 넓히려면 skillRouter.harnessExecAllowlist와 HARNESS_EXEC_BLOCK_PATTERNS를 검토하세요.`);
      return;
    }
    merged.add(name);
  };

  for (const name of extra ?? []) addIfAllowed(name);
  for (const candidate of index ?? []) {
    if (isDeclaredAutoExecSafe(candidate)) addIfAllowed(candidate.name);
  }
  return merged;
}

export interface SkillExecResult {
  skill: string;
  output: string;
}

/**
 * objective 가 allowlist skill 을 강하게·명확히 가리키면 그 skill 을 격리 실행해 출력을 반환(아니면 null).
 * @param index getSkillIndex 산출(호출측 주입·테스트=fake). @param invoke 실행기(기본 invokeResearch·테스트 주입).
 */
export async function execHarnessSkill(
  objective: string,
  index: readonly SkillIndexEntry[],
  invoke: (objective: string, skill: string) => Promise<{ ok: boolean; output: string }> =
    (obj, skill) => invokeResearch(obj, { skill }).then((r) => ({ ok: r.ok, output: r.output })),
  allowlist: ReadonlySet<string> = HARNESS_EXEC_ALLOWLIST,   // S2 — config 확장 주입(기본=하드코딩 3개·무회귀)
): Promise<SkillExecResult | null> {
  if (!objective.trim() || index.length === 0) return null;
  const detect = detectSkillTrigger(objective, index as SkillIndexEntry[]);
  const top = detect.top;
  if (!top || !detect.unambiguous) return null;                       // 모호 → 실행 안 함
  if (top.score < SKILL_HINT_MIN_SCORE) return null;                  // 약한 신호 → 실행 안 함
  if (!top.matchedTriggers || top.matchedTriggers.length === 0) return null; // 명시 트리거만
  if (!allowlist.has(top.name)) return null;                          // allowlist 밖 → 실행 안 함(hint 만)
  try {
    const r = await invoke(objective, top.name);
    if (!r.ok || !r.output.trim()) return null;
    return { skill: top.name, output: r.output };
  } catch {
    return null; // fail-soft
  }
}
