// ── 아크 분류 게이트 — 골 분해 → 자동 아크 부여 (RFC-mission-arcs·A2.5 · 2026-07-14) ──
//
// 골 분해가 만든 페이즈들을 deliverable/서브골 기준으로 아크(응집 그룹)로 묶는다. 그래야 A2
// 아크 배리어+통합 acceptance 가 실제로 작동한다(수동 arcs 부여 없이 신규 미션이 자동 아크).
//
// ★ 성패 = 과계층화 방지(대표). 보수적 기본 = single(flat 유지·회귀 0). 페이즈가 적거나(<5)
//   불확실하면 아크 안 씌운다. multi 는 이질 관심사가 명확히 여럿일 때만.
//   fail-soft: LLM 실패·파싱 실패·검증 실패 전부 single 폴백.
//
// 제1원칙 준수: 분류 결과를 debug.log('mission.arc.classify') 로 관측.

import { tierModel } from '../llm/model-defaults.js';
import { debug } from '../debug/log.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import { mintArcId, hasArcCycle, mergeTrivialArcChains, deriveArcGroups } from './mission-arc.js';

/** 분류 입력 페이즈 — 실 task.id 를 담아 아크 phaseIds 로 되돌린다. */
export interface ArcClassifyPhase {
  id: string;
  title: string;
  description?: string;
}

export interface ArcClassifyResult {
  arcModel: 'single' | 'multi';
  /** multi 일 때만 채워짐. single 은 [](flat 유지·decompose 가 저장 안 함). */
  arcs: MissionArc[];
  /** ★ arcHint 이탈(대표 2026-07-20) — 대표가 arcHint(≥2) 지정했는데 LLM 분류가 다른 수로 냈을 때
   *  채워짐. 카드/description 에 "지정 N → M(사유)" 표면화용. undefined = 이탈 없음/힌트 없음. */
  hintDeviation?: { requested: number; actual: number };
}

export interface ArcClassifyDeps {
  /** LLM 그룹핑(기본 streamLLM·sol). 테스트 주입·NODE_ENV=test 는 미주입 시 single. */
  classify?: (prompt: string) => Promise<string>;
  /** 멀티아크 고려 최소 페이즈 수(기본 5·이하면 무조건 single). */
  minPhasesForMulti?: number;
}

/** LLM 그룹핑 원시 형태(파싱 대상). */
interface RawArcGroup {
  name: string;
  intent: string;
  phases: number[]; // 1-based 페이즈 번호
  dependsOn: number[]; // 1-based 선행 아크 번호
  acceptance: string[];
}

/**
 * 그룹핑(1-based 페이즈/아크 번호)을 실 MissionArc[](task.id·arcId)로 변환 + 검증.
 * 순수 함수 — 단위테스트 대상. 검증 실패(커버리지·사이클·개수)면 null(호출측 single 폴백).
 */
export function deriveArcsFromGrouping(
  phases: readonly ArcClassifyPhase[],
  groups: readonly RawArcGroup[],
): MissionArc[] | null {
  if (groups.length < 2) return null; // 아크 1개 = single
  if (groups.length > 6) return null; // 과계층화 방지
  const arcIds = groups.map((g, i) => mintArcId(g.name || `arc${i}`, i));
  const covered = new Set<number>();
  const arcs: MissionArc[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const phaseIds: string[] = [];
    for (const pn of g.phases) {
      const idx = pn - 1;
      if (idx < 0 || idx >= phases.length) return null; // 잘못된 페이즈 번호
      if (covered.has(pn)) return null; // 중복 배정 — partition 위반
      covered.add(pn);
      phaseIds.push(phases[idx]!.id);
    }
    if (phaseIds.length === 0) return null; // 빈 아크 금지
    const dependsOnArcs = g.dependsOn
      .filter((n) => n >= 1 && n <= groups.length && n - 1 !== i)
      .map((n) => arcIds[n - 1]!);
    arcs.push({
      arcId: arcIds[i]!,
      name: (g.name || `아크 ${i + 1}`).slice(0, 60),
      intent: (g.intent || '').slice(0, 300),
      phaseIds,
      dependsOnArcs: [...new Set(dependsOnArcs)],
      acceptance: (g.acceptance ?? []).map((a) => a.slice(0, 300)).slice(0, 5),
      status: 'pending',
    });
  }
  if (covered.size !== phases.length) return null; // 전 페이즈 커버 안 됨(partition 위반)
  // ★ A7-L1 과분할 가드 — 단편화 1-페이즈 사슬 흡수 후 검증. 흡수로 단일 아크만 남으면 single(flat).
  const merged = mergeTrivialArcChains(arcs);
  if (merged.length < 2) return null; // 병합 후 1아크 = 단일 응집(flat 유지)
  if (hasArcCycle(merged)) return null; // 아크 순환 의존
  return merged;
}

