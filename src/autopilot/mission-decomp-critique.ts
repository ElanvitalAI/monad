// ── 분해 비평기 (사전·빌드 前) — RFC-decomposition-critique-feedback-loop §3a·D1 ──
//
// 반-인플레이션 사다리의 페이즈 고도 rung. 골 분해가 만든 페이즈들을 **빌드 예산 태우기 전에** 적대적
// 으로 비평한다(별 세션 = 분해기와 다른 시선). a6230f 라이브 증거: "복수 지표 국면+관측 품질"(과대·
// 계산+품질 혼재)·"품질 원인 구별·보존"(미명세·단위 결손 처리 규칙 미정)이 빌드 10회·2 split·교착으로
// 사후 발견됐다. 사전 비평이 이걸 빌드 前에 잡는다.
//
// 4렌즈(하나라도 강하면 ok 아님):
//   1. 단일책임  — 관심사 ≥2 섞였나(계산+품질). → over_scope(split 제안).
//   2. 명세완성  — acceptance가 실행가능·구체적인가. 미명세(의미론 결손) → under_specified(clarify).
//   3. 재사용근거 — 지목 자산이 실존하나(grounded·adaptiveGround). 없으면 → ungrounded(mirage류).
//   4. 스코프현실성 — 한 에이전트 실행으로 완주가능한가. 과대 → over_scope(narrow/split).
//
// A7-L2 preflightArc(아크 고도)와 같은 계열·페이즈 고도. grounded=adaptiveGround(코드 실존).
// fail-soft — ground/LLM/파싱 오류는 ok/minor(도구 실패로 실작업 자동 차단 X·HITL 게이트가 통제).
// 제1원칙: 비평을 debug.log('mission.decomp.critique')로 관측.

import { debug } from '../debug/log.js';
import { adaptiveGround } from './mission-grounding-ladder.js';
import { exploreReuseExistence, extractSearchTokens, formatExistenceMap, groundingDirs, classifyUngroundedOverride, type ReuseExistence } from './reuse-existence-explorer.js';
import { recordMissionObservation, type ObservationSinks } from './mission-observation.js';
import { appendCritiqueTrace } from './pipeline/critique-trace.js';
import { tierModel } from '../llm/model-defaults.js';

export type PhaseCritiqueVerdict = 'ok' | 'over_scope' | 'under_specified' | 'ungrounded';

/** 비평 대상 페이즈 — decompose 산출(title·prompt·acceptance). */
export interface DecompCritiquePhase {
  id: string;
  title: string;
  prompt: string;
  acceptance: string[];
  /** ★ 선행 의존 페이즈 id(dependsOn) — 비평기 사전정보(축③): 이 페이즈가 소비하는 계약의 출처를
   *  상류 페이즈 acceptance 에서 확보해 "여기 인라인 안 된 계약은 정상(고립 판정 말라)"으로 인지. */
  dependsOn?: readonly string[];
}

/** 상류 의존 페이즈 요약(비평 프롬프트 주입용·순수). */
export interface UpstreamPhaseContext { title: string; acceptance: readonly string[] }

/** ★ E0 하류 의존 de-escalate 판정(대표 2026-07-18·제로 흠결→good-enough). 순수·결정론.
 *  구현/검증 페이즈가 소비하는 심볼이 [전무]여도, dependsOn 상류가 걸려 있으면(같은 미션서 산출 예정·
 *  구현이 이어짐) critical 이 아니다 — 플랜 시점 [전무]는 정상이고, "생성·경로·형식 완벽 계약"까지 요구하는
 *  것은 제로 흠결 과잉이다(dogfood 실측: analysis-matrix.json·ContentRecord [전무]를 critical 로 오판해
 *  자동 되먹임이 헛돌았다). 완벽한 플랜은 불가·구현에서 바로잡는다(대표 2026-07-18). verdict 는 유지하고
 *  severity 만 minor 로 완화(#4526 오탐필터 동형·verdict 불변=무회귀). dependsOn 없이 [전무] 소비(고아
 *  의존)는 진짜 미충족이므로 critical 유지.
 *  ★ 확장(대표 2026-07-20·"구현서 쉽게 수습할 것에 힘 빼지 마라") — under_specified(미명세·세부 명세 부재:
 *  확인 토큰 필드·계약 세부·API 시그니처 등)도 dependsOn 상류가 있으면 구현 페이즈가 그 세부를 정의하므로
 *  플랜 시점 critical 아님. 종전 ungrounded 만 완화 → 미명세 치명이 coevolve 자동정련을 헛돌림(라이브 실측
 *  8분·"구현 페이즈인데 확인토큰 명세 없음"을 치명 판정). gate dependsOn defer 와 동형. 상류 없으면 유지. */
export function shouldDeescalateDownstreamDep(
  verdict: PhaseCritiqueVerdict, severity: 'critical' | 'minor', upstreamCount: number,
): boolean {
  return (verdict === 'ungrounded' || verdict === 'under_specified') && severity === 'critical' && upstreamCount > 0;
}

