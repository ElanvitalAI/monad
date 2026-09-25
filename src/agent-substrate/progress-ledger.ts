// Progress Ledger — 매스텝 진행 판정(공용·중립 · 2026-07-20 C3 승격).
//
// 원본: src/autopilot/pipeline/mission-progress-ledger.ts(조율자 격상 P2). AutoGen Magentic-One 의 Progress
// Ledger 이중루프 이식 — 매스텝 3판정(satisfied/progress/in_loop)으로 "완료됐나·전진하나·뱅뱅도나"를 알고,
// stall(진전없음/루프) 누적이 임계 넘으면 재계획/에스컬레이션 권장. 판정은 **순수 로직**(결정론·신호에서 파생).
//
// ★ 이 모듈은 **도메인-무관 순수 코어**만 담는다(DESIGN §16 C3): 신호 → Ledger 판정(evaluateProgressLedger)
//   + 프레임 → 신호 파생(deriveProgressSignals). 미션 저널 read 래퍼(evaluateMissionProgress)·조율자 관측
//   (observeCoordinator/logProgressLedger)은 autopilot 잔류. 스몰-폼 하니스가 자기 스테이지 프레임으로 재사용
//   (§15e COORDINATION — stop/retry/escalate 뇌). I/O 없음·전부 순수.

/** 권장 조치 — done/continue/replan(stall)/escalate(HITL). */
export type LedgerRecommendation = 'done' | 'continue' | 'replan' | 'escalate';

/** Progress Ledger 1스텝 판정(AutoGen LedgerEntry 이식). */
export interface ProgressLedger {
  satisfied: boolean;         // is_request_satisfied — 목표 충족(→ done)
  progressBeingMade: boolean; // is_progress_being_made — 최근 전진
  inLoop: boolean;            // is_in_loop — 같은 자리 반복(교착)
  stalled: boolean;           // 파생 — !progress || inLoop(재계획 후보)
  stallCount: number;         // 누적 stall(진전없음/루프 스텝 수)
  recommendation: LedgerRecommendation;
  rationale: string;
}

/** 진행 신호(순수 판정의 입력). */
export interface ProgressSignals {
  totalPhases: number;
  donePhases: number;
  failedPhases: number;
  consecutiveFailures: number;   // 최근 연속 실패(진전없음 신호)
  maxPhaseAttempts: number;      // 한 페이즈의 최대 재시도 수(in_loop 신호)
  orphanPendingWrites: number;   // 미종결 durable write
}

/** stall 임계(AutoGen _max_stalls 동형) — 이 이상이면 재계획 권장. */
export const DEFAULT_MAX_STALLS = 2;
/** in_loop 판정 — 한 페이즈가 이 횟수 이상 재시도되면 뱅뱅. */
export const IN_LOOP_ATTEMPTS = 3;

/** ★ 순수 판정 — 신호 → Progress Ledger(3판정 + 권장). 결정론. */
export function evaluateProgressLedger(sig: ProgressSignals, opts: { maxStalls?: number } = {}): ProgressLedger {
  const maxStalls = opts.maxStalls ?? DEFAULT_MAX_STALLS;
  const satisfied = sig.totalPhases > 0 && sig.donePhases >= sig.totalPhases && sig.failedPhases === 0;
  const inLoop = sig.maxPhaseAttempts >= IN_LOOP_ATTEMPTS;
  const progressBeingMade = !inLoop && sig.consecutiveFailures < 2;
  const stalled = !satisfied && (!progressBeingMade || inLoop);
  // stall 카운트 근사 — 루프 재시도 초과분(재시도 1회 초과 = 1 stall)과 연속실패 중 큰 값(진전 없이
  //   소모한 스텝). AutoGen _n_stalls 동형(임계 넘으면 재계획).
  const loopStalls = inLoop ? Math.max(0, sig.maxPhaseAttempts - 1) : 0;
  const noProgressStalls = progressBeingMade ? 0 : sig.consecutiveFailures;
  const stallCount = Math.max(loopStalls, noProgressStalls);
  let recommendation: LedgerRecommendation;
  let rationale: string;
  if (satisfied) { recommendation = 'done'; rationale = `전 페이즈 완료(${sig.donePhases}/${sig.totalPhases})·실패 0`; }
  else if (sig.consecutiveFailures >= 3) { recommendation = 'escalate'; rationale = `연속 실패 ${sig.consecutiveFailures} — 자동 재계획으로 안 풀림(HITL)`; }
  else if (stalled && stallCount >= maxStalls) { recommendation = 'replan'; rationale = inLoop ? `페이즈 재시도 ${sig.maxPhaseAttempts}회(뱅뱅)·stall ${stallCount}` : `진전 없음·stall ${stallCount}≥${maxStalls}`; }
  else { recommendation = 'continue'; rationale = `진행 중(done ${sig.donePhases}/${sig.totalPhases}·연속실패 ${sig.consecutiveFailures})`; }
  return { satisfied, progressBeingMade, inLoop, stalled, stallCount, recommendation, rationale };
}

/** 진행 신호 파생에 필요한 프레임 최소 형상(구조적 타입 — 구체 Frame 결합 회피). */
export type FrameForSignals = { phaseId?: string; op?: string; status?: string };

/** ★ 순수 신호 파생 — 프레임 배열 → ProgressSignals. I/O 없음(orphan 은 호출측이 주입). 저널을 다시 읽지
 *  않고 프레임(또는 중앙 State)에서 순수 파생하도록. */
export function deriveProgressSignals(frames: readonly FrameForSignals[], opts: { totalPhases?: number; orphanPendingWrites?: number } = {}): ProgressSignals {
  // 페이즈별 최신 상태(마지막 seq) + 시도 수 집계.
  const latestStatus = new Map<string, string>();
  const attempts = new Map<string, number>();
  const orderedFail: boolean[] = [];
  for (const f of frames) {
    if (!f.phaseId) continue;
    if (f.op === 'phase-start') attempts.set(f.phaseId, (attempts.get(f.phaseId) ?? 0) + 1);
    if ((f.op === 'phase-done' || f.op === 'skip') && f.status !== undefined) {
      latestStatus.set(f.phaseId, f.status);
      orderedFail.push(f.status === 'failed');
    }
  }
  const phaseIds = [...latestStatus.keys()];
  const donePhases = phaseIds.filter((p) => { const s = latestStatus.get(p); return s === 'done' || s === 'skipped' || s === 'no-op'; }).length;
  const failedPhases = phaseIds.filter((p) => latestStatus.get(p) === 'failed').length;
  // 최근 연속 실패(뒤에서부터).
  let consecutiveFailures = 0;
  for (let i = orderedFail.length - 1; i >= 0; i--) { if (orderedFail[i]) consecutiveFailures++; else break; }
  const maxPhaseAttempts = attempts.size ? Math.max(...attempts.values()) : 0;
  // ★ totalPhases 기본값 정합 — 종전엔 terminal 프레임 있는 페이즈만 세서 조기 satisfied 오판. 시작
  //   (phase-start)했으나 미종결인 페이즈도 총계에 포함해 조기 satisfied 를 막는다. 진짜 총계를 아는
  //   호출측은 opts.totalPhases 전달(프레임만으로는 미시작 페이즈는 못 셈).
  const startedPhaseIds = new Set(frames.filter((f) => f.phaseId).map((f) => f.phaseId));
  return {
    totalPhases: opts.totalPhases ?? Math.max(startedPhaseIds.size, phaseIds.length),
    donePhases, failedPhases, consecutiveFailures, maxPhaseAttempts,
    orphanPendingWrites: opts.orphanPendingWrites ?? 0,
  };
}
