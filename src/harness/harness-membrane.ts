// 하니스 ↔ 막(SurfaceUx) 배선 — escalation/진행/승인을 서피스로 (H2 · 2026-07-20)
//
// DESIGN §4·§5·§14c. 스테이지드 하니스의 결정/출력이 막(SurfaceUx)을 통과하게 배선한다:
//   - deploy fail-closed(PR open) → ux.confirm(서피스 승인 버튼·autoDrive off/safe) 또는 자율(on)
//   - 진행(onProgress) → ux.progress
//   - escalated terminal → operator 에게 표면화(막의 이유)
// autoDrive 스펙트럼(§5)이 스테이지별 자율/escalation 다이얼. 하니스 = 막의 자연스러운 다단 소비자.
//
// ★ 제1원칙(코드-레벨 로깅 규율): 막 결정(deploy 승인·terminal 표면화)을 관측(observe=debug.log
//   'harness.membrane'). 관측이 없으면 "왜 PR 안 열렸나·왜 escalate 했나" 자기인지·디버깅 불가.

import type { SurfaceUx } from '../agent/surface-ux/types.js';
import type { SelfImplementSeams } from '../self-implement/orchestrator.js';
import { appendRunLedgerEntry, runLedgerDir, type RunLedgerWriter } from '../self-implement/run-ledger.js';
import { buildHarnessSeams } from './harness-seams.js';
import type { DomainExecute } from './skill-executor.js';
import { runStagedHarness, type AutoDrive, type HarnessResult, type HarnessStage } from './staged-harness.js';
import type { CritiqueLike } from './review-adapter.js';
import { foldAnswersIntoDesign, formatDesignAsDecomposeContext, type IntakeClarification, type ConfirmedDesign } from '../autopilot/mission-intake-clarify.js';
import type { CapsuleSeed } from './plan-sizing.js';
import { debug } from '../debug/log.js';

/** ★ C2(§8) — 인터뷰 확정설계(ConfirmedDesign)를 Capsule 씨앗으로 매핑(순수). 재발명 0: 기존 인터뷰가
 *  이미 산출하는 구조를 승격한다. scope=done 목표(successCriteria) · excluded=범위밖 · notes=위험/확인 경계.
 *  빈 필드는 omit(plan 의 휴리스틱 기본으로 폴백). 골루프 나침반을 인터뷰가 채우는 seam. */
export function designToCapsuleSeed(design: ConfirmedDesign): CapsuleSeed {
  return {
    ...(design.scope.length ? { successCriteria: design.scope } : {}),
    ...(design.excluded.length ? { outOfScope: design.excluded } : {}),
    ...(design.notes.length ? { riskBoundaries: design.notes } : {}),
  };
}

/** ⓪ 막 clarify(인터뷰·경량·2026-07-21) — objective 모호성을 **가볍게** 되묻고(intake 예산 1) 확정설계를
 *  경량 메모로 refine. 미션 intake 파이프라인 재사용(analyzeGoalAmbiguity=주입·phase='scope'·heavy=false 로
 *  경량). ⚠️ 대표 원칙: 과도한 조사 금지 — 명확하면 0질문·최상위 blocking 1개만·미응답은 추천옵션 auto-resolve.
 *  autoDrive 'on' 스킵은 sequencer 가 처리(여기 도달=off/safe). fail-soft. [[RESEARCH §1 $deep-interview→$ralplan]]. */