const ARC_CLASSIFY_PROMPT = (goal: string, phases: readonly ArcClassifyPhase[], arcHint?: number): string => [
  '역할: 자율 미션의 페이즈들을 "아크"(응집 서브골·deliverable 기준 묶음)로 그룹핑한다.',
  '아크는 페이즈 로컬 검증이 놓치는 통합 정합성(dead-code/미배선)을 아크 경계에서 잡기 위한 계층이다.',
  '',
  `골: ${goal.slice(0, 400)}`,
  '',
  '페이즈(번호는 1-based):',
  ...phases.map((p, i) => `${i + 1}. ${p.title}`),
  '',
  '규칙(반드시 준수):',
  '- 보수적으로 판단하라. 페이즈들이 하나의 응집 산출물이면 아크를 나누지 말고 그룹 1개만 반환하라(과계층화 금지).',
  '- 이질적 deliverable(예: [관측 계약][게이팅][집행/검증])이 명확히 여럿일 때만 2~4개 아크로 나눠라.',
  '- 모든 페이즈를 정확히 하나의 아크에 배정하라(빠짐/중복 금지).',
  '- 각 아크에 통합 acceptance 2~3개: 그 아크의 페이즈 산출물이 실제로 연결/배선됐는지 검증하는 기준',
  '  (예: "observeX 가 lifecycle 에서 호출되고 통합 테스트로 덮인다"). "함수가 존재한다" 같은 로컬 기준 금지.',
  '- dependsOn: 선행 아크 번호(1-based). 사이클 금지.',
  // ★ arcHint 주입(대표 2026-07-20·soft) — 종전 프롬프트는 대표 선호 아크수를 몰라 무시했다. 힌트를
  //   주되 강제는 안 한다: 이질 관심사가 명확히 다르면 조정하고 사유를 첫 아크 intent 앞에 남긴다.
  ...(arcHint && arcHint >= 2 ? [
    '',
    `- ★ 대표 선호: 약 ${arcHint}개 아크. 특별한 이유(이질 관심사가 명확히 더 많거나 적음)가 없으면 ${arcHint}개로 맞춰라.`,
    `  ${arcHint}개에서 벗어나면 반드시 첫 아크 intent 맨 앞에 "[아크수 조정: ${arcHint}→실제수 — 사유]"를 남겨라(대표가 이탈을 안다).`,
  ] : []),
  '',
  'JSON 만 출력(설명 금지):',
  '{"arcs":[{"name":"...","intent":"...","phases":[1,2],"dependsOn":[],"acceptance":["...","..."]}]}',
  '아크가 1개면(단일 응집) {"arcs":[{...전 페이즈...}]} — 그러면 시스템이 flat 으로 처리한다.',
].join('\n');

