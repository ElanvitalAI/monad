#!/usr/bin/env bun
// ── scripts/run-mission.ts <missionId> (Narrow Waist V5 · 2026-07-09) ──────
//
// 승인된 scheduler 미션의 반복 실행기. 예약(cron)이 발화하면 이 스크립트가:
//   1) 미션 골을 로드(mission-registry) →
//   2) 텔레그램 에이전트 턴(makeTelegramAgentRunTurn·풀 도구)으로 골 실행 →
//   3) 결과를 sendOutbound 로 대표에게 발송(텔레그램·quiet-hour 존중).
// approveMission(scheduler)이 schedule_manage create 로 이 스크립트를 cron 에 배선
// (autopilot_id 스탬프). 설계: 내부 문서 `DESIGN-intent-narrow-waist-2026-07-09` §V5.

import { ensureCronNodePath } from '../src/domains/cron-path.js';
ensureCronNodePath();
// ⛔⭐ 위 호출이 «런타임에» PATH 를 고치는데, bun 은 자식에게 「기동 시 스냅샷」을 준다 —
//   그래서 이 파일의 spawn 중 «최소 PATH 에 없는 도구»를 부르는 것은 env 를 «명시»해야 한다.
//   📏 2026-08-31 실측: `env -i sh -c 'command -v git'` ✅ / `gh` ⛔ ⇒ gh 호출 둘만 노출이다.


// ★ 인스턴스 스코프 상속(ISO·2026-07-19 조율자 인프라 후속) — 부모 데몬(defaultSpawnRunMission)이
// argv 로 넘긴 --config-dir 을 setElanousConfigDir 로 적용하고 argv 에서 strip. 이걸 store 열기
// (openAutopilotMissionsDb·226행)·getUserConfig(270행)·argv[2] missionId(219행) 소비 전에 해야
// 데몬과 같은 config(게이트·예산)/tasks.db 를 읽는다. 미적용 시 항상 ~/.elanous 를 읽어 "데몬 시작 후
// config 변경 미반영"(재시작 필요). strip 후 argv[2]=missionId 유지(플래그는 항상 뒤에 붙는다).
// se-mission-prepare.ts:30 과 동형(#4095 형제 경로).
import { applyConfigDirFlagFromArgv } from '../src/cli/config-dir-flag.js';
applyConfigDirFlagFromArgv();

import { getUserConfig } from '../src/user-config.js';
import { getSessionCwd, setSessionCwd } from '../src/session/working-dir.js';
import { makeTelegramAgentRunTurn } from '../src/telegram-agent.js';
import { ensureCliSession } from '../src/session/chat.js';
import { openAutopilotMissionsDb, getMission } from '../src/autopilot/mission-registry.js';
import { sendOutbound } from '../src/domains/outbound-alert.js';
import { loadMissionOrigin } from '../src/autopilot/mission-origin.js';
import { notifyMissionRerunButton, notifyPhaseResult, notifyPhaseProgress, notifyMissionReviewSummary, notifyArcResult } from '../src/autopilot/mission-notify.js';
import { acquireRunLock, releaseRunLock } from '../src/autopilot/mission-run-lock.js';
import { resumeAfterSplit } from '../src/autopilot/mission-split-resume.js';
import { runMultiphaseMission, parsePhaseVerdict, assessWalkerGrounding, persistPhaseProgress } from '../src/autopilot/mission-multiphase-executor.js';
import { defaultArcVerifier } from '../src/autopilot/mission-arc-verify.js';
import { classifyPhaseKindSmart, classifyPhaseKindDetailed, classifyPhaseKind, runImplementationPhaseViaSE, phaseSlug, type PhaseKind } from '../src/autopilot/mission-se-bridge.js';
import { resolvePhaseFramework } from '../src/autopilot/run-phase-framework.js';
import { readWorkingMemory, formatWorkingMemoryForPrompt, parseWorkingMemorySignals, stripWorkingMemoryMarker, type PhaseMemoryKind } from '../src/autopilot/mission-working-memory.js';
import { formatRfcDesignForPrompt } from '../src/autopilot/mission-rfc-store.js';
import { computeRemovalLivenessWarning } from '../src/autopilot/mission-removal-liveness.js';
import { consumeMissionSignal, MISSION_RESPAWN_SCOPE } from '../src/autopilot/pipeline/mission-signal.js';
// ★ 일원화 RFC U2 — 워킹메모리 write 는 코디네이터 게이트 단일 관문으로(appendWorkingMemory 직접 호출 금지·grep 가드).
import { coordinatorRecordMemory } from '../src/autopilot/pipeline/coordinator-memory.js';
import { recordMissionObservation } from '../src/autopilot/mission-observation.js';
import { debug as debugLog } from '../src/debug/log.js';  // ★ walker 관측(2026-07-21) — sync 컨텍스트(recordPhaseWorkingMemory)용 정적 import.
import { extractRequiredArtifacts, artifactFirstInstruction, checkArtifactExistence } from '../src/autopilot/mission-artifact-discipline.js';
import { triageRetry, type RetryAttemptEvidence, type RetryPath, type RetryTriageDecision } from '../src/autopilot/mission-retry-triage.js';
import { buildPhaseOutcomeFromSummary, synthesizePhaseDiagnosis, buildDiagnosisNote, parseTriageHealOverride, type PhaseOutcome } from '../src/autopilot/mission-phase-diagnosis.js';
import { renderSuspectNotes, type ContradictionSignal } from '../src/autopilot/contradiction-detector.js';
import { attemptsForPhase } from '../src/autopilot/se-build-registry.js';
import { missionRunLogPath, defaultSpawnRunMission } from '../src/autopilot/mission-engine.js';
import { selfHealArmed } from '../src/autopilot/arming.js';
import { rebuildPhase } from '../src/autopilot/mission-lifecycle.js';
import { recordOpsEventSafe } from '../src/domains/ops-log.js';
import { TaskStore } from '../src/task-orchestrator/store.js';
import { arcIdForPhase, formatArcContextForPhase, formatArcHandoffForPhase } from '../src/autopilot/mission-arc.js';
// ★ C5(문맥관리 트랙) — 조율자 시야(미션 전체 진행)를 walker 로 하향 주입하는 순수 조립기(2층 컨텍스트).
import { formatCoordinatorContextForWalker } from '../src/autopilot/pipeline/coordinator-context.js';
import { injectSelfMemory } from '../src/domains/self-awareness.js';
import { openSchedulesDb, listSchedules, setScheduleMission } from '../src/domains/schedule-registry.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveWalkerBudget, resolveWalkerMaxTurns } from '../src/autopilot/mission-budget.js';
import { resolveGoalLoopMaxIterations, loopControlFromConfig } from '../src/autopilot/mission-loop-policy.js';
import { resolveRouteDecision } from '../src/llm/route-decision.js';
import { persistMissionRouteDecision } from '../src/autopilot/mission-route-decision.js';

/** 보호 경로 — 미션 페이즈가 편집하면 안 되는 코어 코드(스케줄 등록·스크립트 실행·아티팩트만 허용). */
const PROTECTED_RE = /^(src|apps|test)\//;

/** 페이즈 실패 유형 분류 — 재시도 가능 여부(대표 2026-07-12). budget(예산소진)/transient(일시적)
 *  은 재시도, blocked(전제부재·코어편집 필요)/unknown 은 재시도 안 함(무한루프·헛수고 방지). 순수함수. */
function classifyFailure(text: string): { reason: string; retryable: boolean } {
  if (/예산 소진|도구 예산|budget|토큰 한도|max.?tokens|끝까지.*못|전체.*(조사|완료).*못|중간에.*중단|소진/i.test(text)) return { reason: 'budget', retryable: true };
  if (/타임아웃|timeout|일시적|rate.?limit|network|네트워크|연결.*실패|잠시 후|다시 시도/i.test(text)) return { reason: 'transient', retryable: true };
  if (/전제.*부재|불가능|권한.*없|코어.*편집.*필요|스크립트.*없|파일.*없|존재하지 않/i.test(text)) return { reason: 'blocked', retryable: false };
  return { reason: 'unknown', retryable: false };
}

/** ★ O5-live(대표 2026-07-13·PLAN) — 페이즈 실패 사실 위에서 근본원인을 LLM 으로 추론.
 *  결정론 골격(synthesizePhaseDiagnosis)보다 풍부한 서술. fail-soft(실패 시 undefined→골격 사용).
 *  근거 없는 원인 환각 금지는 프롬프트로 강제. reasoning 저비용(low). */
async function llmRootCause(o: { title: string; goal?: string; failClass?: string; attempts: Array<{ backend: string; maxTurns?: number; gateResult: string }>; envSignals?: { ghAuth?: boolean }; gateReasons?: string }): Promise<string | undefined> {
  try {
    const { streamLLM } = await import('../src/llm.js');
    const trail = o.attempts.map((a) => `${a.backend.replace(/^elanous-self:/, '')}${a.maxTurns ? ' ' + a.maxTurns + '턴' : ''}->${a.gateResult}`).join(' -> ');
    const prompt = [
      '자율 미션 페이즈 실패의 사실이다. 근본원인을 1-2문장으로 추론하고, 이어서 권장 힐을 한 단어로 답하라.',
      '반드시 "추정"을 명시하고, 아래 사실에 근거하지 않은 원인은 만들지 마라(환각 금지).',
      `페이즈: ${o.title}`,
      o.goal ? `목표: ${o.goal.slice(0, 200)}` : '',
      `실패분류: ${o.failClass ?? '미상'}`,
      `시도 트레일: ${trail}`,
      o.envSignals?.ghAuth === false ? '환경: 격리 worktree 에 gh 인증 없음' : '',
      // ★ run.log 게이트 실패 사유(대표 2026-07-13) — 요약 문자열보다 훨씬 구체(dead-code·범위밖·
      //   no-op 등). 이걸 근거로 opus 수준 진단·힐 추천이 가능(요약 regex 만으론 rebuild 로 퇴화).
      o.gateReasons ? `게이트 실패 상세(run.log):\n${o.gateReasons.slice(0, 900)}` : '',
      '판단 가이드: 여러 시도가 dead-code(미배선)/범위밖/no-op 로 반복 실패 = 과대 페이즈 → 분할(split) 권장. 일시오류 → 재구현. 능력부재(gh 등) → 골정정.',
      '출력(한국어): 근본원인 추정 1-2문장. 마지막 줄에 "권장: <split|rebuild|revise|skip>".',
    ].filter(Boolean).join('\n');
    const text = await streamLLM([{ role: 'user', content: prompt }], () => {}, { model: process.env.ELANOUS_DECOMPOSE_MODEL || 'gpt-5.6-sol', reasoningEffort: 'low' });
    const out = text.trim().replace(/\s+/g, ' ');
    return out.length >= 10 ? out.slice(0, 500) : undefined;
  } catch { return undefined; }
}

/** ★ R3 시스템 소스 룩백(대표 2026-07-13·진단 해상도 사다리) — 게이트 입력↔판정 모순(시스템 결함
 *  의심)이 감지되면, 격리 밖 mission-system 소스를 READ-ONLY 로 읽어 근본을 LLM 조사한다. "주어진
 *  정보(게이트 사유)만이 아니라 시스템 자체를 의심"(대표). 모순 없으면 undefined→기존 llmRootCause
 *  골격. 수정은 하지 않는다(보고만·실 수정 HITL). fail-soft. */
async function systemLookbackRootCause(outcome: PhaseOutcome): Promise<{ root?: string; signals: ContradictionSignal[] }> {
  try {
    // ★ 셀프힐 배선(대표 2026-07-13) — 신호 감지·소스 룩백을 runSystemLookback(단일 출처)로 위임
    //   (그간 인라인 중복). 진단 rootCause 는 기존 모델(sol) 유지(review seam 주입)로 behavior 불변.
    //   escalate(사람 탭)는 별도로 fresh Opus R3 를 돌린다. 감지 신호는 caller 가 [SUSPECT] 로 영속.
    const { phaseSystemSuspectSignals } = await import('../src/autopilot/mission-phase-diagnosis.js');
    const signals = phaseSystemSuspectSignals(outcome);
    if (signals.length === 0) return { signals: [] }; // 모순 없음 → 시스템 의심 안 함(R0~R2 골격)
    const { runSystemLookback } = await import('../src/autopilot/system-lookback-run.js');
    const { streamLLM } = await import('../src/llm.js');
    const { report, investigated } = await runSystemLookback({
      phaseTitle: outcome.title, signals,
      review: (prompt) => streamLLM([{ role: 'user', content: prompt }], () => {}, { model: process.env.ELANOUS_DECOMPOSE_MODEL || 'gpt-5.6-sol', reasoningEffort: 'medium' }),
    });
    const out = report.trim();
    const root = investigated && out.length >= 20 ? `[R3 소스 룩백] ${out.slice(0, 700)}` : undefined;
    return { ...(root ? { root } : {}), signals };
  } catch { return { signals: [] }; }
}

/** ★ run.log 에서 게이트 실패 사유 줄 발췌(대표 2026-07-13) — se-bridge 의 gate-failed/비평/
 *  범위밖/no-op 라인(요약 문자열보다 훨씬 구체). 진단 LLM 입력으로 opus 수준 판단 가능케. */
function extractGateReasons(logPath: string): string | undefined {
  try {
    if (!existsSync(logPath)) return undefined;
    const lines = readFileSync(logPath, 'utf-8').split('\n')
      .filter((l) => /gate-failed|비평 FAIL|범위밖|no-op|폴백|예산 상향|미완\/훼손|status=/.test(l))
      .map((l) => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\[\?[0-9;]*[a-z]/gi, '').trim())
      .filter(Boolean);
    const tail = lines.slice(-12).join('\n');
    return tail.length >= 10 ? tail : undefined;
  } catch { return undefined; }
}

/** 실행 전 dirty/untracked 파일 스냅샷 — 미션이 "새로" 건드린 것만 구분하기 위함. */
function snapshotDirtyFiles(): Set<string> {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8', cwd: process.cwd() });
    const set = new Set<string>();
    for (const line of (r.stdout ?? '').split('\n')) { const f = line.slice(3).trim(); if (f) set.add(f); }
    return set;
  } catch { return new Set(); }
}

/** ★ 가드 일시정지 센티넬(대표 2026-07-13) — 사용자/외부 도구가 메인트리에서 시스템을 고치는
 *  중이면 이 파일을 두어 가드를 전면 비활성(사용자 의도 우선). `touch ~/.elanous/guard-pause`. */
const GUARD_PAUSE_FLAG = join(homedir(), '.elanous/guard-pause');
function guardPaused(): boolean {
  try { return existsSync(GUARD_PAUSE_FLAG); } catch { return false; }
}

/** 되돌리기 전 현재(사용자) 내용 백업 — 오작동해도 복구 가능(영구 파괴 금지). 백업 경로 반환. */
function backupBeforeRevert(f: string, stamp: string): string | null {
  try {
    const src = join(process.cwd(), f);
    if (!existsSync(src)) return null;
    const dir = join(homedir(), '.elanous/backups/guard-reverted', stamp);
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, f.replace(/[/\\]/g, '__'));
    copyFileSync(src, dest);
    return dest;
  } catch { return null; }
}

export interface GuardResult { reverted: string[]; backupDir: string | null; skipped: 'multiphase' | 'paused' | null }

/** ★ 코어 코드 편집 가드(대표 2026-07-12·안전화 2026-07-13) — task 미션이 실행 중 메인트리 코어
 *  코드(src/·apps/·test/)를 편집하면 되돌린다(범위 초과·미검토·라이브 위험). 3층 안전:
 *   1) 멀티페이즈/SE 미션은 격리 worktree 라 메인트리를 안 건드림 → 스킵(오탐 원천 제거).
 *   2) ~/.elanous/guard-pause 존재 시 전면 비활성(사용자 개발 중·사용자 의도 우선).
 *   3) 되돌리기 전 현재 내용 백업(복구 가능·영구 파괴 금지).
 *  실행 전부터 dirty 였던 파일(beforeDirty)은 안 건드림. fail-soft. */
function guardCoreCodeEdits(beforeDirty: Set<string>, opts: { multiphase?: boolean } = {}): GuardResult {
  // 1) 멀티페이즈=격리 → 메인트리 변경은 100% 외부 동시작업. 절대 되돌리지 않는다.
  if (opts.multiphase) return { reverted: [], backupDir: null, skipped: 'multiphase' };
  // 2) 사용자 일시정지 플래그.
  if (guardPaused()) return { reverted: [], backupDir: null, skipped: 'paused' };
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf-8', cwd: process.cwd() });
    const reverted: string[] = [];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let backupDir: string | null = null;
    for (const line of (r.stdout ?? '').split('\n')) {
      const status = line.slice(0, 2);
      const f = line.slice(3).trim();
      if (!f || beforeDirty.has(f) || !PROTECTED_RE.test(f)) continue;
      // 3) 되돌리기 전 백업(사용자 작업 복구 가능).
      const bak = backupBeforeRevert(f, stamp);
      if (bak && !backupDir) backupDir = join(homedir(), '.elanous/backups/guard-reverted', stamp);
      if (status.includes('?')) spawnSync('git', ['clean', '-f', '--', f], { cwd: process.cwd() });
      else spawnSync('git', ['checkout', '--', f], { cwd: process.cwd() });
      reverted.push(f);
    }
    if (reverted.length) console.warn(`[run-mission] ⚠️ 코어 코드 편집 가드 — ${reverted.length}건 되돌림(백업 ${backupDir}): ${reverted.join(', ')}`);
    return { reverted, backupDir, skipped: null };
  } catch { return { reverted: [], backupDir: null, skipped: null }; }
}

/** 자율 미션 실행을 elanous 자기인지 기억에 기록(적정 시점=완료). fail-soft. */
async function selfLogMissionRun(summary: string, text: string): Promise<void> {
  try { await injectSelfMemory({ tool: 'autopilot', summary, kind: 'autonomy', importance: 6, text }); }
  catch { /* fail-soft — 기억 주입 실패가 실행을 막지 않음 */ }
}

/** 실행 전 스케줄 id 스냅샷 — 자동 태깅 기준선. fail-soft. */
function snapshotScheduleIds(): Set<string> {
  try { const db = openSchedulesDb(); try { return new Set(listSchedules(db).map((s) => s.id)); } finally { db.close(); } }
  catch { return new Set(); }
}

/** ★ 플랫폼 자동 태깅(대표 지시 2026-07-12) — 실행 중 새로 생성된(태그 없는) 스케줄을 미션
 *  apm_id 로 자동 태깅. 페이즈가 만든 크론이 미션 계보에 묶여 /mission_del cascade 로 함께
 *  삭제됨(orphan 근절 — 에이전트가 --apm 을 안 붙여도 플랫폼이 보장). fail-soft. */
function autoTagNewSchedules(mid: string, beforeIds: Set<string>): number {
  try {
    const db = openSchedulesDb();
    try {
      let tagged = 0;
      for (const s of listSchedules(db)) {
        if (!beforeIds.has(s.id) && !s.autopilot_id) { setScheduleMission(db, s.id, mid); tagged += 1; }
      }
      if (tagged > 0) console.log(`[run-mission] 새 스케줄 ${tagged}건 미션 계보 자동 태깅(orphan 방지).`);
      return tagged;
    } finally { db.close(); }
  } catch { return 0; }
}

const missionId = (process.argv[2] ?? '').trim();
if (!missionId) {
  console.error('usage: run-mission.ts <missionId>');
  process.exit(1);
}

// 1) 미션 골 로드
const store = openAutopilotMissionsDb();
let goal = '';
try {
  const m = getMission(store, missionId);
  if (!m) { console.error(`[run-mission] 미션 없음: ${missionId}`); process.exit(1); }
  goal = m.goal;
} finally { store.close(); }

// 중복 실행 가드(대표 2026-07-12) — 같은 미션 run-mission 이 이미 살아있으면 조기 종료(single-flight).
//   재실행/재spawn 이 겹쳐도 페이즈를 두 프로세스가 경쟁 집행하지 않도록. 종료 시 자동 해제.
if (!acquireRunLock(missionId)) {
  console.log(`[run-mission] ${missionId} — 이미 실행 중(락 보유) · 중복 프로세스 조기 종료`);
  process.exit(0);
}
// ★ split 자동재개 갭 수정(대표 2026-07-21·기본 안정화 첫 타겟) — split(자율 폐루프)은 이 프로세스가
//   락 보유 중 일어나므로 mission-phase-split 의 즉시 재spawn 이 "이미 실행 중" 조기종료 → 서브페이즈
//   재개자 0 → 정지(라이브 705308 에서 3회 반복 실증·수동 rerun 강요). 수정: split 은 편입만(재spawn
//   defer·아래 1242 에서 no-op 주입), 이 프로세스가 멀티페이즈 완료 후 락 명시 해제 → detached 재spawn
//   (아래 exit 직전). skipLockRelease 로 exit 핸들러가 child 락(다른 pid)을 지우지 않게 보호(race 차단).
//   관측(대표 2026-07-21·자기인지 필수)=mission.exec.split-resume(deferred·respawn-after-unlock).
let splitOccurred = false;
let skipLockRelease = false;
let respawnDone = false;
// ★ split 재개 seam(대표 2026-07-21) — 모든 종료 경로(정상완료·SIGTERM→exit·중간예외→exit)가 이 함수를
//   거치고 idempotent(respawnDone). split 이면 락 해제 후 detached 재spawn·성공/실패 관측(mission-split-resume).
const resumeSplitIfNeeded = (): void => {
  // ★ 런타임 리커버리 중단 장치(대표 2026-07-22) — 자율 재개/힐링(split respawn)을 **CLI signal 로 동적 차단**.
  //   종전엔 respawn 이 signal 을 무시해 `elanous autopilot signal <id> abort|pause` 후에도 재spawn 루프가 계속
  //   돌아 페이즈가 무한 확장됐다(라이브 실측). 여기서 미션 signal 이 abort|pause 면 respawn 을 스킵한다 —
  //   config(정적) 아니라 런타임 주입(CLI)으로 힐링 루프를 즉시 멈추는 장치. clear 로 재개. fail-soft(신호 못
  //   읽으면 종전대로 respawn·무회귀).
  try {
    // ★ TTL/누수-aware(2026-07-23 대표·리뷰 반영) — consumeMissionSignal 이 stale(발신 walker 종료 후)/누수
    //   신호는 무시+원자적 clear. 종전 raw readSignal 은 stale abort 가 영속해 모든 respawn 을 영구 차단
    //   (systemic 데드락 근본). ★리뷰 #3 반영 — respawn 은 MISSION_RESPAWN_SCOPE 로 소비: phase-specific 신호는
    //   mismatch(정리)되고 **global(phaseId 없는) fresh abort 만** respawn 차단(phase-bound 보장·최대 TTL 차단 해소).
    const sig = consumeMissionSignal(missionId, MISSION_RESPAWN_SCOPE);
    if (sig && (sig.kind === 'abort' || sig.kind === 'pause')) {
      try { debugLog.log('mission.exec.split-resume', 'recovery-halted', { missionId, by: `signal:${sig.kind}` }); } catch { /* fail-soft */ }
      return; // respawn 차단(동적 힐링 정지)
    }
  } catch { /* fail-soft — 신호 못 읽으면 종전대로 respawn */ }
  void resumeAfterSplit({
    splitOccurred,
    alreadyDone: () => respawnDone,
    markDone: () => { respawnDone = true; },
    markSkipRelease: () => { skipLockRelease = true; },
    releaseLock: () => releaseRunLock(missionId),
    spawnRun: () => defaultSpawnRunMission(missionId),
    observe: (e) => { try { debugLog.log('mission.exec.split-resume', e, { missionId }); } catch { /* fail-soft */ } },
  });
};
// exit 핸들러 = 최종 보장 경로 — split 재개(idempotent)를 먼저 시도(락 해제·skipLockRelease 설정 포함),
//   그 다음 split 아닐 때만 락 해제(정상 종료). SIGTERM 은 teardown 후 process.exit(0)→이 핸들러로 수렴.
process.on('exit', () => { resumeSplitIfNeeded(); if (!skipLockRelease) releaseRunLock(missionId); });