export function membraneClarify(
  ux: SurfaceUx,
  analyze: (objective: string) => Promise<IntakeClarification[]>,
): (ctx: { objective: string }) => Promise<{ refinedObjective: string; asked: number; capsuleSeed?: CapsuleSeed }> {
  return async ({ objective }) => {
    const observe = (data: Record<string, unknown>): void => {
      try { debug.log('harness.membrane', 'clarify', data); } catch { /* observation must not change fail-soft continuation */ }
    };
    try {
      const clarifications = await analyze(objective);
      if (!clarifications.length) {
        observe({ outcome: 'no-questions', count: 0, asked: 0 });
        return { refinedObjective: objective, asked: 0 }; // 명확 → 0질문(경량)
      }
      const top = clarifications.find((c) => c.blocking) ?? clarifications[0]; // 예산 1 — 최상위만
      let asked = 0;
      let uxFailed = false;
      if (ux.interactive && top) {
        try {
          const res = await ux.question({
            questions: [{
              id: 'clarify', header: (top.header || '명확화').slice(0, 12), question: top.question,
              options: top.options.map((o) => ({ label: o.label, description: o.recommended ? '추천' : '' })),
              multiSelect: false,
            }],
          });
          const ans = res?.answers?.clarify;
          const answer = Array.isArray(ans) ? ans[0] : ans;
          if (answer && !res?.cancelled) { top.answer = answer; asked = 1; }
        } catch { uxFailed = true; /* ux 채널 문제 — 추천옵션 auto-resolve 로 진행(과잉 왕복 금지) */ }
      }
      // fold — 미응답은 추천 옵션으로 auto-resolve. 확정설계=경량 메모(arc/범위/제외/확인)를 objective 앞에.
      const design = foldAnswersIntoDesign(objective, clarifications);
      const memo = formatDesignAsDecomposeContext(design);
      const refinedObjective = memo ? `${memo}\n\n---\n\n${objective}` : objective;
      // ★ C2(§8) — 확정설계 구조를 Capsule 씨앗으로도 승격(문자열 메모로만 버리지 않음). plan 이 나침반으로 소비.
      const capsuleSeed = designToCapsuleSeed(design);
      const seeded = !!(capsuleSeed.successCriteria || capsuleSeed.outOfScope || capsuleSeed.riskBoundaries);
      observe({ outcome: 'questioned', count: clarifications.length, asked, memo: memo.length, seeded, ...(uxFailed ? { uxFailed: true } : {}) });
      return { refinedObjective, asked, ...(seeded ? { capsuleSeed } : {}) };
    } catch (error) {
      observe({ outcome: 'analyze-failed', error: String((error as { message?: unknown })?.message ?? error) });
      return { refinedObjective: objective, asked: 0 };
    }
  };
}

/** deploy fail-closed 게이트를 막으로 — autoDrive 'on'=자율(사전승인·draft PR)·off/safe=ux.confirm(서피스 버튼·
 *  채널 없으면 fail-closed false). 자동승인 금지(제1원칙). */
export function membraneAuthorizeDeploy(ux: SurfaceUx, autoDrive: AutoDrive): (ctx: { objective: string; branch: string; apply?: boolean; diff?: string }) => Promise<boolean> {
  return async ({ objective, branch, apply, diff }) => {
    // ★ #25 apply-in-place(비-git dir/config 실위치 쓰기) — **autoDrive 'on' 이어도 항상 HITL diff 확인**
    //   (auto 금지·DESIGN §4). git 밖 실 FS 쓰기는 사람이 diff 를 본 뒤에만. 막 채널 없으면 fail-closed(false).
    if (apply) {
      const detail = diff && diff.trim() ? `변경 diff:\n${diff.slice(0, 1500)}` : objective.slice(0, 200);
      const ok = await ux.confirm({ prompt: `실위치에 적용할까요? (${branch}·백업 생성됨)`, detail, yesLabel: '적용', noLabel: '보류' });
      debug.log('harness.membrane', 'apply-confirm', { branch, answer: ok, interactive: ux.interactive, surface: ux.surface, autoDrive });
      return ok;
    }
    if (autoDrive === 'on') {
      // named autonomy(operator 가 'on' 선택 = 사전 승인·OMX --madmax). draft PR 라 안전.
      debug.log('harness.membrane', 'deploy-auto', { branch, autoDrive });
      return true;
    }
    // off/safe → 막으로 escalate. ux.confirm 은 채널 없으면 fail-closed(false) 반환.
    const ok = await ux.confirm({ prompt: `PR 열까요? (${branch})`, detail: objective.slice(0, 200), yesLabel: 'PR 열기', noLabel: '보류' });
    debug.log('harness.membrane', 'deploy-confirm', { branch, answer: ok, interactive: ux.interactive, surface: ux.surface });
    return ok;
  };
}

/** onProgress → ux.progress(스테이지→phase 매핑). */
export function membraneProgress(ux: SurfaceUx): (ev: { stage: HarnessStage; message: string }) => void {
  return (ev) => {
    const phase = ev.stage === 'plan' ? 'start' : ev.stage === 'deploy' ? 'end' : 'delta';
    ux.progress(`[${ev.stage}] ${ev.message}`, { phase });
  };
}