/** ★ 실존 심볼 재구현 de-escalate(대표 2026-07-19·"구현 시 바로잡을 수 있으면 사실만 기록·pass").
 *  [실존] 심볼을 "신설/재구현"하라는 지적(ungrounded critical·중복 재구현)은 진짜 결손이 아니라 구현
 *  시점에 "재사용으로 정정"하면 되는 것 — 완전 차단은 비용>이득. 비평은 그 사실(실존·재사용 권장)을
 *  reason 에 기록하고 severity 만 minor(pass). verdict 유지(무회귀). existsCount>0 = 이 페이즈가 지목한
 *  심볼 중 이미 실존하는 게 있음 → 구현 시 재사용으로 바로잡음. */
export function shouldDeescalateExistingReuse(
  verdict: PhaseCritiqueVerdict, severity: 'critical' | 'minor', existsCount: number,
): boolean {
  return verdict === 'ungrounded' && severity === 'critical' && existsCount > 0;
}

export interface PhaseCritique {
  phaseId: string;
  phaseTitle: string;
  verdict: PhaseCritiqueVerdict;
  severity: 'critical' | 'minor';
  /** 단일책임 렌즈 — 섞인 관심사(≥2면 over_scope). */
  concerns: string[];
  reason: string;
  /** 정련 제안(split/narrow/clarify). */
  suggestion: string;
  /** under_specified 일 때 — 빌드 前 명확화가 필요한 질문(치명이면 HITL 카드). */
  needsClarification?: string;
}

export interface DecompCritiqueResult {
  critiques: PhaseCritique[];
  /** 치명(critical) 비평이 하나라도 있나 — HITL 카드 트리거. */
  hasCritical: boolean;
}

export interface DecompCritiqueDeps {
  /** 코드 grounding(기본 adaptiveGround). 테스트 주입. files=이 미션이 발견한 파일(실존맵 검색 공간 재사용). */
  ground?: (query: string, ctx: { acceptance?: string[] }) => Promise<{ context: string; grounded: boolean; confidence: string; files?: string[] }>;
  /** 적대적 비평 LLM(기본 별 세션·opus/sol). 테스트 주입·NODE_ENV=test 미주입 시 ok. */
  judge?: (prompt: string) => Promise<string>;
  /** ★ 결정론 재사용-실존 검증(기본 exploreReuseExistence·ripgrep). 페이즈가 지목한 심볼이 이미
   *  실존/완성인지 git grep 실측으로 판정 — "이미 구현된 걸 재구현"(grounding 상실)을 빌드 前 자기인지.
   *  테스트는 이 seam 주입으로 fs 미접촉. */
  existenceCheck?: (boundaries: readonly string[]) => ReuseExistence[];
  /** ★ 관측 컨텍스트(미션 id) — 있으면 실존 감지를 통합 관측 관문(recordMissionObservation)으로도
   *  흘려 `elanous ops`·self-memory 에 남긴다("왜 grounding 잃었나" 회상 가능). 없으면 로그만. */
  missionId?: string;
  /** 관측 sink seam(테스트 주입). */
  observationSinks?: ObservationSinks;
  repoRoot?: string;
  /** ★ 실존 검사 토큰 상한(config autopilot.critiqueExistenceCap·기본 8). 실재 파일이 상한 밖으로
   *  밀려 [전무] 오판되는 걸 막으려 상향(ripgrep-core 수렴으로 rg 비용 감소). */
  existenceCap?: number;
  /** ★ critique 트레이스 sidecar 기록(sol 입출력 원문·오탐 진단). missionId 있을 때만. 기본 ON. */
  traceSink?: (missionId: string, meta: import('./pipeline/critique-trace.js').CritiqueTraceMeta, raw: { prompt: string; response: string }) => void;
  /** ★ 병렬 비평 동시성 캡(config autopilot.critiqueConcurrency·기본 4). sol rate limit 방어·순서 보존. */
  concurrency?: number;
  /** ★ 비평 모델(config·기본 gpt-5.6-terra) — trace 에 실제 모델 기록(라벨 하드코딩 버그 수복). */
  critiqueModel?: string;
  /** ★ 라운드 태그(critiquePhaseDecomposition 이 주입) — 재분해 누적 trace 를 라운드로 격리. */
  runId?: string;
}

/** 재사용-실존 요약(순수) — critique 프롬프트 주입 + 관측용. exists=이미 코드에 있음(재구현 시 중복). */
export interface ReuseExistenceSummary {
  map: string;
  existsCount: number;
  total: number;
  /** 이미 실존하는 심볼 경계(중복 재구현 위험 신호). */
  existing: ReuseExistence[];
  /** ★ 전체 실존 판정(exists/similar/absent) — ungrounded 결정론 오탐 필터가 absent 케이스((b))에 접근. */
  all: ReuseExistence[];
  /** 토큰 상한 초과로 검사에서 누락된 심볼 수(무음 절단 금지·관측에 표기). */
  dropped: number;
}