/** LLM 응답에서 JSON 파싱 → RawArcGroup[]. 실패 null. */
function parseArcGrouping(raw: string): RawArcGroup[] | null {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]) as { arcs?: unknown };
    if (!Array.isArray(obj.arcs)) return null;
    return obj.arcs.map((a) => {
      const g = a as Record<string, unknown>;
      return {
        name: typeof g.name === 'string' ? g.name : '',
        intent: typeof g.intent === 'string' ? g.intent : '',
        phases: Array.isArray(g.phases) ? g.phases.filter((n): n is number => typeof n === 'number') : [],
        dependsOn: Array.isArray(g.dependsOn) ? g.dependsOn.filter((n): n is number => typeof n === 'number') : [],
        acceptance: Array.isArray(g.acceptance) ? g.acceptance.filter((s): s is string => typeof s === 'string') : [],
      };
    });
  } catch { return null; }
}

/**
 * 아크 분류 — 페이즈들을 아크로 그룹핑(자동 아크 부여). 보수적: 페이즈 적음·불확실·검증실패면 single.
 * single 은 arcs=[](flat 유지). multi 만 arcs 채움.
 */
export async function classifyArcs(
  input: { goal: string; phases: readonly ArcClassifyPhase[]; arcHint?: number },
  deps: ArcClassifyDeps = {},
): Promise<ArcClassifyResult> {
  // single 폴백 — 단, 대표가 확정한 arcHint(≥2)가 있으면 LLM 없이도 결정론 파생(#4498 3A·arcHint 존중).
  const fallback = (reason: string): ArcClassifyResult => {
    if (input.arcHint && input.arcHint >= 2) {
      const derived = deriveArcGroups(input.phases, input.arcHint);
      if (derived.length >= 2) {
        debug.log('mission.arc.classify', 'derived', { phases: input.phases.length, arcHint: input.arcHint, arcs: derived.length, reason });
        return { arcModel: 'multi', arcs: derived };
      }
    }
    debug.log('mission.arc.classify', 'single', { phases: input.phases.length, reason });
    return { arcModel: 'single', arcs: [] };
  };
  const minPhases = deps.minPhasesForMulti ?? 5;
  if (input.phases.length < minPhases) return fallback(`페이즈 ${input.phases.length}<${minPhases}(휴리스틱 게이트)`);
  const classify = deps.classify ?? (process.env.NODE_ENV === 'test' ? undefined : defaultArcClassify);
  if (!classify) return fallback('classify 미주입(test)');
  let raw: string;
  try { raw = await classify(ARC_CLASSIFY_PROMPT(input.goal, input.phases, input.arcHint)); }
  catch (e) { return fallback(`LLM 예외: ${e instanceof Error ? e.message.slice(0, 60) : ''}`); }
  const groups = parseArcGrouping(raw);
  if (!groups) return fallback('파싱 실패');
  const arcs = deriveArcsFromGrouping(input.phases, groups);
  if (!arcs) return fallback('검증 실패(커버리지/사이클/개수)');
  // ★ arcHint 이탈 관측(대표 2026-07-20) — LLM 이 대표 지정 arcHint 와 다른 수로 분류했을 때 logs.db 로
  //   남긴다(종전 무관측 — 대표는 "2 지정했는데 3 나옴"을 이유 없이 마주쳤다). 카드 표면화용 result 도 채움.
  const hintDeviation = input.arcHint && input.arcHint >= 2 && arcs.length !== input.arcHint
    ? { requested: input.arcHint, actual: arcs.length } : undefined;
  debug.log('mission.arc.classify', 'multi', {
    phases: input.phases.length, arcs: arcs.length, arcHint: input.arcHint ?? null,
    hintDeviation: !!hintDeviation, names: arcs.map((a) => a.name),
  });
  return { arcModel: 'multi', arcs, ...(hintDeviation ? { hintDeviation } : {}) };
}

/** 프로덕션 LLM classify — 분해/triage 와 동일 sol 리즈닝. */
async function defaultArcClassify(prompt: string): Promise<string> {
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const model = process.env.MONAD_ARC_CLASSIFY_MODEL || process.env.MONAD_DECOMPOSE_MODEL || tierModel('better');
  const provider = resolveDefaultProvider(model);
  return streamLLM([{ role: 'user', content: prompt }], () => {}, { model, reasoningEffort: 'medium', ...(provider ? { provider } : {}) });
}
