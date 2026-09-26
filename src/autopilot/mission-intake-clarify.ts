// ── Mission Intake Q&A · clarify 게이트 순수 코어 ──────────────────────────────
// RFC-mission-intake-qa-agent-2026-07-16 (재설계 1단계). 일방 분해(골→바로 페이즈)를 되물어
// 설계를 확정하는 Q&A 로 바꾼다 — 모호도 gap 분석 → 옵션형 질문(최대3·추천 먼저) → 답변 fold →
// ConfirmedDesign(분해기 입력). armed 아님(순수 설계 단계·집행 0).
//
// ★ 패턴 = mission-redesign.ts 미러 — judge 주입 seam(테스트 격리)·순수 파서(단위테스트)·fail-soft
//   (LLM/파싱 오류는 "명확"=질문 0개로 보수 폴백해 기존 일방 분해로 진행·비파괴).
// ★ 이 모듈은 배선 없음(I1) — se-mission-prepare/hitl-callback 배선은 I2.

import { tierModel } from '../llm/model-defaults.js';
import { debug } from '../debug/log.js';
import {
  decideAndObserveClarification,
  defaultClarificationBudget,
  type ClarificationCandidate,
} from '../hitl/clarification-policy.js';
import { appendClarifyTrace } from './pipeline/clarify-trace.js';
import { applyChannelUpdate, effectiveArcHint, type MissionState } from './pipeline/mission-state-channels.js';

/** 되물을 질문 1개(codex request_user_input 옵션형 패턴). options=2~3 상호배타·추천 먼저. */
export interface IntakeClarification {
  questionId: string;                  // q1/q2/q3 — 콜백 매칭·dedup
  kind: 'scope' | 'arc' | 'term' | 'safety'; // 종류 → 블로킹 판정(scope/arc=설계 임계)
  header: string;                      // 짧은 칩 라벨(≤12자 권장)
  question: string;                    // 본 질문
  options: IntakeOption[];             // 2~3개·추천 먼저
  answer?: string;                     // 수집된 답(콜백·I2)
  blocking: boolean;                   // scope/arc = 블로킹(추측 진행 금지)
}
export interface IntakeOption { label: string; recommended?: boolean }

/** 되묻기 후 확정된 설계 — 분해기 입력(자유텍스트 아닌 구조화·codex plan_tool 패턴). */
export interface ConfirmedDesign {
  goal: string;
  arcHint?: number;                    // 확정 아크 수(자동/미응답이면 undefined)
  scope: string[];                     // 이번 미션 포함 범위
  excluded: string[];                  // 제외(후속 미션)
  notes: string[];                     // 용어 정의·안전 확인 등
  clarifications: IntakeClarification[]; // 원장(3박자 기록·감사)
}

// ★ 질문 수 상한 제거(대표 지시 2026-07-17) — 종전 3 고정은 sol 이 매번 3개를 꽉 채우게 만들어
//   "고정" 처럼 보였다. 이제 필요한 만큼(적게도·많게도) 생성한다. 아래 값은 설계 상한이 아니라
//   깨진 응답이 폭주하지 않게 하는 방어 backstop(파싱 안전판)일 뿐 — 프롬프트는 "필요한 만큼".
const QUESTION_PARSE_BACKSTOP = 12;
// ★ 아크 정책(대표 지시 2026-07-17) — 유일한 제약은 "아크당 페이즈 수"(4~5). 아크 총수 상한은
//   없다. 미션이 크면 아크가 크기에 비례해 얼마든지 늘어난다(5~7+ 정상). 종전 결정론
//   arcBoundaryOptions(estimatedPhases 하드코딩 8 → 항상 2아크·대안은 더 적은 쪽만)의 최소화
//   편향을 제거하고, 아크 수 판단을 terra judge 에 위임(골 크기·복잡도를 의미적으로 읽어 제안).
// (플랜 경량+정합·2026-07-19) 아크당 페이즈 수 약속(PHASES_PER_ARC_MIN/MAX) 제거 — 페이즈 수는
// 분해기가 골 복잡도에 맞춰 자동 결정. 아크 질문은 "몇 갈래 응집 흐름"(그룹핑)만 묻는다.