/** 페이즈가 지목한 코드 심볼의 결정론 실존 맵 산출(fail-soft·상한 8토큰). prompt+acceptance 에서
 *  코드 식별자를 뽑아 exploreReuseExistence 로 실존@위치 판정. 빈 결과면 null(무주입). */
export function checkReuseExistence(
  phase: DecompCritiquePhase,
  existenceCheck: (boundaries: readonly string[]) => ReuseExistence[],
  cap = 8,
): ReuseExistenceSummary | null {
  try {
    // prompt+acceptance 에서 코드 식별자 토큰 추출(reuse-existence-explorer 의 추출기 재사용).
    const text = [phase.prompt, ...phase.acceptance].join('\n');
    const tokens = extractSearchTokens(text);
    if (!tokens.length) return null;
    // rg 호출 비용 상한(빌드-前·페이즈마다) — 초과분은 관측에 표기(무음 절단 금지). ripgrep-core 수렴으로
    // rg 가 빨라져 상향 안전(config autopilot.critiqueExistenceCap). 실재 파일이 상한 밖으로 밀려 [전무]
    // 오판되는 걸 막으려면 페이즈 토큰 수 이상으로.
    const CAP = Math.max(1, cap);
    const checked = tokens.slice(0, CAP);
    const dropped = Math.max(0, tokens.length - CAP);
    const existence = existenceCheck(checked);
    const existing = existence.filter((e) => e.status === 'exists');
    return { map: formatExistenceMap(existence), existsCount: existing.length, total: existence.length, existing, all: existence, dropped };
  } catch { return null; }
}

/** LLM 출력 → 페이즈 비평(순수·파싱 실패는 ok/minor). */
export function parsePhaseCritique(raw: string, phaseId: string, phaseTitle: string): PhaseCritique {
  const base = { phaseId, phaseTitle, concerns: [] as string[] };
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ...base, verdict: 'ok', severity: 'minor', reason: '비평 파싱 실패(보수적 ok)', suggestion: '' };
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const verdict: PhaseCritiqueVerdict =
      o.verdict === 'over_scope' || o.verdict === 'under_specified' || o.verdict === 'ungrounded' ? o.verdict : 'ok';
    const severity: 'critical' | 'minor' = o.severity === 'critical' && verdict !== 'ok' ? 'critical' : 'minor';
    const concerns = Array.isArray(o.concerns) ? o.concerns.map((c) => String(c).slice(0, 120)).slice(0, 6) : [];
    const nc = typeof o.needsClarification === 'string' ? o.needsClarification.slice(0, 300) : '';
    const reason = typeof o.reason === 'string' ? o.reason.slice(0, 300) : '';
    const suggestion = typeof o.suggestion === 'string' ? o.suggestion.slice(0, 300) : '';
    // ★ 오탐필터 3(2026-07-19 dogfood 발견) — critical 인데 근거가 전무(reason·concerns·suggestion·
    //   needsClarification 4필드 모두 빈)한 판정은 실체 없는 노이즈다(실측: under_specified·critical 인데
    //   4필드 전부 공백이 6분 coevolve 재분해를 트리거·granularity 과공격과 동류). 무근거 critical 은
    //   행동 불가(무엇을 고칠지 없음)이므로 severity 만 minor 로 강등한다 — verdict 유지·무회귀·established
    //   오탐필터 패턴([[feedback_optimization_adoption_criteria_accuracy_no_regression]]).
    const hasJustification = reason.trim().length > 0 || concerns.length > 0 || suggestion.trim().length > 0 || nc.trim().length > 0;
    const effectiveSeverity: 'critical' | 'minor' = verdict === 'ok'
      ? 'minor'
      : (severity === 'critical' && !hasJustification ? 'minor' : severity);
    return {
      ...base,
      verdict,
      severity: effectiveSeverity,
      concerns,
      reason,
      suggestion,
      ...(verdict === 'under_specified' && nc ? { needsClarification: nc } : {}),
    };
  } catch {
    return { ...base, verdict: 'ok', severity: 'minor', reason: '비평 오류(보수적 ok)', suggestion: '' };
  }
}