export interface RunHarnessOnSurfaceOptions {
  objective: string;
  /** 실행 전 층이 확정한 관측 조인 식별자. */
  runId?: string;
  /** 프론트도어가 사람 문면에서 분류한 기존 하니스 언급 관측값. */
  harnessMention?: 'absent' | 'matched' | 'not-matched';
  /** 이 호출이 하니스 자연어 프론트도어에서 온 런임을 표시한다. */
  naturalLanguageDispatch?: boolean;
  /** 종결 원장 writer; 테스트만 대체하고 운영 기본값은 appendRunLedgerEntry다. */
  writeRunLedger?: RunLedgerWriter;
  /** 재사용할 self-implement seam(createWorktree/implement/gate/openPr). */
  seams: SelfImplementSeams;
  /** 막 — 진행/승인/spill 이 이 서피스로. */
  ux: SurfaceUx;
  /** autoDrive 정책(기본 safe). */
  autoDrive?: AutoDrive;
  base?: string;
  /** ★ G9 즉효(2026-07-25) — auto-review 라벨 부착 인텐트(harness↔무인리뷰 대칭화). deploy 로 forward. */
  autoReview?: boolean;
  branchPrefix?: string;
  runCritique?: (ctx: { objective: string; cwd: string; changes: readonly string[] }) => CritiqueLike | Promise<CritiqueLike>;
  /** LLM 리뷰어 seam — Review critique(자동수정 rework 트리거)·PR 제목·post-PR 리뷰 커멘트. 미주입 시 게이트-only. */
  llmReview?: (prompt: string) => Promise<string>;
  /** ★ grounding seam(이식 §3.1) — plan 이 objective 를 grounding 해 Executor 자식에 재사용 팩트 주입. 미주입 시 off. */
  ground?: (objective: string) => Promise<import('../autopilot/mission-codebase-gate.js').CodebaseGrounding>;
  /** ⓪ clarify 분석 seam(인터뷰·opt-in) — 주입 시 membraneClarify 로 감싸 clarify 스테이지 활성. 미주입 시 off.
   *  dev-harness 가 analyzeGoalAmbiguity(phase='scope'·heavy=false) 경량 구성으로 주입. */
  analyzeGoal?: (objective: string) => Promise<IntakeClarification[]>;
  /** ★ 외부 research seam(H3·상황부·opt-in) — 주입 시 intent-gate 뒤 web 조사→grounding 얹음. dev-harness 가 invokeResearch 주입. */
  research?: (topic: string) => Promise<{ ok: boolean; output: string }>;
  /** ★ skill 힌트 seam(H3·상황부·opt-in) — objective 의 explicit 트리거가 skill 을 강하게 가리키면 grounding 힌트(결정론·실행 안 함). dev-harness 가 buildSkillHint 주입. */
  skillHint?: (objective: string) => string | null;
  /** ★ skill 실행 seam(H3 실행형·상황부·opt-in) — allowlist skill 을 격리 실행해 실 출력을 grounding 에. dev-harness 가
   *  selectHarnessSkill(luna 주경로·S1) 주입(source/picked carry). 종전 execHarnessSkill 도 구조 호환. */
  skillExec?: (objective: string) => Promise<{ skill: string; output: string; source?: 'luna' | 'substring'; picked?: string[] } | null>;
  /** ★ R3 신호 게이트 seam(판단층·opt-in·2026-07-22) — objective 에서 종목을 뽑아 매력도 규율 신호(±1σ)를
   *  grounding 에(판단 참고·집행 아님·부작용0). dev-harness 가 buildAttractivenessSignal 주입. null=스킵. */
  signalGate?: (objective: string) => string | null | Promise<string | null>;
  /** ★ LLM decompose seam(H2·Planner·opt-in) — 마커 없는 자유서술 objective 를 richer 스텝으로 분해(TaskGenerator·DB-free). dev-harness 가 llmDecomposeSteps 주입. */
  decompose?: (objective: string, context?: string) => Promise<string[]>;
  /** ★ adversarial 레드팀 seam(H2·Planner·opt-in) — 계획을 실행 前 적대 크리틱이 공격해 보강. dev-harness 가 llmReview 로 주입. */
  adversarialPlan?: (objective: string, steps: readonly string[], context?: string) => Promise<{ revisedSteps: string[]; issues: string[] } | null>;
  /** ★ adversarial 강제 발동(명시 red_team 요청). false 여도 복잡 계획이면 자동. */
  adversarialForce?: boolean;
  maxReviewRounds?: number;
  /** ★ 트랙 X1/R2 도메인 executor(opt-in) — 주입 시 execute 를 코드 implement 대신 도메인 executor(skill 실행형)로
   *  라우팅. dev-harness 가 resolveDomainExecute(rawArgs.domain) 주입. 미주입=코드 executor(무회귀). */
  domainExecute?: DomainExecute;
  // ★ B1 membrane 관통([[RFC-plan-as-rfc-generation]] §8/[[FEATURE-execution-harness-umbrella]] §3k) —
  //   C1~C4 노브를 막 층에 관통시켜 surface 호출자(dev-harness→텔레그램/CLI)가 켤 수 있게 한다(종전엔 안쪽
  //   seam/sequencer 에만 있어 surface 는 기본값만). 미설정 시 seams/sequencer 기본(carry off·mode observe·무회귀).
  /** C1 — Capsule digest(설계 계약)를 executor 프롬프트에 나침반으로 실을지. **3-state**: true=항상 · false=never ·
   *  undefined(기본)=**auto**(인터뷰가 nav 를 실제 채웠을 때만 carry·B 조건부 flip·[[FEATURE-execution-harness-umbrella]] §3k). */
  carryCapsule?: boolean;
  /** C3 — plan-time 크기 렌즈 레벨. 'off'=순수 골루프 · 'observe'(기본)=관측만(자르지 않음). */
  sizingMode?: 'off' | 'observe';
  /** C4 — 실패 조사 원장 레벨. 'off'=원장 안 씀 · 'observe'(기본)=진단 기록·관측(제어흐름 무접촉). */
  ledgerMode?: 'off' | 'observe';
  /** 이미 아는 골 문서 원문(opt-in). 호출자가 가진 원문만 내린다 — objective 로 대체하지 않는다. */
  goalDocument?: string;
}

