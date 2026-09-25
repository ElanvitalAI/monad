// ── 미션 페이즈 진단 + 셀프 힐 정책 (대표 2026-07-13·PLAN O1/O5/O6) ──────────
//
// 목적: monad가 자기 페이즈 실패를 opus 수준으로 진단(목표+시도 트레일+왜+추론)하고
// 셀프 힐(재시도/분할/골정정/건너뛰기)을 결정하게 한다. 여기는 순수 코어:
//   O1  classifyFailClass  — 원시 신호 → failClass 6종(재시도 여부 판정 재사용)
//   O5  synthesizePhaseDiagnosis — PhaseOutcome 사실 → 서술 진단(결정론 골격·LLM 선택 주입)
//   O6  recommendHeal      — 진단 → 힐 액션(§4 정책·결정론)
// 배선(run-mission 캡처·ops/notes 영속·텔레그램 카드·LLM 추론)은 후속 PR.
// PLAN: 내부 문서 `PLAN-mission-self-observability-selfheal-2026-07-13`
// R2 모순 감지 통합: 내부 문서 `PLAN-diagnosis-resolution-ladder-2026-07-13`

import { detectContradictions, renderSystemSuspect, type ContradictionSignal, type GateInputs } from './contradiction-detector.js';
import { gradePhaseCompletability } from './mission-phase-granularity.js';

export type FailClass =
  | 'budget-exhausted'      // 예산/턴 소진 — 재시도(에스컬레이션)가 다 게이트 실패
  | 'gate-failed-tests'     // 무결성 테스트 실패
  | 'gate-failed-critique'  // 비평 FAIL(dead-code/no-op/scope)
  | 'already-satisfied'     // ★ 이미 구현/랜딩됨·변경 불필요(대표 2026-07-21·P1b) — 재구현 무의미·정직 skip
  | 'transient'             // 일시(timeout/network/rate-limit)
  | 'missing-capability'    // gh 인증/네트워크 부재 등 환경 제약(monad가 못 고침)
  | 'provenance'            // 문서 명령 실행 거부 등 보안 경계
  | 'grounding-rejected';   // ★ walker 완주(PASS)했으나 grounding 게이트가 증거부족 반려 — 재조사(split 아님)

export interface PhaseAttempt {
  backend: string;                 // 'monad-self:gpt-5.6-terra' | 'opus-4.8' ...
  maxTurns?: number;
  budgetKrw?: number;
  gateResult: 'pass' | 'built' | 'no-change' | 'gate-failed' | 'error';
  gateOutputExcerpt?: string;
}

export interface PhaseDiffSummary { filesTouched: string[]; plannedFiles: string[]; added: number; deleted: number }
export interface PhaseEnvSignals { ghAuth?: boolean; network?: boolean; worktree?: string }

/** (A) 결정론 사실 레코드 — 항상 채워짐(regex/집계). */
export interface PhaseOutcome {
  phaseId: string; missionId: string; title: string; index: number; total: number;
  status: 'done' | 'failed';
  goal?: string; acceptance?: string;
  failClass?: FailClass;
  critiqueVerdict?: 'pass' | 'fail'; critiqueReason?: string;
  attempts: PhaseAttempt[];        // 에스컬레이션 트레일 전체(terra→opus→예산상향)
  diffSummary?: PhaseDiffSummary;  // 계획 vs 실제 만진 파일(과대/dead-code 추론 근거)
  envSignals?: PhaseEnvSignals;    // gh 인증/네트워크(missing-capability 추론 근거)
  evidenceRefs?: { runLogPath?: string; prUrl?: string; worktree?: string };
}

export type HealKind = 'rebuild' | 'split' | 'revise' | 'skip' | 'escalate';
export interface HealAction { kind: HealKind; confidence: 'high' | 'med' | 'low'; rationale: string }

/** (B) 합성 진단 레코드 — opus 수준 목표. narrative+rootCause+권장 힐. */
export interface PhaseDiagnosis {
  phaseId: string; missionId: string;
  narrative: string;               // 목표 + 시도 트레일(사실)
  rootCauseInference: string;      // 왜(추론·반드시 "추정" 명시)
  confidence: 'high' | 'med' | 'low';
  healRecommendation: HealAction;
  evidenceRefs?: PhaseOutcome['evidenceRefs'];
}