function buildCritiquePrompt(
  phase: DecompCritiquePhase, siblingTitles: readonly string[], groundContext: string,
  reuse: ReuseExistenceSummary | null, upstream: readonly UpstreamPhaseContext[] = [],
): string {
  // ★ 사전정보(축③·2026-07-18) — 이 페이즈의 dependsOn 상류 페이즈가 정의하는 계약을 비평기에 알려줘
  //   고립 판정을 막는다. "이 페이즈가 소비하는 계약이 상류에 정의되면 여기 인라인 안 된 것은 정상."
  const upstreamBlock = upstream.length
    ? [
        '',
        '## 선행 의존(dependsOn)이 정의하는 계약 — 이 페이즈가 소비하는 값의 출처',
        ...upstream.slice(0, 8).map((u) => `- [${u.title}] ${u.acceptance.slice(0, 4).join(' / ').slice(0, 300)}`),
        '★ 이 페이즈가 소비(재사용/의존/배선/인용)하는 계약이 위 상류 페이즈에 정의되면, 여기 인라인 안 된 것은',
        '  정상이다 — 고립 판정(관심사 혼재·미명세) 하지 마라. under_specified 는 상류로도 못 메우는 이 페이즈',
        '  고유 결손(예: 이 페이즈가 스스로 정할 입력 도메인·경계)일 때만.',
      ].join('\n')
    : '';

  // ★ 결정론 실존 맵(git grep 실측) — LLM 추론이 아니라 실측. 재사용근거 렌즈를 양방향으로 무장.
  const existenceBlock = reuse
    ? [
        '',
        `## 결정론 재사용-실존 맵 (git grep 실측 — 추론 아님·[실존]=이미 코드에 있음)`,
        reuse.map.slice(0, 1200),
        reuse.dropped > 0 ? `(심볼 ${reuse.dropped}개는 상한 초과로 미검사)` : '',
      ].filter(Boolean).join('\n')
    : '';
  return [
    '역할: 자율 미션의 골 분해가 만든 "페이즈" 하나를 **빌드 예산을 쓰기 전에** 적대적으로 비평한다.',
    '너는 분해기와 다른 시선이다 — 분해기의 낙관을 견제하라. 애매하면 ok(HITL·빌드가 최종 판단).',
    '4렌즈(하나라도 강하게 위배되면 ok 아님):',
    '  1. 단일책임 — 이 페이즈가 관심사 2개 이상을 섞었나? (예: "계산 + 품질검증"을 한 페이즈에).',
    '     섞였으면 verdict=over_scope, concerns 에 섞인 관심사 나열, suggestion 에 어떻게 쪼갤지.',
    '  2. 명세완성 — **먼저 이 페이즈의 종류(kind)를 판별하고 종류별 기준으로 평가하라(과민 금지·kind 부적합 요구 배제):**',
    '     · 조사/설계/계약 페이즈(제목·지시가 "조사/설계/정의"가 목적): 다뤄야 할 항목(필드·상태·경계·규칙)이',
    '       acceptance 에 **열거**되면 명세 충분(ok). 그 항목의 **구체 값이 아직 안 정해진 것은 이 페이즈가 산출할',
    '       결과**이지 결손이 아니다 — "구체 값이 미리 정해져 있어야 한다"고 요구하지 마라(설계 결과를 선요구=부당).',
    '       under_specified 는 다뤄야 할 항목 자체가 빠졌을 때만.',
    '     · 구현/검증 페이즈(제목·지시가 "구현/작성/배선/검증"이 목적): 결정론적 실행·테스트가 가능하도록 입력',
    '       도메인·오류 타입·경계값·성공조건이 구체적이어야 한다. 모호하면 verdict=under_specified.',
    '       ★ 단 severity 는 plan-time vs impl-time 으로 구분하라(대표 2026-07-19·발산 방지·제로 흠결 과잉 금지):',
    '         - critical = 무엇을 만드는지/성공조건 자체가 불명, 또는 다뤄야 할 책임이 통째로 빠짐(설계 결손).',
    '         - minor(구현 시 확정 메모) = 구현 메커닉 디테일(정확한 API 호출 순서·payload 필드명·에러 메시지',
    '           문구·정확한 timeout 값 등)만 미정 — 플랜 시 확정 불가한 것은 메모로 남기고 구현에서 결정한다.',
    '           이런 impl-detail 미정을 critical 로 막지 마라(완벽 플랜 불가·구현이 바로잡음). "Telegram 과 동일",',
    '           "기존 X 계약 재사용/미러" 처럼 이관·참조 지점이 있으면 under_specified 라도 severity=minor.',
    '     · (예: 구현 페이즈가 "품질 보존"인데 결손 처리 정책 자체가 없으면 critical, 정책은 있고 정확한 임계값만',
    '       미정이면 minor 메모. 설계 페이즈가 "노트 스키마를 설계"면 필드값 미정은 산출물이라 ok.)',
    '     · under_specified 면 needsClarification 에 빌드 前 확정 질문(단 impl-detail 은 구현 메모로 넘겨라).',
    '  3. 재사용근거 — **아래 결정론 실존 맵을 반드시 대조하라(LLM 추측 말고 실측 기준):**',
    '     ★ [전무]를 무조건 ungrounded 로 보지 마라. 그 [전무] 심볼에 대한 이 페이즈의 "역할"을 먼저 판별하라:',
    '       (가) 이 페이즈가 그것을 **산출(정의/작성/구현/생성)**하는가 → [전무]는 아직 안 만든 자기 산출물이라',
    '            **정상(ungrounded 아님)**. 상류가 아직 안 만든 것을 이 페이즈가 만드는 것은 허상이 아니다.',
    '       (나) 이 페이즈가 그것을 **소비(재사용/확장/인용/의존/호출/배선)**하는데 [전무] — 두 갈래로 판별하라:',
    '            · 그 [전무] 심볼이 위 "선행 의존(dependsOn)이 정의하는 계약"에 있으면(선행 페이즈가 산출) →',
    '              **정상(ungrounded 아님)**. 파이프라인 순서상 빌드 시 dependsOn 선행이 먼저 생성한다 — 배선·통합',
    '              검증 페이즈가 선행 산출물을 아직 [전무]인 상태에서 전제하는 것은 정상(빌드가 순서대로 채운다).',
    '            · dependsOn 선행 계약에도 없는 **진짜 외부/미충족 의존**이면 → verdict=ungrounded(reason 에 명시).',
    '     · 지목 심볼이 [실존]인데 페이즈가 그것을 "신설/재구현/추가/작성"하라 → verdict=ungrounded',
    '       (**중복** — 이미 코드에 있음. reason 에 실존 위치 명시·"재구현 아니라 재사용/배선"으로 정정 제안).',
    '     · "확장/배선/수정"이 [실존] 심볼을 대상으로 함은 정상(ungrounded 아님).',
    '     ※ 한 페이즈가 일부 [전무]는 산출(가)·일부 [전무]는 소비(나)면, 소비 쪽 미충족만으로 ungrounded 판정 가능.',
    '  4. 스코프현실성 — 한 에이전트 실행(수백 턴)으로 완주가능한가? 별도 미션급이면 verdict=over_scope.',
    'severity: ★대표 2026-07-19 — **구현 시 바로잡을 수 있으면 사실만 기록하고 minor(pass)**. 완전한 플랜은',
    '  불가하고 구현서 정정 가능한 게 많다 — 비평이 그걸 critical 로 막지 마라(발산·빌드예산 낭비 유발).',
    '  · minor(사실 기록·pass) = impl-detail 미정(API순서·payload·timeout)·**[실존] 심볼 재구현(재사용으로**',
    '    **정정 가능·reason 에 "실존·재사용" 명시)**·소비 순서(dependsOn 상류 있음)·경미한 개선여지.',
    '  · critical(빌드 前 필수) = **진짜 설계 결손만** — 무엇을 만드는지/성공조건 자체가 불명, 다뤄야 할 책임이',
    '    통째로 빠짐, 별도 미션급 과대(over_scope), 상류/dependsOn 어디에도 없는 진짜 고아 의존.',
    '  애매하면 minor(구현서 정정). critical 은 정말 빌드해선 안 될 때만.',
    '',
    `## 페이즈\n제목: ${phase.title}\n지시: ${phase.prompt.slice(0, 1200)}`,
    `acceptance: ${phase.acceptance.length ? phase.acceptance.join(' / ').slice(0, 500) : '(없음 — 미명세 신호)'}`,
    existenceBlock,
    '',
    `## 같은 미션의 다른 페이즈(맥락)\n${siblingTitles.slice(0, 20).map((t) => `- ${t}`).join('\n')}`,
    upstreamBlock,
    '',
    `## grounding(이 페이즈가 지목한 자산의 실존 여부·관련 코드)\n${groundContext.slice(0, 2500)}`,
    '',
    'JSON 한 줄만: {"verdict":"ok|over_scope|under_specified|ungrounded","severity":"critical|minor",',
    '  "concerns":["섞인 관심사"],"reason":"한 줄 근거","suggestion":"정련 제안(split/narrow/clarify)",',
    '  "needsClarification":"under_specified 일 때 빌드 前 확정 질문(아니면 생략)"}',
  ].join('\n');
}

