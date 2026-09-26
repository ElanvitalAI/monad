// ── 멀티페이즈 미션 executor (승인→폐루프 · 대표 지시 2026-07-11) ──────────────
//
// HANDOFF 남은 항목("승인→멀티페이즈 executor 배선")의 실체. approveMission 이 페이즈를
// ready 로 승격하지만, 데몬 TOX 디스패처는 빈 in-memory graph(DB store 와 단절)라 페이즈를
// 못 본다. 이 모듈은 **store(tox_tasks) 기반**으로 페이즈 그래프를 직접 순회 집행한다:
//
//   ready 페이즈 실행 → 성공 시 done + dependsOn 충족된 blocked → ready 승격 → 반복.
//   실패 시 failed + 중단(후속 blocked 유지). 페이즈 없으면 multiphase:false(단일턴 폴백).
//
// runPhase 는 주입(테스트는 스텁·실행은 에이전트 턴). store 도 주입(테스트는 temp).
// trim 된 페이즈를 가리키는 dependsOn 은 무시(존재하는 dep 만 게이팅) — 자동 재배선 후에도
// 안전. 순수 진행 로직 + store I/O 만(신규 실행엔진 없음).

import type { Task } from '../task-orchestrator/types.js';
import type { MissionArc } from '../task-orchestrator/mission.js';
import { TaskStore } from '../task-orchestrator/store.js';
import { resolveArcs, isFlatMission, isArcResolved } from './mission-arc.js';
import { phaseHandle, arcHandle as computeArcHandle, arcIdxForPhase } from './mission-phase-handle.js';
import { verifyArcAcceptance, type ArcVerifier, type ArcEvidence } from './mission-arc-verify.js';
import type { ExternalCompletion, ReuseBoundary } from './mission-grounding-ladder.js';
import { extractFileRefs } from './mission-arc-preflight.js';
import { debug } from '../debug/log.js';

/** task 노트의 [SE-PR] 마커에서 PR URL 추출(대표 2026-07-12·순수) — 리쥼 리포트가 과거 run 의
 *  PR 을 기억하도록. #3886 이 페이즈 done 시 [SE-PR] <url> 을 노트에 보관한다. */
export function prUrlFromNotes(notes: readonly string[]): string | undefined {
  for (const n of notes) {
    const m = /\[SE-PR\]\s*(https?:\/\/\S*\/pull\/\d+)/.exec(n);
    if (m) return m[1];
  }
  return undefined;
}

/** task 노트의 [CRITIQUE:verdict] 마커에서 자동 비평 요약 추출(대표 2026-07-12·순수) — 완료 리뷰
 *  요약·재반영 대상 판정. findings 비어있으면 clean(수정 불필요). #3886 이 보관. verdict=최악(FAIL 우선). */
export function critiqueFromNotes(notes: readonly string[]): { verdict?: string; findings: string[] } {
  const findings: string[] = [];
  let verdict: string | undefined;
  for (const n of notes) {
    const m = /^\[CRITIQUE:([^\]]*)\]\s*(.+)/.exec(n);
    if (!m) continue;
    findings.push(m[2]!.trim());
    const v = m[1]!.toUpperCase();
    verdict = verdict === 'FAIL' ? 'FAIL' : v; // FAIL 이 최우선(있으면 유지)
  }
  return verdict ? { verdict, findings } : { findings };
}

/** ★ R3 — 페이즈 노트에 [REVIEW:ESCALATED](자율 PR 리뷰 K회 미수렴·HITL 대기) 마커가 있나. 순수.
 *  mergeMissionPhases 가 자동/HITL 머지에서 이 페이즈를 제외하는 근거(미해결 리뷰 PR 머지 금지·안전). */
export function hasReviewEscalatedNote(notes: readonly string[]): boolean {
  return notes.some((n) => /^\[REVIEW:ESCALATED\]/.test(String(n)));
}

/** ★ R3 — 페이즈 노트에 [REVIEW:PASS](실제 리뷰가 verdict=PASS) 마커가 있나. 순수.
 *  reviewAutoMerge(requireReviewPass)가 이 마커 있는 페이즈만 자동머지(리뷰 안 된 fail-soft pass 배제·verdict-gated). */
export function hasReviewPassNote(notes: readonly string[]): boolean {
  return notes.some((n) => /^\[REVIEW:PASS\]/.test(String(n)));
}

/** task 노트의 [PROGRESS] 마커에서 현재 진행 note 추출(마지막 1개·순수) — 페이즈 내부
 *  변곡점(재시도·예산 상향·opus 폴백·#3919)의 폴링 미러(TUI/PWA)용. */