/** "N아크"/"N개 아크"/"N개(추천): …"/"자동" 라벨 → arcHint(자동/비숫자=undefined). 순수.
 *  ★ "개" 허용(2026-07-17 dogfood 버그) — sol judge 가 "6개 아크"로 라벨을 써서 종전 /(\d+)\s*아크/
 *  가 파싱 실패 → arcHint 미전달. "N개 아크"·"N 개 아크"·"N아크" 모두 인식.
 *  ★ 선두 "N개" 폴백(2026-07-19 라이브 dogfood 재발) — sol 이 옵션 라벨을 "5개(추천): 공통 문서…"
 *  처럼 써서 "아크"가 숫자에 인접하지 않으면 종전 정규식이 또 undefined → arcHint 소실 → flat 붕괴.
 *  parseArcAnswer 는 arc-kind 답에만 호출되므로(foldAnswersIntoDesign), 선두 숫자는 곧 아크 수다.
 *  "자동"/"auto"(숫자 없음)는 undefined 유지(분해기 위임). 상한 12(오파싱 방지). */
export function parseArcAnswer(answer: string | undefined): number | undefined {
  if (!answer) return undefined;
  const m = answer.match(/(\d+)\s*개?\s*아크/)  // 1) "N개 아크"/"N아크" (아크 인접)
    ?? answer.match(/^\s*(\d+)\s*개/);          // 2) 선두 "N개"(옵션 라벨 "5개(추천): …")
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : undefined;
}

/** kind → 블로킹 여부. scope/arc=설계 임계(추측 진행 금지·RFC §6 구현 기본값). term/safety=비블로킹. */
export function isBlockingKind(kind: IntakeClarification['kind']): boolean {
  return kind === 'scope' || kind === 'arc';
}

/** ★ 아크 되묻기 자율 진행 판정(2026-07-21·대표 지적 "되묻기 컨펌 후 아크를 또 물음") — 아크 단계
 *  질문이 clear single recommendation(모든 질문이 arc kind + 추천 옵션 정확히 1개)이면 카드(HITL) 없이
 *  추천 아크수를 자율 채택한다("전체 추천대로 진행"을 사람 탭 없이·조율자 관장). scope 는 대상 아님
 *  (경계 바꾸는 애매 질문=HITL 유지). arcHint 는 soft(LLM classify 가 최종 아크수 결정)라 무회귀.
 *  애매(추천 0개/복수)면 autoproceed=false(종전대로 카드). 순수 — 두 경로(se-mission-prepare stage2·
 *  mission-hitl-callback advanceClarifyStage) 공용 seam(#4855 가 후자를 우회당한 근본을 통합).
 *  explicitArcHint(CLI --arc-hint) 지정 시 그 값 우선(추천 파싱 대신). */
export interface ArcAutoproceedDecision {
  autoproceed: boolean;   // true = 카드 없이 자율 진행(HITL skip)
  arcHint?: number;       // 채택 아크수(explicit 우선·아니면 추천 라벨 parse·둘 다 없으면 undefined=LLM 재량)
}
export function decideArcAutoproceed(
  arcQuestions: readonly IntakeClarification[],
  explicitArcHint?: number,
): ArcAutoproceedDecision {
  if (arcQuestions.length === 0) return { autoproceed: false };
  const allArcClear = arcQuestions.every(
    (q) => q.kind === 'arc' && q.options.filter((o) => o.recommended).length === 1,
  );
  if (!allArcClear) return { autoproceed: false };
  let arcHint = explicitArcHint;
  if (arcHint === undefined) {
    for (const q of arcQuestions) {
      const n = parseArcAnswer(q.options.find((o) => o.recommended)?.label);
      if (n !== undefined && n >= 1) arcHint = n;
    }
  }
  return { autoproceed: true, ...(arcHint !== undefined ? { arcHint } : {}) };
}

/** 모호도 gap 분석 프롬프트. 명확하면 질문 0개(skip)·모호할 때만 옵션형 질문 생성. */
/** ★ 되묻기 단계(RFC P3·2단계 되묻기 2026-07-17) — 대표 지적: scope 답이 범위를 바꾸면 아크가
 *  달라지니 arc 는 범위 확정 뒤에 물어야 한다(순서 의존). 'scope'=1단계(scope/term/safety·arc 제외),
 *  'arc'=2단계(arc 만·확정 범위 컨텍스트 주입). 미지정('all')=레거시 단일턴(scope+arc 동시·비파괴 폴백). */