async function defaultJudge(prompt: string, critiqueModel?: string): Promise<string> {
  // ★ reviseClassifyDefault 패턴 — resolveDefaultProvider 로 provider 명시(안 하면 미해결 모델은
  //   streamLLM 이 라우팅 실패). ★ 기본 terra(대표 2026-07-18) — critique 는 검증/판정(생성 아님)·실존맵
  //   결정론이 근거·HITL 최종·병렬 20개. 상위 게이팅(decomp-gate)도 terra 라 일관. config 로 sol 복귀 가능.
  const { streamLLM, resolveDefaultProvider } = await import('../llm.js');
  const model = process.env.ELANOUS_DECOMP_CRITIQUE_MODEL || critiqueModel || process.env.ELANOUS_DECOMPOSE_MODEL || tierModel('balanced');
  const provider = resolveDefaultProvider(model);
  return streamLLM([{ role: 'user', content: prompt }], () => {}, { model, reasoningEffort: 'medium', ...(provider ? { provider } : {}) });
}

async function defaultGround(query: string, ctx: { acceptance?: string[] }): Promise<{ context: string; grounded: boolean; confidence: string; files?: string[] }> {
  const g = await adaptiveGround(query, ctx.acceptance ? { acceptance: ctx.acceptance } : {});
  // ★ files 전달(대표 2026-07-18) — grounding 이 발견한 파일을 실존맵 검색 공간으로 재사용(오픈 월드).
  return { context: g.context, grounded: g.grounded, confidence: g.confidence, files: g.files };
}