export function progressFromNotes(notes: readonly string[]): string | undefined {
  for (let i = notes.length - 1; i >= 0; i--) {
    const m = /^\[PROGRESS\]\s*(.+)/.exec(notes[i]!);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** notes 에 진행 note 를 최신 1개만 유지하며 반영(기존 [PROGRESS] 제거·순수). */
export function withProgressNote(notes: readonly string[], note: string): string[] {
  return [...notes.filter((n) => !/^\[PROGRESS\]/.test(n)), `[PROGRESS] ${note.trim()}`];
}

/** 진행 note 를 store 에 영속(fail-soft) — run-mission onProgress 가 텔레그램 edit 과 함께 호출.
 *  transient: 페이즈 종결 시 executor 가 in-memory notes 로 재저장하며 자연 소거되고,
 *  크래시 잔재는 rerun clean(EXECUTION_NOTE_MARKERS)이 정리한다. */
export function persistPhaseProgress(phaseId: string, note: string): void {
  try {
    const store = new TaskStore();
    try {
      const t = store.getTask(phaseId);
      if (!t) return;
      store.saveTask({ ...t, notes: withProgressNote(t.notes, note), updatedAt: Date.now() });
    } finally { store.close(); }
  } catch { /* fail-soft — 진행 표시 실패가 집행을 막지 않음 */ }
}

export interface PhaseResult {
  ok: boolean;
  /** 실행 요약(보고·로그용). */
  summary: string;
  /** SE built 시 PR 초안 URL — 페이즈별 실시간 알림에 "📖 PR 리뷰" 링크로 노출(대표 2026-07-12). */
  prUrl?: string;
  /** 자동 비평 판정(대표 2026-07-12) — pass/warn/fail. 재구현 시 지적을 SE 에 실어 반영. */
  critiqueVerdict?: string;
  /** 자동 비평 지적 목록 — 재구현이 [REBUILD] 로 SE 에 전달(같은 문제 반복 방지). */
  critiqueFindings?: readonly string[];
  /** R3(RFC-autonomous-pr-review §3f) — 자율 PR 리뷰가 K회 미수렴해 escalate(재작업 중단·HITL)된 지적.
   *  [REVIEW:ESCALATED] 로 각인 → mergeMissionPhases 가 자동머지에서 제외(미해결 리뷰 안전)·rebuild 는
   *  [CRITIQUE:*] 만 보므로 재큐 안 함(bound 유지). critiqueFindings 와 배타(escalate=재작업 아님). */
  reviewEscalated?: readonly string[];
  /** R3(RFC §3f) — 실제 리뷰가 verdict=PASS 로 통과함(fail-soft pass 아님·reviewed=true). [REVIEW:PASS]
   *  로 각인 → reviewAutoMerge(requireReviewPass)가 이 마커 있는 페이즈만 자동머지(리뷰 안 된 페이즈 배제). */
  reviewPassed?: boolean;
}

/** 한 페이즈(subagent surface)를 집행. 실행 컨텍스트가 주입(에이전트 턴/서브에이전트/스텁). */
export type RunPhaseFn = (task: Task) => Promise<PhaseResult>;

/** 페이즈 에이전트 응답에서 acceptance 판정 추출 — 마지막 `VERDICT: PASS|FAIL` 토큰(대소문자 무관).
 *  없으면 null → caller 가 보수적으로 실패 처리(응답이 비어있지 않다는 이유로 done 처리하던
 *  약한 判定을 대체). 순수함수(LLM node 규칙·단위테스트). */
export function parsePhaseVerdict(text: string): 'pass' | 'fail' | null {
  const matches = [...text.matchAll(/VERDICT:\s*(PASS|FAIL)/gi)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1]![1]!.toUpperCase() === 'PASS' ? 'pass' : 'fail';
}

/** ★ walker(조사) PASS 의 grounding 판정 (Gap C · 2026-07-19) — 실제 조사 증거 없이 완료를 참칭하는
 *  fake-pass 를 차단한다. maxTurns 강제(예산)만으론 턴 수를 줄일 뿐 모델이 1턴에 가짜 `VERDICT: PASS`
 *  를 낼 수 있다("walker 견고성" 근본·라이브 dogfood 로 실증). ungrounded 조건:
 *    (a) 조사 도구 0회 — 아무것도 안 읽고 완료 참칭(게으른 pass).
 *    (b) maxTurns < 2 — 도구를 불러도 그 **결과를 합성할 턴이 구조적으로 없다**(turn 0=호출, turn 1=결과
 *        합성인데 1턴이면 결과 미반영) → PASS 가 도구 결과에 근거할 수 없다.
 *  ungrounded 면 caller 가 PASS 를 무효화(→실패 경로)해 재조사 self-heal 로 보낸다. 순수함수. */
export function assessWalkerGrounding(o: { toolCalls: number; maxTurns?: number }): { grounded: boolean; reason: string } {
  if (o.toolCalls <= 0) return { grounded: false, reason: '조사 도구 0회 — 실제 조사 없이 완료 참칭' };
  if (o.maxTurns !== undefined && o.maxTurns < 2) return { grounded: false, reason: `예산 상한(maxTurns=${o.maxTurns})으로 도구 결과 합성 불가 — 조사 미완` };
  return { grounded: true, reason: 'grounded(조사 도구 사용 + 결과 합성 턴 확보)' };
}

export interface MultiphaseResult {
  /** 페이즈 미션이 아니면 false — caller 가 단일턴으로 폴백. */
  multiphase: boolean;
  executed: number;
  done: number;
  failed: number;
  /** 총 페이즈 수(대표 2026-07-12) — "집행 N/total" 로 진행 명확화. */
  total?: number;
  /** 조기 중단으로 안 돌린 페이즈 제목(대표 2026-07-12) — 요약에 [미실행] 명시. */
  notRun?: readonly string[];
  phases: Array<{ title: string; status: string; summary?: string; prUrl?: string; phaseId?: string }>;
  /** ★ 전체 페이즈 스냅샷(대표 2026-07-12) — 실제 순서(생성순)·현재 상태. 리쥼 시 리포트가 이번
   *  run 실행분만 재번호하고 이미 done 인 앞 페이즈를 "미실행" 으로 오인하던 버그 해소. 리포트·
   *  재개 버튼 번호는 이걸 기준(실제 N/total). prUrl/critique 는 task 노트에서(과거 run 포함). */
  allPhases?: Array<{ index: number; title: string; status: string; phaseId: string; summary?: string; prUrl?: string;
    /** 자동 비평 요약(대표 2026-07-12) — 완료 리뷰·재반영 대상. findings 있으면 수정 필요. */
    critiqueVerdict?: string; critiqueFindings?: readonly string[] }>;
  /** ★ 아크 통합 검증 실패(RFC 아크·A5) — 페이즈는 green 이나 아크로는 미충족(dead-code·미배선).
   *  run-mission 이 arc-revise 수복 카드를 띄우는 신호(generic rerun 대신·마이그레이션 안전망). */
  arcFailure?: { arcId: string; name: string; intent: string; missing: string };
  /** ★ 아크 순차 배리어 홀드(자기 관측·대표 2026-07-16) — 아크가 미검증/실패라 후속 아크·페이즈가
   *  배리어에 막혀 실행 못 함을 미션이 스스로 인지·표면화("왜 executor 가 안 도나"의 답). run-mission
   *  요약·ops·elanous logs(mission.arc.barrier) 로 노출. 해소=아크 완성 후 재실행 또는 inject --arc. */
  arcBarrier?: { blockingArc: string; blockingStatus: string; blockedArcs: readonly string[]; blockedPhases: number; missing: string | null };
  /** ★ 아크 검증 보류(적응형 디깅·2026-07-14) — grounding 불충분으로 판정 불가("못 봤다"·arcFailure
   *  아님). arc-revise 대신 HITL 검증 보류 카드. false arc-revise(grounding miss→dead-code 오판) 방지. */
  arcUnverified?: { arcId: string; name: string; intent: string; reason: string };
}

/** 페이즈 완료 이벤트(실시간 알림용) — 각 페이즈가 done/failed 될 때마다 1회.
 *  handle = 지칭 핸들 `A<arc>·<hash4>·g<gen>`(파생·revise/rebuild 시 갱신·mission-phase-handle). */
export interface PhaseDoneEvent { index: number; total: number; title: string; status: string; prUrl?: string; summary?: string; phaseId?: string; missionId?: string; handle?: string; arcHandle?: string; arcSeq?: string; arcName?: string }

/** ★ 아크 이벤트(A7 arc-aware UX·2026-07-14) — 아크가 통합검증 통과/실패할 때 1회. 페이즈 이벤트와
 *  대칭으로 서피스(텔레그램 카드·요약 다채널)에 아크 레벨 진행을 실는다. kind=reconcile(시동 정합)/complete(실행 완료).
 *  handle = 아크 지칭 핸들 `A<idx+1>·<slug>`. */
export interface ArcResultEvent { arcId: string; name: string; arcIndex: number; arcTotal: number; status: 'done' | 'failed' | 'unverified' | 'descoped'; kind: 'reconcile' | 'complete'; evidence?: string; missing?: string; missionId?: string; handle?: string }

/**
 * ★ 자율 ACT 결정 계약 (RFC-autonomous-act·AA-X — 미션 phase 2/4 · 외부 수습 by claude-code 2026-07-16·
 *   provenance=external). OBSERVE(관측)→DECIDE(진단)→ACT(집행) 폐루프에서 "이 행동을 자율 집행할지
 *   HITL 로 넘길지"를 표현하는 **순수 결과 타입**. 이 단계는 계약만 정의(결정 함수·런타임 호출부는
 *   후속 페이즈). 기본거부(default-deny): mode 미상/모호·민감 행동·armed=false 는 항상 hitl/무집행.
 *   상관관계 식별자는 이 결정이 어느 OBSERVE·guard·outcome 과 묶이는지 추적(3박자 관측·감사). 기존
 *   PhaseDoneEvent/ArcResultEvent 상태 어휘를 재사용(별도 병렬 스키마 안 만듦). */
export interface AutonomousActDecision {
  /** 집행 경로 — autonomous(무해 자동집행) vs hitl(사람 승인·기본거부). */
  mode: 'autonomous' | 'hitl';
  /** 자율 집행 무장 상태. false 면 autonomous 라도 집행 안 함(관측·제안만·안전 기본값). */
  armed: boolean;
  /** 행동 종류 — 무해(빌드 힐·재스폰 등) vs 민감(실자금·파괴·arming). 민감은 항상 hitl. */
  actClass: 'harmless' | 'sensitive';
  /** OBSERVE 상관 — 이 결정을 촉발한 관측의 미션/페이즈/아크 좌표 + 소스(logs.db observe 등). */
  observeRef: { missionId?: string; phaseId?: string; arcId?: string; source: string };
  /** guard 상관 — 어떤 안전관문(기본거부·예산·무한루프 등)을 통과/차단했나. */
  guard: { name: string; passed: boolean; reason?: string };
  /** outcome 상관 — 집행 결과 상태(기존 페이즈/아크 상태 어휘 재사용). pending=아직 미집행. */
  outcome: PhaseDoneEvent['status'] | ArcResultEvent['status'] | 'pending';
  /** 결정 근거(감사·3박자 관측용). */
  rationale: string;
}

/**
 * ★ AA1 힐 자동집행 seam (RFC-autonomous-act·미션 phase 5·외부 수습·claude-code 2026-07-16). 기본
 *   미주입=no-op → 실패=기존 HITL 경로 그대로(회귀 0). 프로덕션이 진단 recommendedHeal + 실행
 *   어댑터(rebuild/split)를 주입해 arming. armed=false 에서도 무해·멱등·grounded 힐은 자동집행 허용
 *   (실무장 아님 — 빌드 힐은 실자금/파괴 경로가 아님). */
export interface Aa1HealSeam {
  /** 실패 페이즈의 권장 힐 + 무해/멱등/grounded 분류(기존 진단 재사용). null=힐 없음. */
  recommend: (task: Task, summary: string) => { kind: string; actClass: 'harmless' | 'sensitive' | 'unclassified'; idempotent: boolean; grounded: boolean } | null;
  /** 힐 집행 어댑터(기존 rebuild/split 등). 반환=성공 여부. */
  execute: (task: Task, kind: string) => Promise<boolean>;
}

/** decideAutonomousAct 입력 — 제안된 행동의 분류·allowlist·관측·가드 컨텍스트(순수·외부상태 미의존). */
export interface AutonomousActRequest {
  /** 행동 종류. sensitive(실자금·파괴·arming)=항상 hitl · unclassified=기본거부(hitl) · harmless=자율 후보. */
  actClass: 'harmless' | 'sensitive' | 'unclassified';
  /** 명시적 무해 allowlist 통과 여부(빌드 힐·재스폰 등 등재된 행동만 true). */
  allowlisted: boolean;
  /** OBSERVE 상관 좌표(결정에 그대로 유지). */
  observeRef: AutonomousActDecision['observeRef'];
  /** 적용된 guard(기본거부·예산 등). passed=false 면 무조건 hitl. */
  guard: AutonomousActDecision['guard'];
  /** 현재 outcome 상관(재사용·기본 pending). */
  outcome?: AutonomousActDecision['outcome'];
}

/**
 * ★ 기본거부(default-deny) 자율 ACT 결정 (RFC-autonomous-act·AA-X — 미션 phase 3/4 · 외부 수습·
 *   claude-code 2026-07-16·provenance=external). 결정론적 **순수 함수**(시각·난수·I/O·외부상태
 *   미의존). 위험 규칙이 허용 규칙보다 **우선**:
 *     1) sensitive(실자금·파괴·arming) → 항상 hitl.
 *     2) guard 미통과 → hitl.
 *     3) unclassified/미분류·미등재 → hitl(기본거부).
 *     4) harmless + allowlisted + guard 통과 → autonomous (단 armed 는 **항상 false** — 관측/제안만).
 *   autonomous 결과의 armed 는 절대 true 를 반환하지 않는다(실무장=별도 HITL·mandate 게이트). 계약의
 *   상관관계 식별자(observeRef·guard·outcome)를 그대로 유지한다. 런타임 호출부는 이 단계서 배선 안 함.
 */
export function decideAutonomousAct(req: AutonomousActRequest): AutonomousActDecision {
  // 미분류는 보수적으로 sensitive 로 기록(default-deny 정합).
  const recordedClass: AutonomousActDecision['actClass'] = req.actClass === 'harmless' ? 'harmless' : 'sensitive';
  const base = {
    armed: false as const, actClass: recordedClass,
    observeRef: req.observeRef, guard: req.guard, outcome: req.outcome ?? 'pending' as const,
  };
  // 위험 우선 — sensitive 는 무조건 hitl(허용 규칙보다 앞).
  if (req.actClass === 'sensitive') {
    return { ...base, mode: 'hitl', rationale: '민감 행동(실자금·파괴·arming) — 항상 HITL' };
  }
  // guard 미통과 → hitl.
  if (!req.guard.passed) {
    return { ...base, mode: 'hitl', rationale: `guard 차단(${req.guard.name}) — HITL${req.guard.reason ? `: ${req.guard.reason}` : ''}` };
  }
  // 기본거부 — 명시 무해 allowlist 통과만 autonomous(armed 은 항상 false).
  if (req.actClass === 'harmless' && req.allowlisted) {
    return { ...base, mode: 'autonomous', rationale: '무해·allowlist·guard 통과 — 자율 집행(armed=false·관측/제안)' };
  }
  return { ...base, mode: 'hitl', rationale: '미분류/미등재 — 기본거부(HITL)' };
}

/** executor 제어 이벤트(AA2 lifecycle·AA3 barrier·AA-X 경계) — decideExecutorControl 입력. */
export interface ExecutorControlEvent {
  kind: 'executor-start' | 'executor-retry' | 'executor-idle-stop'
    | 'barrier-reconcile' | 'barrier-retry'
    | 'external-kill' | 'destructive-reset' | 'arming' | string;
  missionId: string;
  arcId?: string;
  /** AA2 — 이 executor 가 mission-owned 인가(외부 프로세스 아님). 불명이면 기본거부. */
  owned?: boolean;
  /** AA3 — barrier reconcile/retry 가 멱등인가. */
  idempotent?: boolean;
  /** AA3 — 남은 재시도(>0 이어야 제한 retry 자동). */
  retriesLeft?: number;
}

/**
 * ★ executor 제어 자동대응 판정 (RFC-autonomous-act·AA2/AA3·미션 phase 6·외부 수습·claude-code 2026-07-16).
 * 기존 decideAutonomousAct 정책으로 하나의 제어 이벤트를 판정(별도 lifecycle manager/registry 안 만듦).
 *   AA2: mission-owned executor 의 무해 lifecycle 전이(start/retry/idle-stop)만 autonomous.
 *   AA3: 멱등 barrier reconcile · 남은 재시도 있는 제한 retry 만 autonomous.
 *   AA-X 경계: 외부 프로세스 종료·파괴적 reset·arming·소유권 불명·불명확 이벤트 → HITL.
 * 각 결정에 OBSERVE(missionId/arcId/source)·guard·outcome 상관 이벤트가 남는다(계약 유지).
 */
export function decideExecutorControl(event: ExecutorControlEvent): AutonomousActDecision {
  const observeRef = { missionId: event.missionId, ...(event.arcId ? { arcId: event.arcId } : {}), source: `executor-control:${event.kind}` };
  // AA2 lifecycle — mission-owned 무해 전이만.
  if (event.kind === 'executor-start' || event.kind === 'executor-retry' || event.kind === 'executor-idle-stop') {
    const owned = event.owned === true;
    return decideAutonomousAct({
      actClass: owned ? 'harmless' : 'unclassified',   // 소유권 불명 = 기본거부(HITL)
      allowlisted: owned,
      observeRef, guard: { name: 'aa2-lifecycle', passed: owned, ...(owned ? {} : { reason: '소유권 불명' }) },
    });
  }
  // AA3 barrier — 멱등 reconcile 또는 재시도 남은 제한 retry 만.
  if (event.kind === 'barrier-reconcile' || event.kind === 'barrier-retry') {
    const idem = event.idempotent === true;
    const retryOk = event.kind === 'barrier-reconcile' || (event.retriesLeft ?? 0) > 0;
    const ok = idem && retryOk;
    return decideAutonomousAct({
      actClass: ok ? 'harmless' : 'unclassified',
      allowlisted: ok,
      observeRef, guard: { name: 'aa3-barrier', passed: ok, ...(ok ? {} : { reason: '비멱등/재시도 소진/불명확' }) },
    });
  }
  // AA-X 경계 위험 — 외부 종료·파괴적 reset·arming = 항상 HITL(위험 우선).
  if (event.kind === 'external-kill' || event.kind === 'destructive-reset' || event.kind === 'arming') {
    return decideAutonomousAct({ actClass: 'sensitive', allowlisted: false, observeRef, guard: { name: 'aa-x-boundary', passed: true } });
  }
  // 불명확한 제어 이벤트 = 기본거부.
  return decideAutonomousAct({ actClass: 'unclassified', allowlisted: false, observeRef, guard: { name: 'aa2-3-unclear', passed: false, reason: '불명확한 제어 이벤트' } });
}

/**
 * ★ 외부 완성 게이트 판정 (AA4/AA5·미션 phase 8·외부 수습·claude-code 2026-07-16). phase 7 의
 * ExternalCompletion/ReuseBoundary 를 완성 게이트 입력으로 소비 — **유효한 grounded 외부 완성**만
 * no-op 완주(autoComplete), stale·범위 불일치·근거 부족은 자동 완주 안 하고 수동 검토로 남긴다.
 * reuseBoundary 는 손실 없이 후속 phase/arc 로 전달(AA5). 순수·결정론(라이브 배선은 opt-in).
 */
export function resolveExternalCompletionGate(
  completion: ExternalCompletion,
  boundary: ReuseBoundary,
): { autoComplete: boolean; reuse: ReuseBoundary; reason: string } {
  if (completion.complete && completion.grounded && boundary.freshness === 'fresh') {
    return { autoComplete: true, reuse: boundary, reason: `외부 완성 no-op 완주 — ${completion.evidence}` };
  }
  return { autoComplete: false, reuse: boundary, reason: `자동 완주 안 함(수동 검토) — ${completion.evidence}` };
}

/** ★ AA6 완주 후 정합성 회고 결과(phase 9). 읽기 전용 — 자동 clean/reset/commit 금지·불일치는 HITL. */
export interface Aa6Reconciliation {
  workingTreeClean: boolean;
  /** git status --porcelain 스냅샷(읽기 전용). */
  gitStatusSnapshot: string[];
  /** 승인 arc/mission 범위 vs 실제 배송 파일 정합. */
  scopeConsistent: boolean;
  mismatches: string[];
  /** 자동 경로는 항상 armed=false(자동 수정 없음). */
  armed: false;
  /** 불일치 → hitl 후속 조치(git 변경 없이). */
  followUp: 'none' | 'hitl';
}

/**
 * ★ 완주 후 정합성 회고 (AA6·미션 phase 9·외부 수습). 읽기 전용 git status 스냅샷·워킹트리 청결도·
 * 승인 범위 vs 배송 파일 정합을 구조화 결과로 기록. **자동 clean/reset/commit 없음**(armed=false 불변)·
 * 불일치는 HITL 후속으로만 승격. 순수(git status 라인은 주입·결정론·테스트 가능).
 */
export function reconcilePostRun(input: {
  gitStatusPorcelain: string[];   // 읽기 전용 주입(순수 유지).
  approvedScope: string[];        // 승인 arc/mission 범위(파일·심볼).
  deliveredFiles: string[];       // 실제 배송 파일.
}): Aa6Reconciliation {
  const clean = input.gitStatusPorcelain.length === 0;
  const outOfScope = input.deliveredFiles.filter((f) => !input.approvedScope.some((s) => f.includes(s) || s.includes(f)));
  const mismatches = [
    ...(clean ? [] : [`워킹트리 dirty — 미커밋 ${input.gitStatusPorcelain.length}건(언커밋 고아 의심)`]),
    ...outOfScope.map((f) => `범위 밖 배송: ${f}`),
  ];
  return {
    workingTreeClean: clean, gitStatusSnapshot: input.gitStatusPorcelain,
    scopeConsistent: outOfScope.length === 0, mismatches, armed: false,
    followUp: mismatches.length ? 'hitl' : 'none',
  };
}

/** 미션의 subagent 페이즈를 dependsOn 순서로 순회 집행(store 영속). onPhaseDone 은 각 페이즈
 *  종결 시 즉시 호출(실시간 알림·PR 링크). */
export async function runMultiphaseMission(
  missionId: string,
  runPhase: RunPhaseFn,
  deps: { store?: TaskStore; now?: () => number; log?: (s: string) => void; onPhaseStart?: (e: PhaseDoneEvent) => void; onPhaseDone?: (e: PhaseDoneEvent) => void; onArcResult?: (e: ArcResultEvent) => void; verifyArc?: ArcVerifier; parallelCap?: number; aa1Heal?: Aa1HealSeam } = {},
): Promise<MultiphaseResult> {
  const store = deps.store ?? new TaskStore();
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const ownsStore = !deps.store;

  try {
    const phases = store.listTasks({ goalSlug: missionId }).filter((t) => t.surface.kind === 'subagent');
    if (phases.length === 0) {
      return { multiphase: false, executed: 0, done: 0, failed: 0, phases: [] };
    }

    const byId = new Map(phases.map((t) => [t.id, t]));
    const isDone = (id: string): boolean => byId.get(id)?.status === 'done';
    // ★ 종결-스킵 dep(2026-07-14) — cancelled/superseded 는 영영 done 이 안 되므로 dependents 를
    //   영구 블록(deadlock)한다. descope(아크/페이즈 취소) 후 dependents 가 갇히던 갭 = 셀프힐로
    //   원천 차단: 종결-스킵 dep 은 non-blocking(그 산출은 없지만 dependent 는 진행). 실측: 미션
    //   …668871 arc2 descope 후 arc4 가 취소된 골든셋 페이즈 dep 으로 deadlock.
    const isTerminalSkip = (id: string): boolean => {
      const s = byId.get(id)?.status;
      return s === 'cancelled' || s === 'superseded';
    };
    // 존재하는(=trim 안 된)·미종결 dep 만 게이팅 — 삭제/취소된 페이즈 참조는 무시.
    const unmetDeps = (t: Task): string[] => t.dependsOn.filter((d) => byId.has(d) && !isDone(d) && !isTerminalSkip(d));

    // ★ 아크(RFC-mission-arcs·A2) — 골→아크→페이즈. flat 미션은 resolveArcs 가 암묵적 단일 아크
    //   (전 페이즈·의존 없음·통합 acceptance 없음)로 해석 → 아크 게이팅/검증 무영향(회귀 0).
    let missionArcs: readonly MissionArc[] | undefined;
    let missionGen = 0;
    try { const m = store.getMission(missionId); missionArcs = m?.autopilot?.arcs; missionGen = m?.autopilot?.rerunGeneration ?? 0; } catch { /* fail-soft */ }
    const arcs = resolveArcs(missionArcs, phases.map((p) => p.id));
    // ★ 지칭 핸들(DESIGN-mission-arc-phase-id-handles) — flat 미션은 아크 태그 생략(A1 무의미). 파생·순수.
    const flatMission = isFlatMission(missionArcs);
    const handleFor = (phaseId: string): string =>
      phaseHandle({ taskId: phaseId, generation: missionGen, ...(flatMission ? {} : { arcIdx: arcIdxForPhase(missionArcs, phaseId) }) });
    // 페이즈의 아크 지칭 — 핸들 `A2·slug` + 전체 중 순번 `2/3`(멀티 아크만·flat 은 생략).
    const arcInfoForPhase = (phaseId: string): { handle: string; seq: string; name: string } | undefined => {
      if (flatMission) return undefined;
      const idx = arcIdxForPhase(missionArcs, phaseId);
      if (idx == null || !arcs[idx]) return undefined;
      return { handle: computeArcHandle(arcs[idx]!, idx), seq: `${idx + 1}/${arcs.length}`, name: arcs[idx]!.name };
    };
    const arcById = new Map(arcs.map((a) => [a.arcId, a]));
    const arcOfPhase = (phaseId: string) => arcs.find((a) => a.phaseIds.includes(phaseId)) ?? null;
    // 아크 순차 배리어 — 페이즈의 아크가 선행 아크(dependsOnArcs) 전부 해소(done/descoped)여야 실행 가능.
    //   flat(단일 아크·의존 없음)이면 항상 true → 현행과 동일. descoped 선행 아크는 배리어 통과(2026-07-15·
    //   범위 제외 아크가 downstream 을 영구 홀드하지 않도록 — 668871 arc2 선례).
    const arcReady = (t: Task): boolean => {
      const arc = arcOfPhase(t.id);
      if (!arc) return true;
      return arc.dependsOnArcs.every((d) => isArcResolved(arcById.get(d)?.status ?? 'pending'));
    };
    // ★ arc.status 영속화(A7-L3·2026-07-14) — in-memory arcs(resolveArcs 복사본)의 status 를 미션
    //   autopilot 에 되쓴다. 이게 없어 status 변경이 프로세스 종료 시 증발 → 스토어 영원히 pending·
    //   리쥼마다 배리어 리셋이었다(RFC §14a 갭 3). flat(명시 아크 없음)은 저장 안 함(회귀 0).
    const persistArcs = (): void => {
      if (isFlatMission(missionArcs)) return;
      try {
        const fresh = store.getMission(missionId);
        if (fresh?.autopilot?.arcs) {
          store.saveMission({ ...fresh, autopilot: { ...fresh.autopilot, arcs: arcs.map((a) => ({ ...a })) } });
        }
      } catch { /* fail-soft — 영속화 실패가 실행을 막지 않음 */ }
    };
    // ★ 아크 이벤트 발신(A7 arc-aware UX) — 아크 통합검증 통과/실패/보류를 서피스에 실시간 통지(페이즈 대칭).
    const emitArc = (a: MissionArc, status: 'done' | 'failed' | 'unverified' | 'descoped', kind: 'reconcile' | 'complete'): void => {
      // ★ 관측 장치(대표 2026-07-19·제1원칙) — 아크 통합검증 결과(배리어 해제 positive 신호)를 logs.db 에도.
      //   배리어 held(mission.arc.barrier)와 짝 — `elanous logs --category mission.arc.verify` 로 아크 완성 와칭.
      try {
        debug.log('mission.arc.verify', status, {
          missionId, arc: a.name, arcSeq: `${arcs.indexOf(a) + 1}/${arcs.length}`, kind,
          ...(a.verifyResult?.missing ? { missing: a.verifyResult.missing.slice(0, 120) } : {}),
        });
      } catch { /* fail-soft */ }
      try {
        deps.onArcResult?.({
          arcId: a.arcId, name: a.name, arcIndex: arcs.indexOf(a), arcTotal: arcs.length, status, kind, missionId,
          ...(flatMission ? {} : { handle: computeArcHandle(a, arcs.indexOf(a)) }),
          ...(a.verifyResult?.evidence ? { evidence: a.verifyResult.evidence } : {}),
          ...(a.verifyResult?.missing ? { missing: a.verifyResult.missing } : {}),
        });
      } catch { /* fail-soft — 알림 실패가 실행을 막지 않음 */ }
    };
    // ★ 아크 증거 시드(적응형 디깅·2026-07-14) — 아크 페이즈들의 설명·notes 에서 파일참조를 뽑아
    //   검증기 grounding 시드로. intent 재유도가 놓치는 실구현을 파게 해 grounding miss(arc1 선례) 방지.
    const arcEvidence = (a: MissionArc): ArcEvidence => {
      const refs = new Set<string>();
      for (const pid of a.phaseIds) {
        const t = byId.get(pid);
        if (!t) continue;
        for (const f of extractFileRefs(`${t.title}\n${t.description ?? ''}\n${t.notes.join('\n')}`)) refs.add(f);
      }
      return { seedFiles: [...refs] };
    };

    // blocked/backlog 중 dep 충족된 것을 ready 로 승격(멱등).
    const promote = (): void => {
      for (const t of phases) {
        if ((t.status === 'blocked' || t.status === 'backlog') && unmetDeps(t).length === 0) {
          t.status = 'ready';
          t.updatedAt = now();
          store.saveTask(t);
        }
      }
    };

    const results: MultiphaseResult['phases'] = [];
    let executed = 0;
    let done = phases.filter((t) => t.status === 'done').length;
    let failed = 0;
    let arcFailure: MultiphaseResult['arcFailure']; // 아크 통합 검증 실패(A5 수복 신호).
    let arcUnverified: MultiphaseResult['arcUnverified']; // 아크 판정 보류(grounding 불충분·HITL).
    let arcBarrier: MultiphaseResult['arcBarrier']; // 아크 배리어 홀드 자기 관측(대표 2026-07-16).

    // ★ 아크 배리어 자기 관측(대표 2026-07-16·제1원칙) — 아크 미검증/실패로 후속 아크·페이즈가
    //   배리어에 막혀 실행 못 할 때, "무엇이·왜·무엇을 막나"를 logs.db(mission.arc.barrier)+run.log
    //   +result 로 표면화한다. 이게 없어 "executor 가 왜 안 도나"를 아무도 몰랐다(외부 규명 필요).
    const observeArcBarrier = (reason: string): void => {
      if (isFlatMission(missionArcs)) return;
      const unresolved = (id: string): boolean => !isArcResolved(arcById.get(id)?.status ?? 'pending');
      // 막힌 아크 = 미해소·미실패인데 선행 아크가 미해소.
      const blocked = arcs.filter((a) => !isArcResolved(a.status) && a.status !== 'failed'
        && a.dependsOnArcs.some(unresolved));
      const blockedPhases = blocked.reduce((n, a) => n + a.phaseIds.filter((pid) => {
        const s = byId.get(pid)?.status; return s !== 'done' && s !== 'cancelled' && s !== 'superseded';
      }).length, 0);
      // 1차 블로커 = reconcile 이 잡은 실패/보류 아크, 아니면 미해소 선행 아크.
      const primary = (arcFailure && arcs.find((a) => a.arcId === arcFailure!.arcId))
        || (arcUnverified && arcs.find((a) => a.arcId === arcUnverified!.arcId))
        || arcs.find((a) => !isArcResolved(a.status) && a.status !== 'failed' && a.dependsOnArcs.length === 0)
        || arcs.find((a) => !isArcResolved(a.status));
      if (!primary && blocked.length === 0) return;
      const missing = primary?.verifyResult?.missing ?? arcFailure?.missing ?? arcUnverified?.reason ?? null;
      arcBarrier = {
        blockingArc: primary?.name ?? '?', blockingStatus: primary?.status ?? 'pending',
        blockedArcs: blocked.map((a) => a.name), blockedPhases, missing,
      };
      try {
        debug.log('mission.arc.barrier', 'held', {
          missionId, reason, blockingArc: arcBarrier.blockingArc, blockingStatus: arcBarrier.blockingStatus,
          blockedArcs: arcBarrier.blockedArcs, blockedPhases, missing,
        });
      } catch { /* fail-soft */ }
      log(`[multiphase] 🚧 아크 배리어 — '${arcBarrier.blockingArc}'(${arcBarrier.blockingStatus}) 미해소로 후속 아크 ${blocked.length}개·페이즈 ${blockedPhases} 홀드${missing ? ` · missing: ${missing.slice(0, 80)}` : ''}. 해소=아크 완성 후 재실행 또는 elanous autopilot inject --arc(외부 수습).`);
    };

    promote(); // 초기 승격(dep 없는 blocked 도 ready 로).

    // ★ 시동 reconcile(A7-L3·2026-07-14) — 레트로 마이그레이션/리쥼 시 status 갇힘 해소(RFC §14a 갭 2·3).
    //   전 페이즈가 이미 done 인데 status 가 미완인 아크를 실 verifier 로 통합 검증→done/failed 후 persist.
    //   그래야 배리어가 정확하고(선행 아크 done 이어야 후속 실행), 이미 완료된 아크가 pending 에 안 갇힌다.
    //   flat(암묵 1아크)은 무영향(회귀 0). 아크 실패면 arcFailure 세팅 → 아래 실행 루프 스킵(arc-revise 수복).
    if (!isFlatMission(missionArcs)) {
      for (const arc of arcs) {
        if (isArcResolved(arc.status) || arc.status === 'failed') continue;
        if (arc.phaseIds.length === 0) continue;
        // ★ 자동 descope(2026-07-15) — 전 페이즈 terminal 인데 all-done 아님(cancelled 섞임) → 더 실행
        //   못 하고 verify 게이트(all-done)도 못 넘어 pending 영구 홀드(배리어 블록). non-blocking descoped
        //   로 전이(배리어 해소·재실행 안 함). 668871 arc2(임베딩 페이즈 cancelled) 선례.
        const pstatus = arc.phaseIds.map((pid) => byId.get(pid)?.status);
        const allTerminal = pstatus.every((s) => s === 'done' || s === 'cancelled' || s === 'superseded');
        if (allTerminal && !pstatus.every((s) => s === 'done')) {
          arc.status = 'descoped';
          arc.verifyResult = { ok: true, evidence: '범위 제외(descoped) — 전 페이즈 terminal(cancelled 포함·더 실행 없음). 완주 non-blocking.' };
          log(`[multiphase] ⊘ 아크 descoped — ${arc.name}(cancelled 페이즈로 축소·배리어 해소·재실행 안 함)`);
          emitArc(arc, 'descoped', 'reconcile');
          continue;
        }
        if (!arc.phaseIds.every((pid) => byId.get(pid)?.status === 'done')) continue;
        arc.status = 'verifying';
        const v = await verifyArcAcceptance(arc, missionId, deps.verifyArc, arcEvidence(arc));
        arc.verifyResult = { ok: v.ok, evidence: v.evidence, ...(v.missing ? { missing: v.missing } : {}) };
        if (v.ok) {
          arc.status = 'done';
          log(`[multiphase] ✓ 아크 reconcile 완료 — ${arc.name}${arc.acceptance.length ? `(통합 검증: ${v.evidence.slice(0, 60)})` : ''}`);
          if (arc.acceptance.length > 0) emitArc(arc, 'done', 'reconcile');
        } else if (v.grounded === false) {
          // ★ 판정 보류(적응형 디깅) — grounding 불충분("못 봤다"). failed 아님·arc-revise 안 함. HITL 보류.
          arc.status = 'verifying'; // 미완 표시 유지(배리어 홀드) — done/failed 아님.
          arcUnverified = arcUnverified ?? { arcId: arc.arcId, name: arc.name, intent: arc.intent, reason: v.missing ?? 'grounding 불충분(판정 불가)' };
          log(`[multiphase] 🔍 아크 reconcile 판정 보류 — ${arc.name}: grounding 불충분 → HITL 검증 보류(재-grounding 필요·arc-revise 아님)`);
          emitArc(arc, 'unverified', 'reconcile');
        } else {
          arc.status = 'failed';
          arcFailure = { arcId: arc.arcId, name: arc.name, intent: arc.intent, missing: v.missing ?? '통합 미충족' };
          log(`[multiphase] 🔒 아크 reconcile 검증 실패 — ${arc.name}: ${(v.missing ?? '').slice(0, 90)} → arc-revise 권장(페이즈 green·아크 미충족)`);
          emitArc(arc, 'failed', 'reconcile');
        }
      }
      persistArcs();
    }

    // ★ 아크 내 페이즈 병렬(RFC 아크·A3·2026-07-14) — 명시 아크가 있을 때만 병렬(flat/기존 미션은
    //   순차 유지·회귀 0). 한 배치는 한 아크만(아크 순차 배리어 유지). 병렬도 상한. race 안전:
    //   JS 단일스레드라 await(runPhase) 이후 블록은 sync-atomic(카운터·saveTask·notes 는 각 페이즈
    //   자기 것·인터리브 없음).
    const parallelEnabled = !isFlatMission(missionArcs);
    const PARALLEL_CAP = deps.parallelCap ?? 3;

    /** 페이즈 1개 실행(running→runPhase→done/failed→notes/results/알림·카운터). 반환=성공여부. */
    const executePhase = async (runnable: Task): Promise<boolean> => {
      runnable.status = 'running';
      runnable.updatedAt = now();
      store.saveTask(runnable);
      log(`[multiphase] ▶ ${runnable.title}`);
      try { const ai = arcInfoForPhase(runnable.id); deps.onPhaseStart?.({ index: phases.findIndex((p) => p.id === runnable.id), total: phases.length, title: runnable.title, status: 'running', phaseId: runnable.id, missionId, handle: handleFor(runnable.id), ...(ai ? { arcHandle: ai.handle, arcSeq: ai.seq, arcName: ai.name } : {}) }); } catch { /* fail-soft */ }
      let res: PhaseResult;
      try { res = await runPhase(runnable); }
      catch (e) { res = { ok: false, summary: e instanceof Error ? e.message : String(e) }; }
      // ── 이하 sync(await 없음) — 병렬 배치에서도 인터리브 없이 원자 처리 ──
      executed += 1;
      runnable.status = res.ok ? 'done' : 'failed';
      runnable.updatedAt = now();
      if (res.prUrl) runnable.notes = [...runnable.notes, `[SE-PR] ${res.prUrl}`];
      if (res.critiqueFindings && res.critiqueFindings.length) {
        const verdict = (res.critiqueVerdict ?? 'warn').toUpperCase();
        runnable.notes = [...runnable.notes, ...res.critiqueFindings.map((f) => `[CRITIQUE:${verdict}] ${f}`)];
      }
      // ★ R3 — 리뷰 escalate(미수렴·HITL) 각인. rebuild(정규식 /^\[CRITIQUE:/)엔 안 걸려 재큐 안 되고(bound 유지),
      //   mergeMissionPhases 가 이 마커를 자동머지 제외 근거로 쓴다(미해결 리뷰 PR 자동머지 차단·안전).
      if (res.reviewEscalated && res.reviewEscalated.length) {
        runnable.notes = [...runnable.notes, ...res.reviewEscalated.map((f) => `[REVIEW:ESCALATED] ${f}`)];
      }
      // ★ R3 — 실제 리뷰 PASS 각인(reviewAutoMerge requireReviewPass 게이트가 이 마커로 자동머지 대상 판정).
      if (res.reviewPassed) runnable.notes = [...runnable.notes, '[REVIEW:PASS]'];
      store.saveTask(runnable);
      byId.set(runnable.id, runnable);
      results.push({ title: runnable.title, status: runnable.status, summary: res.summary.slice(0, 200), phaseId: runnable.id, ...(res.prUrl ? { prUrl: res.prUrl } : {}) });
      try {
        deps.onPhaseDone?.({
          index: phases.findIndex((p) => p.id === runnable.id), total: phases.length,
          title: runnable.title, status: runnable.status,
          ...(res.prUrl ? { prUrl: res.prUrl } : {}), summary: res.summary,
          phaseId: runnable.id, missionId,
          handle: handleFor(runnable.id), ...((): { arcHandle: string; arcSeq: string; arcName: string } | object => { const ai = arcInfoForPhase(runnable.id); return ai ? { arcHandle: ai.handle, arcSeq: ai.seq, arcName: ai.name } : {}; })(),
        });
      } catch { /* fail-soft */ }
      if (res.ok) done += 1; else failed += 1;
      // ★ AA1 — 실패 페이즈 권장 힐 자동집행(RFC-autonomous-act·phase 5·외부 수습). decideAutonomousAct
      //   가드 뒤로만: 무해·멱등·grounded 힐만 autonomous(armed=false) 자동집행, 위험/근거부족은 HITL
      //   경로 유지. seam 미주입(기본)이면 no-op → 기존 동작 불변(회귀 0). 이 task 자기 notes 만 수정.
      if (!res.ok && deps.aa1Heal) {
        try {
          const rec = deps.aa1Heal.recommend(runnable, res.summary);
          if (rec) {
            const decision = decideAutonomousAct({
              actClass: rec.actClass,
              allowlisted: rec.idempotent,                                  // 무해 allowlist=멱등 힐만
              observeRef: { missionId, phaseId: runnable.id, source: 'phase-failure' },
              guard: { name: 'aa1-heal', passed: rec.grounded, ...(rec.grounded ? {} : { reason: 'grounding 부족' }) },
            });
            if (decision.mode === 'autonomous') {
              const ok = await deps.aa1Heal.execute(runnable, rec.kind);
              runnable.notes = [...runnable.notes, `[AA1-HEAL:${rec.kind}] 자율 집행(armed=false) → ${ok ? 'ok' : 'fail'}`];
            } else {
              runnable.notes = [...runnable.notes, `[AA1-HITL:${rec.kind}] ${decision.rationale} → 사람 승인 경로 유지`];
            }
            store.saveTask(runnable);
          }
        } catch { /* fail-soft — 힐 배선 실패가 미션을 막지 않음 */ }
      }
      return res.ok;
    };

    // guard: 각 iteration 이 ≥1 페이즈 종결 → ≤ phases.length 회.
    for (let guard = 0; guard <= phases.length; guard++) {
      if (arcFailure || arcUnverified) { observeArcBarrier('arc-unresolved(reconcile)'); break; } // 아크 실패/보류 → 실행 스킵(배리어 관측).
      const pending = phases.filter(
        (t) => t.status !== 'done' && t.status !== 'failed' && t.status !== 'cancelled' && t.status !== 'superseded',
      );
      if (pending.length === 0) break;

      // 실행 가능(페이즈 dep + 아크 배리어 둘 다 충족).
      const runnables = pending.filter((t) => (t.status === 'ready' || unmetDeps(t).length === 0) && arcReady(t));
      if (runnables.length === 0) {
        log(`[multiphase] 실행 가능 페이즈 없음(dep/아크 배리어 미충족) — 중단(${pending.length} 대기)`);
        observeArcBarrier('no-runnable(barrier)');
        break;
      }
      // 배치 = 첫 runnable 의 아크 페이즈만(아크 순차). flat/병렬 불가면 1개(순차·회귀 0).
      const batchArc = arcOfPhase(runnables[0]!.id);
      let batch = parallelEnabled && batchArc
        ? runnables.filter((t) => arcOfPhase(t.id)?.arcId === batchArc.arcId).slice(0, PARALLEL_CAP)
        : [runnables[0]!];
      if (batch.length > 1) log(`[multiphase] ⇉ ${batch.length}개 페이즈 병렬 실행${batchArc ? ` (아크: ${batchArc.name})` : ''}`);
      // ★ 아크 active 전이(A7-L3) — 아크 첫 배치 실행 시 pending→active + persist(관측성·제1원칙).
      if (batchArc && batchArc.status === 'pending') { batchArc.status = 'active'; persistArcs(); }

      const oks = await Promise.all(batch.map((r) => executePhase(r)));

      if (oks.some((ok) => !ok)) {
        log(`[multiphase] ✗ 배치 내 페이즈 실패 — 중단(후속 blocked 유지)`);
        break;
      }
      // ★ 아크 완성 감지 + 통합 검증(A2) — 배치가 아크의 전 페이즈를 done 시켰으면 통합 검증.
      const arc = batchArc && arcOfPhase(batch[0]!.id);
      if (arc && !isArcResolved(arc.status) && arc.status !== 'failed'
          && arc.phaseIds.every((pid) => byId.get(pid)?.status === 'done')) {
        arc.status = 'verifying'; // A7-L3 — 통합 검증 진입 관측.
        const v = await verifyArcAcceptance(arc, missionId, deps.verifyArc, arcEvidence(arc));
        arc.verifyResult = { ok: v.ok, evidence: v.evidence, ...(v.missing ? { missing: v.missing } : {}) };
        if (v.ok) {
          arc.status = 'done';
          if (arc.acceptance.length > 0) { log(`[multiphase] ✓ 아크 완료 — ${arc.name}(통합 검증 통과: ${v.evidence.slice(0, 60)})`); emitArc(arc, 'done', 'complete'); }
        } else if (v.grounded === false) {
          // ★ 판정 보류(적응형 디깅) — grounding 불충분. failed 아님·arc-revise 안 함. HITL 보류.
          arc.status = 'verifying';
          arcUnverified = arcUnverified ?? { arcId: arc.arcId, name: arc.name, intent: arc.intent, reason: v.missing ?? 'grounding 불충분(판정 불가)' };
          log(`[multiphase] 🔍 아크 판정 보류 — ${arc.name}: grounding 불충분 → HITL 검증 보류(arc-revise 아님)`);
          emitArc(arc, 'unverified', 'complete');
        } else {
          arc.status = 'failed';
          failed += 1;
          arcFailure = { arcId: arc.arcId, name: arc.name, intent: arc.intent, missing: v.missing ?? '통합 미충족' };
          log(`[multiphase] 🔒 아크 통합 검증 실패 — ${arc.name}: ${(v.missing ?? '').slice(0, 90)} → 중단(페이즈는 green 이나 아크로는 미충족·arc-revise 권장)`);
          emitArc(arc, 'failed', 'complete');
        }
        persistArcs(); // ★ A7-L3 — done/failed/verifying 를 스토어에 되쓴다(리쥼 넘어 배리어 보존).
        if (arc.status === 'failed' || arcUnverified) break;
      }
      promote();
    }

    // ★ 미실행 페이즈(대표 2026-07-12) — 조기 중단(페이즈 실패) 시 안 돌린 페이즈 제목.
    //   run-mission 요약이 "완료" 처럼 보이던 문제 해소(총 N 중 executed 만·나머지 미실행 명시).
    const ranTitles = new Set(results.map((r) => r.title));
    const notRun = phases.filter((p) => !ranTitles.has(p.title)).map((p) => p.title);
    // ★ 전체 페이즈 스냅샷(대표 2026-07-12) — 생성순 실제 순서 + 최신 상태(in-place 갱신됨). 이번
    //   run 실행분(results)의 summary/prUrl 을 title 로 매칭해 붙임(리쥼해도 앞 done 페이즈 보존 표시).
    const resultByTitle = new Map(results.map((r) => [r.title, r]));
    const allPhases = [...phases].sort((a, b) => a.createdAt - b.createdAt).map((p, i) => {
      const ran = resultByTitle.get(p.title);
      // ★ PR 기억 소실 수정(대표 2026-07-12) — 이전 run 에서 done 된 페이즈의 PR 은 이번 run
      //   results 엔 없지만 task 노트([SE-PR])에 보관돼 있다. 노트에서 읽어 리쥼해도 과거 PR 보존.
      const prUrl = ran?.prUrl ?? prUrlFromNotes(p.notes);
      const cq = critiqueFromNotes(p.notes); // 완료 리뷰·재반영 대상(과거 run 포함).
      return { index: i, title: p.title, status: p.status, phaseId: p.id,
        ...(ran?.summary ? { summary: ran.summary } : {}), ...(prUrl ? { prUrl } : {}),
        ...(cq.verdict ? { critiqueVerdict: cq.verdict } : {}), ...(cq.findings.length ? { critiqueFindings: cq.findings } : {}) };
    });
    return { multiphase: true, executed, done, failed, total: phases.length, notRun, phases: results, allPhases, ...(arcFailure ? { arcFailure } : {}), ...(arcUnverified ? { arcUnverified } : {}), ...(arcBarrier ? { arcBarrier } : {}) };
  } finally {
    if (ownsStore) store.close();
  }
}