export type ClarifyPhase = 'scope' | 'arc' | 'all';

export function buildClarifyPrompt(
  goal: string,
  ctx: { groundContext?: string; researchContext?: string; heavy?: boolean; phase?: ClarifyPhase; confirmedScope?: string[]; feedback?: string; planAsRfc?: boolean } = {},
): string {
  const phase: ClarifyPhase = ctx.phase ?? 'all';
  const includeArc = (phase === 'arc' || phase === 'all') && ctx.heavy === true;
  const includeScope = phase === 'scope' || phase === 'all';
  const arcOnly = phase === 'arc';
  // ★ 플랜 경량+정합(대표 2026-07-19) — 아크는 "응집 그룹(deliverable 묶음)"의 개수만 정한다.
  //   종전엔 "아크당 4~5페이즈"를 약속해 5아크=20~25페이즈를 암시했으나, 실제 분해는 골 복잡도에
  //   맞춰 가볍게(플랜 힘빼기) 나온다 → 약속과 산출 불일치. 그래서 페이즈 수 약속을 제거하고,
  //   아크는 "몇 갈래의 응집 흐름으로 볼까"(그룹핑)만 묻는다. 페이즈 수는 분해기가 자동 결정.
  const arcGuide = [
    `  - arc: 이 골을 몇 갈래의 응집 아크(deliverable 묶음)로 볼지 제안한다.`,
    `         · 아크 = 통합 검증 경계(응집 산출물 단위). 페이즈 수는 약속하지 말라 —`,
    `           분해기가 골 복잡도에 맞춰 자동 결정한다(가벼우면 아크당 1~2페이즈일 수도 있다).`,
    `         · 골이 단일 응집이면 1개(자동)도 정상. 이질 관심사가 뚜렷하면 2~4개 권장.`,
    `         · 옵션: 추천(응집 흐름 수) + 대안(더 세분/더 압축) + "자동"(분해기 위임).`,
  ];
  return [
    '역할: 자율 미션 시스템의 "Intake Q&A" 에이전트. 골을 분해하기 **전에**, 이 골이 모호하거나',
    '범위가 과다/불명확하면 사람에게 되물어 설계를 확정한다. 목적은 어긋난 분해 예방.',
    // ★ R4 — planAsRfc 시 이 인터뷰는 RFC/설계문서를 쓰기 위한 것. 질문을 "설계 갭 채우기"로 지향
    //   (설계 선택·구조·제약·경계 결정). RFC-plan-as-rfc-generation §6(R4).
    ...(ctx.planAsRfc
      ? ['', '★ 이 Q&A 는 RFC/설계문서를 저작하기 위한 것이다. 설계에 꼭 필요한 미결정(설계 방향·구조 선택·제약·경계)만 물어 RFC 의 빈 섹션을 채워라 — 구현 디테일 말고 설계 결정.']
      : []),
    ...(arcOnly
      ? ['', '★ 이번 단계는 **아크 경계만** 정한다(범위/용어는 이미 확정됨). arc kind 질문만 내라(scope/term/safety 금지).']
      : []),
    '',
    '되물을 가치가 있는 것만(노이즈 금지). 명확한 골이면 질문 0개로 답한다(빈 배열).',
    '되묻는 축(있을 때만):',
    ...(includeScope ? ['  - scope: 범위/우선순위 불명(예: "A와 B 중 이번 범위는? A만/둘 다/B는 후속")'] : []),
    ...(includeArc ? arcGuide : []),
    ...(includeScope ? ['  - term: 판단 필요한 미정의 용어의 정의 확인.'] : []),
    ...(includeScope ? ['  - safety: 실집행/파괴/arming 이 항상 HITL 로 남는지 확인(자동 아님).'] : []),
    '규칙: 질문은 되물을 가치 있는 것만 필요한 만큼(고정 개수 아님·적게도 많게도·노이즈 금지).',
    '      옵션 2~3개(상호배타·추천 먼저). 명확하면 질문 0개. 확정에 꼭 필요한 것만 물어라(HITL 최종판단).',
    '',
    `## 골\n${goal.slice(0, 800)}`,
    ...(ctx.feedback ? ['', `## ★ 대표 직접 교정(반드시 반영해 질문/추천을 다시 만들어라)\n${ctx.feedback.slice(0, 500)}`] : []),
    ...(ctx.confirmedScope && ctx.confirmedScope.length ? ['', `## 확정 범위(1단계에서 확정 — 이 범위 기준으로 아크 판단)\n${ctx.confirmedScope.join('\n').slice(0, 400)}`] : []),
    ...(ctx.groundContext ? ['', `## grounding(기존 코드)\n${ctx.groundContext.slice(0, 600)}`] : []),
    ...(ctx.researchContext ? ['', `## 외부조사 보강\n${ctx.researchContext.slice(0, 400)}`] : []),
    '',
    'JSON 한 줄만(질문 없으면 []):',
    '[{"kind":"scope|arc|term|safety","header":"짧은라벨","question":"본질문",'
      + '"options":[{"label":"...","recommended":true},{"label":"..."}]}]',
  ].join('\n');
}