/** 페이즈 1개 적대적 비평. fail-soft — 도구 오류는 ok/minor. */
export async function critiquePhase(
  phase: DecompCritiquePhase, siblingTitles: readonly string[], deps: DecompCritiqueDeps = {},
  upstream: readonly UpstreamPhaseContext[] = [],
): Promise<PhaseCritique> {
  const okFallback = (reason: string): PhaseCritique => ({ phaseId: phase.id, phaseTitle: phase.title, verdict: 'ok', severity: 'minor', concerns: [], reason, suggestion: '' });
  try {
    // ★ 비평 모델 결정(대표 2026-07-18·계층 재정립) — 기본 terra(개별 반복 판정). config/env 오버라이드.
    //   실제 모델을 trace 에 기록해 CLI 표시 정확성 확보(라벨 하드코딩 버그 수복).
    const model = deps.critiqueModel || process.env.ELANOUS_DECOMP_CRITIQUE_MODEL || tierModel('balanced');
    const judge = deps.judge ?? (process.env.NODE_ENV === 'test' ? undefined : ((p: string) => defaultJudge(p, model)));
    if (!judge) return okFallback('judge 미주입(test) — 보수적 ok');
    const ground = deps.ground ?? defaultGround;
    const g = await ground(`[페이즈: ${phase.title}] ${phase.prompt.slice(0, 400)}`, { acceptance: phase.acceptance });
    // ★ 결정론 재사용-실존 검증(자기인지) — 지목 심볼이 이미 실존/완성인지 git grep 실측. "이미 구현된
    //   걸 재구현"(grounding 상실·미션 668871 실패모드)을 빌드 前에 자기감지. LLM 추론 앞에 실측을 둔다.
    // ★ grounding 발견 공간 재사용(대표 2026-07-18 근본) — 공간을 미리 하드코딩하지 않고, 이 미션이
    //   조사에서 touch 한 파일(g.files)의 디렉토리를 실존맵 검색 공간에 더한다(스킬·.elanous·유저 어디든).
    const groundRoots = g.files?.length ? groundingDirs(g.files) : [];
    const existenceCheck = deps.existenceCheck ?? (process.env.NODE_ENV === 'test' ? undefined : ((b: readonly string[]) => exploreReuseExistence(b, groundRoots.length ? { extraRoots: groundRoots } : {})));
    const reuse = existenceCheck ? checkReuseExistence(phase, existenceCheck, deps.existenceCap) : null;
    const prompt = buildCritiquePrompt(phase, siblingTitles, g.context, reuse, upstream);
    const raw = await judge(prompt);
    const c = parsePhaseCritique(raw, phase.id, phase.title);
    // ★ ungrounded 결정론 오탐 필터(대표 2026-07-18·정확도 개선) — LLM verdict=ungrounded 일 때만, 결정론
    //   실존맵이 ungrounded 의 전제(허상/중복)를 명백히 반증하면 override(애매하면 무변경=LLM 존중). 다른
    //   verdict 엔 무영향 → "기존보다 나빠지지 않음" 불변. override 는 반드시 관측(제1원칙).
    let override: ReturnType<typeof classifyUngroundedOverride> | null = null;
    if (c.verdict === 'ungrounded' && c.severity === 'critical' && reuse) {
      override = classifyUngroundedOverride({ phaseText: [phase.title, phase.prompt, ...phase.acceptance].join(' '), existence: reuse.all });
      if (override.action === 'downgrade') {
        // verdict(ungrounded)는 유지·severity 만 minor(빌드차단 해제). verdict 는 절대 안 바꿈 → 무회귀.
        c.severity = 'minor';
        c.reason = `[결정론 오탐필터] ${override.reason} (원 LLM: ${c.reason.slice(0, 120)})`;
      } else {
        override = null; // none — 무변경(LLM 존중).
      }
    }
    // ★ E0 하류 의존 de-escalate(대표 2026-07-18·제로 흠결→good-enough) — #4526 오탐필터(실존맵 허상
    //   반증)가 안 잡은 ungrounded critical 이라도, dependsOn 상류가 있으면 소비 산출물은 같은 미션서
    //   이어짐(플랜 시점 미완 정상). severity 만 minor(치명 해제)·verdict 유지·관측. 이로써 자동 되먹임
    //   (coevolve·critical 카운트)이 하류 의존을 헛되이 좇지 않고 good-enough 에서 멈춘다. 고아([전무]+
    //   dependsOn 없음)는 critical 유지. override(#4526)와 배타(이미 완화됐으면 skip).
    if (!override && shouldDeescalateDownstreamDep(c.verdict, c.severity, upstream.length)) {
      c.severity = 'minor';
      c.reason = `[하류 의존·good-enough] dependsOn 상류 ${upstream.length}건 — 소비 산출물은 구현서 이어짐(플랜 시점 미완 정상). (원 LLM: ${c.reason.slice(0, 100)})`;
      debug.log('mission.decomp.critique', 'downstream-dep-deescalate', {
        phaseId: phase.id, title: phase.title.slice(0, 40), upstream: upstream.length, verdict: c.verdict, newSeverity: c.severity,
      });
    }
    // ★ 실존 심볼 재구현 de-escalate(대표 2026-07-19) — [실존] 재구현 지적(ungrounded critical·중복)은
    //   구현 시 재사용으로 정정하면 되므로 note-and-pass(minor). 비평은 "실존·재사용" 사실만 기록·통과.
    //   앞의 override(#4526)/downstream-dep 로 이미 완화됐으면 skip. reuse 실존 심볼 있을 때만.
    if (!override && c.severity === 'critical' && reuse && shouldDeescalateExistingReuse(c.verdict, c.severity, reuse.existsCount)) {
      c.severity = 'minor';
      c.reason = `[실존 재사용·good-enough] 지목 심볼 중 ${reuse.existsCount}건 이미 실존 — 재구현 말고 재사용(구현 시 정정). (원 LLM: ${c.reason.slice(0, 100)})`;
      c.suggestion = c.suggestion || '실존 심볼을 import·재사용하도록 구현 시 정정(신설 금지).';
      debug.log('mission.decomp.critique', 'existing-reuse-deescalate', {
        phaseId: phase.id, title: phase.title.slice(0, 40), existsCount: reuse.existsCount, verdict: c.verdict, newSeverity: c.severity,
      });
    }
    if (override) {
      debug.log('mission.decomp.critique', 'ungrounded-override', {
        phaseId: phase.id, title: phase.title.slice(0, 40), action: override.action, kind: override.kind,
        existsCount: reuse!.existsCount, total: reuse!.total, newVerdict: c.verdict, newSeverity: c.severity,
      });
    }
    debug.log('mission.decomp.critique', c.verdict, {
      phaseId: phase.id, title: phase.title.slice(0, 40), severity: c.severity,
      concerns: c.concerns.slice(0, 3), reason: c.reason.slice(0, 100),
      ...(reuse ? { reuseExists: reuse.existsCount, reuseTotal: reuse.total, reuseDropped: reuse.dropped } : {}),
    });
    // ★ critique 트레이스 sidecar(관측 보강·제1원칙) — sol 이 받은 실존맵·프롬프트와 응답 원문을 남겨
    //   "sol 이 [실존] 실측을 받고도 왜 ungrounded 냈나"를 사후에 직접 본다(LLM 층 오탐 진단의 열쇠).
    if (deps.missionId) {
      const sink = deps.traceSink ?? ((process.env.NODE_ENV === 'test') ? undefined : appendCritiqueTrace);
      if (sink) sink(deps.missionId, {
        phaseId: phase.id, title: phase.title.slice(0, 60), verdict: c.verdict, severity: c.severity,
        reuseMap: reuse?.map.slice(0, 1500) ?? '', existsCount: reuse?.existsCount ?? 0, total: reuse?.total ?? 0,
        dropped: reuse?.dropped ?? 0, groundConfidence: g.confidence, model, runId: deps.runId ?? '',
        ...(override ? { override: override.kind } : {}),
        promptChars: prompt.length, responseChars: raw.length, at: new Date().toISOString(),
      }, { prompt, response: raw });
    }
    // ★ 관측 파리티(제1원칙·관측 관문) — 지목 심볼이 이미 실존(중복 재구현 위험)이거나 critique 가
    //   ungrounded critical 이면 통합 관문으로 흘려 `elanous ops`·self-memory 에 남긴다("왜 grounding
    //   잃었나" 회상). 빌드-前 단계가 raw debug.log 만 남기던 관측 갭 해소. missionId 있을 때만.
    if (deps.missionId && (c.verdict === 'ungrounded' || (reuse && reuse.existsCount > 0))) {
      recordMissionObservation({
        missionId: deps.missionId, phaseId: phase.id, phaseTitle: phase.title,
        stage: 'diagnose',
        verdict: c.verdict === 'ungrounded' ? 'fail' : 'event',
        rationale: c.verdict === 'ungrounded'
          ? `분해 비평 ungrounded(${c.severity}) — ${c.reason.slice(0, 140)}`
          : `재사용 지목 심볼 ${reuse!.existsCount}/${reuse!.total}건 이미 실존(중복 재구현 위험·자기인지)`,
        ...(reuse && reuse.existsCount > 0 ? { missing: reuse.existing.map((e) => `[실존] ${e.boundary}${e.locations[0] ? `@${e.locations[0]}` : ''}`).join(' · ').slice(0, 300) } : {}),
        refs: { verdict: c.verdict, severity: c.severity, ...(reuse ? { reuseExists: reuse.existsCount, reuseTotal: reuse.total } : {}) },
      }, deps.observationSinks ?? {});
    }
    return c;
  } catch (e) {
    debug.log('mission.decomp.critique', 'error', { phaseId: phase.id, error: e instanceof Error ? e.message.slice(0, 120) : '' }, { level: 'error' });
    return okFallback('비평 오류(fail-soft·ok)');
  }
}