/**
 * 막 위에서 스테이지드 하니스 구동. buildHarnessSeams + membrane(deploy confirm·progress) + runStagedHarness.
 * deploy 는 fail-closed(막 승인)·escalated 는 operator 표면화. autoDrive 로 자율↔HITL 다이얼.
 */
export async function runStagedHarnessOnSurface(opts: RunHarnessOnSurfaceOptions): Promise<HarnessResult> {
  const autoDrive: AutoDrive = opts.autoDrive ?? 'safe';
  debug.log('harness.membrane', 'start', {
    objective: opts.objective.slice(0, 100), runId: opts.runId, autoDrive, surface: opts.ux.surface, interactive: opts.ux.interactive,
  });

  const seams = buildHarnessSeams({
    seams: opts.seams,
    ...(opts.base ? { base: opts.base } : {}),
    ...(opts.branchPrefix ? { branchPrefix: opts.branchPrefix } : {}),
    ...(opts.runCritique ? { runCritique: opts.runCritique } : {}),
    ...(opts.llmReview ? { llmReview: opts.llmReview } : {}),
    ...(opts.ground ? { ground: opts.ground } : {}),
    ...(opts.analyzeGoal ? { clarify: membraneClarify(opts.ux, opts.analyzeGoal) } : {}),
    ...(opts.research ? { research: opts.research } : {}),
    ...(opts.skillHint ? { skillHint: opts.skillHint } : {}),
    ...(opts.skillExec ? { skillExec: opts.skillExec } : {}),
    ...(opts.signalGate ? { signalGate: opts.signalGate } : {}),
    ...(opts.decompose ? { decompose: opts.decompose } : {}),
    ...(opts.adversarialPlan ? { adversarialPlan: opts.adversarialPlan } : {}),
    ...(opts.adversarialForce ? { adversarialForce: opts.adversarialForce } : {}),
    ...(opts.domainExecute ? { domainExecute: opts.domainExecute } : {}),
    // ★ B1 관통 — C1 carryCapsule · C3 sizingMode 를 seam 층으로 forward(surface 호출자 제어). 미설정=seam 기본.
    ...(opts.carryCapsule !== undefined ? { carryCapsule: opts.carryCapsule } : {}),
    ...(opts.sizingMode !== undefined ? { sizingMode: opts.sizingMode } : {}),
    // part2-B(M-UX 2·3차) — execute 내부 마일스톤/stall 카드를 이 서피스로(SurfaceUx.progress → emitFeedback).
    onExecuteProgress: (msg) => { try { opts.ux.progress(msg, { phase: 'delta' }); } catch { /* fail-soft */ } },
    authorizeDeploy: membraneAuthorizeDeploy(opts.ux, autoDrive),
    // ★ G9 즉효 — auto-review 라벨 인텐트를 deploy seam 으로 forward(개발 라인 대칭·harness PR 무인 완결 진입).
    ...(opts.autoReview ? { autoReview: true } : {}),
    ...(opts.goalDocument?.trim() ? { goalDocument: opts.goalDocument } : {}),
  });
  seams.onProgress = membraneProgress(opts.ux);

  const result = await runStagedHarness({
    objective: opts.objective,
    ...(opts.runId ? { runId: opts.runId } : {}),
    seams,
    autoDrive,
    ...(opts.maxReviewRounds !== undefined ? { maxReviewRounds: opts.maxReviewRounds } : {}),
    // ★ B1 관통 — C4 ledgerMode 를 sequencer 로 forward. 미설정=기본 observe.
    ...(opts.ledgerMode !== undefined ? { ledgerMode: opts.ledgerMode } : {}),
  });

  // terminal 표면화(막의 이유) — escalated 는 operator 판단 대기, 성공은 완료 통지. 전부 관측.
  const reviewed = result.verdict?.reviewed;
  const goalSource = opts.naturalLanguageDispatch || (opts.harnessMention && opts.harnessMention !== 'absent')
    ? 'natural-language-dispatch'
    : 'no-goal-file';
  const terminalObservation = {
    runId: result.runId, terminal: result.terminal, ok: result.ok, rounds: result.rounds, ref: result.deployRef ?? null,
    goalSource,
    ...(reviewed !== undefined ? { reviewed } : {}),
  };
  debug.log('harness.membrane', 'terminal', terminalObservation);
  // ⛔⭐ 원장 쓰기는 fail-soft 지만 «조용하면» 안 된다 — 실패가 로그에도 안 남으면
  //   바깥에서 「하니스는 원장에 종결행을 «안 남긴다»」로 보이고, 실제로 그렇게 읽혔다.
  //   📏 2026-08-11 73차 전수: 하니스 런 «넷»이 전부 `terminal` 관측을 냈는데 원장 «파일»은 둘뿐이었다
  //     (옛 둘은 전 트리 탐색 0건 · 보존 삭제 아님). 배선은 `#7399`(2026-08-06)에 이미 있었고,
  //     끈 커밋 `#7476`(2026-08-07)의 사유 *"런 원장에 종결행을 남기지 않고"* 는 그 «증상»을 본 것이다.
  //   ⇒ 📌 ***기전은 「배선 없음」이 아니라 「배선이 있는데 조용히 실패」였고, 로그가 없어 원리상 못 봤다.***
  //   ⛔ 원장이 «무엇을 담는가»는 여기서 안 바꾼다 — 실패가 «보이게»만 한다.
  let ledgerDirectory: string | undefined;
  try {
    ledgerDirectory = runLedgerDir();
  } catch { /* path lookup must not block terminal observation */ }
  try {
    (opts.writeRunLedger ?? appendRunLedgerEntry)({
      timestamp: new Date().toISOString(),
      runId: result.runId,
      event: 'terminal',
      data: terminalObservation,
    });
    debug.log('harness.membrane', 'terminal-ledger', {
      runId: result.runId,
      outcome: 'written',
      ...(ledgerDirectory !== undefined ? { ledgerDirectory } : {}),
    });
  } catch (error) {
    // fail-soft: observation must not block the terminal result — 다만 «삼킨 사실»은 남긴다.
    debug.log('harness.membrane', 'terminal-ledger', {
      runId: result.runId,
      outcome: 'write-failed',
      error: String((error as { message?: unknown })?.message ?? error),
      ...(ledgerDirectory !== undefined ? { ledgerDirectory } : {}),
    }, { level: 'warn' });
  }
  if (result.terminal === 'escalated') {
    opts.ux.progress(`⚠️ HITL 필요: ${result.detail ?? result.terminal} — operator 판단 대기`, { phase: 'end' });
  } else if (result.ok) {
    opts.ux.progress(`✅ 완료(${result.terminal})${reviewed === false ? ' · 심사 미실행' : ''}${result.deployRef ? ` · ${result.deployRef}` : ''}`, { phase: 'end' });
  } else {
    opts.ux.progress(`⚠️ 미완(${result.terminal}): ${result.detail ?? ''}`, { phase: 'end' });
  }
  return result;
}