// ★ agent-loop-substrate 조각3 — graceful teardown 계약(SIGTERM/SIGINT cancel 시 결정론적 자원 회수·좀비 방지).
//   종전엔 exit 핸들러(sync)만 있어 cancel(SIGTERM) 경로에서 정리 보장이 없었다(중지 시 좀비 위험). 등록 자원을
//   LIFO fail-soft 로 1회 해제 후 graceful exit. releaseRunLock 은 멱등(exit 핸들러와 중복 무해). 제1원칙 3박자:
//   관측(mission.exec.teardown)·자기인지(ok/failed)·셀프힐(fail-soft 격리로 좀비 잔존 방지).
const { createTeardownContract } = await import('../src/agent-substrate/teardown.js');
const missionTeardown = createTeardownContract();
missionTeardown.register('run-lock', () => { if (!skipLockRelease) releaseRunLock(missionId); });
// ★ SIGTERM/SIGINT race 차단(리뷰 3차·대표 2026-07-21) — teardown 은 LIFO. split-resume 를 run-lock
//   **후** 등록해 **먼저** 실행되게 한다: split 이면 resume(skipLockRelease 설정→락 해제→재spawn 원자적)가
//   먼저 돌고, 뒤이은 run-lock 은 skipLockRelease=true 라 skip(조기 락 해제로 외부가 끼어드는 중복실행 race
//   차단). split 아니면 resume no-op → run-lock 이 정상 해제. exit 핸들러의 resume 은 idempotent(중복 무해).
missionTeardown.register('split-resume', () => { resumeSplitIfNeeded(); });
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void missionTeardown.run(sig).then(async (r) => {
      try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.teardown', sig, { missionId, ok: r.okCount, failed: r.failedCount, steps: r.steps.map((s) => `${s.name}${s.ok ? '' : ':FAIL'}`) }); } catch { /* fail-soft */ }
    }).finally(() => process.exit(0));
  });
}

// ★ 자기인지 관측 store sink(RFC 3박자·P1·2026-07-14) — run-mission 은 별도 스폰 프로세스라
//   데몬(nexus)의 StoreSink 를 상속하지 않는다. 등록 안 하면 셀프힐 관문(recordMissionObservation)
//   의 debug.log 가 파일 트레일에만 남고 logs.db 에 안 닿아 `elanous logs` 로 조회 불가(P1 무실효).
//   데몬과 같은 instanceName 으로 등록 → 통합 조회. fail-soft(실패해도 미션은 돈다).
try {
  const [storeMod, dbgMod, cfgMod] = await Promise.all([
    import('../src/mss/logging/log-store.js'),
    import('../src/debug/log.js'),
    import('../src/user-config.js'),
  ]);
  const logsCfg = cfgMod.getUserConfig().logs;
  storeMod.setLogInstanceName(logsCfg.instanceName);
  const offStore = storeMod.registerLogStoreSink((s) => dbgMod.debug.registerSink(s), 'autopilot', logsCfg.retention);
  if (offStore) { process.on('exit', offStore); missionTeardown.register('log-store-sink', offStore); }
} catch { /* fail-soft — 파일 트레일이 진실원 */ }

console.log(`[run-mission] ${missionId} · goal: ${goal}`);

// 미션 발신 origin(어느 채널/봇에서 시작했나) — 완료/실패 알림을 그 채널(메인 Q&A 봇)로 되돌린다.
//   없으면 sendOutbound 가 report 폴백(대표 2026-07-12: 실행 알림이 finance report 채널로 새던 갭 정정).
const missionOrigin = loadMissionOrigin(missionId);

// 실행 전 스케줄 스냅샷 — 페이즈/턴이 만든 새 스케줄을 완료 후 미션 계보에 자동 태깅.
const beforeScheduleIds = snapshotScheduleIds();
// 실행 전 dirty 스냅샷 — 미션이 새로 편집한 코어 코드(src/apps/test)를 완료 후 자동 되돌림(가드).
const beforeDirty = snapshotDirtyFiles();

// 2) 에이전트 턴으로 골 실행(풀 도구 — 텔레그램 Q&A 와 동일)
const cfg = getUserConfig();
const runTurnImpl = makeTelegramAgentRunTurn(cfg);
// ★ 실행 프로바이더 라벨(대표 2026-07-15) — 텔레그램 페이즈 카드에 "어떤 모델이 트리거·집행하는지"
//   노출. config 의 provider/model(코딩 에이전트가 태우는 모델). auto 면 model 만.
const execProviderLabel = cfg.llm.provider === 'auto'
  ? (cfg.llm.model || 'auto')
  : `${cfg.llm.provider}:${cfg.llm.model || '?'}`;
const session = ensureCliSession(cfg, undefined, { title: `mission:${missionId}` });
const system =
  '너는 elanous 의 예약 미션 실행기다. 아래 미션 골을 지금 수행하고, 결과를 한국어로 ' +
  '간결하고 실용적으로 정리해 보고하라. 최신 정보가 필요하면 도구를 사용하라. ' +
  '보고는 바로 대표에게 발송되니 인사말 없이 핵심부터.';

// 2a) 멀티페이즈 우선 — 승인된 미션에 subagent 페이즈가 있으면 dependsOn 순서로 순회 집행
//     (approve→멀티페이즈 executor 폐루프). 페이즈 없으면 아래 단일턴 폴백.
const phaseSystem =
  '너는 elanous 의 멀티페이즈 미션 실행기다. 아래는 한 페이즈의 지시와 acceptance 다. ' +
  '지시를 지금 수행하고 acceptance 를 실제로 충족했는지 스스로 검증하라. 도구를 적극 사용하라. ' +
  '성공/실패와 핵심 근거를 한국어로 간결히 보고하라. ' +
  '★반드시 응답의 맨 마지막 줄에 판정을 정확히 이 형식으로 출력하라: ' +
  'acceptance 전부 충족이면 "VERDICT: PASS", 하나라도 미충족·차단(전제 부재 등)·불확실이면 "VERDICT: FAIL". ' +
  '이 토큰이 없으면 실패로 간주된다. ' +
  '★범위 제한: 너는 스케줄 등록·기존 스크립트 실행·아티팩트/리포트 작성만 한다. ' +
  // ★ 크론 등록 가이드(대표 2026-07-13·walker fix) — walker 가 크론 등록 방법을 못 찾아 예산을
  //   소진하던 문제(price-guard 페이즈4). 정확한 도구·검증법을 명시.
  '★크론/스케줄 등록은 반드시 `bun src/index.ts schedule create` 명령(또는 elanous schedule 도구)으로 한다. ' +
  'crontab 직접 편집·schedules.db 직접 write 는 금지다(대표 방침). 옵션이 헷갈리면 `bun src/index.ts schedule create --help` 로 확인하라. ' +
  '등록 직후 반드시 `bun src/index.ts schedule list` 로 그 잡이 실제 등록됐는지 눈으로 확인하고, 그 출력을 VERDICT PASS 근거로 보고에 인용하라. 등록을 확인하지 못하면 VERDICT FAIL 이다. ' +
  '코어 코드(src/·apps/·test/)는 절대 편집·생성하지 마라 — 필요해 보여도 하지 말고 그 사실을 보고에 남겨라. ' +
  '(범위 밖 코어 편집은 플랫폼이 자동 되돌린다.) ' +
  // ★ ③검증 스코프 정합(근본·2026-07-22·핸드오프 3근본 #3) — 종전 "acceptance 를 스스로 검증하라"만
  //   있어 검증 페이즈가 전체 `bun test`/전체 tsc 를 돌렸다. 이 저장소 base 는 기존 실패(80 tsc·order-
  //   dependent test 오염)를 안고 있어 전체 스위트는 구조적으로 통과 불가 → base 실패를 보고 VERDICT
  //   FAIL → 무한 재시도·페이즈 확장(3947ef doomed 실지점). 프로젝트 정책=변경파일 touch-clean 스코프.
  '★검증 스코프(대표 방침·touch-clean): 테스트·타입체크로 검증할 때 절대 전체 스위트(`bun test`)·전체 tsc 를 돌리지 마라. ' +
  '이 저장소 base 에는 네 변경과 무관한 기존 실패(약 80 tsc 에러·order-dependent 테스트 오염)가 있어 전체 검증은 구조적으로 통과 불가다. ' +
  '변경한 파일·디렉토리만 검증하라: 변경 디렉토리는 `bun test <디렉토리>`, 타입은 `bun run scripts/ci-typecheck-changed.ts`(변경된 .ts 만 검사). ' +
  '스토어 경로(db·json)를 새로 추가/이동했으면 `bun run gate:isolation`(격리 하드코딩 ratchet 게이트)도 돌려라 — `join(homedir(), ".elanous", …)` 직접 하드코딩은 test↔prod 격리를 깨므로 resolver(elanousStateRoot/memoryDbPath/getElanousConfigDir)를 거쳐야 하고, 신규 하드코딩은 이 게이트가 차단한다. ' +
  'base 에 이미 있던 실패는 네 책임이 아니며 그것으로 VERDICT FAIL 하지 마라 — 네 변경이 "새로" 깨뜨린 것만 회귀다. ' +
  // ★ 조사 도구 가드(대표 지시 2026-07-12) — 조사/확인 페이즈가 동기 read 명령(git status·
  //   rev-parse·grep·파일읽기)에 비동기 PtyShell 을 골라 1회 폴링 후 출력이 아직 안 나오자
  //   "repo root 못 찾음"으로 단정·포기하던 실패(dogfood: 조사 페이즈 blocked). PtyShell 은
  //   지속·인터랙티브·서버·watch 같은 "긴 작업" 전용 — 조사는 인터랙티브 세션이 아니다.
  '★조사·확인은 read-only 동기 작업이다: git status/branch/rev-parse, grep, 파일 읽기는 ' +
  '반드시 Bash·Read·Grep·Glob 로 하라. PtyShell 은 쓰지 마라 — 조사는 인터랙티브 세션이 아니다 ' +
  '(PtyShell 은 지속·서버·watch 같은 긴 작업 전용). 도구 결과가 한 번 비거나 예상과 달라도 ' +
  '즉시 포기하지 말고 다른 도구로 재확인하라. repository root 는 현재 작업 디렉터리이며 ' +
  'git rev-parse --show-toplevel 로 확인된다(정상 동작함).';
// ★ 페이즈 내부 진행 표시(대표 2026-07-12) — onPhaseStart 가 보낸 "구현 중" 메시지 좌표를 캡처해,
//   SE 격리 구현의 변곡점(재시도·예산 상향·opus 폴백)마다 그 메시지를 edit(진행을 실시간 노출).
//   + [PROGRESS] note 영속 — 텔레그램 밖(TUI/PWA)이 store 폴링으로 같은 변곡점을 미러하도록.
let phaseProgress: { msgId: number | null; phaseId?: string; info: { index: number; total: number; title: string; provider?: string; arcName?: string; arcSeq?: string } } | null = null;
// ★ 미션 워킹 메모리(P1/P2 기록·P3 주입 · 2026-07-13) — 각 페이즈가 자기 작업(요약·재사용 경계·
//   결정·산출물)을 미션 스코프 워킹 메모리에 남겨, 후속 페이즈(fresh 세션)가 읽어 조사→구현 지식
//   전달 갭을 메운다. 전부 fail-soft(기록/읽기 실패가 미션을 절대 막지 않음).
//   walker(조사) 에이전트가 응답 말미에 재사용 경계를 구조화해 남기도록 지시하는 힌트.
const WORKING_MEMORY_EMIT_HINT =
  '\n\n[미션 워킹 메모리 기록 지시] 응답 맨 마지막(VERDICT 줄 앞)에 다음 마커와 JSON 한 줄을 출력하라 — ' +
  '후속 페이즈가 네 조사 결과를 재사용한다. reusables 에는 후속 구현이 반드시 재사용해야 할 export/경계를 ' +
  '"파일:심볼" 형식으로(예: "finance-tools:quoteToMarketSignal"), decisions 에는 네가 내린 핵심 결정을 넣어라. ' +
  '없으면 빈 배열로 남겨라(지어내지 말 것). ★ 또한 플랜과 다르게 진행했으면(목표 대비 범위 축소·페이즈 보류·' +
  '사용자 되묻기 필요·선행 환경 개선·지형 차이로 재해석) deviation 에 남겨라 — 완벽한 플랜은 없으니 구현에서 ' +
  '바로잡되 "왜 달라졌나"를 남긴다(없으면 deviation 생략). kind 는 scope_reduction|deferred|asked_user|' +
  'env_improved|regrounded|other 중 하나:\n[WORKING-MEMORY]\n{"reusables":[],"decisions":[],"summary":"이 페이즈에서 파악/결정한 것 한 줄","deviation":{"kind":"other","note":"플랜과 다르게 한 이유(이탈 없으면 이 필드 생략)"}}';

/** 워커/조사 페이즈의 워킹 메모리 kind 판정 — 제목이 조사·파악·분석류면 investigation, 아니면
 *  operational(크론 등록 등). 순수·정규식(분류 LLM 재호출 없이 경량). */
function walkerMemKind(title: string): PhaseMemoryKind {
  return /조사|파악|분석|식별|추적|확인|대조|조회|검토|스파이크|spike|investigat/i.test(title) ? 'investigation' : 'operational';
}

/** 페이즈 결과를 미션 워킹 메모리에 기록(P1/P2). agentText 있으면 [WORKING-MEMORY] 마커에서
 *  reusables/decisions 추출(walker), 없으면 summary 만(impl). 전부 fail-soft·항상 non-throw. */
function recordPhaseWorkingMemory(
  mid: string,
  task: { id: string; title: string },
  memKind: PhaseMemoryKind,
  opts: { summary?: string; agentText?: string; prUrl?: string },
): void {
  try {
    const sig = opts.agentText
      ? parseWorkingMemorySignals(opts.agentText)
      : { summary: (opts.summary ?? '').slice(0, 600), reusables: [] as string[], decisions: [] as string[] };
    // ★ 아크 태깅(A4·2026-07-14) — 이 페이즈의 아크 id 를 워킹메모리에 심어 아크 메이트 강조 주입 근거.
    let arcId: string | undefined;
    try { const s = new TaskStore(); const arcs = s.getMission(mid)?.autopilot?.arcs; s.close(); arcId = arcIdForPhase(arcs, task.id); } catch { /* fail-soft */ }
    coordinatorRecordMemory(mid, {
      phaseId: task.id,
      phaseTitle: task.title,
      kind: memKind,
      summary: sig.summary || (opts.summary ?? ''),
      reusables: sig.reusables,
      decisions: sig.decisions,
      artifacts: opts.prUrl ? [opts.prUrl] : [],
      ...(arcId ? { arcId } : {}),
      ...(sig.deviation ? { deviation: sig.deviation } : {}),
    });
    // ★ premise 활용 관측(2026-07-21·제1원칙 point4) — wm-inject/premise-inject 는 "주입(도착)"만 남긴다.
    //   walker 가 그 전제를 실제 읽고 반영했는지의 증거 = 방출한 decisions/reusables + deviation(regrounded 등).
    //   이걸 mission.walker 로 각인해 "premise 도착 → walker 반응"의 짝을 조회 가능하게(도착↔활용 갭 종결).
    //   ★조회: elanous logs --category mission.walker (event=premise-applied). fail-soft.
    try {
      debugLog.log('mission.walker', 'premise-applied', {
        missionId: mid, phaseId: task.id, kind: memKind,
        decisions: sig.decisions.length, reusables: sig.reusables.length,
        ...(sig.deviation ? { deviationKind: sig.deviation.kind } : {}),
      });
    } catch { /* fail-soft — 관측 실패가 미션을 막지 않음 */ }
    // ★ E1 구현 이탈 관측(대표 2026-07-18·제1원칙 3박자·stage=edit) — 페이즈가 플랜과 다르게 진행했으면
    //   logs.db+self-memory+ops 에 남겨 "구현이 왜 플랜과 달라졌나"가 미션 그래프·회고에 회상되게(휘발 방지).
    //   fail-soft — 관측 실패가 미션을 막지 않는다.
    if (sig.deviation) {
      try {
        recordMissionObservation({
          missionId: mid, phaseId: task.id, phaseTitle: task.title, stage: 'edit', verdict: 'inject',
          rationale: `구현 이탈(${sig.deviation.kind}) — ${sig.deviation.note}`.slice(0, 300),
        });
      } catch { /* fail-soft */ }
    }
  } catch { /* fail-soft */ }
}

// ★ 페이즈 스택(대표 2026-07-13 · 페이즈 의존성 전파) — 직전 성공 구현 페이즈의 원격 브랜치를 추적해
//   다음 구현 페이즈의 worktree base 로 넘긴다. 이전 산출물 위에 쌓여야 후속 페이즈가 재사용 가능
//   (dogfood: 페이즈2 가 페이즈1 정책을 main 기준 worktree 라 못 봐 중복 생성·실패). 미머지여도
//   origin/se/<slug> 로 스택(built 시 push 됨). operational(조사) 페이즈는 브랜치 없음 → 유지.
let lastImplBranch: string | undefined;
// ★ 재개 스택 재구성(2026-07-14 · 힐링) — lastImplBranch 는 in-process 변수라 rebuild/resume 로
//   run-mission 이 재spawn 되면 undefined 로 리셋된다. 게다가 이미 done 인 앞 페이즈는 executor 가
//   skip(재실행 X)해 채워지지 않는다 → 재개 페이즈의 worktree 가 main 에서 분기해 앞 산출물을 상실
//   (dogfood a6230f: 재개 후 coordinator-mission.ts 가 fresh 129줄·앞 서브페이즈 코드 없음·재구현).
//   시작 시 이미 done 인 impl 페이즈의 원격 브랜치(origin/se/<slug>·존재하는 것만)로 lastImplBranch 를
//   재구성해 스택 체인을 잇는다. 조사(operational) 페이즈는 브랜치가 없어 자연히 제외. fail-soft.
try {
  const { TaskStore } = await import('../src/task-orchestrator/store.js');
  const store = new TaskStore();
  try {
    const doneSub = store.listTasks({ goalSlug: missionId })
      .filter((t) => t.surface.kind === 'subagent' && t.status === 'done')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const t of doneSub) {
      const br = `origin/se/${phaseSlug(missionId, t)}`;
      const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', br], { cwd: process.cwd() });
      if (r.status === 0) lastImplBranch = br;  // 존재하는 마지막 impl 브랜치 = 누적 tip
    }
    if (lastImplBranch) console.log(`[multiphase] 🔗 재개 스택 재구성 — baseBranch=${lastImplBranch} (마지막 done impl 페이즈·worktree main 분기 방지)`);
  } finally { store.close(); }
} catch { /* fail-soft — 재구성 실패는 main 기준(종전 동작) */ }
// ★ S4 실행 프레임 저널(실행 적응 2026-07-19) — onPhaseStart/Done 에서 페이즈 실행을 프레임으로 남긴다
//   (관측·리플레이 토대·빌드 PipelineFrame 과 분리). 동기 콜백에서 쓰도록 미리 로드. status 문자열은
//   ExecPhaseStatus 로 안전 매핑(미지 값은 done 근사). always-on 관측(제1원칙)·fail-soft.
const { recordExecPhase: recordExecPhaseFrame, recordPendingWrite: recordPendingWriteFrame, collectPendingWrites } = await import('../src/autopilot/pipeline/exec-frame-journal.js');
// ★ 재개 고아 회수(조율자 격상 P0) — 재spawn 시, 이전 실행이 PR 은 냈으나 정상 종결 프레임을 못 남긴
//   pending-write(고아 후보)를 회수해 관측한다. lastImplBranch 재구성(위 origin/se 프로빙)의 durable
//   원장 백업 — 브랜치 프로빙이 놓친 산출물도 조율자가 인지(재구현 차단 근거). READ-ONLY·fail-soft.
try {
  const orphans = collectPendingWrites(missionId);
  if (orphans.length) {
    console.log(`[multiphase] ♻️  미종결 pending-write ${orphans.length}건 회수(고아 방지) — ${orphans.map((o) => `${o.phaseTitle.slice(0, 24)}[${o.artifacts.length}]`).join(', ')}`);
    try {
      const { debug } = await import('../src/debug/log.js');
      debug.log('mission.exec.frame', 'orphan-recovered', { missionId, count: orphans.length, phases: orphans.map((o) => o.phaseId) });
    } catch { /* fail-soft */ }
  }
} catch { /* fail-soft — 회수 실패는 종전 동작(브랜치 프로빙만) */ }
const toExecPhaseStatus = (s: string): 'running' | 'done' | 'failed' | 'skipped' | 'blocked' | 'no-op' =>
  (s === 'done' || s === 'failed' || s === 'skipped' || s === 'blocked') ? s : 'done';
