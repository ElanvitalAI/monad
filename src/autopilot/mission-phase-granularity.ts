// ── 페이즈 granularity 수치 게이트 (결정론·사전필터) — RFC-decomposition-critique §3a·D2 ──
//
// D1 분해 비평기(LLM·적대적)의 짝. 이건 **결정론 수치 휴리스틱**이라 LLM 없이도 항상 도는 값싼
// 사전필터다(스킬-카운트·ai-task-manager 패턴). 양방향 게이팅:
//   too_large  — 관심사(스킬) ≥ 임계 → split (a6230f "계산+품질" 같은 혼재)
//   too_small  — 사소·1-step → 인접 병합 후보 (과분할 방지·A7-L1 mergeTrivialArcChains 의 페이즈판)
//
// 스킬-카운트 = 제목+지시에 나타난 **서로 다른 관심사 클래스** 수(조사/설계/구현/계산/검증/운영).
// ≥3 이면 단일책임 위배 신호. 제1원칙: 관측은 호출측(prepare)이 debug.log 로.

export type GranularityVerdict = 'ok' | 'too_large' | 'too_small';

export interface PhaseGranularityGrade {
  phaseId: string;
  phaseTitle: string;
  verdict: GranularityVerdict;
  /** 서로 다른 관심사 클래스 수(스킬-카운트). ≥3 → too_large 신호. */
  skillCount: number;
  /** 감지된 관심사 클래스(예: ['compute','verify']). */
  concerns: string[];
  /** acceptance criteria 수. */
  acceptanceCount: number;
  /** 제목의 결합 접속(그리고·및·+·· 등) 수. */
  conjunctions: number;
  reason: string;
}

export interface GranularityInput {
  id: string;
  title: string;
  prompt: string;
  acceptance: string[];
}

/** 관심사 클래스 → 신호 키워드(한/영). 한 페이즈가 여러 클래스를 건드리면 스킬-카운트↑. */
const CONCERN_KEYWORDS: Record<string, string[]> = {
  investigate: ['조사', '분석', '파악', '매핑', '탐색', 'investigate', 'analyze', 'map'],
  design: ['설계', '정의', '타입', '스키마', '계약', '명세', '구조', 'design', 'define', 'schema', 'type', 'contract'],
  implement: ['구현', '배선', '추가', '작성', '생성', '연결', '이관', 'implement', 'wire', 'add', 'build', 'create'],
  compute: ['계산', '산출', '판정', '정규화', '벡터', '점수', '집계', 'compute', 'calculate', 'score', 'aggregate'],
  verify: ['검증', '테스트', '회귀', '비평', '품질', '정합', 'verify', 'test', 'regression', 'quality', 'validate'],
  operate: ['등록', '집행', '배포', '스케줄', '크론', '실행', '주문', 'schedule', 'cron', 'deploy', 'execute', 'order'],
};

const CONJUNCTION_RE = /그리고|및|·|\+|,|\band\b/g;

/** 텍스트에서 서로 다른 관심사 클래스 감지(순수). */
export function detectConcerns(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  for (const [cls, kws] of Object.entries(CONCERN_KEYWORDS)) {
    if (kws.some((k) => t.includes(k.toLowerCase()))) found.push(cls);
  }
  return found;
}