/** LLM 출력 → 질문 배열. 파싱 실패/빈 = [](명확·보수적 진행). 순수·필요한 만큼(backstop 방어)·옵션 정규화. */
export function parseClarifyResponse(raw: string): IntakeClarification[] {
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: IntakeClarification[] = [];
    for (const item of arr) {
      if (out.length >= QUESTION_PARSE_BACKSTOP) break;               // 방어 backstop(설계 상한 아님·폭주 방지)
      const o = item as { kind?: unknown; header?: unknown; question?: unknown; options?: unknown };
      const question = typeof o.question === 'string' ? o.question.trim() : '';
      if (!question) continue;
      const kind: IntakeClarification['kind'] =
        o.kind === 'arc' || o.kind === 'term' || o.kind === 'safety' ? o.kind : 'scope';
      const options = normalizeOptions(o.options);
      if (options.length < 2) continue;                               // 옵션 2개 미만은 질문 성립 X
      out.push({
        questionId: `q${out.length + 1}`,
        kind,
        header: typeof o.header === 'string' ? o.header.slice(0, 24) : kind,
        question: question.slice(0, 300),
        options,
        blocking: isBlockingKind(kind),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/** 옵션 배열 정규화 — label 필수·최대 3·추천 1개 이하(첫 추천만)·label 중복 제거. 순수. */
function normalizeOptions(raw: unknown): IntakeOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: IntakeOption[] = [];
  let recTaken = false;
  for (const it of raw) {
    if (out.length >= 3) break;
    const o = it as { label?: unknown; recommended?: unknown };
    // LLM 이 라벨에 "(추천)"/"(recommended)" 를 넣는 경우 제거(카드가 별도로 접미) — 중복 방지.
    const label = typeof o.label === 'string'
      ? o.label.trim().replace(/\s*[（(]\s*(추천|recommended)\s*[)）]\s*$/i, '').trim().slice(0, 40)
      : '';
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const recommended = o.recommended === true && !recTaken;
    if (recommended) recTaken = true;
    out.push(recommended ? { label, recommended: true } : { label });
  }
  return out;
}

// ★ 판단 모델 = sol(최고 리즈닝·대표 지시 2026-07-17) — 마름질(설계 확정 질문/추천)은 미션 전체
//   분해 방향을 좌우하는 최고-임팩트 판단이라 최상위 리즈닝 모델을 쓴다. sol=최고, terra=중간,
//   luna=경량. 종전 luna-low(2026-07-16)는 아크/범위를 최소로만 마름질했다 → sol + high 로 상향.
//   env override 유지. [[feedback_mission_fabric_llm_logic_balance_2026_07_16]] 갱신.
const INTAKE_JUDGE_MODEL = process.env.ELANOUS_INTAKE_MODEL || tierModel('better');
async function defaultJudge(prompt: string): Promise<string> {
  const { streamLLM } = await import('../llm.js');
  return streamLLM([{ role: 'user', content: prompt }], () => {}, {
    model: INTAKE_JUDGE_MODEL,
    reasoningEffort: 'high', // 설계 확정 판단 — sol/high(최고 리즈닝·대표 2026-07-17). 미션 전체 방향 좌우.
  });
}

export interface ClarifyDeps {
  judge?: (prompt: string) => Promise<string>;
  /** ★ 관측 컨텍스트(미션 id) — 있으면 sol 입출력을 clarify 트레이스 sidecar 로 남긴다("왜 범위 0개"). */
  missionId?: string;
  /** clarify 트레이스 sink(테스트 주입·기본 appendClarifyTrace). */
  traceSink?: (missionId: string, meta: import('./pipeline/clarify-trace.js').ClarifyTraceMeta, raw: { prompt: string; response: string }) => void;
}

/** ★ A(2단계 강제) fallback — heavy 미션의 범위 질문이 LLM 판단으로 0개일 때 기본 범위 확정 카드를
 *  주입해 "범위→아크 2단계" 순서를 보장한다(비결정성 대책). 옵션은 골 무관 일반형(추천=MVP 먼저)이나
 *  범위 단계 자체를 거치게 해 예측 가능성을 확보한다. 순수. */
export function fallbackScopeQuestion(): IntakeClarification {
  return {
    questionId: 'q1', kind: 'scope', header: '완료 범위', blocking: isBlockingKind('scope'),
    question: '이번 단계의 완료 범위를 어디까지로 확정할까요?',
    options: [
      { label: '핵심 흐름 먼저(MVP)·확장은 후속', recommended: true },
      { label: '전체 범위를 이번 단계에 구현' },
      { label: '코드 변경 없이 설계·계약만' },
    ],
  };
}

/** 골 모호도 gap 분석 → 옵션형 질문(0~3). fail-soft — LLM/파싱 오류는 [](명확 취급·일방 분해 폴백).
 *  judge 미주입(test)이면 []( 실 LLM 호출 방지·seam). */
function applyClarificationPolicy(
  questions: IntakeClarification[],
  missionId?: string,
): IntakeClarification[] {
  const budget = defaultClarificationBudget('intake');
  const accepted: IntakeClarification[] = [];
  for (const question of questions) {
    const candidate: ClarificationCandidate = {
      id: question.questionId,
      decision: `${question.kind} boundary for mission intake`,
      prompt: question.question,
      options: question.options.map((option) => ({
        label: option.label,
        description: option.recommended ? 'Recommended intake default.' : 'Alternative intake direction.',
        recommended: option.recommended,
      })),
      whyNow: question.blocking
        ? 'The answer changes the mission decomposition boundary.'
        : 'The answer changes the confirmed intake design.',
      impact: question.kind === 'safety' ? 'critical' : question.blocking ? 'high' : 'medium',
      replanTrigger: 'Revisit when mission scope or constraints materially change.',
    };
    const decision = decideAndObserveClarification(candidate, { phase: 'intake', budget }, {
      consumer: 'mission-intake', missionId,
    });
    if (decision.action !== 'ask') continue;
    accepted.push(question);
    budget.used += decision.budgetCost;
  }
  return accepted.map((question, index) => ({ ...question, questionId: `q${index + 1}` }));
}

export async function analyzeGoalAmbiguity(
  goal: string,
  ctx: { groundContext?: string; researchContext?: string; heavy?: boolean; phase?: ClarifyPhase; confirmedScope?: string[]; feedback?: string; forceScopeFallback?: boolean; planAsRfc?: boolean } = {},
  deps: ClarifyDeps = {},
): Promise<IntakeClarification[]> {
  try {
    const judge = deps.judge ?? (process.env.NODE_ENV === 'test' ? undefined : defaultJudge);
    if (!judge) return [];
    const prompt = buildClarifyPrompt(goal, ctx);
    const raw = await judge(prompt);
    let qs = parseClarifyResponse(raw);
    // ★ phase 안전망(P3) — LLM 이 지침을 어겨도 단계별 kind 를 강제. scope 단계=arc 제거,
    //   arc 단계=arc 만(scope/term/safety 제거). 순서 의존 불변식 보장.
    const phase = ctx.phase ?? 'all';
    if (phase === 'scope') qs = qs.filter((q) => q.kind !== 'arc');
    else if (phase === 'arc') qs = qs.filter((q) => q.kind === 'arc');
    // questionId 재부여(필터 후 q1..qn 연속).
    qs = qs.map((q, i) => ({ ...q, questionId: `q${i + 1}` }));
    // ★ 범위 fallback = opt-in(대표 결정 2026-07-18 "스킵+MAX2") — 종전엔 heavy 범위 0개면 fallback
    //   카드를 강제 삽입해 "2단계 보장(예측 가능성)"했으나, 이는 범위가 명확한데도 불필요한 왕복을 낳았다.
    //   대표는 "왕복 최소화(scope 0개면 arc 직행)"를 택함 → 기본은 skip(fallback 없음). se-mission-prepare
    //   의 "stage1 0개 → stage2 직행" 경로가 이제 실제로 산다. 예측 가능성이 필요하면 config
    //   autopilot.intakeForceScopeStage=true 로 forceScopeFallback 를 켜 종전 동작으로 복귀(비파괴).
    let fallback = false;
    if (phase === 'scope' && ctx.heavy === true && qs.length === 0 && ctx.forceScopeFallback === true) {
      qs = [fallbackScopeQuestion()];
      fallback = true;
      debug.log('mission.intake', 'scope-fallback', { heavy: true, phase, reason: 'forceScopeFallback=on → 2단계 보장' });
    }
    debug.log('mission.intake', qs.length ? 'clarify' : 'clear', {
      count: qs.length, kinds: qs.map((q) => q.kind), heavy: ctx.heavy === true, phase,
    });
    // ★ clarify 트레이스 sidecar(관측 보강) — sol 입출력 원문을 남겨 "왜 범위 0개(clear)/이 질문인가" 진단.
    if (deps.missionId) {
      const sink = deps.traceSink ?? (process.env.NODE_ENV === 'test' ? undefined : appendClarifyTrace);
      if (sink) sink(deps.missionId, {
        phase, count: qs.length, kinds: qs.map((q) => q.kind), heavy: ctx.heavy === true, fallback,
        promptChars: prompt.length, responseChars: raw.length, at: new Date().toISOString(),
      }, { prompt, response: raw });
    }
    return applyClarificationPolicy(qs, deps.missionId);
  } catch (e) {
    debug.log('mission.intake', 'error', { error: e instanceof Error ? e.message.slice(0, 120) : '' }, { level: 'error' });
    return [];
  }
}

/** 범위 답변에서 **제외/후속 절만** 추출(전체 답변 복제 방지·순수·에코 UX 수복 2026-07-22). 답변이
 *  "A까지 다루고, B는 후속" 처럼 콤마로 구분된 별도 제외 절을 가지면 그 절만 반환한다. 단일 절(전체가
 *  범위 서술)이거나 모든 절이 제외면 빈 문자열(범위=제외 중복 카드 방지). "·"는 목록 구분자라 절 경계 아님. */
export function extractExclusionClause(answer: string): string {
  const clauses = answer.split(/[,，、]| 및 | 그리고 /).map((s) => s.trim()).filter(Boolean);
  if (clauses.length < 2) return '';
  const excl = clauses.filter((c) => /후속|나중|다음|제외|exclude/i.test(c));
  if (!excl.length || excl.length === clauses.length) return '';
  return excl.join(' · ');
}

/** 수집된 답변을 확정 설계로 fold. 순수 — arc 답 → arcHint, scope/term/safety → scope/notes.
 *  미응답 질문은 추천 옵션으로 채운다(auto-resolve·codex 패턴). */
export function foldAnswersIntoDesign(goal: string, clarifications: IntakeClarification[]): ConfirmedDesign {
  const scope: string[] = [];
  const excluded: string[] = [];
  const notes: string[] = [];
  // ★ P1 라이브 배선(조율자 격상) — arcHint 를 append 리듀서 채널로 누적한다. 종전 LastValue 대입은
  //   여러 arc 답 중 뒤의 파싱 실패(undefined)가 앞의 유효 아크 수를 덮어 침묵 소실될 수 있었다
  //   (INCIDENT 손실체인 클래스). applyChannelUpdate(append)는 null/undefined 를 무시하므로 한 번
  //   유효 숫자가 들어오면 보존되고, effectiveArcHint 가 마지막 non-null 을 유효값으로 준다(구조적 차단).
  let arcHintState: MissionState = {};
  for (const c of clarifications) {
    const answer = c.answer ?? c.options.find((o) => o.recommended)?.label ?? c.options[0]?.label;
    if (!answer) continue;
    if (c.kind === 'arc') {
      arcHintState = applyChannelUpdate(arcHintState, 'arcHint', parseArcAnswer(answer));
    } else if (c.kind === 'scope') {
      // ★ 에코 UX 수복(대표 2026-07-22) — 종전엔 답변에 "후속/제외" 문자열이 있으면 **전체 답변**을 excluded
      //   로도 push 해, 확정 카드가 "- 범위: X · - 제외(후속): X" 로 **동일 텍스트를 중복 표시**했다(선택
      //   에코 결함·라이브 실측: "…까지만 다루고, 유사 레거시는 후속" 이 "후속" 매칭으로 범위=제외 중복).
      //   범위 답변은 이미 "~까지만·나머지는 후속" 식으로 결정을 온전히 서술하므로 중복 복제하지 않는다.
      //   excluded 는 범위와 **구별되는 제외 절**이 있을 때만 그 절만 담는다(전체 답변 복제 금지).
      scope.push(`${c.header}: ${answer}`);
      const exclClause = extractExclusionClause(answer);
      if (exclClause) excluded.push(`${c.header}: ${exclClause}`);
    } else {
      notes.push(`${c.header}: ${answer}`);
    }
  }
  const arcHint = effectiveArcHint(arcHintState); // append 이력의 마지막 non-null(손실 차단)
  return {
    goal,
    ...(arcHint !== undefined ? { arcHint } : {}),
    scope,
    excluded,
    notes,
    clarifications,
  };
}

/** 확정 설계 → 분해기 reviseContext 문자열(기존 --comment 재분해 경로 재사용). 순수. */
export function formatDesignAsDecomposeContext(design: ConfirmedDesign): string {
  const lines = ['[Intake 확정 설계 — 이 설계 기준으로 분해]'];
  if (design.arcHint !== undefined) lines.push(`- 아크 수: ${design.arcHint}개`);
  if (design.scope.length) lines.push(`- 범위: ${design.scope.join(' · ')}`);
  if (design.excluded.length) lines.push(`- 제외(후속): ${design.excluded.join(' · ')}`);
  if (design.notes.length) lines.push(`- 확인: ${design.notes.join(' · ')}`);
  return lines.join('\n');
}

/** 아직 답 안 온 블로킹 질문이 있나 — 있으면 분해 진행 금지(카드 대기). 순수. */
export function hasUnansweredBlocking(clarifications: readonly IntakeClarification[]): boolean {
  return clarifications.some((c) => c.blocking && !c.answer);
}

// ── 텔레그램 옵션 카드 · 콜백(순수·I2 배선이 소비) ────────────────────────────
// callback_data = `apm-clarify:<token>:<qid>:<optIdx>` (token=미션 hitl hash6·≤64자).
export const CLARIFY_CALLBACK_PREFIX = 'apm-clarify';

/** 콜백 데이터 조립(옵션 답변). 순수. */
export function clarifyCallbackData(token: string, questionId: string, optIdx: number): string {
  return `${CLARIFY_CALLBACK_PREFIX}:${token}:${questionId}:${optIdx}`;
}

/** "이대로 진행" 콜백 데이터 — 미답 비블로킹은 추천값 auto-resolve(I3b). 순수. */
export function clarifyProceedData(token: string): string {
  return `${CLARIFY_CALLBACK_PREFIX}:${token}:go`;
}

/** ★ "직접 수정" 콜백 데이터(RFC P4·자유 피드백 2026-07-17) — 탭 시 force-reply 로 자유 교정 입력. 순수. */
export function clarifyEditData(token: string): string {
  return `${CLARIFY_CALLBACK_PREFIX}:${token}:edit`;
}

export type ClarifyCallback =
  | { token: string; kind: 'answer'; questionId: string; optIdx: number }
  | { token: string; kind: 'proceed' }
  | { token: string; kind: 'edit' };

/** 콜백 데이터 파싱(답변 or 진행 or 직접수정). 형식 불일치=null(형제 핸들러 stomp 방지). 순수. */
export function parseClarifyCallbackData(data: string): ClarifyCallback | null {
  const go = data.match(/^apm-clarify:([^:]+):go$/);
  if (go) return { token: go[1]!, kind: 'proceed' };
  const ed = data.match(/^apm-clarify:([^:]+):edit$/);
  if (ed) return { token: ed[1]!, kind: 'edit' };
  const m = data.match(/^apm-clarify:([^:]+):(q\d+):(\d+)$/);
  if (!m) return null;
  const optIdx = Number(m[3]);
  if (!Number.isInteger(optIdx) || optIdx < 0) return null;
  return { token: m[1]!, kind: 'answer', questionId: m[2]!, optIdx };
}

/** 모든 질문이 답변됐나(블로킹+비블로킹). 순수. */
export function allAnswered(clarifications: readonly IntakeClarification[]): boolean {
  return clarifications.every((c) => !!c.answer);
}

export interface ClarifyMessage { questionId: string; text: string; buttons: { text: string; data: string }[][] }

/** 옵션 순번 → keycap 이모지(1️⃣2️⃣3️⃣…). ★ 대표 2026-07-16 — 원문자(①②③·흑백·작음)는 텔레그램에서
 *  너무 작아 keycap 이모지(컬러·큼)로 교체(가독성). 5 초과는 "N." 폴백. 순수. */
const CIRCLED = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
function circled(i: number): string { return CIRCLED[i] ?? `${i + 1}.`; }

/** ★ I3d(2026-07-16 dogfood·대표 제안) — 옵션을 질문 텍스트에 1️⃣2️⃣3️⃣로 나열하고 버튼은 짧은 번호만.
 *  긴 라벨 truncation 근본 해소(버튼=번호라 안 잘림·한 줄에 다 들어감). 질문 하나당 메시지 하나
 *  (편집이 그 질문만 건드림). control = "전체 추천대로 진행"(미답=추천값 fold·블로킹 포함). 순수. */
export function buildClarifyMessages(
  clarifications: readonly IntakeClarification[],
  token: string,
): { questions: ClarifyMessage[]; control: { text: string; buttons: { text: string; data: string }[][] } } {
  const total = clarifications.length;
  const questions: ClarifyMessage[] = clarifications.map((c, qi) => {
    const tag = c.blocking ? '[필수] ' : '';
    const optLines = c.options.map((o, oi) => `${circled(oi)} ${o.label}${o.recommended ? '  ✅추천' : ''}`);
    const text = [
      `🤔 되묻기 ${qi + 1}/${total} ${tag}· ${c.header}`,
      c.question,
      '',
      ...optLines,
      '',
      '↓ 번호를 누르세요',
    ].join('\n');
    // 짧은 번호 버튼 한 줄(안 잘림). 추천은 ✅ 접미.
    const buttons = [c.options.map((o, oi) => ({
      text: o.recommended ? `${circled(oi)}✅` : circled(oi),
      data: clarifyCallbackData(token, c.questionId, oi),
    }))];
    return { questionId: c.questionId, text, buttons };
  });
  const blockingCount = clarifications.filter((c) => c.blocking).length;
  const control = {
    text: [
      `🤔 미션 설계 확인 — 되묻기 ${total}개${blockingCount ? ` ([필수] ${blockingCount})` : ''}`,
      '각 질문의 번호를 누르면 반영됩니다. 다 정하면 아래 [선택대로 진행].',
      '그냥 추천값대로 바로 갈 거면 [전체 추천대로 진행].',
      '추천안을 고치고 싶으면 [✏️ 직접 수정] — 바꿀 점을 답장으로 주면 다시 마름질합니다.',
    ].join('\n'),
    buttons: [
      [{ text: '🚀 전체 추천대로 진행', data: clarifyProceedData(token) }],
      [{ text: '✏️ 직접 수정', data: clarifyEditData(token) }],
    ],
  };
  return { questions, control };
}

/** 답변 완료된 질문 메시지의 편집 텍스트(버튼은 editMessageText 가 제거). 순수. */
export function buildAnsweredText(c: IntakeClarification, qIndex: number, total: number): string {
  return `✓ 되묻기 ${qIndex + 1}/${total} · ${c.header}\n${c.question}\n\n✅ 선택: ${c.answer ?? '(추천값)'}`;
}