// ── O1 · failClass 분류 ──────────────────────────────────────────────
/** 원시 신호(게이트/비평 텍스트 + 환경) → failClass 6종. envSignals(환경 제약)와
 *  provenance(보안)는 텍스트보다 우선 — heal 결정을 근본적으로 바꾸므로. 순수함수. */
export function classifyFailClass(input: {
  text?: string;
  critiqueVerdict?: 'pass' | 'fail';
  envSignals?: PhaseEnvSignals;
}): FailClass {
  const t = input.text ?? '';
  // 1) 환경 제약(gh 인증/네트워크 부재) — 가장 actionable한 근본. monad가 못 고침.
  if (input.envSignals?.ghAuth === false || input.envSignals?.network === false) return 'missing-capability';
  // 1.5) ★ P0(PLAN-context-propagation §1·2026-07-22) — LLM/API 인증 실패(401·invalid key)·delegate 커맨드
  //   실행 실패는 크레덴셜/환경 제약(monad 가 재시도·분할로 못 고침). 종전엔 이 신호가 텍스트에 있어도
  //   전용 분류가 없어 budget-exhausted 기본값으로 떨어져 split/rebuild 로 오귀속됐다(2a014e opus 401
  //   → budget-exhausted→rebuild 실증). missing-capability 로 분류 → revise(골 축소/사람 개입)·split 차단.
  if (/\b401\b|invalid x-api-key|authentication_error|\bunauthorized\b|invalid.{0,8}api[_ ]?key|delegate 오류[^]*command failed/i.test(t)) return 'missing-capability';
  // 2) 보안 경계(문서 명령 실행·프롬프트 인젝션 거부).
  if (/prompt.?injection|프롬프트.*인젝션|문서.*명령.*(실행|거부)|권한.?없는.?데이터|untrusted/i.test(t)) return 'provenance';
  // 2.5) ★ 이미 만족(already-satisfied·대표 2026-07-21·P1b) — 이미 구현/랜딩됨·변경 불필요. dead-code no-op
  //   (배선 누락·재구현 대상)과 구분: "이미/already/nothing to commit/변경 불필요"는 정직 만족 → skip
  //   (재구현·예산 상향 무의미). critique(dead-code)보다 먼저 판정해 no-op 정규식에 삼켜지지 않게 한다.
  if (input.critiqueVerdict !== 'fail'
    && !/dead.?code|미완|훼손|범위.?밖/i.test(t)  // dead-code 신호가 있으면 critique(재구현)로 — already 로 안 샘
    && /이미.{0,15}(구현|존재|반영|완료|있|랜딩|머지|main)|already.{0,15}(implement|exist|present|done|satisf|in main)|nothing to commit|변경\s*(이\s*)?(불필요|필요\s*(하지\s*않|없))/i.test(t)) return 'already-satisfied';
  // 2.6) ★ grounding 반려(대표 2026-07-21·split 남발 ⑤) — walker 완주(PASS)를 grounding 게이트가 증거부족
  //   으로 무효화한 케이스. 오버라이드(run-mission·walkerGroundingGate opt-in)가 심는 유니크 마커만 매칭
  //   → 무회귀. budget-exhausted(split) 오분류 차단, 재조사(rebuild)로 라우팅(개별 attempt=pass인데 fail 모순 해소).
  if (/\[grounding 실패\]|재조사 필요\(grounding|missing_evidence/i.test(t)) return 'grounding-rejected';
  // 3) 비평 FAIL(dead-code/no-op/미완/훼손) — 배선 누락·위증.
  if (input.critiqueVerdict === 'fail' || /dead.?code|dead-code|미완|훼손|no-?op|변경.?(0|없|되지 않)|범위.?밖/i.test(t)) return 'gate-failed-critique';
  // 4) 무결성 테스트 실패.
  if (/\btest\b.*fail|테스트.*실패|\d+\s*fail|무결성.*(게이트)?.*(실패|fail)/i.test(t)) return 'gate-failed-tests';
  // 5) 일시(timeout/network/rate-limit).
  if (/타임아웃|timeout|일시적|rate.?limit|연결.*실패|잠시 후|다시 시도/i.test(t)) return 'transient';
  // 6) 예산/턴 소진(폴백까지 실패) — 기본 폴백.
  return 'budget-exhausted';
}

/** 페이즈가 "너무 큼"(분할 신호)인가 — 폴백까지 소진 or 다중 게이트실패 시도.
 *  ★ requireSizeSignal(opt-in·대표 2026-07-21·split 남발 진단) — 종전 `gateFails>=2` 단독 조건은
 *  "재시도 2회 실패"면 diff·파일수 무관하게 거의 항상 참이라, walker 가 완수 못한 실패를 **크기로
 *  오귀속**해 split 을 남발시킨 근원(라이브 617097). ON 이면 재시도 횟수 단독으로 big 판정하지 않고,
 *  실제 크기신호(manyFiles) 또는 계단소진(opus)+반복 결합만 big. OFF=종전(무회귀). */
export function isTooBig(outcome: PhaseOutcome, opts?: { requireSizeSignal?: boolean }): boolean {
  const gateFails = outcome.attempts.filter((a) => a.gateResult === 'gate-failed' || a.gateResult === 'error').length;
  const hadFallback = outcome.attempts.some((a) => /opus/i.test(a.backend));
  // ★ P1(통합 sizing 2026-07-22) — 크기 신호(manyFiles)를 SSOT gradePhaseCompletability 로 위임한다.
  //   종전 로컬 매직넘버 `>= 5` 를 SIZE_THRESHOLDS.filesOversize 단일 출처로 흡수(무회귀 — files 만
  //   전달해 base 는 hardOversize=files≥5 로만 판정, 텍스트 신호 미개입). 실행실패 신호(gateFails·
  //   계단소진)는 split 고유의 custom 층으로 base 위에 결합(PLAN §1 per-site custom).
  const manyFiles = gradePhaseCompletability({
    id: outcome.phaseId, title: '', prompt: '', acceptance: [],
    sizeSignals: { files: outcome.diffSummary?.filesTouched.length ?? 0 },
  }).verdict === 'too_large';
  if (opts?.requireSizeSignal) return manyFiles || (hadFallback && gateFails >= 2);
  return (hadFallback && gateFails >= 1) || gateFails >= 2 || manyFiles;
}

// ── O6 · 셀프 힐 정책 ────────────────────────────────────────────────
/** 진단 근거(failClass + too-big + 반복 실패) → 힐 액션. §4 표. 순수·결정론.
 *  opts.requireSizeSignal 은 isTooBig 로 전달(재시도=과대 오귀속 차단·opt-in·무회귀). */
export function recommendHeal(outcome: PhaseOutcome, opts?: { requireSizeSignal?: boolean }): HealAction {
  const fc = outcome.failClass ?? 'budget-exhausted';
  const big = isTooBig(outcome, opts);
  switch (fc) {
    case 'transient':
      return { kind: 'rebuild', confidence: 'high', rationale: '일시적 실패 — 재시도로 해소 가능성 높음' };
    case 'gate-failed-critique':
      // dead-code/no-op = 배선 누락. 비평을 가이드로 재구현. 반복이면 분할.
      return big
        ? { kind: 'split', confidence: 'med', rationale: '비평 반복 실패 + 과대 신호 — 단일책임으로 분할' }
        : { kind: 'rebuild', confidence: 'med', rationale: '비평 FAIL(배선 누락·미완) — 비평을 가이드로 재구현' };
    case 'gate-failed-tests':
      return { kind: 'rebuild', confidence: 'med', rationale: '무결성 테스트 실패 — 수정 후 재시도' };
    case 'already-satisfied':
      // ★ 이미 구현/랜딩됨 — 재구현·예산 상향 무의미. 정직 skip(done)으로 넘어가 진짜 남은 골로 진행.
      return { kind: 'skip', confidence: 'high', rationale: '이미 구현/랜딩됨(변경 불필요) — 재구현 무의미·정직 skip' };
    case 'budget-exhausted':
      return big
        ? { kind: 'split', confidence: 'med', rationale: '예산 소진 + 과대 페이즈 신호 — 서브페이즈로 분할' }
        : { kind: 'rebuild', confidence: 'low', rationale: '예산 소진(과대 신호 약함) — 예산 리셋 재시도' };
    case 'missing-capability':
      return { kind: 'revise', confidence: 'med', rationale: '환경 제약(gh 인증/네트워크 등) — 골에서 해당 요구 축소 또는 사람 개입' };
    case 'provenance':
      return { kind: 'escalate', confidence: 'high', rationale: '보안 경계 — 자율 진행 금지, 사람 판단 필요' };
    case 'grounding-rejected':
      // ★ walker 는 완주(PASS)·grounding 만 증거부족 반려 → 페이즈 과대 아님. split 금지·재조사(rebuild).
      //   isTooBig/requireSizeSignal 무관하게 항상 rebuild(split 남발 ⑤ 근본 차단).
      return { kind: 'rebuild', confidence: 'med', rationale: 'grounding 반려(walker 완주·조사증거 부족) — 재조사/rebuild-with-grounding(split 아님)' };
  }
}

/** ★ triage 힐 오버라이드(대표 2026-07-14) — 재시도 triage(walker/SE)가 실패 요약에 남긴 근본
 *  갈림길 결정을 결정론 recommendHeal 보다 우선할 HealKind 로 파싱. budget-exhausted 자율 셀프힐이
 *  P6(premise 부재->revise) 를 rebuild 로 오힐하지 않게 하는 근거. 마커 없으면 null(결정론 유지).
 *  walker 마커=`[재시도 triage 권장: <path> ...]` · SE 마커=`[SE triage: <path>] ...`. 순수함수. */
const TRIAGE_HEAL_MAP: Record<string, HealKind> = {
  'retry-discipline': 'rebuild', 'retry-budget': 'rebuild', 'retry-escalate': 'rebuild',
  split: 'split', revise: 'revise', skip: 'skip', escalate: 'escalate',
};
export function parseTriageHealOverride(summary: string): HealKind | null {
  const m = (summary ?? '').match(/\[(?:재시도 triage 권장:|SE triage:)\s*([a-z-]+)/);
  const path = m?.[1];
  return path && TRIAGE_HEAL_MAP[path] ? TRIAGE_HEAL_MAP[path]! : null;
}

// ── O5 · 진단 신시사이저 ─────────────────────────────────────────────
const FAILCLASS_KO: Record<FailClass, string> = {
  'budget-exhausted': '예산/턴 소진(재시도가 모두 게이트 실패)',
  'gate-failed-tests': '무결성 테스트 실패',
  'gate-failed-critique': '비평 FAIL(배선 누락·미완·범위밖 의심)',
  'already-satisfied': '이미 구현/랜딩됨(변경 불필요·정직 skip)',
  'transient': '일시적 오류(타임아웃/네트워크)',
  'missing-capability': '환경 제약(gh 인증/네트워크 부재 추정)',
  'provenance': '보안 경계(문서 명령 거부)',
  'grounding-rejected': 'grounding 반려(walker 완주·조사증거 부족)',
};

/** 시도 트레일을 사람이 읽는 한 줄로 — "terra 1000턴→gate-failed → opus→gate-failed". */
/** 트레일에 표시할 최근 시도 수(대표 2026-07-14) — se_builds 는 rebuild 마다 누적되므로 전부 늘어놓으면
 *  "왜 이리 많나(과거 포함)" 혼란. 최근 N 만 보이고 초과분은 "외 M회" 로 요약. */
const TRAIL_TAIL = 6;
/** gateResult → 사람 라벨. no-change 는 "no-op(변경0)" 로 정직 표시(built=성공 오인 방지·대표 2026-07-14). */
const GATE_LABEL: Record<PhaseAttempt['gateResult'], string> = {
  pass: 'pass', built: 'built', 'no-change': 'no-op(변경0)', 'gate-failed': 'gate-failed', error: 'error',
};
export function renderAttemptTrail(attempts: PhaseAttempt[]): string {
  if (!attempts.length) return '(시도 기록 없음)';
  const shown = attempts.slice(-TRAIL_TAIL);
  const omitted = attempts.length - shown.length;
  const trail = shown
    .map((a) => {
      const who = a.backend.replace(/^monad-self:/, '');
      const turns = a.maxTurns ? ` ${a.maxTurns}턴` : '';
      return `${who}${turns}→${GATE_LABEL[a.gateResult] ?? a.gateResult}`;
    })
    .join(' → ');
  // 정상 에스컬레이션(terra→opus)엔 프리픽스 없음. 누적(여러 rebuild)로 TRAIL_TAIL 초과할 때만
  //   "누적 N회(앞 M 생략)" 로 명시 — 한 번의 실행으로 오해 방지(대표 2026-07-14).
  return omitted > 0 ? `누적 ${attempts.length}회(앞 ${omitted} 생략) … ${trail}` : trail;
}

/** ★ 페이즈 산출물 → R2 게이트 입력(대표 2026-07-13·셀프힐 배선) — synthesizePhaseDiagnosis 와
 *  escalate(시스템 결함 룩백)가 공유하는 GateInputs 구성(중복 제거). diff 요약·비평 판정·실패
 *  텍스트를 모순 감지기(detectContradictions) 입력으로 정규화. 순수·결정론. */
export function phaseGateInputs(outcome: PhaseOutcome): GateInputs {
  return {
    ...(outcome.diffSummary ? { changedFiles: outcome.diffSummary.filesTouched, diffBody: (outcome.diffSummary.added + outcome.diffSummary.deleted) > 0 ? 'x' : '' } : {}),
    ...(outcome.critiqueVerdict ? { critiqueVerdict: outcome.critiqueVerdict } : {}),
    failText: `${outcome.critiqueReason ?? ''} ${outcome.attempts.map((a) => a.gateOutputExcerpt ?? '').join(' ')}`.trim(),
  };
}

/** ★ 페이즈에 대한 시스템 결함 의심 신호(대표 2026-07-13·셀프힐) — 모순이 있으면 escalate 가
 *  R3 소스 룩백으로 넘길 신호. 없으면 빈 배열(=시스템 결함 아님·보안/판단 경계는 별도). 순수. */
export function phaseSystemSuspectSignals(outcome: PhaseOutcome): ContradictionSignal[] {
  return detectContradictions(phaseGateInputs(outcome));
}

/** PhaseOutcome 사실 → PhaseDiagnosis. 결정론 골격은 항상 생성(LLM 없어도 동작·fail-soft).
 *  opts.llmRootCause 가 주어지면(후속 배선의 streamLLM 추론) rootCause 를 대체 — 단 근거
 *  없는 원인 환각 금지는 배선측 프롬프트 책임. narrative 는 항상 결정론(사실이라 추론 불요). */
export function synthesizePhaseDiagnosis(
  outcome: PhaseOutcome,
  opts: { llmRootCause?: string; requireSizeSignal?: boolean } = {},
): PhaseDiagnosis {
  const fc = outcome.failClass ?? 'budget-exhausted';
  const goalLine = outcome.goal ? `목표: ${outcome.goal.slice(0, 160)}` : `페이즈: ${outcome.title}`;
  const trail = renderAttemptTrail(outcome.attempts);
  const narrative = `${outcome.title} 실패. ${goalLine}. 시도: ${trail}. 분류: ${FAILCLASS_KO[fc]}.`;

  // 결정론 rootCause 골격 — failClass + 근거 신호로 조립("추정" 명시).
  const grounds: string[] = [];
  if (isTooBig(outcome)) grounds.push('여러 재시도가 모두 게이트 실패(과대 페이즈 신호)');
  if ((outcome.diffSummary?.filesTouched.length ?? 0) >= 5) grounds.push(`${outcome.diffSummary!.filesTouched.length}개 파일 동시 변경`);
  if (outcome.envSignals?.ghAuth === false) grounds.push('격리 worktree gh 인증 부재');
  if (outcome.envSignals?.network === false) grounds.push('네트워크 접근 제약');
  if (outcome.critiqueVerdict === 'fail' && outcome.critiqueReason) grounds.push(`비평: ${outcome.critiqueReason.slice(0, 80)}`);
  const groundStr = grounds.length ? ` (근거: ${grounds.join(' · ')})` : '';
  const detClause = FAILCLASS_ROOT[fc];
  const rootCauseInference = opts.llmRootCause?.trim()
    ? opts.llmRootCause.trim()
    : `${detClause} 추정.${groundStr}`;

  // 신뢰도: 근거 신호가 있으면 med↑, 환경 신호까지 있으면 high.
  const confidence: PhaseDiagnosis['confidence'] =
    outcome.envSignals && (outcome.envSignals.ghAuth === false || outcome.envSignals.network === false)
      ? 'high'
      : grounds.length >= 1 ? 'med' : 'low';

  // ★ R2 모순 감지(대표 2026-07-13·진단 해상도 사다리) — 게이트 입력↔판정 불일치(변경 파일은 있는데
  //   diff 본문 없음·테스트 통과인데 비평 FAIL)면 "시스템 결함 의심". 예산/분할 오진 대신 escalate
  //   (게이트 입력·mission system 소스 룩백·사람) + narrative 에 명시. price-guard 페이즈0/2 근본
  //   ("diff 본문 없어 검증 불가")을 시스템이 스스로 규명하도록 — 주어진 정보만이 아니라 시스템 의심.
  const gateInputs = phaseGateInputs(outcome);
  const suspect = detectContradictions(gateInputs);
  const suspectLine = renderSystemSuspect(gateInputs);
  const healRecommendation: HealAction = suspect.length > 0
    ? { kind: 'escalate', confidence: 'high', rationale: `시스템 결함 의심(모순 ${suspect.length}건) — 예산 증액·분할 무의미. 게이트 입력·mission system 소스 룩백 필요(주어진 정보만이 아니라 시스템 자체 의심).` }
    : recommendHeal(outcome, opts.requireSizeSignal ? { requireSizeSignal: true } : undefined);

  return {
    phaseId: outcome.phaseId,
    missionId: outcome.missionId,
    narrative: suspectLine ? `${narrative}\n${suspectLine}` : narrative,
    rootCauseInference,
    confidence,
    healRecommendation,
    ...(outcome.evidenceRefs ? { evidenceRefs: outcome.evidenceRefs } : {}),
  };
}

// ── O1 배선 보조 · 페이즈 요약 → PhaseOutcome (순수·run-mission 캡처용) ──────
/** run-mission/SE 브릿지가 남긴 페이즈 요약 문자열에서 사실을 복원한다. 요약 태그
 *  예: "[FAIL·budget·3회내 시도] ..." · SE 텍스트의 "1000턴"·"opus 폴백"·"gate-failed".
 *  attempt 트레일은 best-effort(요약이 담은 만큼) — 완전 캡처는 후속(se-bridge 스레딩). */
export function buildPhaseOutcomeFromSummary(input: {
  phaseId: string; missionId: string; title: string; index: number; total: number;
  status: 'done' | 'failed';
  summary?: string; goal?: string;
  critiqueVerdict?: 'pass' | 'fail'; critiqueReason?: string;
  envSignals?: PhaseEnvSignals;
  evidenceRefs?: PhaseOutcome['evidenceRefs'];
}): PhaseOutcome {
  const s = input.summary ?? '';
  // 시도 횟수: "N회내 시도" 또는 "시도N".
  const nMatch = /(\d+)\s*회내 시도/.exec(s) ?? /시도\s*(\d+)/.exec(s);
  const attemptN = nMatch ? Math.max(1, Math.min(9, Number(nMatch[1]))) : 1;
  // 턴/백엔드 힌트.
  const turnMatch = /(\d{2,4})\s*턴/.exec(s);
  const hadOpus = /opus/i.test(s);
  const gate: PhaseAttempt['gateResult'] = input.status === 'done'
    ? (/\bPR\b|http|built/i.test(s) ? 'built' : 'pass')
    : (/gate-?failed|무결성.*실패/i.test(s) ? 'gate-failed' : 'error');
  const attempts: PhaseAttempt[] = [];
  for (let i = 0; i < attemptN; i++) {
    const isLastOpus = hadOpus && i === attemptN - 1;
    attempts.push({
      backend: isLastOpus ? 'opus-4.8' : 'monad-self:gpt-5.6-terra',
      ...(i === 0 && turnMatch ? { maxTurns: Number(turnMatch[1]) } : {}),
      gateResult: input.status === 'done' && i === attemptN - 1 ? gate : (input.status === 'done' ? 'gate-failed' : gate),
    });
  }
  const failClass = input.status === 'failed'
    ? classifyFailClass({ text: s, critiqueVerdict: input.critiqueVerdict, envSignals: input.envSignals })
    : undefined;
  return {
    phaseId: input.phaseId, missionId: input.missionId, title: input.title,
    index: input.index, total: input.total, status: input.status,
    ...(input.goal ? { goal: input.goal } : {}),
    ...(failClass ? { failClass } : {}),
    ...(input.critiqueVerdict ? { critiqueVerdict: input.critiqueVerdict } : {}),
    ...(input.critiqueReason ? { critiqueReason: input.critiqueReason } : {}),
    attempts,
    ...(input.envSignals ? { envSignals: input.envSignals } : {}),
    ...(input.evidenceRefs ? { evidenceRefs: input.evidenceRefs } : {}),
  };
}

// ── 진단 note 빌더/파서 (P1 · 2026-07-13) ───────────────────────────────
// task.notes 의 `[DIAGNOSIS]` 항목이 진단의 영속 SoT — run-mission 이 쓰고(빌더),
// ops-status(phases[])·TUI 워처·텔레그램 카드가 읽는다(파서). 표면별 재합성 금지의 실체.
// 신규 포맷 `[DIAGNOSIS:failClass]` — 구 포맷(`[DIAGNOSIS]`·failClass 없음)도 파싱.

export interface DiagnosisNoteData {
  failClass?: FailClass;
  narrative: string;
  rootCause: string;
  heal: HealKind;
  confidence: HealAction['confidence'];
}

const HEAL_KINDS: readonly HealKind[] = ['rebuild', 'split', 'revise', 'skip', 'escalate'];
const FAIL_CLASSES: readonly FailClass[] = [
  'budget-exhausted', 'gate-failed-tests', 'gate-failed-critique', 'already-satisfied', 'transient', 'missing-capability', 'provenance', 'grounding-rejected',
];

/** 진단 → notes 항목 1줄(≤600자). run-mission 영속 경로가 사용(단일 출처). */
export function buildDiagnosisNote(diag: PhaseDiagnosis, failClass?: FailClass): string {
  const tag = failClass ? `[DIAGNOSIS:${failClass}]` : '[DIAGNOSIS]';
  return `${tag} ${diag.narrative} 근본원인: ${diag.rootCauseInference} 권장: ${diag.healRecommendation.kind}(${diag.healRecommendation.confidence})`.slice(0, 600);
}

/** notes → 진단(마지막 [DIAGNOSIS] 항목·rerun 후 최신 세대 우선). 없으면 null. 순수. */
export function parseDiagnosisNote(notes: readonly string[]): DiagnosisNoteData | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!;
    const m = /^\[DIAGNOSIS(?::([\w-]+))?\]\s*(.*)$/s.exec(n);
    if (!m) continue;
    const body = m[2] ?? '';
    // "… 근본원인: <root> 권장: <kind>(<conf>)" 역파싱 — 빌더와 대칭.
    const tail = /(.*?)\s*근본원인:\s*(.*?)\s*권장:\s*([\w-]+)\((high|med|low)\)\s*$/s.exec(body);
    const fcRaw = m[1];
    const failClass = FAIL_CLASSES.find((f) => f === fcRaw);
    const healRaw = tail?.[3];
    const heal = HEAL_KINDS.find((h) => h === healRaw) ?? 'rebuild';
    return {
      ...(failClass ? { failClass } : {}),
      narrative: (tail?.[1] ?? body).trim(),
      rootCause: (tail?.[2] ?? '').trim(),
      heal,
      confidence: (tail?.[4] as HealAction['confidence'] | undefined) ?? 'low',
    };
  }
  return null;
}

const FAILCLASS_ROOT: Record<FailClass, string> = {
  'budget-exhausted': '과대 페이즈로 실행 예산 초과',
  'gate-failed-tests': '변경이 테스트 무결성을 깨뜨림',
  'gate-failed-critique': '산출물이 계획 배선에 미달(dead-code/미완)',
  'already-satisfied': '이미 구현/랜딩되어 변경 불필요(정직 skip)',
  'transient': '일시적 인프라 오류',
  'missing-capability': '격리 환경의 능력 부재(외부 접근 등)로 완료 불가',
  'provenance': '신뢰 경계 위반 소지로 중단',
  'grounding-rejected': 'walker 는 완주했으나 조사 증거 합성이 부족해 grounding 게이트가 반려',
};