/** 전 페이즈 사전 분해 비평 → 결과. hasCritical 이면 호출측(prepare)이 HITL 카드로 노출. */
export async function critiquePhaseDecomposition(
  phases: readonly DecompCritiquePhase[], deps: DecompCritiqueDeps = {},
): Promise<DecompCritiqueResult> {
  const titles = phases.map((p) => p.title);
  // ★ 병렬 비평(대표 2026-07-18) — 각 페이즈 critiquePhase 는 독립(siblingTitles 읽기만·공유 상태 없음)
  //   이라 worker pool 로 병렬화(20페이즈 순차 → 동시). 순서 보존(배열 인덱스). 동시성 캡(concurrency)
  //   으로 rate limit 방어. eval-scenario-cli worker pool 패턴 재사용. cap<=1 이면 순차(폴백).
  // ★ runId(라운드 태그) — 한 호출=한 라운드. 재분해 누적 trace 를 라운드로 격리(CLI 최신만 표시).
  const runDeps: DecompCritiqueDeps = { ...deps, runId: deps.runId ?? new Date().toISOString() };
  const concurrency = Math.max(1, deps.concurrency ?? 4);
  const critiques = new Array<PhaseCritique>(phases.length);
  // ★ 사전정보(축③) — 페이즈 id → 페이즈 맵. 각 페이즈의 dependsOn 을 상류 페이즈 {title,acceptance}로 resolve.
  const byId = new Map(phases.map((p) => [p.id, p]));
  const upstreamOf = (p: DecompCritiquePhase): UpstreamPhaseContext[] =>
    (p.dependsOn ?? []).map((id) => byId.get(id)).filter((u): u is DecompCritiquePhase => !!u)
      .map((u) => ({ title: u.title, acceptance: u.acceptance }));
  let nextIdx = 0;
  const pump = async (): Promise<void> => {
    for (;;) {
      const idx = nextIdx++;
      if (idx >= phases.length) return;
      critiques[idx] = await critiquePhase(phases[idx]!, titles, runDeps, upstreamOf(phases[idx]!));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, phases.length) }, () => pump()));
  return { critiques, hasCritical: critiques.some((c) => c.severity === 'critical') };
}