/** 페이즈 1개 granularity 등급(순수·결정론). */
export function gradePhaseGranularity(phase: GranularityInput): PhaseGranularityGrade {
  const concerns = detectConcerns(`${phase.title} ${phase.prompt.slice(0, 800)}`);
  const skillCount = concerns.length;
  const acceptanceCount = phase.acceptance.length;
  const conjunctions = (phase.title.match(CONJUNCTION_RE) ?? []).length;

  // ★ too_large(과대) 게이트 제거(대표 2026-07-19) — 플랜 경량 원칙(굵은 페이즈는 의도적)과 정면 충돌하는
  //   오탐 노이즈. skillCount≥3 등 휴리스틱이 정상적으로 굵은 조사/구현 페이즈를 "과대→split"으로
  //   오분류해 HITL 카드·로그 노이즈만 만들고 플랜 정련엔 무의미했다(feedback_granularity_gate_over_aggressive).
  //   coevolve 재분해는 critique 치명(내용 기반)만 트리거하므로 과대 제거가 그 경로에 영향 없음. 과소만 유지.
  const tooLarge = false;
  // too_small: 관심사 ≤1 AND acceptance ≤1 AND 지시 짧음(사소·병합 후보).
  const tooSmall = skillCount <= 1 && acceptanceCount <= 1 && phase.prompt.trim().length < 120;

  const verdict: GranularityVerdict = tooLarge ? 'too_large' : tooSmall ? 'too_small' : 'ok';
  const reason = tooSmall
    ? '과소 — 단일 관심사·acceptance≤1·짧은 지시(인접 병합 후보)'
    : `적정 — 관심사 ${skillCount}·acceptance ${acceptanceCount}`;
  return { phaseId: phase.id, phaseTitle: phase.title, verdict, skillCount, concerns, acceptanceCount, conjunctions, reason };
}

// ── P0 · 통합 완주-가능-크기 판정 (SSOT · PLAN-unified-phase-sizing-contract 2026-07-22) ──
//
// 대표 통찰(2026-07-22): 분해(gradePhaseGranularity concern수)·구현 split(isTooBig gateFails/
// manyFiles)·reshape(concern) 3곳이 **크기를 서로 다른 근거로 판정**해 "중단없는 완주 0". 이 함수가
// "walker 한 실행으로 완주 가능한 크기"의 **단일 정량 SSOT**. 3곳이 전부 이걸 base 로 호출(P1~P3 배선).
//
// 종전 파편 임계를 여기로 흡수(SSOT):
//   · concerns ≥3   ← gradePhaseGranularity skillCount (단일책임 위배·텍스트 신호)
//   · files    ≥5   ← isTooBig manyFiles (mission-phase-diagnosis·실행 근거)
//   · est      >500 ← feedback 페이즈 <500 LOC (autopilot_phase_split_pattern)
//   · acceptance≥6  ← 한 실행에 담기 과다
//
// ⚠️ 2026-07-19 과대게이트 제거 교훈(feedback_granularity_gate_over_aggressive) 계승: **텍스트 단독
// 신호(concerns≥3)만으론 too_large 로 찍지 않는다**(굵은 조사/구현 페이즈 오탐 근원). 텍스트는
// corroboration(concerns≥3 AND acceptance≥6 또는 제목 결합)일 때만, 실행-근거 크기신호(files/est)는
// 단독으로도 too_large(휴리스틱이 아니라 지상진실이라). → 오탐 없이 진짜 과대만 잡는다.

/** SSOT 크기 임계 — 종전 3곳에 흩어진 매직넘버를 여기로 통합(단일 출처). */
export const SIZE_THRESHOLDS = {
  concernsOversize: 3,     // 관심사 클래스 ≥3 → 단일책임 위배(텍스트·corroboration 필요)
  filesOversize: 5,        // 파일 ≥5 → manyFiles(isTooBig 계승·실행 근거)
  estOversizeLoc: 500,     // 추정 LOC >500 → 과대(feedback 페이즈 <500 LOC)
  acceptanceOversize: 6,   // acceptance ≥6 → 한 실행에 담기 과다
  acceptanceHealthyMax: 5, // 6번째 criteria부터 부하 가산
} as const;