// ★ S1 긍정 발산 스킵(execPhaseSkip opt-in·2026-07-19) — 이미 충족된 페이즈는 실행을 생략한다. 게이트는
//   user-config(autopilot.execPhaseSkip·기본 OFF·비파괴). luna 판정기는 경량(effort low)·grounding 으로
//   아크커버 판단. env override(ELANOUS_SATISFACTION_MODEL) 허용(디버그).
let execPhaseSkipEnabled = false;
try { const ap = getUserConfig().raw?.autopilot as { execPhaseSkip?: unknown } | undefined; execPhaseSkipEnabled = ap?.execPhaseSkip === true; } catch { /* OFF */ }
// ★ P4 셀프힐 자동집행 게이트(opt-in·기본 OFF·비파괴) — ON 이면 GoalBlocker 유형화로 실패 페이즈 자동힐
//   (재조사/재시도 진단 워킹메모리 주입·harmless·멱등). decideAutonomousAct 가드가 실집행 최종 게이트.
let selfHealAutoExecEnabled = false;
try { const ap = getUserConfig().raw?.autopilot as { selfHealAutoExec?: unknown } | undefined; selfHealAutoExecEnabled = ap?.selfHealAutoExec === true; } catch { /* OFF */ }
// ★ split 자율 집행 게이트 — 기본 ON 전환(대표 철학=유연 대응·2026-07-21). heal=split(과대→분할)을 HITL
//   없이 자율 splitPhaseIntoSubphases 집행 + 사후 통지("알아서 나누고 진행"). 라이브 705308 근본: split 권장을
//   splitAutoExec OFF 라 escalate(HITL)로 멈춘 지점 — 자율 폐루프가 그 자리를 메운다. 안전 근거: reuse-existence
//   교정(아래)이 split 오판(재사용 미이행→rebuild)을 선행 필터 + splitPhaseIntoSubphases 는 자기완결(재분해→
//   재배선→arc 치환→재spawn)이라 국소 구조조정. 롤백 seam 보존: autopilot.splitAutoExec=false 로 OFF(escalate/HITL
//   split 경로 그대로 최후 안전망). maturity 자동금지 원칙은 존중(성숙도 분리는 여전히 자율 제안까지만·apply=HITL).
let splitAutoExecEnabled = true;
try { const ap = getUserConfig().raw?.autopilot as { splitAutoExec?: unknown } | undefined; if (ap?.splitAutoExec === false) splitAutoExecEnabled = false; } catch { /* 기본 ON 유지 */ }
// ★ split 수렴가드(대표 2026-07-21·남발 진단) — 한 아크가 임계(ARC_SPLIT_DRIFT_THRESHOLD=2) 이상 split
//   되면 split 은 "실패 만능 처방"이 되어 무한 재귀(라이브 617097: 페이즈 6→11). 근본 = isTooBig 의
//   재시도=과대 자동성립 + splitCount 상한 부재. 가드 ON = drift 감지 아크의 split 을 차단하고 heal 을
//   escalate 로 강등(→ arc-edit reshape / progress-verdict / HITL). detectArcSizeDrift 는 이미 관측하나
//   자동집행이 없던 갭을 메움(관측→자기인지→힐 완성). 기본 OFF·무회귀(가드 미발동 시 종전 split 그대로).
let splitConvergenceGuardOn = false;
try { const ap = getUserConfig().raw?.autopilot as { splitConvergenceGuard?: unknown } | undefined; if (ap?.splitConvergenceGuard === true) splitConvergenceGuardOn = true; } catch { /* 기본 OFF 유지 */ }
// ★ 아크 reshape 자율집행(대표 2026-07-21·split 남발 ② 근본·PLAN-coordinator-arc-reshape) — 수렴가드가
//   차단한 반복 split 을 escalate 로 끝내지 말고, 코디네이터가 **전체 아크 문맥**(assembleMissionState +
//   gradePhaseGranularity concern)으로 아크단위 재성형(re-decompose/merge/carve/maturity)을 자율 집행.
//   plan↔impl granularity 통일(concern 단위)로 "실패=크기 오귀속" 종결. 기본 OFF·무회귀(splitConvergenceGuard 동반).
let arcReshapeAutoExecOn = false;
try { const ap = getUserConfig().raw?.autopilot as { arcReshapeAutoExec?: unknown } | undefined; if (ap?.arcReshapeAutoExec === true) arcReshapeAutoExecOn = true; } catch { /* 기본 OFF 유지 */ }
// ★ 과대신호 엄격화(대표 2026-07-21) — isTooBig 의 `gateFails>=2` 단독(=재시도 실패면 diff 무관 거의 항상
//   참)이 실패를 크기로 오귀속해 split 을 남발시킨 근원. ON 이면 실제 크기신호(파일 다수)나 계단소진+반복만
//   과대로 인정 → 재시도만으론 split 아님. 기본 OFF·무회귀.
let strictOversizeOn = false;
try { const ap = getUserConfig().raw?.autopilot as { strictOversizeSignal?: unknown } | undefined; if (ap?.strictOversizeSignal === true) strictOversizeOn = true; } catch { /* 기본 OFF 유지 */ }
// ★ P5c(대표 2026-07-21) — 조율자 아크 편집 자율 집행(delete-phase·set-arc-done 등). splitAutoExec 이 못
//   잡은 터미널 실패에 조율자가 LLM 판정→편집. opt-in(기본 OFF·비파괴·무위험 랜딩). dogfood 로 실증 후 ON.
let arcEditAutoExecEnabled = false;
try { const ap = getUserConfig().raw?.autopilot as { arcEditAutoExec?: unknown } | undefined; if (ap?.arcEditAutoExec === true) arcEditAutoExecEnabled = true; } catch { /* 기본 OFF 유지 */ }
// ★ P6b(대표 2026-07-21) — 상황점검·진행 판단(증거 재수집 후 continue/arc-adjust/replan/partial-stop). 반복
//   실패에 곧바로 판단 않고 증거(grounding) 위 verdict. replan=재수집/재준비 자율 경로 신설. opt-in(기본 OFF).
let progressVerdictEnabled = false;
try { const ap = getUserConfig().raw?.autopilot as { progressVerdictAutoExec?: unknown } | undefined; if (ap?.progressVerdictAutoExec === true) progressVerdictEnabled = true; } catch { /* 기본 OFF 유지 */ }
// ★ Gap C walker verdict grounding 게이트(opt-in·기본 OFF·2026-07-19) — ON 이면 walker(조사) 의 PASS 를
//   실제 조사 증거(도구 사용 + 결과 합성 턴)로 검증한다. fake-pass(0도구·maxTurns<2 참칭)면 PASS 무효화→
//   재조사 self-heal. maxTurns 강제(예산)가 완료 참칭까지 막진 못하는 "walker 견고성" 근본 대응.
let walkerGroundingEnabled = false;
try { const ap = getUserConfig().raw?.autopilot as { walkerGroundingGate?: unknown } | undefined; walkerGroundingEnabled = ap?.walkerGroundingGate === true; } catch { /* OFF */ }
const { classifyGoalBlocker, goalBlockerToHealRecommend } = await import('../src/autopilot/pipeline/goal-blocker.js');
const { observeCoordinator, logProgressLedger } = await import('../src/autopilot/pipeline/mission-progress-ledger.js');
// ★ 통합 조율 런타임 UR1(2026-07-19) — 조율자 매스텝 결정을 단일 순수 스텝(coordinatorStep)으로 수렴.
//   onPhaseDone 이 중앙 State(UR0 조립)를 coordinatorStep 에 넣어 ledger 판정 + State 갱신을 한 곳에서.
//   State 를 매스텝 persist → 실행이 중앙 State 를 통과(단일 런타임의 첫 실체). 저널 재-read 제거.
const { assembleMissionState, persistMissionState, readMissionState } = await import('../src/autopilot/pipeline/mission-state-assemble.js');
const { coordinatorStep } = await import('../src/autopilot/pipeline/coordinator-step.js');
// ★ R1(RFC-autonomous-pr-review) — 리뷰-재작업 교착을 onPhaseDone(sync)에서 판정하려 module-scope 정적 바인딩.
const { decideCoordinatorCommand: decideCoordCmd, deriveReviewSignals: deriveReviewSig } = await import('../src/autopilot/pipeline/coordinator-command.js');
// ★ S7(대표 2026-07-20·교착 재구성) — onPhaseDone 은 non-async 라 상단에서 미리 import(동기 호출).
const { canUseUxAgent: canUxS7 } = await import('../src/ux/ux-config.js');
const { notifyMissionHitlViaUx: notifyUxS7 } = await import('../src/autopilot/mission-ux-live.js');
let deadlockNotified = false;
const { applyChannelUpdates, cursorUpdate, readCursor } = await import('../src/autopilot/pipeline/mission-state-channels.js');
// ★ UR2 — 조율자 라우팅을 중앙 State 가 소유(routingForPhase read·routingUpdate write). 재실행/재개 정합.
const { routingForPhase } = await import('../src/autopilot/pipeline/coordinator-command.js');
// ★ UR3 재개 커서 소비 — 리플레이 goto/rewind 가 중앙 State 에 남긴 재개 위치를 읽어 그 페이즈를 ready 로
//   리셋(executor 가 그 지점부터 재실행)하고 커서 클리어. State 가 '현재 위치'를 소유(리플레이→재개 배선).
try {
  const persisted = readMissionState(missionId);
  const cursor = persisted ? readCursor(persisted) : undefined;
  if (cursor) {
    const cstore = openAutopilotMissionsDb();
    let reset = false;
    try {
      const t = cstore.listTasks({ goalSlug: missionId }).find((x) => x.id === cursor.phaseId);
      if (t && t.status !== 'ready') { cstore.saveTask({ ...t, status: 'ready' }); reset = true; }
    } finally { cstore.close(); }
    observeCoordinator('resume-from-cursor', missionId, { phaseId: cursor.phaseId, reason: cursor.reason, reset });
    // 커서 클리어(1회 소비) — 다음 실행이 재개를 반복하지 않도록.
    try { persistMissionState(missionId, applyChannelUpdates(assembleMissionState(missionId), [cursorUpdate(null)])); } catch { /* fail-soft */ }
  }
} catch { /* fail-soft — 커서 소비 실패는 정상 실행(재개 없음) */ }
const satisfactionClassify = async (p: string): Promise<string> => {
  const { streamLLM } = await import('../src/llm.js');
  return streamLLM([{ role: 'user', content: p }], () => {}, { model: process.env.ELANOUS_SATISFACTION_MODEL || 'gpt-5.6-luna', reasoningEffort: 'low' });
};
// ★ walker 샌드박스 격리(opt-in·autopilot.missionWorktree·기본 OFF·대표 2026-07-21) — walker(operational)
//   페이즈 도구가 main 트리에 써서 오염([feedback_walker_phase_main_tree_pollution]). 미션 worktree 를 만들어
//   setSessionCwd 로 walker 도구 cwd 를 격리(walker 도구는 전부 getSessionCwd() 참조). setSessionCwd≠chdir 라
//   se-isolated(자체 worktree·repoRoot=process.cwd() 직접)는 무영향. 플래그 OFF = setSessionCwd 미호출 →
//   getSessionCwd()=process.cwd()=종전 그대로. 종료 시 dispose(discard·현 ephemeral 동작 보존·PR 캡처는 후속).
//   ⚠️ 프로덕션 러너 변경 — 격리 테스트 dogfood 후 flip-on. fail-soft(생성 실패=격리 없이 종전 실행).
let missionWtPlan: import('../src/autopilot/build/isolated-instance.js').IsolatedPlan | undefined;
try {
  const wtOn = (getUserConfig().raw?.autopilot as { missionWorktree?: unknown } | undefined)?.missionWorktree === true;
  // ★ B-2 walker boundary guard(opt-in·autopilot.missionWorktreeGuard·기본 OFF·2026-07-21) — setSessionCwd
  //   는 상대경로만 격리하고 절대경로는 통과시켜, walker LLM 이 절대경로 Write 로 main 트리를 오염시켰다
  //   (walker_phase_main_tree_pollution 실측). guard ON = 격리 worktree 를 쓰기 경계로 강제(경계 밖 절대
  //   Write/Edit 거부). OFF = 종전(상대만 격리·무회귀). 봉쇄돼야 walker 가 worktree 에 써 A(캡처)가 전달한다.
  const guardOn = (getUserConfig().raw?.autopilot as { missionWorktreeGuard?: unknown } | undefined)?.missionWorktreeGuard === true;
  // ⚠️ store(240)는 246 에서 이미 close 됨 — 닫힌 핸들 재사용 금지. missionWorktree OFF 일 땐 `wtOn && hasSub`
  //   단축평가로 이 listTasks 가 실행 안 돼 잠복했으나, flip-on 순간 "Cannot use a closed database" → create-failed
  //   → walker main 오염(2026-07-21 flip-on dogfood 실증). 새 핸들로 hasSub 평가 후 즉시 close(종전 OFF=미개봉 보존).
  const hasSub = wtOn ? (() => { const s = openAutopilotMissionsDb(); try { return s.listTasks({ goalSlug: missionId }).some((t) => t.surface.kind === 'subagent'); } finally { s.close(); } })() : false;
  if (wtOn && hasSub) {
    const { createIsolatedInstance, ensureWorktreeDeps } = await import('../src/autopilot/build/isolated-instance.js');
    const plan = createIsolatedInstance(process.cwd(), `mission-${missionId}`, 'main');
    ensureWorktreeDeps(process.cwd(), plan);
    setSessionCwd(plan.worktreePath, 'tool', { boundary: guardOn });
    missionWtPlan = plan;
    try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.worktree', 'created', { missionId, worktree: plan.worktreePath, boundary: guardOn }); } catch { /* fail-soft */ }
  }
} catch (e) { try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.worktree', 'create-failed', { missionId, error: e instanceof Error ? e.message.slice(0, 120) : '' }); } catch { /* fail-soft */ } }

const mp = await runMultiphaseMission(
  missionId,
  async (task) => {
    // ★ P3 pause(대표 2026-07-13·캐스케이드 컨트롤) — 페이즈 실행 전 일시정지 확인. paused 면 현재
    //   프로세스를 깨끗이 종료(상태 보존·done 페이즈 유지). resume 이 재spawn 으로 남은 페이즈 재개.
    try {
      const { isMissionPaused } = await import('../src/autopilot/mission-lifecycle.js');
      if (isMissionPaused(missionId)) {
        console.log('[multiphase] ⏸️ 미션 일시정지(pause) — resume 대기·상태 보존');
        // ★ S5 제1원칙 OBSERVE — 실행기가 실제로 멈춘 지점(어느 페이즈 앞에서)을 logs.db 에 각인.
        //   pauseMission(호출측 의사결정)과 별개로 executor 관점의 실측 멈춤 프레임. fail-soft.
        try {
          const { debug } = await import('../src/debug/log.js');
          debug.log('mission.exec.pause', 'executor-halt', { missionId, beforePhaseId: task.id, beforePhase: task.title?.slice(0, 80) });
        } catch { /* fail-soft */ }
        process.exit(0);
      }
    } catch { /* fail-soft */ }
    // ★ S1 충족 판정(execPhaseSkip opt-in) — 이미 충족이면 실행 생략(빠른 스킵·no-op·done). 결정론
    //   fast-path(필수 산출물 존재) → luna(grounding 으로 아크커버/기존구현 판단). skip 은 satisfied_skip
    //   deviation + exec skip frame 으로 3박자 각인(리플레이·회고). fail-soft(판정 실패=정상 실행).
    if (execPhaseSkipEnabled) {
      try {
        const { evaluatePhaseSatisfaction } = await import('../src/autopilot/mission-phase-satisfaction.js');
        const acceptTxt = (task.acceptance?.criteria ?? []).join('\n');
        const gBlock = (() => { try { return formatWorkingMemoryForPrompt(readWorkingMemory(missionId), { viewerPhaseId: task.id }); } catch { return ''; } })();
        const verdict = await evaluatePhaseSatisfaction(task, { cwd: missionWtPlan ? getSessionCwd() : process.cwd(), goal, acceptanceText: acceptTxt, groundingBlock: gBlock }, { classify: satisfactionClassify });
        if (verdict.satisfied) {
          console.log(`[multiphase] ⏭️ 페이즈 스킵(이미 충족·${verdict.via}) — ${verdict.reason}`);
          try { recordExecPhaseFrame(missionId, { phaseId: task.id, phaseTitle: task.title, op: 'skip', status: 'skipped', deviation: { kind: 'satisfied_skip', note: verdict.reason }, note: `via ${verdict.via}` }); } catch { /* fail-soft */ }
          try { coordinatorRecordMemory(missionId, { phaseId: task.id, phaseTitle: task.title, kind: 'operational', summary: `이미 충족·스킵(${verdict.via}): ${verdict.reason}`, reusables: [], decisions: [], artifacts: [], deviation: { kind: 'satisfied_skip', note: verdict.reason } }); } catch { /* fail-soft */ }
          return { ok: true, summary: `[SKIP·이미충족·${verdict.via}] ${verdict.reason}` };
        }
      } catch { /* fail-soft — 판정 실패는 정상 실행 */ }
    }
    // ★ 2단계 브릿지(대표 지시 2026-07-12) — 구현·테스트저작 페이즈는 walker(운영만)로는
    //   막다른 길(코어편집 가드가 되돌림). SE 격리 worktree 경로로 위임(자율 구현→무결성
    //   게이트→PR 초안·merge HITL). build disarmed(기본)면 arming 대기로 정직 보고.
    // ★ 축D D1(ANS §5) — 이진 if 를 strategy 레지스트리로. BUILD 고정↔RUN 가변 경계.
    //   기본 해석은 종전과 동일(implementation→se-isolated·else→walker·비파괴).
    // ★ P3 조율자 Command 제어(opt-in·autopilot.coordinatorControl·기본 OFF) — 분류 저신뢰면 조율자가
    //   개입한다: 강한 tier 로 재분류(no-cache) 시도 → 여전히 저신뢰면 보수 라우팅(operational·scope
    //   creep 방지). OFF 면 종전 동작(관측만). 대표 dogfood 근본(저신뢰→오분류→scope creep) 대응.
    const ccOn = (() => { try { return (getUserConfig().raw?.autopilot as { coordinatorControl?: unknown } | undefined)?.coordinatorControl === true; } catch { return false; } })();
    // ★ UR2 read-first(통합 런타임) — 중앙 State 가 이 페이즈의 durable 라우팅을 소유하면 그것을 진실원으로
    //   삼는다(재실행/재개 시 재분류 없이 조율자의 이전 결정을 따름 — 재litigate 방지·State 가 라우팅 소유).
    let phaseKind: PhaseKind | undefined;
    let routedFromState = false;
    if (ccOn) {
      try {
        const persisted = readMissionState(missionId);
        const prior = persisted ? routingForPhase(persisted, task.id) : undefined;
        if (prior && (prior.phaseKind === 'implementation' || prior.phaseKind === 'operational')) {
          phaseKind = prior.phaseKind;
          routedFromState = true;
          observeCoordinator('route-from-state', missionId, { phaseId: task.id, phaseKind, reason: prior.reason });
        }
      } catch { /* fail-soft — State 읽기 실패는 종전 분류 경로 */ }
    }
    if (!routedFromState) {
      // ★ 분류 맥락(대표 2026-07-22 "전체 페이즈·아크 분류와 같이") — 미션 골을 tie-breaker 에 전달해
      //   단일 페이즈 고립 판정 대신 "이 미션은 실제 구현/조사 중 무엇을 하나" 맥락으로 판정(배선 페이즈가
      //   operational 오분류되는 divergence 완화). 골은 모듈 스코프라 무비용.
      const classifyCtx = { context: { goal: goal.slice(0, 300) } };
      phaseKind = await classifyPhaseKindSmart(task, classifyCtx);
      // ★ P3 조율자 Command 제어(opt-in) — 분류 저신뢰면 조율자가 개입(재분류→보수 라우팅). UR2: 보수
      //   라우팅 결정을 중앙 State routing 채널에 write(durable) → 다음 실행/재개가 State 에서 읽는다.
      if (ccOn) {
        try {
          const { decideCoordinatorCommand, routingUpdate } = await import('../src/autopilot/pipeline/coordinator-command.js');
          const detail = await classifyPhaseKindDetailed(task, { noCache: true });
          if (detail.lowConfidence) {
            const cmd = decideCoordinatorCommand({ classifyLowConfidence: true });
            observeCoordinator('intervene', missionId, { phaseId: task.id, action: cmd.action, source: detail.source, reason: cmd.reason });
            if (cmd.action === 'reclassify') {
              const retry = await classifyPhaseKindDetailed(task, { noCache: true });
              if (retry.lowConfidence) {
                const conservative = decideCoordinatorCommand({ classifyLowConfidence: true, reclassifyExhausted: true });
                phaseKind = 'operational'; // 보수 라우팅(walker·읽기전용)
                observeCoordinator('route-conservative', missionId, { phaseId: task.id, reason: conservative.reason });
                // ★ UR2 State write — 조율자 라우팅 결정을 중앙 State 가 소유(재개/재실행 정합). 관측 동반.
                try {
                  const st = assembleMissionState(missionId);
                  persistMissionState(missionId, applyChannelUpdates(st, [routingUpdate({ phaseId: task.id, phaseKind: 'operational', action: conservative.action, reason: conservative.reason })]));
                  observeCoordinator('route-write', missionId, { phaseId: task.id, phaseKind: 'operational', action: conservative.action });
                } catch { /* fail-soft — State write 실패는 라우팅 자체엔 무영향 */ }
              } else phaseKind = retry.kind;
            }
          }
        } catch { /* fail-soft — 조율자 제어 실패는 종전 동작 */ }
      }
    }
    phaseKind = phaseKind ?? 'operational';
    const phaseFramework = resolvePhaseFramework({ phaseKind });
    // ★ 근본(2026-07-22 dogfood) — phaseKind 별 goal-loop 반복 상한(정식 config 인터페이스 autopilot.loopControl).
    //   operational(조사)=바운디드(across-turn 재주입 폭주=예산 소진 근절)·implementation=기본(8) 유지·회귀0.
    //   chat.ts 의 opts.goalLoopMaxIterations seam 으로 흘러 runGoalLoop.maxIterations 를 결정한다(consumer 무개변).
    const goalLoopMaxIterations = resolveGoalLoopMaxIterations(phaseKind, loopControlFromConfig());
    debugLog.log('mission.loop-policy', 'resolved', { missionId, phaseId: task.id, phaseKind, goalLoopMaxIterations: goalLoopMaxIterations ?? null });
    if (phaseFramework.id === 'se-isolated') {
      const res = await runImplementationPhaseViaSE(missionId, task, {
        repoRoot: process.cwd(),
        baseBranch: lastImplBranch, // ★ 이전 성공 페이즈 위에 스택(미지정=main)
        onProgress: (note) => {
          // ★ 진행 메시지 1개 재사용(대표 2026-07-12·정정) — 반환된 실제 좌표를 저장해 다음 변곡점은
          //   그 메시지를 edit(새 메시지 남발 방지). 첫 호출이 새 메시지 생성 → 좌표 확보.
          try { if (phaseProgress) { const mid = notifyPhaseProgress(missionOrigin, phaseProgress.msgId, phaseProgress.info, note); if (mid) phaseProgress.msgId = mid; } } catch { /* fail-soft */ }
          try { if (phaseProgress?.phaseId) persistPhaseProgress(phaseProgress.phaseId, note); } catch { /* fail-soft */ }
        },
      });
      // ★ built(PR push 완료) 시에만 이 페이즈 브랜치를 다음 base 로 스택. no-op(변경 0·prUrl 없음)은
      //   브랜치가 origin 에 없으므로 스택하지 않고 이전 브랜치 유지(그 산출물은 이미 하위에 포함).
      if (res.ok && res.prUrl) {
        lastImplBranch = `origin/se/${phaseSlug(missionId, task)}`;
        // ★ put_writes(조율자 격상 P0) — PR 이 push 된 "그 순간" pending-write 프레임을 남긴다. 여기서
        //   onPhaseDone 사이에 프로세스가 죽어도 이 PR 이 미션 원장에 남아 고아가 안 된다(재개 시
        //   collectPendingWrites 로 회수 → 재구현 차단). fail-soft(관측/보존은 부수효과).
        try {
          let arcId: string | undefined; let arcName: string | undefined;
          try { const s = new TaskStore(); const arcs = s.getMission(missionId)?.autopilot?.arcs; s.close(); arcId = arcIdForPhase(arcs, task.id); } catch { /* fail-soft */ }
          recordPendingWriteFrame(missionId, {
            phaseId: task.id, phaseTitle: task.title, framework: 'se-isolated',
            artifacts: [res.prUrl, lastImplBranch], note: 'PR push 완료(phase-done 전 durable write 보존)',
            ...(arcId ? { arcId } : {}), ...(arcName ? { arcName } : {}),
          });
        } catch { /* fail-soft */ }
        // ★ R0 자율 PR 리뷰(RFC-autonomous-pr-review-agent 2026-07-20) — PR push 완료 직후·phase-done 전에
        //   실제 PR diff(gh pr diff)를 리뷰어(sol·read-only critic 계약)에 실어 correctness/설계 검증한다.
        //   pre-PR critique(=diff scope-guard·makePr 前)와 계층이 다르다: 이건 생성된 PR 산출물 검증(post-PR).
        //   verdict=fail 이면 PhaseResult.critique* 를 채워 [CRITIQUE:FAIL] 각인 → rebuildCritiquedPhases
        //   재작업 경로가 자동 연결(신규 재작업 배관 없음). ★관측 필수(제1원칙): 리뷰=셀프힐 결정이므로 fail 은
        //   recordMissionObservation 3박자 관문(stage=review·logs.db+self-memory+ops timeline), pass/warn 은
        //   debug.log('mission.review'). fail-soft(리뷰 실패/예외가 미션을 막지 않음). 머지=HITL 불변(R3).
        try {
          const prDiff = (() => {
            const r = spawnSync('gh', ['pr', 'diff', res.prUrl], { encoding: 'utf-8', timeout: 25000, maxBuffer: 12 * 1024 * 1024, env: { ...process.env } });
            return r.status === 0 ? r.stdout : '';
          })();
          if (prDiff.trim()) {
            const { reviewPullRequest } = await import('../src/autopilot/mission-critique.js');
            const { debug } = await import('../src/debug/log.js');
            const acceptance = (task.acceptance?.criteria ?? []).join('\n');
            const wm = (() => { try { return formatWorkingMemoryForPrompt(readWorkingMemory(missionId), { viewerPhaseId: task.id }); } catch { return ''; } })();
            const review = await reviewPullRequest(
              { prDiff, phaseIntent: task.title, ...(acceptance ? { acceptance } : {}), ...(wm ? { workingMemory: wm } : {}) },
              async (prompt) => {
                const { streamLLM } = await import('../src/llm.js');
                return streamLLM([{ role: 'user', content: prompt }], () => {}, { model: process.env.ELANOUS_PR_REVIEW_MODEL || 'gpt-5.6-sol', reasoningEffort: 'medium' });
              },
            );
            debug.log('mission.review', 'reviewed', { missionId, phaseId: task.id, prUrl: res.prUrl, verdict: review.verdict, mustFix: review.mustFix.length, shouldFix: review.shouldFix.length });
            // ★ R1 조율자 관측(RFC-autonomous-pr-review 3b) — 리뷰 판정을 1급 실행 프레임(review-gate)으로
            //   append(mission.exec.frame 자동관측·리플레이/감사). fail=blocked+deviation review_fail. fail-soft.
            try {
              recordExecPhaseFrame(missionId, {
                phaseId: task.id, phaseTitle: task.title, op: 'review-gate', framework: 'se-isolated',
                status: review.verdict === 'fail' ? 'blocked' : 'done', artifacts: [res.prUrl],
                note: `PR 리뷰 ${review.verdict.toUpperCase()}${review.mustFix[0] ? `: ${review.mustFix[0].slice(0, 80)}` : ''}`,
                ...(review.verdict === 'fail' ? { deviation: { kind: 'review_fail' as const, note: review.mustFix.slice(0, 2).join(' · ').slice(0, 140) } } : {}),
              });
            } catch { /* fail-soft */ }
            // ★ R1/R2 — 리뷰 이력(State review 채널)을 조립(현재 write 前 → priorFails 는 이번 판정 제외).
            //   R2 발산방어가 이 이력에서 라운드/직전 블로커를 파생한다. fail-soft(조립 실패=빈 이력·첫 라운드 취급).
            let reviewState: Record<string, unknown> = {};
            let assembleOk = false;
            try { reviewState = assembleMissionState(missionId); assembleOk = true; } catch { /* fail-soft */ }
            const { reviewUpdate, reviewsForPhase } = await import('../src/autopilot/pipeline/coordinator-command.js');
            const priorFails = reviewsForPhase(reviewState, task.id).filter((r) => r.verdict === 'fail');
            // ★ R1 — 이번 판정을 review 채널(append·durable)에 write(resume 재리뷰 방지·조율자 압력 회상·routing 동형).
            //   ★조립 성공 시에만(dogfood #4782 리뷰 지적) — 조립 실패면 reviewState={} 라 persist 시 carry-over(routing/
            //   cursor) 를 유실한다. 실패 시 write 스킵(이번 판정은 exec 프레임·워킹메모리·관측으로 남으므로 손실 아님).
            if (assembleOk) {
              try {
                persistMissionState(missionId, applyChannelUpdates(reviewState, [reviewUpdate({
                  phaseId: task.id, verdict: review.verdict, prUrl: res.prUrl,
                  ...(review.mustFix.length ? { findings: review.mustFix.slice(0, 3) } : {}),
                })]));
              } catch { /* fail-soft */ }
            }
            // ★ C(순수 추출·2026-07-20) — verdict-gate + 발산방어 bound + escalate + reviewPassed 결정을
            //   순수 decideReviewOutcome 로. run-mission 은 결과를 res 에 적용(최우선·무보호 前) + 부수효과만.
            //   dogfood 리뷰어 반복 지적("핵심 배선 검증")을 단위테스트 가능케(pre-PR critique 병합·bound·escalate 해제).
            const { decideReviewOutcome } = await import('../src/autopilot/mission-review-rework.js');
            const outcome = decideReviewOutcome({
              review, priorFailFindings: priorFails.at(-1)?.findings ?? [], priorFailCount: priorFails.length,
              prevCritiqueVerdict: res.critiqueVerdict, prevCritiqueFindings: res.critiqueFindings,
              ...(Number(process.env.ELANOUS_REVIEW_MAX_ROUNDS) > 0 ? { maxRounds: Number(process.env.ELANOUS_REVIEW_MAX_ROUNDS) } : {}),
            });
            // ★ patch 적용 — 결정 반영이 최우선·무조건(dogfood #4782/#4784: 관측/import 예외가 못 끊게·부수효과 前).
            if (outcome.patch.clearCritique) { res.critiqueVerdict = undefined; res.critiqueFindings = undefined; }
            if (outcome.patch.critiqueVerdict !== undefined) res.critiqueVerdict = outcome.patch.critiqueVerdict;
            if (outcome.patch.critiqueFindings !== undefined) res.critiqueFindings = outcome.patch.critiqueFindings;
            if (outcome.patch.reviewEscalated !== undefined) res.reviewEscalated = outcome.patch.reviewEscalated;
            if (outcome.patch.reviewPassed) res.reviewPassed = true;
            // ★ 리뷰 결과 GitHub PR 코멘트 표면화(대표 2026-07-21) — 미션 리뷰 verdict/mustFix/shouldFix 를 PR
            //   에 남겨 대표가 PR 페이지에서 자율 리뷰를 확인(종전 logs.db·State 만·GitHub 미표면화 갭). pass/warn/
            //   fail 모두·res.prUrl 있을 때만·fail-soft(코멘트 실패가 리뷰 결정을 못 끊음). 관측=mission.review pr-comment.
            if (res.prUrl) {
              try {
                const { extractPrNumber } = await import('../src/autopilot/pr-manager.js');
                const prNum = extractPrNumber(res.prUrl);
                if (prNum) {
                  const round = priorFails.length + 1;
                  const emoji = review.verdict === 'pass' ? '✅' : review.verdict === 'warn' ? '⚠️' : '⛔';
                  const mf = review.mustFix.length ? review.mustFix.map((m) => `- ${m}`).join('\n') : '_(없음)_';
                  const sf = review.shouldFix.length ? `\n\n**Should-fix**:\n${review.shouldFix.map((s) => `- ${s}`).join('\n')}` : '';
                  const body = `## 🤖 자율 PR 리뷰 — ${emoji} ${review.verdict.toUpperCase()} (round ${round}·${outcome.action})\n\n**Must-fix**:\n${mf}${sf}\n\n_미션 \`${missionId}\` · 페이즈 "${task.title.slice(0, 60)}" · 자동 리뷰 노드_`;
                  spawnSync('gh', ['pr', 'comment', String(prNum), '--body', body], { encoding: 'utf-8', env: { ...process.env } });
                  try { debugLog.log('mission.review', 'pr-comment', { missionId, phaseId: task.id, pr: prNum, verdict: review.verdict, round }); } catch { /* fail-soft */ }
                }
              } catch { /* fail-soft — 코멘트 실패가 리뷰 결정을 못 끊음 */ }
            }
            // 부수효과 — fail(rework/escalate)만 관측·워킹메모리·HITL(pass/warn 은 patch 로 충분).
            if (outcome.action === 'rework' || outcome.action === 'escalate') {
              const round = outcome.round;
              observeCoordinator('review-rework', missionId, { phaseId: task.id, round, action: outcome.action, resolved: outcome.rework?.resolved, persisted: outcome.rework?.persisted, reason: outcome.rework?.reason });
              // ★ R2 문맥관리 — 리뷰 지적을 워킹메모리 review_fail deviation 으로(재작업·후속 페이즈 주입). fail-soft.
              try {
                const { coordinatorRecordMemory } = await import('../src/autopilot/pipeline/coordinator-memory.js');
                coordinatorRecordMemory(missionId, {
                  phaseId: task.id, phaseTitle: task.title, kind: 'implementation', provenance: 'decision',
                  summary: `PR 리뷰 FAIL(round ${round}·${outcome.action})`, reusables: [], decisions: [],
                  artifacts: res.prUrl ? [res.prUrl] : [],
                  deviation: { kind: 'review_fail', note: review.mustFix.slice(0, 2).join(' · ').slice(0, 200) },
                });
              } catch { /* fail-soft */ }
              // ★ 관측(셀프힐 3박자) — 별도 fail-soft(patch 반영과 독립·관측 실패가 결정을 못 끊는다).
              try {
                const { recordMissionObservation } = await import('../src/autopilot/mission-observation.js');
                if (outcome.action === 'rework') {
                  recordMissionObservation({
                    missionId, phaseId: task.id, phaseTitle: task.title, stage: 'review', verdict: 'fail', stateful: true,
                    rationale: `PR 리뷰 FAIL -> 재작업(round ${round}): ${review.mustFix[0]?.slice(0, 120) ?? ''}`,
                    refs: { prUrl: res.prUrl, round, blockers: review.mustFix.slice(0, 3) },
                  });
                } else {
                  recordMissionObservation({
                    missionId, phaseId: task.id, phaseTitle: task.title, stage: 'review', verdict: 'stuck', stateful: true, importance: 7,
                    rationale: `PR 리뷰 미수렴(${outcome.rework?.reason ?? ''}) — 재작업 중단·HITL`,
                    refs: { prUrl: res.prUrl, round, blockers: review.mustFix.slice(0, 3) },
                  });
                  if (missionOrigin && canUxS7()) {
                    try { notifyUxS7(missionOrigin, missionId, `🔎 PR 리뷰 ${round}회 미수렴 — ${outcome.rework?.reason ?? ''}. merge/재작업/취소를 판단해 주세요(PR: ${res.prUrl}).`, { signals: { reviewStuck: true, round } }); } catch { /* fail-soft */ }
                  }
                }
              } catch { /* fail-soft */ }
            }
          }
        } catch { /* fail-soft — 리뷰 실패는 미션 무중단 */ }
      }
      // ★ P2 기록 — 구현 페이즈 산출(PR·요약)을 워킹 메모리에(후속 페이즈가 무엇이 만들어졌는지 인지).
      recordPhaseWorkingMemory(missionId, task, 'implementation', { summary: res.summary, ...(res.prUrl ? { prUrl: res.prUrl } : {}) });
      return res;
    }
    const basePrompt = task.surface.kind === 'subagent' ? task.surface.prompt : task.title;
    // R3 durable evidence: this walker owns the self-turn model selection, so
    // record the exact policy decision before invoking it. SE/ACP paths do not
    // write here until they expose an equally authoritative decision contract.
    try {
      persistMissionRouteDecision(task.id, resolveRouteDecision({
        provider: cfg.llm.provider, configuredModel: cfg.llm.model, text: basePrompt,
        routePolicy: cfg.llm.routePolicy,
      }));
    } catch { /* evidence must never block execution */ }
    // ★ walker 페이즈 의존성 근본(대표 2026-07-13) — walker(operational)는 main 트리에서 실행되어
    //   이전 페이즈(구현) 산출물이 미merge PR 이면 못 본다(dogfood: 서브페이즈5 조사가 이전 경계를
    //   못 봄·페이즈 스택은 SE 격리 구현만 커버). 직전 성공 페이즈 브랜치를 알려 git show/checkout
    //   으로 읽게 한다(main 트리 오염 없이). runTurnImpl 이 cwd 옵션이 없어 프롬프트 주입으로 해결.
    const stackHint = lastImplBranch
      ? `\n\n[페이즈 스택 · 이전 산출물 접근] 이전 성공 구현 페이즈의 산출물은 '${lastImplBranch}' 브랜치에 있다(미merge 라 현재 작업트리엔 없을 수 있음). 이전 페이즈 파일을 조사·검증·참조해야 하면 'git show ${lastImplBranch}:<경로>' 로 내용을 읽거나 'git checkout ${lastImplBranch} -- <경로>' 로 가져와라(작업 후 'git checkout -- <경로>' 로 원복). 크론/스케줄 등록의 실행 의존은 그 페이즈 PR 이 merge 돼야 실제 동작함을 인지하라.`
      : '';
    // ★ P3 주입 — 이전 페이즈들이 워킹 메모리에 남긴 재사용 경계·결정을 프롬프트에(fresh 세션이
    //   이전 조사 결과를 상실하는 근본 갭 해소). fail-soft(읽기 실패=빈 블록).
    // ★ 축A A1 — viewerPhaseId(이 페이즈)로 가시성 필터. agent-전용 각인은 소유 페이즈만(현재 subteam 기본·무영향·비파괴).
    const wmEntries = (() => { try { return readWorkingMemory(missionId); } catch { return []; } })();
    const wmBlock = (() => { try { return formatWorkingMemoryForPrompt(wmEntries, { viewerPhaseId: task.id }); } catch { return ''; } })();
    // ★ 관측 보강(대표 2026-07-21·제1원칙) — walker 경로 build-context 주입 관측 비대칭 해소. se-isolated 는
    //   mission-se-bridge.ts:242 가 wm-inject 를 찍는데 walker 는 무관측이라 "플랜 컨텍스트(skill/code 팩트)가
    //   구현에 전달됐나"를 logs 로 볼 수 없었다. 동형 관측을 심어 경로 무관 대칭. ★조회: elanous logs --category
    //   mission.exec.context. (구조: 장차 Historian read seam 으로 방출+관측을 수렴할 자리 — 대표 구조검토.)
    try {
      const buildSeed = wmEntries.find((e) => e.provenance === 'build');
      const { debug } = await import('../src/debug/log.js');
      debug.log('mission.exec.context', 'wm-inject', {
        missionId, phaseId: task.id, framework: 'walker',
        wmChars: wmBlock.length, hasBuildContext: !!buildSeed,
        reusables: buildSeed?.reusables?.length ?? 0,
        decisions: buildSeed?.decisions?.length ?? 0,
        // ★ premise 관측(2026-07-21·제1원칙 point4) — 종전 wm-inject 는 "글자 수·decisions 수"(도착만) 였다.
        //   walker 가 honor 해야 할 아크 전제(build decisions+reusables) 건수를 premise 로 남겨 "premise N건 주입됨"을
        //   조회 가능하게(활용 여부는 하단 mission.walker 'premise-applied' 관측이 짝). 도착↔활용 갭 해소 시작.
        premises: (buildSeed?.decisions?.length ?? 0) + (buildSeed?.reusables?.length ?? 0),
      });
    } catch { /* fail-soft — 관측 실패가 실행을 막지 않음 */ }
    // ★ artifact-first 규율(대표 2026-07-13·P2 근본) — 조사 페이즈가 필수 산출물(.artifacts/*.json)을
    //   선언하면, 서술을 장황하게 뽑아 예산을 소진하고 저장 전 실패하던 근본(P2 실측: 128k->512k
    //   4배 상향에도 반복 실패)을 예방. 뼈대를 먼저 저장하고 append·서술 최소화 지시를 주입.
    //   필수 산출물이 없으면 빈 문자열(주입 없음). acceptance 기준도 함께 훑어 경로를 놓치지 않음.
    const acceptanceText = (task.acceptance?.criteria ?? []).join('\n');
    const artifactHint = artifactFirstInstruction(extractRequiredArtifacts(`${basePrompt}\n${acceptanceText}`));
    // ★ C3(문맥관리 트랙·2026-07-19) — 아크 통합 의도를 walker RUN 컨텍스트에 전파. 종전 arcHint(아크 구조)
    //   는 BUILD decompose 전용이라 walker 는 자기 아크의 통합 intent 를 모른 채 실행했다(감사). 이 페이즈가
    //   속한 아크의 intent+통합 acceptance 를 주입해 국소 작업이 아크 전체 의도와 정합하게 한다. 로직은
    //   순수 헬퍼(formatArcContextForPhase·테스트가능)에, 여기선 store 조회만. fail-soft(조회 실패=빈 블록).
    // ★ C2·C3 — 아크 경계 핸드오프(C2·선행 아크 완주 요약)+아크 통합 의도(C3). 한 번 store 조회로 둘 다 파생.
    //   handoff 는 아크 첫 페이즈+선행아크 있을 때만, context 는 매 페이즈. 포맷은 순수 헬퍼. fail-soft.
    const { arcHandoff, arcContext } = (() => {
      try {
        const s = new TaskStore(); const arcs = s.getMission(missionId)?.autopilot?.arcs; s.close();
        return { arcHandoff: formatArcHandoffForPhase(arcs, task.id), arcContext: formatArcContextForPhase(arcs, task.id) };
      } catch { return { arcHandoff: '', arcContext: '' }; }
    })();
    // ★ C5(2층 하향주입) — 통합 State(U1~U2.6)에서 조율자 시야(진행률·권장·실패)를 walker 로 하향. 워킹메모리/
    //   아크는 이미 아래에 있어 제외(중복회피). assembleMissionState 는 이 스코프에서 가용(447 import). 관측·fail-soft.
    let coordCtxBlock = '';
    try {
      const r = formatCoordinatorContextForWalker(assembleMissionState(missionId), task.id);
      coordCtxBlock = r.blockText;
      if (r.blockText) {
        try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.coordinator', 'context-downward', { missionId, phaseId: task.id, donePhases: r.donePhases, totalPhases: r.totalPhases, failureCount: r.failureCount, ...(r.recommendation ? { recommendation: r.recommendation } : {}) }); } catch { /* fail-soft */ }
      }
    } catch { /* fail-soft */ }
    // ★ ②RFC 설계 주입(근본·2026-07-22·핸드오프 3근본 #2) — RFC-preset 미션에서 walker 가 RFC 설계
    //   본문을 못 보고 즉흥 확장하던 근본 해소. rfcToProposedTasks 는 페이즈에 제목+아크명+경로만 넣어
    //   walker 는 경계·처분·무회귀를 몰랐다. rfc.md 본문을 계약 블록으로 직접 주입(경로만 주고 Read 기대
    //   하지 않음). 비-RFC 미션은 ''(무영향). ★조회: elanous logs --category mission.exec.context (event=rfc-inject).
    const rfcBlock = (() => { try { return formatRfcDesignForPrompt(missionId); } catch { return ''; } })();
    // ★ 근본 B — 제거-전 liveness 게이트(대표 설계·2026-07-22) — RFC 가 "제거" 지시한 심볼이 실제 live(운영
    //   call-site 존재)면 결정론 grep 으로 잡아 premise 교정 주입(제거 말고 불일치 보고). 저작 아닌 실행 시점
    //   =현재 코드 기준. a85843 phase2 dispatchYoutubeTranscript(runner.ts:1377 live) 오분류 근본 차단.
    const livenessBlock = (() => { try { return computeRemovalLivenessWarning(`${basePrompt}\n${acceptanceText}`, process.cwd()); } catch { return ''; } })();
    const prompt = basePrompt + stackHint + (rfcBlock ? `\n\n${rfcBlock}` : '') + (livenessBlock ? `\n\n${livenessBlock}` : '') + coordCtxBlock + arcHandoff + arcContext + (wmBlock ? `\n\n${wmBlock}` : '') + artifactHint + WORKING_MEMORY_EMIT_HINT;
    if (rfcBlock || livenessBlock) { try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.context', 'rfc-inject', { missionId, phaseId: task.id, framework: 'walker', rfcChars: rfcBlock.length, livenessWarn: livenessBlock.length > 0 ? 1 : 0 }); } catch { /* fail-soft */ } }
    // ★ premise 합성 관측(2026-07-21·제1원칙 point4) — 프롬프트에 실제 주입된 전제(premise) 블록 구성.
    //   wm-inject(도착)만으론 arcContext(C3 통합의도)/arcHandoff(C2)/coordCtx(C5)/wm 이 진짜 프롬프트에
    //   들어갔는지 불명. 각 블록 주입여부+총 promptChars 를 남겨 "walker 에게 전제 N종 실제 주입됨"을 조회.
    //   ★조회: elanous logs --category mission.exec.context (event=premise-inject).
    try {
      const { debug } = await import('../src/debug/log.js');
      debug.log('mission.exec.context', 'premise-inject', {
        missionId, phaseId: task.id,
        arcContext: arcContext.length > 0 ? 1 : 0, arcHandoff: arcHandoff.length > 0 ? 1 : 0,
        coordCtx: coordCtxBlock.length > 0 ? 1 : 0, wm: wmBlock.length > 0 ? 1 : 0,
        premiseBlocks: [arcContext, arcHandoff, coordCtxBlock, wmBlock].filter((b) => b.length > 0).length,
        promptChars: prompt.length,
      });
    } catch { /* fail-soft — 관측 실패가 실행을 막지 않음 */ }
    // ★ 재시도 로직(대표 2026-07-12) — 예산 소진/일시적 실패는 자동 재시도(예산 escalation).
    //   근본 불가(전제 부재·코어편집 필요)·알 수 없는 실패는 재시도 안 함(무한루프·헛수고 방지).
    //   부분 실패해도 미션·성공 페이즈는 보존(runMultiphaseMission 이 done 유지·체인 중단만·삭제 없음).
    //   ★상한 상향(대표 2026-07-12): 조사(운영) 페이즈는 repo 구조·스키마·export·세션 등 파일을
    //   많이 읽어야 해 48k 로는 부족(비결정적 예산 소진·정주행 불안정). 조사 페이즈가 넉넉히 완주.
    //   코딩 페이즈는 SE 격리(별도 예산)라 이 배열 영향 없음.
    //   ★대폭 상향(대표 2026-07-13): 급락·연관시장 심층 조사 같은 대형 조사가 128k 로도 산출물
    //   저장·검증까지 못 가 budget-exhausted(P2 실패 실측). 128k→256k→512k 로 4배 상향해 심층
    //   조사가 완주. ELANOUS_WALKER_BUDGET(쉼표 구분·예 "200000,400000,800000")로 override 가능.
    // ★ config-first 예산(대표 2026-07-14) — user-config(autopilot.budget.walker)→
    //   env(ELANOUS_WALKER_BUDGET)→기본[128k·256k·512k]. SE 코딩 예산과 정책 통일(mission-budget.ts).
    const budgets = resolveWalkerBudget();
    // ★ 적응형 재시도 triage(대표 2026-07-13) — 1번째 시도는 기계적, 2번째 시도부터 매 실패를 LLM 이
    //   관찰해 근본 갈림길을 분류한다. "3번째를 단순 예산 계단 상향"으로 반복하면 규율 실패(장황->
    //   산출물 미저장)는 예산이 클수록 악화(P2 실측). 결정 신호=필수 산출물 디스크 존재. retry-*
    //   경로는 자동 실행, split/revise/skip/escalate 는 중단->실패 카드(사람 검토·대표 결정).
    const requiredArtifacts = extractRequiredArtifacts(`${basePrompt}\n${acceptanceText}`);
    const triageClassify = async (p: string): Promise<string> => {
      const { streamLLM } = await import('../src/llm.js');
      return streamLLM([{ role: 'user', content: p }], () => {}, { model: process.env.ELANOUS_RETRY_TRIAGE_MODEL || process.env.ELANOUS_DECOMPOSE_MODEL || 'gpt-5.6-sol', reasoningEffort: 'medium' });
    };
    const attemptsEv: RetryAttemptEvidence[] = [];
    const triageDecisions: RetryPath[] = [];
    let injected: string[] = [];              // triage 가 주입한 지시(누적)
    let currentBudget = budgets[0]!;          // 동적 — triage 가 다음 예산을 정한다
    let heavyDecision: RetryTriageDecision | null = null;
    let lastText = '', lastTag = 'fail', lastReason = 'unknown';
    // ★ walker 과부하(mid-turn 컨텍스트 폭발) 신호 소비(2026-07-21·자율 폐루프) — streamLLMWithTools 의
    //   compact-breaker-open 을 missionContext.onOverload 로 수신. 종전엔 debug.log 만·소비자 0(라이브 705308
    //   escalate 로 멈춘 근본). 과부하면 예산 계단 상향은 역효과(history 더 폭발)라 조기 split 로 라우팅한다.
    let overloadSignal: { turn: number; consecutiveFailures: number; reason: string } | null = null;
    // ★ CW3 signal control(opt-in·autopilot.coordinatorControl·기본 OFF·RFC-coordinator-walker-control-plane P4)
    //   — walker turn 루프가 매 turn 중앙 State signal 채널을 폴링(pollSignal)해 조율자의 mid-phase 신호
    //   (abort/pause)를 graceful 수신. flag OFF 면 pollSignal 미주입→llm.ts 무동작(무회귀). signal 채널 비면
    //   undefined→무동작. onOverload(방출↑·자율 split) 의 수신↓ 대칭. audit #59 (b) mid-phase 양방향 0 해소.
    const ccSignalOn = (() => { try { return (getUserConfig().raw?.autopilot as { coordinatorControl?: unknown } | undefined)?.coordinatorControl === true; } catch { return false; } })();
    const MAX_ATTEMPTS = budgets.length;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // ★ walker(조사) 진행 통지 — 빌드처럼 조사 페이즈도 진행/변곡점을 메시지 1개로 edit.
      try {
        if (phaseProgress) {
          const prev = triageDecisions[triageDecisions.length - 1];
          const note = `🔍 조사 중 · 예산 ${Math.round(currentBudget / 1000)}k · 시도 ${attempt + 1}/${MAX_ATTEMPTS}${prev ? ` (재시도 판단: ${prev})` : ''}`;
          const mid = notifyPhaseProgress(missionOrigin, phaseProgress.msgId, phaseProgress.info, note);
          if (mid) phaseProgress.msgId = mid;
        }
      } catch { /* fail-soft */ }
      let text = '';
      let threw = false;
      let toolCalls = 0;   // ★ Gap C grounding — 이 시도의 실제 조사 도구 호출 수(fake-pass 판별).
      // ★ 예산 강제(2026-07-19 인프라 후속) — 토큰 예산을 tool-loop 턴 상한으로 파생(llmOpts.maxTurns).
      //   기존엔 예산이 입력 trimToBudget 에만 쓰여 tiny 예산도 family 기본(24턴)까지 완주했다(dogfood).
      //   무회귀: 기본 계단(≥128k)은 undefined→family 기본 유지, 작은 예산에만 상한(resolveWalkerMaxTurns).
      //   루프 스코프로 hoist — 아래 실패 분류(budget-cap 폴백)도 이 값을 본다.
      const walkerMaxTurns = resolveWalkerMaxTurns(currentBudget);
      try {
        // triage 가 주입한 적응형 지시를 프롬프트 말미에(예: 규율 실패 -> 저장 우선 강제).
        const attemptPrompt = injected.length ? `${prompt}\n\n[적응형 재시도 지시]\n${injected.join('\n')}` : prompt;
        if (walkerMaxTurns !== undefined) {
          const { debug } = await import('../src/debug/log.js');
          debug.log('mission.walker.budget', 'maxTurns-enforced', { missionId, phaseId: task.id, budget: currentBudget, maxTurns: walkerMaxTurns, attempt: attempt + 1 });
        }
        const r = await runTurnImpl({ userConfig: cfg, sessionId: session.id, userText: attemptPrompt, systemPrompt: phaseSystem, maxTokens: currentBudget, ...(walkerMaxTurns !== undefined ? { llmOpts: { maxTurns: walkerMaxTurns } } : {}), ...(goalLoopMaxIterations !== undefined ? { goalLoopMaxIterations } : {}), onToolCall: () => { toolCalls += 1; }, missionContext: { missionId, phaseId: task.id, onOverload: (info) => { overloadSignal = info; }, ...(ccSignalOn ? { pollSignal: () => { try { return consumeMissionSignal(missionId, task.id); } catch { return undefined; } } } : {}) } });
        text = (r.text ?? '').trim();
      } catch (e) {
        lastText = e instanceof Error ? e.message : String(e); threw = true;
      }
      // ★성공判定 — 명시적 VERDICT: PASS 만 done. FAIL/판정누락은 실패.
      let verdict = threw ? null : parsePhaseVerdict(text);
      // ★ Gap C walker verdict grounding(opt-in) — PASS 를 실제 조사 증거로 검증. fake-pass(0도구 또는
      //   maxTurns<2 로 도구결과 합성불가)면 PASS 무효화 → 재조사 신호를 텍스트에 실어 실패 경로로. 그러면
      //   classifyGoalBlocker 가 '재조사/grounding'(missing_evidence)로 → re-research 자율 self-heal. maxTurns
      //   강제(예산)가 못 막는 완료 참칭을 grounding 으로 차단(라이브 dogfood 로 실증된 walker 견고성 근본).
      if (walkerGroundingEnabled && verdict === 'pass') {
        const g = assessWalkerGrounding({ toolCalls, ...(walkerMaxTurns !== undefined ? { maxTurns: walkerMaxTurns } : {}) });
        if (!g.grounded) {
          try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.walker.grounding', 'ungrounded-pass-downgrade', { missionId, phaseId: task.id, toolCalls, maxTurns: walkerMaxTurns ?? null, reason: g.reason, attempt: attempt + 1 }); } catch { /* fail-soft */ }
          // 노이즈 리포트를 **교체**(append 아님) — fake-pass 리포트에 우연히 섞인 needs_user 신호가
          // classifyGoalBlocker(NEEDS_USER 우선)를 오분류(HITL)시키던 것 차단. clean grounding 신호만 남겨
          // missing_evidence('재조사·grounding')→re-research 자율 self-heal 로 확정 라우팅. 참칭 리포트는
          // 어차피 결과 미합성이라 보존가치 없음(관측은 위 debug.log 가 toolCalls/reason 을 남긴다).
          text = `[grounding 실패] ${g.reason} — walker 가 실제 조사 결과 합성 없이 완료를 참칭했다. 재조사 필요(grounding·missing_evidence).`;
          verdict = null;   // PASS 무효화 → 아래 실패 경로 → 재조사 self-heal
        }
      }
      if (verdict === 'pass') {
        // ★ goal-loop 관측(2026-07-21·제1원칙 point3) — walker 증거게이트 통과(성공) 회차를 mission.walker 로.
        //   "몇 번째 시도에 PASS 했나·도구 몇 회"를 조회 가능하게(재시도 폐루프 자기인지 재료). fail-soft.
        try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.walker', 'goal-loop', { missionId, phaseId: task.id, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, verdict: 'pass', toolCalls, progressed: true }); } catch { /* fail-soft */ }
        // ★ P1 기록 — walker(조사/운영) 성공. [WORKING-MEMORY] 마커에서 재사용 경계·결정 추출.
        recordPhaseWorkingMemory(missionId, task, walkerMemKind(task.title), { summary: text, agentText: text });
        return { ok: true, summary: `[PASS·시도${attempt + 1}] ${stripWorkingMemoryMarker(text)}` };
      }
      if (!threw) { lastText = text; lastTag = verdict ? 'FAIL' : '판정누락(fail)'; lastReason = classifyFailure(text).reason; }
      else { lastTag = '예외(fail)'; lastReason = 'transient'; }
      // ★ 예산 강제↔self-heal 분류 연결(2026-07-19) — walker maxTurns 상한이 강제된 상태에서 실패했는데
      //   모델 텍스트가 예산 신호를 안 남겨 'unknown' 으로 떨어지면, 이는 실제로 **예산 상한 때문에 조사를
      //   못 끝낸** budget/run_failed 실패다. unknown→escalate(HITL·사람 무력)로 오분류하지 않고 'budget'
      //   으로 승격해 classifyGoalBlocker 가 run_failed→autonomous retry(예산 상향 재시도)로 라우팅하게
      //   한다. tiny 예산 실패의 정답은 "더 큰 예산 재시도"이지 사람 개입이 아니다(순수 라이브 self-heal 갭).
      if (walkerMaxTurns !== undefined && !threw && lastReason === 'unknown') lastReason = 'budget';
      // ★ 시도 증거 수집 — triage 의 결정 신호(필수 산출물 디스크 존재 = 규율실패 vs 진짜부족).
      const attemptArtifacts = checkArtifactExistence(requiredArtifacts, { cwd: missionWtPlan ? getSessionCwd() : process.cwd() });
      attemptsEv.push({
        attempt: attempt + 1, budget: currentBudget, failReason: lastReason,
        verdictMissing: !threw && verdict === null, textLength: text.length, textTail: text.slice(-400),
        artifacts: attemptArtifacts,
      });
      // ★ goal-loop 관측(2026-07-21·제1원칙 point3) — 재시도 회차·실패 사유·진전 여부를 mission.walker 로.
      //   종전엔 실패가 run.log([multiphase] console.log)에만 있어 "몇 번째 재시도·왜 실패·진전 있었나"를
      //   logs.db 로 조회 불가(제1원칙 위반). progressed = 산출물 생성 or 실제 도구조사 흔적(hang/공회전 판별).
      //   ★조회: elanous logs --category mission.walker (event=goal-loop). fail-soft.
      try {
        const artifactsPresent = attemptArtifacts.filter((a: { exists: boolean }) => a.exists).length;
        const { debug } = await import('../src/debug/log.js');
        debug.log('mission.walker', 'goal-loop', { missionId, phaseId: task.id, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, verdict: verdict ?? 'fail', reason: lastReason, budget: currentBudget, toolCalls, artifactsPresent, progressed: artifactsPresent > 0 || (toolCalls > 0 && text.length > 0) });
      } catch { /* fail-soft */ }
      // ★ 과부하 조기 분할(2026-07-21·자율 폐루프 point 3) — mid-turn 컨텍스트 폭발(compact-breaker-open)이
      //   감지됐고 이 시도가 PASS 가 아니면, 예산 계단 상향 재시도는 역효과(history 더 폭발)다. 즉시 split 로
      //   라우팅한다: heavyDecision(split) 을 심어 실패 요약에 [재시도 triage 권장: split] 마커를 실으면,
      //   다운스트림 parseTriageHealOverride → heal=split → 자율 splitPhaseIntoSubphases 집행(코디네이터가
      //   알아서 나눠 진행). 관측 3박자: overload-detected(logs) + heavyDecision 마커(요약·진단) + arc split(분할 시).
      if (overloadSignal) {
        try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.walker', 'overload-detected', { missionId, phaseId: task.id, ...(overloadSignal as { turn: number; consecutiveFailures: number; reason: string }), attempt: attempt + 1, route: 'auto-split' }); } catch { /* fail-soft */ }
        const os = overloadSignal as { turn: number; consecutiveFailures: number; reason: string };
        heavyDecision = { path: 'split', nextBudget: currentBudget, injectInstructions: [], isRetry: false, source: 'heuristic', rationale: `walker 과부하(${os.reason}·turn ${os.turn}·연속압축실패 ${os.consecutiveFailures}) — 컨텍스트 폭발 조기 분할(예산 상향 역효과)` };
        lastTag = 'overload(fail)'; lastReason = 'overload';
        break; // 조기 중단 — 남은 예산 계단 소진 없이 split 로
      }
      if (attempt >= MAX_ATTEMPTS - 1) break; // 마지막 시도 — 재시도 없음
      // ★ 근본 갈림길 분류(2번째 시도부터) — 실패를 관찰해 예산/전략을 동적 조정.
      const decision = await triageRetry(
        {
          phaseTitle: task.title, goal: basePrompt.slice(0, 300), acceptance: acceptanceText,
          requiredArtifacts, attempts: attemptsEv, priorDecisions: triageDecisions,
          nextBudgetDefault: budgets[Math.min(attempt + 1, budgets.length - 1)]!,
        },
        { classify: triageClassify },
      );
      triageDecisions.push(decision.path);
      console.log(`[multiphase] 재시도 triage(${decision.source}) → ${decision.path} · ${decision.rationale}`);
      try {
        if (phaseProgress) {
          const note = decision.isRetry ? `🧭 재시도 판단: ${decision.path} · 예산 ${Math.round(decision.nextBudget / 1000)}k` : `🧭 재시도 판단: ${decision.path}(사람 검토) · ${decision.rationale.slice(0, 50)}`;
          const mid = notifyPhaseProgress(missionOrigin, phaseProgress.msgId, phaseProgress.info, note);
          if (mid) phaseProgress.msgId = mid;
        }
      } catch { /* fail-soft */ }
      if (!decision.isRetry) {
        heavyDecision = decision; // split/revise/skip/escalate → 중단(HITL)
        // ★ S3 in-flight 아크 수술(2026-07-19) — split(범위 과대)은 분할 대상. 관측 3박자(arc_surgery
        //   deviation + exec arc-surgery frame + logs)를 각인해 리플레이·회고가 "왜 수술 제안했나"를
        //   회상. 실제 분할은 기존 inject --arc/편집 CLI(사람 승인·영향 큼=HITL). fail-soft.
        try {
          const { isArcSurgeryTrigger, formatArcSurgeryProposal } = await import('../src/autopilot/mission-arc-surgery.js');
          if (isArcSurgeryTrigger(decision.path)) {
            const proposal = formatArcSurgeryProposal(task.title, decision.rationale);
            try { recordExecPhaseFrame(missionId, { phaseId: task.id, phaseTitle: task.title, op: 'arc-surgery', status: 'blocked', deviation: { kind: 'arc_surgery', note: proposal }, note: 'split 제안(HITL)' }); } catch { /* fail-soft */ }
            try { coordinatorRecordMemory(missionId, { phaseId: task.id, phaseTitle: task.title, kind: 'operational', summary: proposal, reusables: [], decisions: [], artifacts: [], deviation: { kind: 'arc_surgery', note: proposal } }); } catch { /* fail-soft */ }
            // ★ CC2(RFC-general-coordinator-custom-contracts §3d) — 파편 각인 넘어 UX flow 로 재구성
            //   선택지 제시(S3 아크분할). opt-in canUseUxAgent·fail-soft·기존 발행 인프라 재활용.
            try {
              const { canUseUxAgent } = await import('../src/ux/ux-config.js');
              const { notifyMissionHitlViaUx } = await import('../src/autopilot/mission-ux-live.js');
              if (canUseUxAgent() && missionOrigin) notifyMissionHitlViaUx(missionOrigin, missionId, proposal, { signals: { arcSurgery: true, phaseFailed: true } });
            } catch { /* fail-soft */ }
          }
        } catch { /* fail-soft */ }
        // ★ S2 의존 미션 추천(2026-07-19) — escalate(근본 불가·전제/선행 부재)·skip(건너뜀·의존 대기)은
        //   부분 완주 + 선행 필요 신호. 관측 3박자(blocked_dependency deviation + exec dep-recommend
        //   frame + logs)를 각인. 실제 carve/association·재개는 기존 CLI(HITL·영향 큼). fail-soft.
        try {
          const { isDependencyRecommendTrigger, formatDependencyProposal } = await import('../src/autopilot/mission-dependency-recommend.js');
          if (isDependencyRecommendTrigger(decision.path)) {
            const proposal = formatDependencyProposal(task.title, decision.rationale);
            try { recordExecPhaseFrame(missionId, { phaseId: task.id, phaseTitle: task.title, op: 'dep-recommend', status: 'blocked', deviation: { kind: 'blocked_dependency', note: proposal }, note: 'escalate/skip 의존추천(HITL)' }); } catch { /* fail-soft */ }
            try { coordinatorRecordMemory(missionId, { phaseId: task.id, phaseTitle: task.title, kind: 'operational', summary: proposal, reusables: [], decisions: [], artifacts: [], deviation: { kind: 'blocked_dependency', note: proposal } }); } catch { /* fail-soft */ }
            // ★ CC2(RFC §3d) — 파편 각인 넘어 UX flow 로 재구성 선택지 제시(S2 의존미션 신설/재개).
            //   opt-in canUseUxAgent·fail-soft·기존 발행 인프라 재활용.
            try {
              const { canUseUxAgent } = await import('../src/ux/ux-config.js');
              const { notifyMissionHitlViaUx } = await import('../src/autopilot/mission-ux-live.js');
              if (canUseUxAgent() && missionOrigin) notifyMissionHitlViaUx(missionOrigin, missionId, proposal, { signals: { blockedDependency: true, phaseFailed: true } });
            } catch { /* fail-soft */ }
          }
        } catch { /* fail-soft */ }
        break;
      }
      currentBudget = decision.nextBudget;
      if (decision.injectInstructions.length) injected = injected.concat(decision.injectInstructions);
    }
    // ★ 운영(walker) 페이즈 실패 관측성 — lastText(에이전트 마지막 응답)를 run.log 에 남겨 진단이 읽게.
    console.log(`[multiphase] 운영 페이즈 실패 — [${lastTag}·${lastReason}]: ${lastText.slice(0, 600)}`);
    // ★ triage 가 근본 갈림길(분할/골정정/건너뜀/에스컬)을 권고하면 실패 요약에 실어 실패 카드·진단에 노출.
    const triageNote = heavyDecision ? ` [재시도 triage 권장: ${heavyDecision.path} — ${heavyDecision.rationale}]` : '';
    // ★ P1 기록(실패) — 후속 페이즈가 "이 페이즈는 실패했다"를 인지하도록(부분 조사 결과도 있으면 실림).
    recordPhaseWorkingMemory(missionId, task, walkerMemKind(task.title), { summary: `[실패·${lastReason}]${triageNote} ${lastText.slice(0, 300)}`, agentText: lastText });
    return { ok: false, summary: `[${lastTag}·${lastReason}·${attemptsEv.length}회 시도]${triageNote} ${lastText}` };
  },
  {
    log: (s) => console.log(s),
    // ★ 아크 통합 acceptance 검증기 주입(A7-L3·2026-07-14) — grounded(코드 실독) dead-code 검출.
    //   이게 없으면 verifyArcAcceptance 가 skip-pass(항상 통과)라 아크의 존재 이유(페이즈 green인데
    //   아크로는 미배선)가 무력화됐다(RFC §14a 갭 1). process.cwd()=미션 워킹트리 루트.
    verifyArc: defaultArcVerifier(missionWtPlan ? getSessionCwd() : process.cwd()),
    // ★ P4 셀프힐 자동집행(opt-in·autopilot.selfHealAutoExec·기본 OFF) — 페이즈 실패 시 GoalBlocker
    //   유형화(P4)로 힐 경로를 가른다: 재조사/재시도(자동·harmless·멱등)는 진단을 워킹메모리에 주입해
    //   다음 시도가 "무엇이 빠졌나"를 보게 하고(비파괴 셀프힐), 사용자입력필요/불명은 HITL(decideAutonomousAct
    //   가드가 실집행 게이트). 매매 fail-CLOSED 불변·armed 무관(빌드 힐은 실자금/파괴 경로 아님).
    //   seam 미주입(OFF)이면 no-op → 종전 동작(회귀 0).
    ...(selfHealAutoExecEnabled ? { aa1Heal: {
      recommend: (task: { id: string; title: string }, summary: string) => {
        const v = classifyGoalBlocker(summary);
        try { observeCoordinator('heal-blocker', missionId, { phaseId: task.id, kind: v.kind, route: v.route, autoHealable: v.autoHealable }); } catch { /* fail-soft */ }
        return goalBlockerToHealRecommend(v);
      },
      execute: async (task: { id: string; title: string }, kind: string) => {
        // 비파괴 자동힐 — 진단을 워킹메모리에 주입(다음 재시도/재조사가 결핍 컨텍스트를 인지). 멱등·harmless.
        try {
          coordinatorRecordMemory(missionId, { phaseId: task.id, phaseTitle: task.title, kind: 'operational',
            summary: `[셀프힐:${kind}] 이 페이즈 실패 — 다음 시도는 이 진단을 반영하라(자동 재계획)`,
            reusables: [], decisions: [], artifacts: [], deviation: { kind: 'self_heal', note: kind } });
          observeCoordinator('heal-execute', missionId, { phaseId: task.id, kind });
          return true;
        } catch { return false; }
      },
    } } : {}),
    // ★ 페이즈별 실시간 알림(대표 2026-07-12) — 각 페이즈 종결 즉시 발송. SE built PR 있으면
    //   "📖 PR #N 리뷰" URL 버튼(탭 → GitHub PR 바로 열림·클릭 리뷰). fail-soft.
    // P7 — missionId 스레딩: 실패 카드의 📄 로그 안내(elanous ops mission-log)가 미션을 특정하도록.
    onPhaseStart: (e) => {
      // ★ 신호 누수 차단(2026-07-23·리뷰 반영) — 무조건 clear(레이스: 직전 도착 정상 신호 삭제) 대신 소비자
      //   (consumeMissionSignal)가 phaseId 대조+TTL 로 다른 페이즈용/만료 신호를 소비 시점에 정리한다. 새 페이즈는
      //   자기 phaseId 로 소비하므로 이전 페이즈용 abort 는 자동 무시+clear(phase-mismatch)·레이스 없음.
      try { const mid = notifyPhaseResult(missionOrigin, { ...e, missionId, provider: execProviderLabel }); phaseProgress = { msgId: mid, ...(e.phaseId ? { phaseId: e.phaseId } : {}), info: { index: e.index, total: e.total, title: e.title, provider: execProviderLabel, ...(e.arcName ? { arcName: e.arcName } : {}), ...(e.arcSeq ? { arcSeq: e.arcSeq } : {}) } }; } catch { /* fail-soft */ }
      try { recordExecPhaseFrame(missionId, { phaseId: e.phaseId ?? '', phaseTitle: e.title, op: 'phase-start', status: 'running', ...(e.arcName ? { arcName: e.arcName } : {}), ...(e.arcSeq ? { arcSeq: e.arcSeq } : {}) }); } catch { /* fail-soft */ }
    },
    onPhaseDone: (e) => {
      try { notifyPhaseResult(missionOrigin, { ...e, missionId, provider: execProviderLabel }); } catch { /* fail-soft */ }
      try { recordExecPhaseFrame(missionId, { phaseId: e.phaseId ?? '', phaseTitle: e.title, op: 'phase-done', status: toExecPhaseStatus(e.status), ...(e.arcName ? { arcName: e.arcName } : {}), ...(e.arcSeq ? { arcSeq: e.arcSeq } : {}), ...(e.prUrl ? { artifacts: [e.prUrl] } : {}), ...(e.summary ? { note: e.summary.slice(0, 200) } : {}) }); } catch { /* fail-soft */ }
      // ★ UR1 조율자 매스텝 스텝(통합 런타임) — 중앙 State 조립 → coordinatorStep(순수) 로 ledger 판정 +
      //   State 갱신을 한 곳에서. 종전엔 evaluateMissionProgress(저널 재-read)를 콜백에서 직접 불렀다.
      //   이제 조율자 결정이 coordinatorStep 한 곳에 수렴하고, 갱신된 중앙 State 를 매스텝 persist →
      //   실행이 State 를 통과한다. logProgressLedger 로 mission.coordinator.ledger 방출은 그대로. fail-soft.
      try {
        const state = assembleMissionState(missionId);
        const step = coordinatorStep({ state, ...(e.total !== undefined ? { totalPhases: e.total } : {}) });
        // ★ 제1원칙 관측 — 중앙 State 가 이 스텝을 통과함을 mission.coordinator.step 으로(자기인지). ledger
        //   판정은 mission.coordinator.ledger 로. 둘 다 `elanous logs --category mission.coordinator` 로 회상.
        for (const o of step.observations) observeCoordinator(o.event, missionId, o.data);
        logProgressLedger(missionId, step.ledger);
        persistMissionState(missionId, applyChannelUpdates(state, step.updates));
        // ★ R1(RFC-autonomous-pr-review 3b) — 조율자 Command 판정. ledger 신호 + 리뷰-재작업 교착(review-gate
        //   프레임 파생·ledger 가 못 보는 리뷰 fail 루프)을 결합 → replan/escalate. 리뷰 신호는 관측만도 남긴다.
        const reviewSig = deriveReviewSig(Array.isArray(state.frames) ? (state.frames as { phaseId?: string; op?: string; status?: string }[]) : []);
        if (reviewSig.reviewFailures > 0) observeCoordinator('review-signal', missionId, { reviewFailures: reviewSig.reviewFailures, reviewReworkStalled: reviewSig.reviewReworkStalled });
        const cmd = decideCoordCmd({ ledgerRecommendation: step.ledger.recommendation, reviewReworkStalled: reviewSig.reviewReworkStalled });
        // ★ S7(대표 2026-07-20) — 교착(ledger replan/inLoop 또는 리뷰-재작업 루프) 1회 감지 시 재구성 UX flow.
        //   Command 판정 재활용(감지 신규 아님)·미션당 1회(deadlockNotified)·opt-in canUseUxAgent·fail-soft.
        if (!deadlockNotified && (cmd.action === 'replan' || cmd.action === 'escalate' || step.ledger.inLoop) && missionOrigin && canUxS7()) {
          deadlockNotified = true;
          const why = reviewSig.reviewReworkStalled ? `리뷰-재작업 반복(리뷰 fail ${reviewSig.reviewFailures})` : `진전 없음(stall ${step.ledger.stallCount})`;
          try { notifyUxS7(missionOrigin, missionId, `🔄 교착 감지 — ${why}. 아크 재분해·접근 전환을 제안합니다.`, { signals: { deadlock: true, failureCount: step.ledger.stallCount, ...(reviewSig.reviewReworkStalled ? { reviewReworkStalled: true } : {}) } }); } catch { /* fail-soft */ }
        }
      } catch { /* fail-soft */ }
    },
    // ★ 아크 이벤트 실시간 통지(A7 arc-aware UX·2026-07-14) — 아크 통합검증 통과/실패(reconcile·complete)를
    //   텔레그램 카드로. 페이즈가 green 인데 아크로는 dead-code 인 순간을 사람이 본다. fail-soft.
    onArcResult: (e) => { try { notifyArcResult(missionOrigin, e); } catch { /* fail-soft */ } },
  },
);
if (mp.multiphase) {
  // ★ 전체 페이즈 실제 순서·상태 기준 리포트(대표 2026-07-12) — 리쥼 시 이번 run 실행분만 재번호
  //   하고 이미 done 인 앞 페이즈를 "미실행" 으로 오인하던 버그 해소. allPhases 없으면 폴백.
  const all = mp.allPhases ?? mp.phases.map((p, i) => ({ index: i, title: p.title, status: p.status, phaseId: p.phaseId ?? '', summary: p.summary, prUrl: p.prUrl, critiqueVerdict: undefined as string | undefined, critiqueFindings: undefined as readonly string[] | undefined }));
  const total = mp.total ?? all.length;
  const doneN = all.filter((p) => p.status === 'done').length;
  const failedN = all.filter((p) => p.status === 'failed').length;
  const remainN = all.filter((p) => p.status !== 'done' && p.status !== 'failed').length; // 미실행/대기
  // ★ 프레이밍 완화(대표 2026-07-21) — 페이즈 실패는 자율 복구(O6-arm rebuild)나 재구성 판정으로 이어지는
  //   경우가 많아 "⛔ 미션 중단"은 과한 에러 프레이밍(대표 지적·거슬림). 후속 대기 + 복구/재구성 진행 톤으로.
  const head = failedN > 0
    ? (remainN > 0 ? `🔧 페이즈 실패 — 후속 ${remainN} 대기(자율 복구·재구성 판정)` : '⚠️ 멀티페이즈 미션 실행(일부 실패)')
    : '🤖 멀티페이즈 미션 실행 완료';
  // 실제 순서(1..N)로 전 페이즈 나열 — done/failed 는 사유(summary) 노출, 그 외는 [미실행].
  const lines = all.map((p) => {
    const running = p.status === 'done' || p.status === 'failed';
    const label = running ? p.status : '미실행';
    const s = (p.summary ?? '').replace(/\s+/g, ' ').trim();
    const showDetail = (p.status === 'failed' || /SE·PR|arming 대기|PR http|변경 불필요|no-op/i.test(s)) && s;
    const detail = showDetail ? `\n     └ ${s.slice(0, 140)}` : '';
    return `  ${p.index + 1}. [${label}] ${p.title}${detail}`;
  }).join('\n');
  const partial = failedN > 0
    ? `\n(✅완료 ${doneN} 보존 · 미션 유지 · 자동삭제 안 함 · 실패 페이즈 재구현 or 처음부터 재실행으로 이어감)`
    : '';
  // ★ 아크 브레이크다운(A7 arc-aware UX·2026-07-14) — 요약 카드(sendOutbound 다채널)에 아크별 상태·
  //   통합검증·preflight 판정을 실는다. flat(암묵 1아크) 미션이면 생략. fail-soft.
  let arcBlock = '';
  try {
    const s = new TaskStore();
    try {
      const marcs = s.getMission(missionId)?.autopilot?.arcs;
      if (marcs && marcs.length) {
        const ai = (st: string): string => st === 'done' ? '✅' : st === 'failed' ? '🔒' : (st === 'active' || st === 'verifying') ? '🔧' : '⏳';
        const arcLines = marcs.map((a, i) => {
          const pf = a.preflightVerdict && a.preflightVerdict.verdict !== 'founded' ? ` ⚠️${a.preflightVerdict.verdict}` : '';
          const vr = a.status === 'failed' && a.verifyResult?.missing ? ` — ${a.verifyResult.missing.slice(0, 60)}` : '';
          return `  ${ai(a.status)}⬡${i + 1}. [${a.status}] ${a.name}${pf}${vr}`;
        }).join('\n');
        const arcDone = marcs.filter((a) => a.status === 'done').length;
        arcBlock = `\n아크 ${arcDone}/${marcs.length}:\n${arcLines}`;
      }
    } finally { s.close(); }
  } catch { /* fail-soft */ }
  const msg = `${head}\n골: ${goal}\n완료 ${doneN}/${total} · 실패 ${failedN}${remainN ? ` · 미실행 ${remainN}` : ''}${arcBlock}\n${lines}${partial}\n· ${missionId}`;
  const ok = sendOutbound(msg, failedN > 0 ? 'alert' : 'report', missionOrigin);
  console.log(`[run-mission] 멀티페이즈 완료 · sent=${ok} · done=${mp.done} failed=${mp.failed}`);

  // ★ 자기 관측성 영속(대표 2026-07-13·PLAN O1/O2) — 각 페이즈 결과를 진단으로 합성해
  //   ① ops_events(task status_change·elanous ops 가 읽음) ② task.notes(왜 실패했나 영속)에
  //   남긴다. 그간 실패 이유가 휘발성 /tmp 로그에만 있어 elanous 자신이 못 읽던 갭 해소. fail-soft.
  try {
    const diagStore = new TaskStore();
    try {
      for (const p of all) {
        if ((p.status !== 'done' && p.status !== 'failed') || !p.phaseId) continue;
        const outcome = buildPhaseOutcomeFromSummary({
          phaseId: p.phaseId, missionId, title: p.title, index: p.index, total,
          status: p.status, summary: p.summary, goal,
          ...(p.critiqueVerdict === 'pass' || p.critiqueVerdict === 'fail' ? { critiqueVerdict: p.critiqueVerdict } : {}),
          ...(p.critiqueFindings?.length ? { critiqueReason: p.critiqueFindings.join(' · ').slice(0, 200) } : {}),
          evidenceRefs: { runLogPath: missionRunLogPath(missionId), ...(p.prUrl ? { prUrl: p.prUrl } : {}) },
        });
        // ★ P6 — attempts 실측(se_builds 빌드=시도 1급·B1 계측). summary regex 재구성은 폴백.
        //   텔레그램 카드(notifyPhaseResult)와 같은 사실원 — 진단 소비 일원화.
        try {
          const real = attemptsForPhase(p.phaseId);
          if (real.length) outcome.attempts = real;
        } catch { /* fail-soft */ }
        // ★ O5-live — 실패면 LLM 으로 근본원인 격상(fail-soft·없으면 결정론 골격). run.log 게이트
        //   사유를 입력에 넣어(대표 2026-07-13) opus 수준 판단(dead-code/범위밖/no-op→분할).
        const gateReasons = p.status === 'failed' ? extractGateReasons(missionRunLogPath(missionId)) : undefined;
        // ★ R3 우선(대표 2026-07-13) — 모순(시스템 의심)이면 소스 룩백 rootCause, 없으면 기존 골격 LLM.
        const lookback = p.status === 'failed' ? await systemLookbackRootCause(outcome) : { signals: [] as ContradictionSignal[] };
        const llmRoot = p.status === 'failed'
          ? (lookback.root ?? (await llmRootCause({ ...outcome, ...(gateReasons ? { gateReasons } : {}) })))
          : undefined;
        let diag = synthesizePhaseDiagnosis(outcome, { ...(llmRoot ? { llmRootCause: llmRoot } : {}), ...(strictOversizeOn ? { requireSizeSignal: true } : {}) });
        // ★ reuse-existence 교정(대표 2026-07-13·A2·DESIGN §5) — heal=split 판정을 실측으로 재검증.
        //   선언된 재사용 경계(워킹메모리 reusables)가 코드베이스+백업에 실제로 존재하는지 예산 무제한
        //   탐색해, 과반 실존이면 "과대(split)" 오판을 "재사용 미이행 -> rebuild-with-map" 으로 교정
        //   (split 남발 방지·P7 근본). 재사용맵을 rootCause 에 실어 rebuild 가 그대로 참조. fail-soft.
        if (p.status === 'failed' && diag.healRecommendation.kind === 'split') {
          try {
            const { assessReuseAndReviseHeal } = await import('../src/autopilot/reuse-existence-explorer.js');
            const wm = readWorkingMemory(missionId);
            const scoped = wm.filter((e) => e.phaseId === p.phaseId || e.phaseTitle === p.title).flatMap((e) => e.reusables);
            const bounds = scoped.length ? scoped : wm.flatMap((e) => e.reusables);
            if (bounds.length) {
              const rev = assessReuseAndReviseHeal({ boundaries: bounds, currentHeal: 'split' });
              if (rev.changed) {
                diag = { ...diag, healRecommendation: { kind: rev.heal, confidence: rev.confidence, rationale: rev.rationale }, rootCauseInference: `${diag.rootCauseInference}\n${rev.reuseMap}` };
                console.log(`[run-mission] ★ reuse-existence 교정 · split->${rev.heal} · ${p.title.slice(0, 30)} (${rev.rationale.slice(0, 60)})`);
              }
            } else {
              // ★ ④ 신규구현형 인지(관측 보강·대표 2026-07-21·split 남발 ④) — reusables 경계 0 이라 reuse-existence
              //   교정이 원천 무력한 페이즈(신규 코드 작성형). 이 경로가 split 반복하면 수렴가드→reshape(②)가 잡는다.
              //   "무엇이 reuse 교정에 안 잡히는가"를 표면화(관측 3박자) — 조회 elanous logs --category mission.selfheal.reuse-skip.
              try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.selfheal.reuse-skip', 'new-impl-phase', { missionId, phaseId: p.phaseId, reason: '신규구현형(reusables 경계 0) — reuse 교정 무력·수렴가드/reshape 위임' }); } catch { /* fail-soft */ }
            }
          } catch { /* fail-soft — 탐색 실패면 원 진단(split) 유지 */ }
        }
        // ★ triage 힐 오버라이드(대표 2026-07-14) — 재시도 triage(walker/SE)가 실패 요약에 남긴 근본
        //   갈림길 결정을 결정론 recommendHeal 보다 우선. budget-exhausted 자율 셀프힐이 P6(premise
        //   부재->revise 인데 결정론은 rebuild(low))을 rebuild 로 오힐하지 않게 한다. 마커 없으면 유지.
        if (p.status === 'failed') {
          const triageHeal = parseTriageHealOverride(p.summary ?? '');
          if (triageHeal && triageHeal !== diag.healRecommendation.kind) {
            console.log(`[run-mission] ★ triage 힐 오버라이드 · ${diag.healRecommendation.kind}->${triageHeal} · ${p.title.slice(0, 30)}`);
            diag = { ...diag, healRecommendation: { kind: triageHeal, confidence: diag.healRecommendation.confidence, rationale: `재시도 triage 권장(${triageHeal}) 우선 · ${diag.healRecommendation.rationale}`.slice(0, 200) } };
          }
          // ★ 중앙 맥락-triage(대표 2026-07-22 "신호 올라오면 문맥을 더 넓게 보고 판단하는 조율자 층") — 위의
          //   리지드 heal(budget→rebuild/split) 을, 실패를 **넓은 맥락**(phaseKind 분류·선언문·criteria·미션골·
          //   형제·실패출력·시도이력)으로 조율자가 재판정. 신규 heal(fix-declaration=선언 모호/잘림→텍스트 수정·
          //   route-hitl=승인요청 등 HITL 필수→escalate) 포함 → 선언문/HITL 실패를 split/rebuild 로 오귀속하던
          //   근본 종식(라이브 81b18c). 공용화: 폴백=위 diag·집행=기존 revise/escalate dispatch 매핑. opt-in.
          const ccHealOn = (() => { try { return (getUserConfig().raw?.autopilot as { coordinatorControl?: unknown } | undefined)?.coordinatorControl === true; } catch { return false; } })();
          if (ccHealOn && p.status === 'failed') {
            try {
              const { decideHealTriage, mapContextualHealToDispatch } = await import('../src/autopilot/mission-heal-triage.js');
              const taskRec = diagStore.listTasks({ goalSlug: missionId }).find((t) => t.id === p.phaseId);
              const acceptance = taskRec?.acceptance?.criteria ? [...taskRec.acceptance.criteria] : [];
              const phasePrompt = taskRec?.surface.kind === 'subagent' ? taskRec.surface.prompt : (outcome.goal ?? p.title);
              // ★ 분류 관찰·스레딩 수복(대표 2026-07-22) — 종전엔 raw regex classifyPhaseKind 를 proxy 로
              //   재계산해 (a)관측을 안 남기고 (b)페이즈 실행 때 이미 관측된 smart 분류(State 라우팅)와 단절됐다.
              //   → State 의 persist 된 smart 라우팅을 우선 읽고(threading), 없으면 regex 폴백, **어느 쪽이든
              //   관측**(제1원칙). 이로써 triage 가 쓰는 분류가 logs 에 보이고 앞단 분류와 일관.
              let phaseKind: PhaseKind | undefined;
              let pkSource = 'none';
              try {
                const persisted = readMissionState(missionId);
                const prior = persisted ? routingForPhase(persisted, p.phaseId) : undefined;
                if (prior && (prior.phaseKind === 'implementation' || prior.phaseKind === 'operational')) {
                  phaseKind = prior.phaseKind; pkSource = 'state';
                }
              } catch { /* fail-soft — State 읽기 실패는 regex 폴백 */ }
              if (!phaseKind && taskRec) { phaseKind = classifyPhaseKind(taskRec); pkSource = 'regex'; }
              if (phaseKind) { try { observeCoordinator('triage-classify', missionId, { phaseId: p.phaseId, phaseKind, source: pkSource }); } catch { /* fail-soft */ } }
              const priorHeals = (taskRec?.notes ?? []).filter((n) => n.includes('권장 힐') || n.startsWith('[DIAGNOSIS')).slice(-4);
              const resolve = async (prompt: string): Promise<string> => {
                const { streamLLM } = await import('../src/llm.js');
                return streamLLM([{ role: 'user', content: prompt }], () => {}, { model: process.env.ELANOUS_HEAL_TRIAGE_MODEL || 'gpt-5.6-sol', reasoningEffort: 'medium' });
              };
              const decision = await decideHealTriage({
                phaseTitle: p.title, phasePrompt, acceptanceCriteria: acceptance,
                ...(phaseKind ? { phaseKind } : {}),
                missionGoal: goal, siblingTitles: all.filter((x) => x.phaseId !== p.phaseId).map((x) => x.title).slice(0, 10),
                failureOutput: (gateReasons ?? p.summary ?? '').slice(0, 500), attemptCount: outcome.attempts.length,
                priorHeals, ...(outcome.failClass ? { failClass: outcome.failClass } : {}),
              }, resolve, diag.healRecommendation.kind);
              const mapped = mapContextualHealToDispatch(decision.heal);
              if (mapped.kind !== diag.healRecommendation.kind || mapped.declarationFix || mapped.hitl) {
                console.log(`[run-mission] ★ 중앙 triage · ${diag.healRecommendation.kind}->${decision.heal}${mapped.declarationFix ? '(선언수정)' : mapped.hitl ? '(HITL)' : ''} · ${p.title.slice(0, 30)} (${decision.reason.slice(0, 50)})`);
                diag = { ...diag, healRecommendation: { kind: mapped.kind, confidence: decision.confidence, rationale: `중앙 triage(${decision.heal}): ${decision.reason}`.slice(0, 200) } };
                try { observeCoordinator('heal-triage', missionId, { phaseId: p.phaseId, heal: decision.heal, mapped: mapped.kind, ...(phaseKind ? { phaseKind } : {}), reason: decision.reason.slice(0, 80) }); } catch { /* fail-soft */ }
              }
            } catch { /* fail-soft — 중앙 triage 실패면 위 diag 유지 */ }
          }
          // ★ 실패 셀프인지 보강(대표 2026-07-19·제1원칙) — 실패+권장힐(미적용)을 미션 워킹메모리에 구조적
          //   deviation(phase_failed)으로 각인. 후속 페이즈·조율자가 "무엇이 왜 실패했고 어떤 힐이 대기 중인가"를
          //   formatWorkingMemoryForPrompt 로 능동 회상(자기인지). fail-soft.
          try {
            coordinatorRecordMemory(missionId, {
              phaseId: p.phaseId, phaseTitle: p.title, kind: 'operational',
              summary: `실패(${outcome.failClass}) → 권장 힐 ${diag.healRecommendation.kind}(미적용·자율집행/HITL 대기): ${diag.healRecommendation.rationale.slice(0, 120)}`,
              reusables: [], decisions: [], artifacts: [],
              deviation: { kind: 'phase_failed', note: `${outcome.failClass}→${diag.healRecommendation.kind}` },
            });
          } catch { /* fail-soft */ }
          // ★ split 자율 집행(opt-in splitAutoExec·대표 2026-07-20) — heal=split(과대·reuse-existence 교정
          //   통과 후)은 HITL 대신 자율 분할 집행 + 사후 통지. 분할은 미션 빌드 진행에 도움·구조 국소조정.
          //   splitPhaseIntoSubphases 가 서브페이즈 backlog 생성·원본 삭제·재spawn 까지 완결(재개 내장).
          // ★ split 수렴가드(대표 2026-07-21) — 이 페이즈의 아크가 이미 임계 이상 split(drift) 됐으면
          //   split 차단(남발·무한재귀 방지)하고 heal 을 escalate 로 강등 → 아래 arc-edit(reshape)/
          //   progress-verdict/HITL 이 이어받는다. "한 페이즈 국소 4분할" 반복 대신 "전체 아크 reshape/사람"으로.
          let reshapeHandled = false;
          if (p.status === 'failed' && diag.healRecommendation.kind === 'split' && splitConvergenceGuardOn) {
            try {
              const arcs = diagStore.getMission(missionId)?.autopilot?.arcs;
              const hostArcId = arcs ? arcIdForPhase(arcs, p.phaseId) : undefined;
              const { detectArcSizeDrift } = await import('../src/autopilot/mission-arc-drift.js');
              const drift = arcs ? detectArcSizeDrift(arcs) : [];
              const hit = hostArcId ? drift.find((d) => d.arcId === hostArcId) : undefined;
              if (hit) {
                console.log(`[run-mission] ★ 수렴가드 — 아크 "${hit.name.slice(0, 30)}" splitCount ${hit.splitCount}회(임계) → split 차단·상위 reshape/escalate 라우팅`);
                try { observeCoordinator('split-convergence-guard', missionId, { phaseId: p.phaseId, arcId: hostArcId, splitCount: hit.splitCount, phaseCount: hit.phaseCount }); } catch { /* fail-soft */ }
                // ★ 아크 reshape 자율집행 시도(opt-in) — escalate 강등 전. 전체 아크 문맥으로 재성형. 성공 시
                //   하류(split/arc-edit/verdict/HITL) 스킵(autoSplitHandled) + 재spawn(splitOccurred·검증된 seam).
                if (arcReshapeAutoExecOn && arcs) {
                  try {
                    const { buildArcReshapeInput, decideArcReshape, applyArcReshape, defaultArcReshapeResolve, defaultArcReshapeExecutors } = await import('../src/autopilot/mission-arc-reshape.js');
                    const rInput = buildArcReshapeInput(missionId, goal, arcs, assembleMissionState(missionId) as unknown as { phases?: unknown; failures?: unknown; workingMemory?: unknown }, hostArcId);
                    const rDec = await decideArcReshape(rInput, defaultArcReshapeResolve);
                    try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.coordinator.arc-reshape', rDec.action, { missionId, arcId: hostArcId, reason: rDec.reason.slice(0, 150) }); } catch { /* fail-soft */ }
                    if (rDec.action !== 'no-reshape') {
                      const rRes = await applyArcReshape(missionId, rDec, defaultArcReshapeExecutors());
                      if (rRes.ok) {
                        reshapeHandled = true; splitOccurred = true;
                        try { observeCoordinator('arc-reshape', missionId, { action: rDec.action, arcId: hostArcId, detail: rRes.detail }); } catch { /* fail-soft */ }
                        console.log(`[run-mission] ★ 아크 reshape 자율집행 · ${rDec.action} · ${rRes.detail ?? ''}`);
                        if (missionOrigin) { try { const { notifyMissionOrigin } = await import('../src/autopilot/mission-notify.js'); notifyMissionOrigin(missionOrigin, `🔧 조율자 아크 reshape(자율) — ${rDec.action}: ${rDec.reason.slice(0, 60)}. 재개합니다.`); } catch { /* fail-soft */ } }
                      }
                    }
                  } catch { /* fail-soft → escalate 폴백 */ }
                }
                if (!reshapeHandled) diag = { ...diag, healRecommendation: { ...diag.healRecommendation, kind: 'escalate', rationale: `수렴가드: 아크 반복 split ${hit.splitCount}회(남발) → split 중단·전체 아크 reshape/사람 판단. ${diag.healRecommendation.rationale}`.slice(0, 200) } };
              }
            } catch { /* fail-soft — 가드 실패면 종전 split 경로 */ }
          }
          let autoSplitHandled = reshapeHandled;
          if (p.status === 'failed' && diag.healRecommendation.kind === 'split' && splitAutoExecEnabled) {
            try {
              const { splitPhaseIntoSubphases } = await import('../src/autopilot/mission-phase-split.js');
              // ★ 재spawn defer(split 자동재개 갭·대표 2026-07-21) — 즉시 재spawn 은 이 프로세스 락 보유
              //   중이라 조기종료→정지. no-op 주입으로 skip 하고, 이 프로세스 exit 후 락 해제하고 재spawn(아래).
              const res = await splitPhaseIntoSubphases(missionId, p.phaseId, { spawnRun: () => {} });
              if (res.capHit) {
                // ★ Device 3 (PLAN-anti-infinite-phase-split 2026-07-23) — 페이즈 예산 cap 도달 → 중앙
                //   조율자가 처리한다: reshape(merge/re-decompose)로 과팽창 압축 시도 → 여유 생기면 재개,
                //   못 하면 HITL escalate. 무한 split 이 여기서 조율자 판단으로 귀결(관측 mission.phase.reshape).
                try {
                  const { governPhaseCapHit } = await import('../src/autopilot/mission-phase-cap-governor.js');
                  const capArcId = diagStore.getMission(missionId)?.autopilot?.arcs?.find((a) => a.phaseIds.includes(p.phaseId))?.arcId;
                  const gov = await governPhaseCapHit(missionId, capArcId, { store: diagStore });
                  try { observeCoordinator('cap-governor', missionId, { phaseId: p.phaseId, action: gov.action, reshapeAction: gov.reshapeAction, phaseCount: gov.phaseCount, budget: gov.budget }); } catch { /* fail-soft */ }
                  if (gov.action === 'reshaped') {
                    autoSplitHandled = true; splitOccurred = true; // 압축 후 재개(재spawn)
                    console.log(`[run-mission] ★ 예산 cap(${gov.phaseCount}/${gov.budget}) → 조율자 reshape 압축 · ${gov.detail}`);
                    if (missionOrigin) { try { const { notifyMissionOrigin } = await import('../src/autopilot/mission-notify.js'); notifyMissionOrigin(missionOrigin, `📐 페이즈 예산 도달 → 조율자가 ${gov.reshapeAction}로 압축(${gov.phaseCount}/${gov.budget}) 후 재개합니다.`); } catch { /* fail-soft */ } }
                  } else {
                    // HITL — 압축 불가/여전히 초과. 무한 split 대신 대표 결정(descope/redesign) 표면화.
                    diag = { ...diag, healRecommendation: { ...diag.healRecommendation, kind: 'escalate', rationale: `페이즈 예산 초과(${gov.phaseCount}/${gov.budget}) — split 중단. ${gov.detail}`.slice(0, 200) } };
                  }
                } catch { /* fail-soft → 아래 escalate 폴백 */ }
              } else if (res.ok) {
                autoSplitHandled = true;
                splitOccurred = true; // exit 직전 락 해제 후 detached 재spawn 트리거(서브페이즈 순회 재개).
                try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.split-resume', 'deferred-respawn', { missionId, phaseId: p.phaseId, subPhases: res.subPhaseCount ?? 0, reason: 'lock-held-during-split' }); } catch { /* fail-soft */ }
                // 관측 = split 함수 내부 debug.log('mission.arc.split') + 아래 사후 통지 + res 로그.
                console.log(`[run-mission] ✂️ 자율 분할 집행 · ${p.title.slice(0, 30)} → ${res.subPhaseCount ?? 0} 서브페이즈 (splitAutoExec)`);
                try { observeCoordinator('auto-split', missionId, { phaseId: p.phaseId, subPhases: res.subPhaseCount, reason: /overload/.test(p.summary ?? '') ? 'overload' : 'oversized' }); } catch { /* fail-soft */ }
                try {
                  const { notifyMissionOrigin } = await import('../src/autopilot/mission-notify.js');
                  // ★ UX(대표 2026-07-21) — 에러 아닌 진행형 서사(상황 판단 완료 → 이 방향으로 정리). "과대
                  //   판정" 같은 실패 뉘앙스 대신 "한 번에 처리하기엔 커서 N개로 나눠 이어간다"는 정확·간결한 설명.
                  const splitWhy = /overload/.test(p.summary ?? '') ? '한 번에 담기엔 맥락이 커서' : '한 번에 처리하기엔 범위가 커서';
                  if (missionOrigin) notifyMissionOrigin(missionOrigin, `🧩 "${p.title.slice(0, 40)}" 단계가 ${splitWhy}, 자율 판단으로 ${res.subPhaseCount ?? 0}개 세부 단계로 나눠 이어갑니다. (상황 판단 완료 → 이 방향으로 정리·자동 계속)`);
                } catch { /* fail-soft */ }
              } else {
                // ★ 유연 다단 tier-b(2026-07-21·자율 폐루프 point 4) — 페이즈 split 로 못 풀면(재분해 실패/최소단위)
                //   코디네이터가 아크 재조정(크기 오판 drift)/성숙도 분리를 **자율 제안**한다(집행 아님·apply=HITL).
                //   그래도 안 되면 아래 CC2c HITL escalate(tier-c·최후). "알아서 나누고 진행"을 다단으로.
                try {
                  const { summarizeArcDrift } = await import('../src/autopilot/mission-arc-drift.js');
                  const { buildMaturityProposal } = await import('../src/autopilot/mission-maturity.js');
                  const m = diagStore.getMission(missionId);
                  const arcs = m?.autopilot?.arcs;
                  const drift = arcs ? summarizeArcDrift(arcs) : null;
                  const mat = buildMaturityProposal(arcs, m?.autopilot?.tier as unknown as Parameters<typeof buildMaturityProposal>[1]);
                  const proposal = drift ?? (mat.oversized ? `과대 미션(${mat.reason}) — 성숙도 분리 자율 제안(후속 ${mat.followups.length}개·apply=HITL)` : `분할 실패(${(res.error ?? '').slice(0, 60)}) — 아크 재조정 검토 권장`);
                  observeCoordinator('re-adjust', missionId, { phaseId: p.phaseId, reason: 'split-failed', drift: !!drift, oversized: mat.oversized, error: (res.error ?? '').slice(0, 80) });
                  try { const { notifyMissionOrigin } = await import('../src/autopilot/mission-notify.js'); if (missionOrigin) notifyMissionOrigin(missionOrigin, `🔧 자율 분할 실패 → 코디네이터 재조정 제안 — ${proposal}`); } catch { /* fail-soft */ }
                } catch { /* fail-soft → CC2c HITL */ }
              }
            } catch { /* fail-soft → HITL 폴백 */ }
          }
          // ★ P5c(대표 2026-07-21) — 조율자 아크 편집 자율 집행(opt-in arcEditAutoExec·기본 OFF). splitAutoExec
          //   이 못 잡은 터미널 실패에, 조율자가 히스토리안 맥락(done 페이즈) 위에서 아크/페이즈 편집(delete-phase·
          //   set-arc-done 등)을 LLM 판정→이미 있는 편집 인프라로 집행. 편집되면 splitOccurred 재사용해 re-spawn.
          //   보수적(no-edit 폴백)·fail-soft. split 은 splitAutoExec 이 이미 처리하므로 여기선 delete/set-arc-done 중심.
          let arcEditHandled = false;
          if (p.status === 'failed' && !autoSplitHandled && arcEditAutoExecEnabled) {
            try {
              const { decideArcEdit, applyArcEdit, defaultArcEditResolve, defaultArcEditExecutors } = await import('../src/autopilot/mission-arc-edit-decision.js');
              const m = diagStore.getMission(missionId);
              const arcs = m?.autopilot?.arcs;
              const arcId = arcs?.find((a) => a.phaseIds?.includes(p.phaseId))?.arcId;
              const doneTitles = (mp.allPhases ?? []).filter((x) => x.status === 'done').map((x) => `완료: ${x.title}`).slice(0, 12);
              const decision = await decideArcEdit(
                { phaseId: p.phaseId, title: p.title, attempts: outcome.attempts?.length ?? 1, ...(arcId ? { arcId } : {}), ...(outcome.failClass ? { failClass: outcome.failClass } : {}), ...(p.summary ? { summary: p.summary } : {}) },
                { goal, landed: doneTitles, ...(arcs ? { arcSummary: `아크 ${arcs.length}개` } : {}) },
                defaultArcEditResolve,
              );
              try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.coordinator.arc-edit', decision.action, { missionId, phaseId: p.phaseId, ...(decision.arcId ? { arcId: decision.arcId } : {}), reason: decision.reason.slice(0, 150) }); } catch { /* fail-soft */ }
              if (decision.action !== 'no-edit') {
                const r = await applyArcEdit(missionId, decision, defaultArcEditExecutors());
                if (r.ok) {
                  arcEditHandled = true;
                  splitOccurred = true; // exit 후 락 해제하고 detached 재spawn(편집 반영 순회 재개).
                  console.log(`[run-mission] 🔧 조율자 아크 편집(자율) · ${decision.action} · ${p.title.slice(0, 30)} (arcEditAutoExec)`);
                  try { observeCoordinator('arc-edit', missionId, { action: decision.action, phaseId: p.phaseId, ...(r.detail ? { detail: r.detail } : {}) }); } catch { /* fail-soft */ }
                  try { const { notifyMissionOrigin } = await import('../src/autopilot/mission-notify.js'); if (missionOrigin) notifyMissionOrigin(missionOrigin, `🔧 조율자 아크 편집(자율·사후) — ${decision.action}: ${decision.reason.slice(0, 60)}. 재개합니다.`); } catch { /* fail-soft */ }
                } else {
                  try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.coordinator.arc-edit', 'apply-failed', { missionId, phaseId: p.phaseId, action: decision.action, error: (r.error ?? '').slice(0, 120) }); } catch { /* fail-soft */ }
                }
              }
            } catch { /* fail-soft → 이하 O6-arm/HITL 폴백 */ }
          }
          // ★ P6b(대표 2026-07-21) — 상황점검·진행 판단. 반복 실패에 곧바로 판단 말고 증거(grounding+done) 위
          //   verdict(continue/arc-adjust/replan/partial-stop). 핵심 새 능력 = replan(재수집/재준비 자율 경로) —
          //   증거 부족하면 프리매처 종결 대신 build-rerun(research/ground) 로 재수집 후 재판단. arc-adjust/
          //   partial-stop 은 기존 P5c/P2 에 위임(관측만). opt-in·보수적·fail-soft.
          let replanHandled = false;
          if (p.status === 'failed' && !autoSplitHandled && !arcEditHandled && progressVerdictEnabled && (outcome.attempts?.length ?? 1) >= 2) {
            try {
              const { runSituationAssessment, defaultSufficiencyResolve, defaultVerdictResolve } = await import('../src/autopilot/mission-progress-verdict.js');
              const { loadFreshGrounding } = await import('../src/autopilot/mission-grounding-cache.js');
              const g = loadFreshGrounding(missionId, goal) as { codeFacts?: string[]; files?: string[] } | null;
              const doneTitles = (mp.allPhases ?? []).filter((x) => x.status === 'done').map((x) => `완료: ${x.title}`).slice(0, 12);
              const groundingFacts = [...(g?.codeFacts ?? []).slice(0, 12), ...(g?.files ?? []).slice(0, 8).map((f) => `기존 파일: ${f}`)];
              const outc = await runSituationAssessment(
                { goal, phaseTitle: p.title, ...(outcome.failClass ? { failClass: outcome.failClass } : {}), recurrence: outcome.attempts?.length ?? 1, ...(p.summary ? { attemptTrail: p.summary } : {}), groundingFacts, researchFindings: [], doneContext: doneTitles },
                defaultSufficiencyResolve, defaultVerdictResolve,
              );
              try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.coordinator.situation', outc.verdict.action, { missionId, phaseId: p.phaseId, sufficient: outc.sufficiency.sufficient, gaps: outc.sufficiency.gaps.slice(0, 3), reason: outc.verdict.reason.slice(0, 150) }); } catch { /* fail-soft */ }
              // replan = 재수집/재준비(상황점검) 자율 집행. arc-adjust/continue/partial-stop 은 기존 경로 위임.
              if (outc.verdict.action === 'replan') {
                const { spawnMissionPrepare } = await import('../src/autopilot/mission-prepare-spawn.js');
                spawnMissionPrepare(missionId, { rerunFrom: 'research' }); // research→ground 재수집 후 재계획(prepare 가 재spawn)
                replanHandled = true;
                console.log(`[run-mission] 🧭 조율자 상황점검 → replan(재수집/재준비) 자율 집행 · ${p.title.slice(0, 30)} (progressVerdict)`);
                try { observeCoordinator('progress-verdict', missionId, { action: 'replan', phaseId: p.phaseId, sufficient: outc.sufficiency.sufficient }); } catch { /* fail-soft */ }
                try { const { notifyMissionOrigin } = await import('../src/autopilot/mission-notify.js'); if (missionOrigin) notifyMissionOrigin(missionOrigin, `🧭 조율자 상황점검(자율) — 증거 재수집 후 재판단(replan): ${outc.verdict.reason.slice(0, 60)}`); } catch { /* fail-soft */ }
              }
            } catch { /* fail-soft → 이하 기존 경로 폴백 */ }
          }
          // ★ O6-arm 자율 rebuild 예정 판정(대표 2026-07-21) — 아래(O6-arm)에서 (budget-exhausted|transient)
          //   +rebuild+armed+미힐이면 자율 재구현한다. 그 경우 CC2c HITL 카드가 병렬로 뜨면 "자율로 돌 건데
          //   사람에게 또 묻는" 중복·에러프레이밍(대표 지적)이 된다. 자율 rebuild 예정이면 CC2c 스킵(자율 위임).
          let willAutoRebuild = false;
          if (p.status === 'failed' && !autoSplitHandled && !arcEditHandled && !replanHandled) {
            try {
              const healableR = outcome.failClass === 'transient' || outcome.failClass === 'budget-exhausted';
              if (healableR && diag.healRecommendation.kind === 'rebuild' && selfHealArmed()) {
                const tR = diagStore.getTask(p.phaseId);
                willAutoRebuild = !!tR && !tR.notes.some((n) => n.includes('[SELF-HEAL]'));
              }
            } catch { /* fail-soft */ }
          }
          // ★ CC2c(대표 2026-07-20) — phase_failed 재구성 선택지 UX flow(자율 split/rebuild 처리 안 될 때만).
          //   escalate → HITL. split·rebuild 자율집행 예정이면 HITL 스킵(중복 방지·대표 2026-07-21). rebuild 가
          //   자율 불가(armed off·재힐)일 때만 카드 — 그땐 blockedDependency(의존미션) 오분류 대신 apply-heal
          //   추천(recommendedAction)으로 ⭐추천 버튼이 뜨게(대표 2026-07-21·추천버튼 부재 수정).
          if (!autoSplitHandled && !arcEditHandled && !replanHandled && !willAutoRebuild) try {
            const { canUseUxAgent } = await import('../src/ux/ux-config.js');
            const { notifyMissionHitlViaUx } = await import('../src/autopilot/mission-ux-live.js');
            if (canUseUxAgent() && missionOrigin) {
              const heal = diag.healRecommendation.kind;
              const sig: Record<string, unknown> = { phaseFailed: true, failureCount: 1 };
              if (heal === 'split') sig.arcSurgery = true;
              else if (heal === 'escalate') sig.blockedDependency = true;
              else if (heal === 'rebuild') sig.recommendedAction = 'apply-heal';
              const proposal = `⚠️ 페이즈 실패: ${p.title}\n원인 ${outcome.failClass} · 권장 힐 ${heal}\n${diag.healRecommendation.rationale.slice(0, 120)}\n어떻게 재구성할까요?`;
              notifyMissionHitlViaUx(missionOrigin, missionId, proposal, { signals: sig });
            }
          } catch { /* fail-soft */ }
        }
        // ① ops 이벤트 — task 전이(elanous ops timeline --entity-type task 가 노출).
        recordOpsEventSafe({
          entityType: 'task', entityId: p.phaseId, event: 'status_change',
          fromState: 'running', toState: p.status, actor: 'dispatcher',
          rationale: p.status === 'failed' ? `${outcome.failClass}: ${diag.rootCauseInference}`.slice(0, 300) : '완료',
          refs: p.status === 'failed'
            ? { missionId, failClass: outcome.failClass, heal: diag.healRecommendation.kind, confidence: diag.confidence }
            : { missionId, ...(p.prUrl ? { prUrl: p.prUrl } : {}) },
        });
        // ② task.notes 영속 — 실패면 진단(narrative+rootCause+권장 힐)을 append.
        if (p.status === 'failed') {
          let alreadyHealed = false;
          try {
            const task = diagStore.getTask(p.phaseId);
            if (task) {
              alreadyHealed = task.notes.some((n) => n.includes('[SELF-HEAL]'));
              // 빌더 단일 출처(P1) — [DIAGNOSIS:failClass] 태그 포함(ops-status/TUI 파서가 역파싱).
              const note = buildDiagnosisNote(diag, outcome.failClass);
              // ★ 셀프힐 배선(대표 2026-07-13) — 시스템 결함 의심 신호를 [SUSPECT] 로 영속. escalate
              //   버튼(나중 탭)이 diffSummary 를 재구성 못 하므로, 실패 시점의 신호가 유일한 복원 경로.
              //   중복 방지(세대별 append 라 기존 [SUSPECT] 는 제거 후 최신만).
              const suspectNotes = renderSuspectNotes(lookback.signals);
              const kept = task.notes.filter((n) => !n.startsWith('[SUSPECT:'));
              diagStore.saveTask({ ...task, notes: [...kept, note, ...suspectNotes], updatedAt: Date.now() });
            }
          } catch { /* fail-soft */ }
          // ★ O6-arm(대표 2026-07-13·PLAN·budget-exhausted 편입 2026-07-14) — 저위험 자율 힐.
          //   (transient OR budget-exhausted) + rebuild 권장 + selfHeal armed + 미힐(1회 상한).
          //   ★budget-exhausted 편입 근거(대표 2026-07-14): P2 처럼 재시도 소진형 예산 실패는 fresh
          //   재구현(새 예산 계단+artifact-first+triage)으로 완주 가능(대표 rebuild 버튼으로 실증).
          //   단, triage 가 revise/split/skip/escalate 를 권한 경우(P6 premise 부재)엔 위 triage 힐
          //   오버라이드가 healRecommendation 을 rebuild 가 아니게 만들어 이 게이트가 자동 스킵→HITL
          //   (무한 rebuild 방지). 분할/골정정/건너뛰기 등 판단 힐은 항상 HITL. fail-closed(기본 off).
          //   무한루프 방지=[SELF-HEAL] 마커 1회 가드.
          try {
            const healable = outcome.failClass === 'transient' || outcome.failClass === 'budget-exhausted';
            if (healable && diag.healRecommendation.kind === 'rebuild'
                && !alreadyHealed && selfHealArmed()) {
              const task = diagStore.getTask(p.phaseId);
              if (task) diagStore.saveTask({ ...task, notes: [...task.notes, `[SELF-HEAL] ${outcome.failClass} 자율 재구현 1회(${new Date().toISOString()})`], updatedAt: Date.now() });
              rebuildPhase(missionId, p.phaseId, { note: `자율 셀프 힐(${outcome.failClass}·1회·PLAN O6-arm)` });
              console.log(`[run-mission] ★ 자율 셀프 힐 발동 · ${p.title.slice(0, 30)} · ${outcome.failClass}→rebuild`);
            }
          } catch { /* fail-soft */ }
          // ★ O4 self-event(대표 2026-07-13·PLAN) — 봇 ambient 자각에 "최근 실패+권장 힐" 주입.
          //   텔레그램에서 "지금 미션 어때" 물으면 봇이 self_recall 로 회상해 답(ops_status 안 불러도).
          try {
            await injectSelfMemory({
              tool: 'autopilot', kind: 'mission-phase-failure', importance: 6,
              summary: `미션 ${missionId} 페이즈 "${p.title.slice(0, 40)}" 실패(${outcome.failClass}) — 권장 ${diag.healRecommendation.kind}`,
              text: `${diag.narrative}\n근본원인: ${diag.rootCauseInference}\n권장 힐: ${diag.healRecommendation.kind}(${diag.healRecommendation.confidence}) — ${diag.healRecommendation.rationale}`,
              refs: { missionId, phaseId: p.phaseId, failClass: outcome.failClass, heal: diag.healRecommendation.kind },
            });
          } catch { /* fail-soft */ }
        }
        console.log(`[run-mission] 진단 영속 · ${p.title.slice(0, 30)} · ${p.status}${outcome.failClass ? `(${outcome.failClass}→${diag.healRecommendation.kind})` : ''}`);
      }
    } finally { diagStore.close(); }
  } catch (e) { console.log(`[run-mission] 진단 영속 실패(fail-soft): ${e instanceof Error ? e.message : String(e)}`); }
  // ★ 재실행/재개 UX(대표 2026-07-12) — 실패 페이즈부터 재개(앞 성공 보존) + 처음부터 재실행.
  //   재개 번호는 allPhases 의 실제 index(리쥼해도 정확한 N/total·"3/7" 오기 해소).
  const failedPhase = all.find((p) => p.status === 'failed');
  const resumeInfo = failedPhase?.phaseId
    ? { phaseId: failedPhase.phaseId, index: failedPhase.index, total }
    : null;
  const rerunText = resumeInfo
    ? '⤴️ 실패 지점부터 재개(앞 성공 페이즈 보존)하거나 처음부터 다시 하려면 아래 버튼을 누르세요.'
    : '⤴️ 이 미션을 처음부터 다시 구현하려면 아래 버튼을 누르세요(미션 유지·페이즈 재실행).';
  // ★ 자율 revise 결선(RFC 3박자·P3·2026-07-14) — 실패 페이즈의 triage 가 revise(교착)면 generic
  //   재실행 버튼 대신 recommendRevise 로 narrow 초안을 자동 생성해 원탭 승인 카드를 발송한다(넘버원
  //   폴백 = HITL + 충분한 정보). 판단은 시스템·집행은 원탭 승인(자율경계·대표 2026-07-14 승인).
  //   교착이 아닌 실패나 추천/채널 부재면 기존 rerun 버튼으로 폴백. fail-soft.
  let autoRevised = false;
  // ★ arc-revise 수복(RFC 아크·A5·2026-07-14) — 아크 통합 검증 실패(페이즈는 green 이나 아크로는
  //   dead-code·미배선)면 generic rerun 대신 arc-revise 초안 카드를 띄운다(마이그레이션 안전망).
  //   아크 실패가 페이즈 교착보다 우선(둘 다면 아크 통합이 근본).
  if (mp.arcFailure) {
    try {
      const { presentArcReviseCard } = await import('../src/autopilot/mission-arc-revise.js');
      const r = await presentArcReviseCard(missionId, mp.arcFailure);
      autoRevised = r.sent;
      console.log(`[run-mission] ★ arc-revise 결선(아크 통합 실패) · sent=${r.sent}(${r.reason}) · 아크 "${mp.arcFailure.name}"`);
    } catch (e) { console.log(`[run-mission] arc-revise 결선 실패(fail-soft): ${e instanceof Error ? e.message : String(e)}`); }
  }
  // ★ arming 경계 HITL(Track C·2026-07-15) — 실집행(canary/체결/mandate) 페이즈는 자동 실패/revise 대신
  //   arm/defer/skip 의사확인 카드로. 코드는 disarmed 게이트 뒤 — arming 은 사람이 결정(매매=HITL).
  if (!autoRevised && failedPhase && failedPhase.phaseId) {
    try {
      const { isArmingBoundaryPhase, presentArmingDecisionCard } = await import('../src/autopilot/mission-arming-gate.js');
      if (isArmingBoundaryPhase(failedPhase.title, failedPhase.summary)) {
        const sent = presentArmingDecisionCard(missionOrigin, missionId, failedPhase.phaseId, failedPhase.title);
        autoRevised = sent; // 카드 발송했으면 revise/rerun 폴백 안 함
        console.log(`[run-mission] ★ arming 경계 HITL · sent=${sent} · 실집행 페이즈 "${failedPhase.title.slice(0, 30)}" — 실패 아니라 의사확인(arm/defer/skip)`);
      }
    } catch (e) { console.log(`[run-mission] arming 경계 HITL 실패(fail-soft): ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (!autoRevised && failedPhase && parseTriageHealOverride(failedPhase.summary ?? '') === 'revise') {
    try {
      const { autoPresentReviseCard } = await import('../src/autopilot/mission-auto-revise.js');
      const failureContext = `실패 페이즈 "${failedPhase.title}" — ${(failedPhase.summary ?? '').slice(0, 400)}`;
      const r = await autoPresentReviseCard(missionId, failureContext);
      autoRevised = r.sent;
      console.log(`[run-mission] ★ 자율 revise 결선(교착) · sent=${r.sent}(${r.reason})${r.reviseKind ? ` · ${r.reviseKind}` : ''} · ${failedPhase.title.slice(0, 30)}`);
    } catch (e) { console.log(`[run-mission] 자율 revise 결선 실패(fail-soft): ${e instanceof Error ? e.message : String(e)}`); }
  }
  // revise 카드를 못 보냈으면(교착 아님·추천/채널 부재) generic rerun 버튼으로 폴백.
  if (!autoRevised) { try { notifyMissionRerunButton(missionOrigin, missionId, rerunText, resumeInfo); } catch { /* fail-soft */ } }
  // ★ 완료 리뷰 요약 + 비평 재반영(대표 2026-07-12) — 자동 비평이 지적한 페이즈가 있으면 요약을
  //   보내고 [🔧 비평 재반영] 버튼(지적된 페이즈만 커멘트 반영 재구현·이전 PR close·머지는 HITL).
  const critiqued = all.filter((p) => p.critiqueFindings && p.critiqueFindings.length > 0);
  const mergeable = all.filter((p) => p.prUrl && !(p.critiqueFindings && p.critiqueFindings.length > 0));
  if (critiqued.length > 0 || mergeable.length > 0) {
    const reviewLines = all
      .filter((p) => p.prUrl || (p.critiqueFindings && p.critiqueFindings.length))
      .map((p) => {
        const pr = p.prUrl ? ` ${p.prUrl}` : '';
        const cq = p.critiqueFindings && p.critiqueFindings.length
          ? `\n     └ [비평 ${p.critiqueVerdict ?? 'WARN'}·${p.critiqueFindings.length}건]: ${p.critiqueFindings.slice(0, 2).join(' · ').slice(0, 140)}`
          : (p.prUrl ? '\n     └ [비평 PASS·머지 가능]' : '');
        return `  ${p.index + 1}. ${p.title}${pr}${cq}`;
      }).join('\n');
    const reviewFoot = critiqued.length > 0
      ? `\n(🔧 비평 재반영: 지적된 ${critiqued.length}개 페이즈 재구현 → 새 PR. 전부 clean 되면 [✅ 반영(머지)] 버튼.)`
      : `\n(✅ 전부 clean — [반영(머지)]로 ${mergeable.length}개 PR squash 머지.)`;
    const reviewMsg = `📋 리뷰 요약 — 완료 PR 확인\n${reviewLines}${reviewFoot}\n· ${missionId}`;
    try { notifyMissionReviewSummary(missionOrigin, missionId, reviewMsg, { hasCritiques: critiqued.length > 0, hasMergeable: mergeable.length > 0, provider: execProviderLabel }); } catch { /* fail-soft */ }
  }
  autoTagNewSchedules(missionId, beforeScheduleIds); // 페이즈가 만든 스케줄 → 미션 계보 자동 태깅.
  // ★ 멀티페이즈=SE 격리(대표 2026-07-13) — 격리 worktree 에서만 구현하므로 메인트리 변경은
  //   미션 산출이 아니라 외부 동시작업이다. 가드 스킵(사용자/다른 세션 작업 파괴 금지).
  guardCoreCodeEdits(beforeDirty, { multiphase: true });
  // 자율 실행 self-log(적정 시점=완료) — elanous 가 "내가 이 미션을 실행했다"를 자기인지 기억에 기록.
  await selfLogMissionRun(
    `자율 미션 실행: ${goal.slice(0, 80)} — 페이즈 ${mp.done}/${mp.executed} 완료${mp.failed ? `·${mp.failed} 실패` : ''}`,
    `골: ${goal}\n${mp.phases.map((p, i) => `${i + 1}. [${p.status}] ${p.title}`).join('\n')}`,
  );
  // ★ 관측성 자기증강(RFC 3박자·P4·2026-07-14) — 미션 실행을 계기로 관측부채(계측 없는 자율 셀프힐
  //   로직)를 자가진단해 self-memory 로 표면화한다. throttle(20h) 내장이라 매 실행 비용 없음.
  //   propose-only(발송 없음). 새 자율 로직에 관측 계측 누락(이번 세션 debug.log 0개 사고) 재발 방지.
  try {
    const { runObservabilityDebtScan } = await import('../src/autopilot/mission-observability-debt.js');
    const r = runObservabilityDebtScan();
    if (r.ran && r.findings.length) console.log(`[run-mission] ★ 관측부채 자가진단 · ${r.findings.length}개 파일 표면화(propose-only)`);
  } catch { /* fail-soft */ }
  // ★ LG2 완료 전이 단일화(2026-07-19) — 실행 완료 시 미션 done 을 게이트로 즉시 전이(별도 크론
  //   sweepFiniteMissions 지연 제거·창구 통일: 실행완료=미션완료 같은 프로세스·시각). FINITE + 전 태스크 done
  //   일 때만(sweepFinite 와 동일 판정). CONTINUOUS(scheduler)는 계속 돎(스킵). sweepFinite 는 안전망으로 유지
  //   (게이트 done 이면 no-op). fail-soft. LG0 게이트가 mission.lifecycle.transition{reason:exec-complete} 관측.
  if (mp.failed === 0) {
    try {
      const { missionKind } = await import('../src/autopilot/mission-lifecycle.js');
      const { openAutopilotMissionsDb, getMission } = await import('../src/autopilot/mission-registry.js');
      const { missionLifecycleGate } = await import('../src/autopilot/mission-lifecycle-gate.js');
      const mdb = openAutopilotMissionsDb();
      try {
        const mrow = getMission(mdb, missionId);
        const tstore = new TaskStore();
        const tasks = tstore.listTasks({ goalSlug: missionId });
        tstore.close();
        const allDone = tasks.length > 0 && tasks.every((t) => t.status === 'done');
        if (missionKind(mrow?.execution_model ?? null) === 'finite' && allDone) {
          missionLifecycleGate(mdb, missionId, 'done', 'exec-complete');
          console.log(`[run-mission] ★ LG2 — 미션 완료 전이(exec-complete·창구 통일) · ${missionId}`);
          // ★ R3(RFC-autonomous-pr-review §3f) — reviewAutoMerge armed 면 완료 시 clean(리뷰 PASS·비평 0·
          //   escalated 아님) 페이즈 PR 을 자동 머지(verdict-gated). 기본 OFF=종전대로 HITL 머지 승인 대기
          //   (머지=HITL 불변). mergeMissionPhases 가 admin 이중게이트·escalated 제외를 이미 강제. fail-soft.
          try {
            const { reviewAutoMergeArmed } = await import('../src/autopilot/arming.js');
            if (reviewAutoMergeArmed()) {
              const { mergeMissionPhases } = await import('../src/autopilot/mission-lifecycle.js');
              const mr = mergeMissionPhases(missionId, { requireReviewPass: true }); // verdict-gated(리뷰 PASS 페이즈만).
              observeCoordinator('review-auto-merge', missionId, { merged: mr.merged, skipped: mr.skipped, ok: mr.ok, ...(mr.error ? { error: mr.error } : {}) });
              console.log(`[run-mission] ★ R3 reviewAutoMerge armed → 자동 머지 ${mr.merged}건(skip ${mr.skipped}) · ${missionId}`);
            }
          } catch { /* fail-soft — 자동 머지 실패는 완료 전이/미션 무영향(HITL 폴백) */ }
        }
      } finally { mdb.close(); }
    } catch { /* fail-soft — 완료 전이 실패는 sweepFinite 안전망이 이어받음 */ }
  }
  // ★ P2 — 진전 불가 자율 종결(대표 2026-07-21·조율자 종점). mp.failed>0 = in-run 셀프힐(rebuild/split
  //   bound)이 이미 소진됐는데도 실패 잔존 = 진짜 진전 불가. 종전엔 여기서 process.exit(1)로 미션을 running 인
  //   채 방치(영구 동결) — 사람이 카드 눌러야만 종결. 이제 조율자가 자율로 대응 스펙트럼(graceful-land/descope/
  //   stop)을 결정·집행한다. 순수 결정=mission-stuck-resolution·집행(전이·통지)=여기. fail-soft(실패 시 종전 동작).
  let stuckTerminal = false;
  if (mp.failed > 0) {
    try {
      const { decideStuckResolution } = await import('../src/autopilot/mission-stuck-resolution.js');
      const failedPhases = all.filter((p) => p.status === 'failed');
      const transientFailedCount = failedPhases.filter((p) => /transient|일시적|타임아웃|timeout|rate.?limit|연결.*실패/i.test(p.summary ?? '')).length;
      const escalateFailedCount = failedPhases.filter((p) => /escalate|provenance|보안|모순|security|prompt.?inject|문서.*명령/i.test(p.summary ?? '')).length;
      const res = decideStuckResolution({ doneCount: doneN, failedCount: failedN, totalCount: total, remainingCount: remainN, transientFailedCount, escalateFailedCount });
      // 제1원칙 관측 — 종결 결정을 mission.exec.stuck-resolution 으로 각인(자기인지·`elanous logs`).
      try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.stuck-resolution', res.action, { missionId, done: doneN, failed: failedN, total, remaining: remainN, transientFailedCount, escalateFailedCount, reason: res.reason.slice(0, 200) }); } catch { /* fail-soft */ }
      observeCoordinator('stuck-resolution', missionId, { action: res.action, done: doneN, failed: failedN, total });
      if (res.terminalStatus) {
        stuckTerminal = true;
        const { openAutopilotMissionsDb } = await import('../src/autopilot/mission-registry.js');
        const { missionLifecycleGate } = await import('../src/autopilot/mission-lifecycle-gate.js');
        const sdb = openAutopilotMissionsDb();
        try { missionLifecycleGate(sdb, missionId, res.terminalStatus, `stuck-${res.action}`); } finally { sdb.close(); }
        console.log(`[run-mission] ★ P2 자율 종결 · ${res.action}→${res.terminalStatus} · ${res.reason}`);
        // HITL 통지(fail-soft) — 자율 종결을 대표께 카드로. stop=사람 판단 요청·land/descope=부분완료 안내.
        if (missionOrigin) {
          try {
            const icon = res.action === 'stop' ? '🛑' : res.action === 'graceful-land' ? '🛬' : '✂️';
            const label = res.action === 'stop' ? '자율 진행 불가 — STOP(사람 판단)' : res.action === 'graceful-land' ? 'graceful 하차(부분완료 인정)' : '잔여 descope 후 완료';
            // ★ P3 — stuckResolution 신호로 종결 결과별 사후 선택지(수용/재분해) 렌더(buildContextualActions).
            notifyUxS7(missionOrigin, missionId, `${icon} 조율자 자율 종결 — ${label}. ${res.reason}`, { signals: { stuckResolution: res.action, failureCount: failedN } });
          } catch { /* fail-soft */ }
        }
      }
    } catch { /* fail-soft — 종결 결정 실패는 종전 동작(running 유지·재구동 여지) 폴백 */ }
  }
  // ★ 미션 worktree dispose(격리 ON 시). A 캡처 ON 이면 dispose 전에 산출물을 미션 브랜치 PR 로 캡처.
  if (missionWtPlan) {
    // ★ A 완주갭 캡처(opt-in·autopilot.missionWorktreeCapture·기본 OFF·2026-07-21) — walker 산출이 PR/전달
    //   없이 dispose 로 버려지던 완주갭(done≠delivery·[feedback_walker_phase_main_tree_pollution]) 봉쇄.
    //   dispose 전에 worktree diff 를 미션 브랜치로 commit·force-push·PR(upsertPr 재사용·draft·머지=HITL 불변).
    //   nothing-to-commit=noop(정직 처리). fail-soft(캡처 실패/예외=종전 dispose 폴백). B(guard)와 짝 —
    //   guard 로 walker 가 worktree 에 써야 여기 diff 가 잡힌다.
    let capturePrUrl: string | undefined;
    const captureOn = (getUserConfig().raw?.autopilot as { missionWorktreeCapture?: unknown } | undefined)?.missionWorktreeCapture === true;
    // ★ 완료 시에만 캡처(대표 2026-07-21·조기캡처 결함 수정) — dispose 는 매 프로세스 종료(split/arc-edit
    //   재개 포함)마다 실행된다. split·실패 재개·stuck 종결 시엔 산출물이 미완(조사페이즈 tracked 코드 0·
    //   untracked-only)이라 캡처가 무의미하고 commit 이 "nothing added(untracked only)"→오분류된다. 진짜
    //   완료(실패 0·split 재개 없음·stuck 종결 아님)일 때만 캡처. 재개 시엔 다음 프로세스가 산출을 이어간다.
    const missionComplete = mp.failed === 0 && !splitOccurred && !stuckTerminal;
    if (captureOn && !missionComplete) {
      try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.worktree', 'capture-skip-incomplete', { missionId, mpFailed: mp.failed, splitOccurred, stuckTerminal }); } catch { /* fail-soft */ }
    }
    if (captureOn && missionComplete) {
      try {
        const { makePrManager } = await import('../src/autopilot/pr-manager.js');
        const oc = makePrManager().upsertPr({
          branch: missionWtPlan.branch,
          worktreePath: missionWtPlan.worktreePath,
          title: `mission: ${goal.slice(0, 60)}`,
          body: `🤖 자율 미션 산출물 auto-capture(walker·완주갭 봉쇄)\n\n미션: ${missionId}\n골: ${goal.slice(0, 500)}\n\n머지는 HITL 승인(draft 계약).`,
          commitMessage: `mission(${missionId}): walker 산출 캡처 — ${goal.slice(0, 50)}`,
          excludePaths: ['apps/pwa/out'],
        });
        const { debug } = await import('../src/debug/log.js');
        if (oc.ok) {
          capturePrUrl = oc.url;
          debug.log('mission.exec.worktree', 'captured', { missionId, prUrl: oc.url, reused: oc.reused });
          if (missionOrigin) { try { notifyMissionReviewSummary(missionOrigin, missionId, `📦 미션 산출물 캡처 — PR ${oc.url}\n(머지는 HITL 승인) · ${missionId}`, { hasCritiques: false, hasMergeable: true, provider: execProviderLabel }); } catch { /* fail-soft */ } }
        } else {
          debug.log('mission.exec.worktree', oc.reason === 'noop' ? 'capture-noop' : 'capture-failed', { missionId, reason: oc.reason, detail: oc.detail.slice(0, 150) });
        }
      } catch (e) { try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.worktree', 'capture-error', { missionId, error: e instanceof Error ? e.message.slice(0, 120) : '' }); } catch { /* fail-soft */ } }
    }
    let wtDisposed = false, branchPruned = false;
    try { const { disposeIsolatedInstance } = await import('../src/autopilot/build/isolated-instance.js'); disposeIsolatedInstance(process.cwd(), missionWtPlan); wtDisposed = true; } catch { /* fail-soft */ }
    // ★ dispose=discard 계약 — worktree 제거 후 se/mission-* 브랜치도 삭제(반복 미션 브랜치 누적 방지·
    //   se-backend-bench:95 동형). 미션 worktree 는 ephemeral 이라 브랜치 잔존 불필요.
    //   ⚠️ 단 A 캡처로 PR 이 생겼으면 그 브랜치를 삭제하면 PR 이 끊긴다 → 캡처 성공 시 branch -D 스킵(브랜치 유지).
    if (!capturePrUrl) {
      try { const { execFileSync } = await import('node:child_process'); execFileSync('git', ['-C', process.cwd(), 'branch', '-D', missionWtPlan.branch], { stdio: 'ignore' }); branchPruned = true; } catch { /* fail-soft — 브랜치 부재/잠금 */ }
    }
    // 관측 — created↔disposed 대칭(제1원칙 3박자). dispose/gc/캡처 결과를 mission.exec.worktree 로.
    try { const { debug } = await import('../src/debug/log.js'); debug.log('mission.exec.worktree', 'disposed', { missionId, worktree: missionWtPlan.worktreePath, branch: missionWtPlan.branch, wtDisposed, branchPruned, captured: capturePrUrl ?? null }); } catch { /* fail-soft */ }
  }
  // ★ split 자동재개(대표 2026-07-21·기본 안정화 첫 타겟) — 정상완료 경로에서 명시 호출(exit 핸들러가
  //   최종 안전망·idempotent). seam 이 락 해제→detached 재spawn→성공/실패 관측(정지→수동 rerun 근본 해소).
  // P2 자율 종결(graceful-land/descope/stop)됐으면 split 재개 안 함 — 미션은 이미 종결(잔여 재구동 금지).
  if (!stuckTerminal) resumeSplitIfNeeded();
  process.exit(mp.failed > 0 ? 1 : 0);
}

// 2b) 단일턴 폴백 — 페이즈 없는 미션(scheduler 등)은 골을 한 턴으로 실행.
try {
  const r = await runTurnImpl({ userConfig: cfg, sessionId: session.id, userText: goal, systemPrompt: system, maxTokens: 1400 });
  const text = (r.text ?? '').trim() || '(빈 응답)';
  const msg = `🤖 예약 미션 실행\n골: ${goal}\n\n${text}\n\n· ${missionId}`;
  const ok = sendOutbound(msg, 'report', missionOrigin);
  console.log(`[run-mission] 완료 · sent=${ok} · tokens=${r.usedTokens ?? '?'}`);
  autoTagNewSchedules(missionId, beforeScheduleIds); // 턴이 만든 스케줄 → 미션 계보 자동 태깅.
  // ★ task 단일턴 미션은 메인트리에서 스크립트 실행 → 코어 편집 시 되돌림(백업·pause 플래그 존중).
  const g = guardCoreCodeEdits(beforeDirty, { multiphase: false });
  if (g.reverted.length) sendOutbound(`⚠️ 실행 중 범위 밖 코어 코드 ${g.reverted.length}건 변경 감지 → 되돌림(백업됨·복구 가능):\n${g.reverted.map((f) => `- ${f}`).join('\n')}\n백업: ${g.backupDir}\n※ 사용자 작업이었다면 백업에서 복원하고, 개발 중엔 \`touch ~/.elanous/guard-pause\` 로 가드를 끄세요.\n· ${missionId}`, 'alert', missionOrigin);
  await selfLogMissionRun(`자율 미션 실행: ${goal.slice(0, 80)}`, `골: ${goal}\n\n${text.slice(0, 400)}`);
} catch (e) {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[run-mission] 실행 실패: ${err}`);
  sendOutbound(`⚠️ 예약 미션 실행 실패\n골: ${goal}\n오류: ${err}\n· ${missionId}`, 'alert', missionOrigin);
  process.exit(1);
}