/** HITL 카드/알림용 요약(순수) — critical 비평만. 비면 ''. */
export function formatCritiqueForHitl(result: DecompCritiqueResult): string {
  const crit = result.critiques.filter((c) => c.severity === 'critical');
  if (!crit.length) return '';
  const label = (v: PhaseCritiqueVerdict) =>
    v === 'over_scope' ? '과대(관심사 혼재)' : v === 'under_specified' ? '미명세' : v === 'ungrounded' ? '근거부족(허상)' : '';
  const lines = [`⚠️ 분해 비평 — 빌드 前 정련 권장 (치명 ${crit.length}건):`];
  for (const c of crit) {
    lines.push(`  • [${label(c.verdict)}] ${c.phaseTitle}`);
    if (c.concerns.length) lines.push(`     관심사: ${c.concerns.join(' + ')}`);
    if (c.reason) lines.push(`     근거: ${c.reason.slice(0, 120)}`);
    if (c.suggestion) lines.push(`     제안: ${c.suggestion.slice(0, 120)}`);
    if (c.needsClarification) lines.push(`     ❓ 확정 필요: ${c.needsClarification.slice(0, 120)}`);
  }
  lines.push('  → split/narrow/clarify 후 빌드(빌드 예산 낭비·교착 사전 방지)');
  return lines.join('\n');
}

/** ★ HITL 카드용 1줄 비평 요약(대표 2026-07-19·리포트 장황함 해소) — 카드엔 개수·유형만,
 *  치명 상세(페이즈·근거·제안)는 첨부 문서 + `pipeline --sub critique` 로. 없으면 ''. 순수. */
export function formatCritiqueSummaryLine(result: DecompCritiqueResult): string {
  const crit = result.critiques.filter((c) => c.severity === 'critical');
  if (!crit.length) return '';
  const by = (v: PhaseCritiqueVerdict) => crit.filter((c) => c.verdict === v).length;
  const parts: string[] = [];
  if (by('under_specified')) parts.push(`미명세 ${by('under_specified')}`);
  if (by('ungrounded')) parts.push(`근거부족 ${by('ungrounded')}`);
  if (by('over_scope')) parts.push(`과대 ${by('over_scope')}`);
  return `⚠️ 비평 치명 ${crit.length}건 (${parts.join('·')}) — 상세는 첨부/pipeline --sub critique`;
}