export type CompletabilityVerdict = 'ok' | 'too_large' | 'too_small';
export interface CompletabilitySizeSignals { est?: number; files?: number }
/** base 입력 = granularity 입력 + (있으면) 규모 신호. 규모는 옵셔널(분해 시엔 텍스트만·실행 후엔 files). */
export interface CompletabilityInput extends GranularityInput {
  sizeSignals?: CompletabilitySizeSignals;
}
export interface PhaseCompletabilityGrade {
  phaseId: string;
  phaseTitle: string;
  verdict: CompletabilityVerdict;
  concerns: string[];
  acceptanceCount: number;
  conjunctions: number;
  sizeSignals: CompletabilitySizeSignals;
  /** 0~1 — 한 walker 실행으로 완주 가능성(1=쉬움·과대일수록↓). */
  completabilityScore: number;
  /** 완주가능 크기를 깎은 요인(관측·HITL 근거). */
  oversizeFactors: string[];
  reason: string;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** ★ 통합 완주-가능-크기 판정(SSOT·순수·결정론). "walker 한 실행으로 완주 가능한가"를 정량화.
 *  분해·split·reshape 3곳이 공유(P1~P3). 텍스트 신호 + (있으면) 실행근거 크기신호를 결합. */
export function gradePhaseCompletability(input: CompletabilityInput): PhaseCompletabilityGrade {
  const concerns = detectConcerns(`${input.title} ${input.prompt.slice(0, 800)}`);
  const acceptanceCount = input.acceptance.length;
  const conjunctions = (input.title.match(CONJUNCTION_RE) ?? []).length;
  const files = input.sizeSignals?.files;
  const est = input.sizeSignals?.est;
  const T = SIZE_THRESHOLDS;

  // 과대 부하 — 각 신호가 완주 가능성을 누적으로 깎는다(관측 근거로 factor 기록).
  const oversizeFactors: string[] = [];
  let oversize = 0;
  const extraConcerns = Math.max(0, concerns.length - (T.concernsOversize - 1)); // 3번째 concern부터
  if (extraConcerns > 0) { oversize += extraConcerns; oversizeFactors.push(`관심사 ${concerns.length}(${concerns.join('+')})`); }
  const extraAccept = Math.max(0, acceptanceCount - T.acceptanceHealthyMax); // 6번째 criteria부터
  if (extraAccept > 0) { oversize += extraAccept; oversizeFactors.push(`acceptance ${acceptanceCount}`); }
  if (conjunctions > 0) { oversize += conjunctions; oversizeFactors.push(`제목 결합 ${conjunctions}`); }
  if (files !== undefined && files >= T.filesOversize) { oversize += files / T.filesOversize; oversizeFactors.push(`파일 ${files}`); }
  if (est !== undefined && est > T.estOversizeLoc) { oversize += est / T.estOversizeLoc; oversizeFactors.push(`추정 ${est}LOC`); }

  const completabilityScore = clamp01(1 - oversize * 0.2);

  // verdict — 텍스트 단독 too_large 금지(2026-07-19 교훈). 실행-근거 크기신호(files/est)는 단독 too_large,
  //   텍스트(concerns)는 corroboration(acceptance 과다 또는 제목 결합) 동반일 때만.
  const hardOversize = (files !== undefined && files >= T.filesOversize) || (est !== undefined && est > T.estOversizeLoc);
  const textCorroboratedOversize = concerns.length >= T.concernsOversize && (acceptanceCount >= T.acceptanceOversize || conjunctions >= 1);
  const acceptanceHeavy = acceptanceCount >= T.acceptanceOversize && concerns.length >= 2;
  const tooLarge = hardOversize || textCorroboratedOversize || acceptanceHeavy;

  // too_small — gradePhaseGranularity 계승(관심사≤1·acceptance≤1·짧은 지시). 실제 크기신호 있으면 제외.
  const tooSmall = !tooLarge
    && concerns.length <= 1 && acceptanceCount <= 1 && input.prompt.trim().length < 120
    && !hardOversize;

  const verdict: CompletabilityVerdict = tooLarge ? 'too_large' : tooSmall ? 'too_small' : 'ok';
  const reason = tooLarge
    ? `과대 — 완주가능성 ${completabilityScore.toFixed(2)}(${oversizeFactors.join(' · ')})`
    : tooSmall
      ? '과소 — 단일 관심사·acceptance≤1·짧은 지시(인접 병합 후보)'
      : `적정 — 완주가능성 ${completabilityScore.toFixed(2)}·관심사 ${concerns.length}·acceptance ${acceptanceCount}`;

  return {
    phaseId: input.id, phaseTitle: input.title, verdict,
    concerns, acceptanceCount, conjunctions,
    sizeSignals: { ...(est !== undefined ? { est } : {}), ...(files !== undefined ? { files } : {}) },
    completabilityScore, oversizeFactors, reason,
  };
}

export interface DecompGranularityResult {
  grades: PhaseGranularityGrade[];
  tooLarge: PhaseGranularityGrade[];
  tooSmall: PhaseGranularityGrade[];
}

/** 전 페이즈 granularity 등급(순수). */
export function gradeDecompositionGranularity(phases: readonly GranularityInput[]): DecompGranularityResult {
  const grades = phases.map(gradePhaseGranularity);
  return {
    grades,
    tooLarge: grades.filter((g) => g.verdict === 'too_large'),
    tooSmall: grades.filter((g) => g.verdict === 'too_small'),
  };
}

/** ★ 아크 정합 판정(RFC P2·decisions 채널 소비자 2026-07-17) — Intake clarify 가 확정한 아크 수
 *  (arcHint)를 실제 분해 페이즈 수와 대조한다. arcHint 는 프롬프트 "부탁"일 뿐 LLM 이 안 지킬 수
 *  있으므로(5아크 요청→5페이즈 flat), 결정론 게이트로 검증한다. 아크당 4~5페이즈 기준 →
 *  기대 [arcHint×4, arcHint×5]. 하한(arcHint×3)에도 못 미치면 "아크 붕괴"(멀티아크가 flat 으로
 *  뭉개짐)로 판정. 대표 지적 "5아크→5페이즈" 재발의 결정론 탐지. 순수. */
export interface ArcConformance {
  arcHint: number;
  phaseCount: number;
  expectedMin: number;   // arcHint × 4 (아크당 최소 페이즈)
  expectedMax: number;   // arcHint × 5
  conforms: boolean;     // phaseCount >= arcHint×3 (관대한 하한 — 붕괴만 잡음)
  note: string;
}
export function gradeArcConformance(phaseCount: number, arcHint: number): ArcConformance | null {
  if (!Number.isFinite(arcHint) || arcHint < 2) return null; // 1아크/미지정은 정합 무의미
  const expectedMin = arcHint * 4;
  const expectedMax = arcHint * 5;
  const collapseFloor = arcHint * 3; // 관대한 하한 — LLM 재량 여유 두되 붕괴는 잡는다
  const conforms = phaseCount >= collapseFloor;
  const note = conforms
    ? `아크 정합 OK — 확정 ${arcHint}아크 · 페이즈 ${phaseCount}개(기대 ${expectedMin}~${expectedMax})`
    : `⚠️ 아크 붕괴 의심 — 확정 ${arcHint}아크는 아크당 4~5페이즈(≈${expectedMin}~${expectedMax})여야 하나 ${phaseCount}페이즈만 분해됨(멀티아크가 flat 으로 뭉개짐·재분해 권장)`;
  return { arcHint, phaseCount, expectedMin, expectedMax, conforms, note };
}

/** HITL 카드/알림용 요약(순수) — 과대/과소 있을 때만. 비면 ''. */
export function formatGranularityForHitl(result: DecompGranularityResult): string {
  if (!result.tooLarge.length && !result.tooSmall.length) return '';
  const lines = ['📐 분해 granularity(결정론 게이트):'];
  for (const g of result.tooLarge) lines.push(`  • [과대→split] ${g.phaseTitle} — ${g.reason}`);
  for (const g of result.tooSmall) lines.push(`  • [과소→병합?] ${g.phaseTitle} — ${g.reason}`);
  return lines.join('\n');
}
