// ── Self-Evolution SE4 · 야간 격리 구현 러너 (2026-07-09) ──────────────────
//
// 대표: "루프 엔지니어링 모듈을 하나 더 만들어 계획된 문서를 넣으면 밤새 구현." 승인된
// 제안(SE2) → 격리 인스턴스(SE3) → 자율 구현(ContinuationDriver/delegate seam) → 무결성
// 게이트(SE4) → PR 초안. merge/재부팅 없음(HITL·P3). build arming off 면 집행 0(skeleton).
//
// ★ config 격리 하드가드(대표 강조): 격리 데몬 launch args 는 반드시 --config-dir(격리)+
// --test-state-dir 를 포함하고, 그 경로가 정식 ~/.elanous 이면 throw. 메인 config 무오염 보증.

import { isolatedPort, assertIsolationSafe, type IsolatedPlan } from './isolated-instance.js';
import type { GateResult } from './integrity-gate.js';
import type { BuildTarget } from './build-target.js';
import type { CritiqueResult } from '../mission-critique.js';
import { checkImmutableCore } from '../safety.js';
import { isSystemRepairAuthorized } from '../system-repair.js';

/** ★ 격리 데몬 launch args — 항상 --config-dir(격리)+--test-state-dir. 정식 경로면 throw.
 *  "구현상 헛점으로 메인 config 을 날려서는 안 된다"(대표). 이 함수만이 격리 데몬 기동 진입. */
export function buildIsolatedLaunchArgs(plan: IsolatedPlan): string[] {
  assertIsolationSafe(plan);
  const home = process.env.HOME ?? '';
  if (home && plan.configDir.startsWith(`${home}/.elanous`) && !plan.configDir.includes('.worktrees')) {
    throw new Error(`config 격리 위반: 격리 데몬이 정식 ~/.elanous 를 config-dir 로 사용 시도(${plan.configDir})`);
  }
  return [
    '--config-dir', plan.configDir,
    '--test-state-dir', plan.testStateDir,
    'nexus', 'run', '--http-port', String(plan.port),
  ];
}

export type BuildStatus = 'disarmed' | 'no-approved' | 'built' | 'gate-failed' | 'impl-failed' | 'core-violation'
  // no-change(대표 2026-07-12): 실제 코드 변경 0 = 이미 구현됨/변경 불필요(정직한 no-op PASS).
  //   pr-failed: 실제 변경 있는데 PR 생성(커밋/push/gh) 실패 = 진짜 실패(껍데기 built 금지).
  | 'no-change' | 'pr-failed';

export interface NocturnalResult {
  status: BuildStatus;
  target?: BuildTarget;
  evidence?: GateResult;
  prUrl?: string;
  /** R0/R1 비평 결과(대표 2026-07-12) — 재구현이 이 지적을 SE 에 실어 반영하도록 흘려보냄.
   *  built 경로에서만 채워짐(pass 여도 findings 있을 수 있음). PR 코멘트에만 남던 갭 해소. */
  critique?: CritiqueResult;
  next: string;
}

export interface NocturnalDeps {
  /** 격리 인스턴스 생성(주입·기본 SE3 createIsolatedInstance). slug → plan. async 허용(구조정합 LLM merge). */
  createInstance: (slug: string) => IsolatedPlan | Promise<IsolatedPlan>;
  /** 자율 구현(ContinuationDriver/delegate seam). 격리 cwd 에서 플랜 구현.
   *  error=true 면 구현 오류(delegate 예외)·changed=false+error미설정이면 변경 불필요(no-op). */
  implement: (plan: IsolatedPlan, target: BuildTarget) => Promise<{ changed: boolean; summary: string; error?: boolean }>;
  /** 변경 파일 목록(격리 cwd·git diff --name-only). 주입 시 IMMUTABLE_CORE 위반 게이트(SE5.2). */
  changedFiles?: (plan: IsolatedPlan) => string[];
  /** 무결성 게이트(격리 cwd). ⛔ 통과 수 기준은 이 구현이 «스코프별로» 소유한다(makeNocturnalDeps). */
  gate: (plan: IsolatedPlan) => GateResult | Promise<GateResult>;
  /** R0/R1 비평(대표 2026-07-12) — gate 후 범위밖·Goodhart(+LLM) flag. async 허용. 미주입 skip. */
  critique?: (plan: IsolatedPlan, target: BuildTarget) => CritiqueResult | Promise<CritiqueResult>;
  /** PR 초안 생성(브랜치 push·주입). critique 전달 시 PR 본문에 비평 첨부. null=실패. */
  // ★ noop(nothing-to-commit) = 이미 반영된 no-op(대표 2026-07-21) — pr-failed 아닌 no-change PASS 로.
  makePr?: (plan: IsolatedPlan, target: BuildTarget, evidence: GateResult, critique?: CritiqueResult) => { url: string } | { noop: true } | null;
  /** 인스턴스 정리(주입). */
  dispose?: (plan: IsolatedPlan) => void;
  /** 제안 상태 갱신(built 표시). */
  markBuilt?: (targetId: string, note: string) => void;
  /** 자율행동 기록. */
  record?: (input: { action: string; rationale: string; outcome: string; refs?: Record<string, unknown> }) => void;
}

/** 승인 제안 1건 격리 구현 — 인스턴스→구현→게이트→PR 초안. build arming off 면 skeleton. */
export async function runNocturnalOne(
  target: BuildTarget,
  armed: boolean,
  deps: NocturnalDeps,
): Promise<NocturnalResult> {
  const record = deps.record ?? (() => {});
  if (!armed) {
    record({ action: `격리 구현 대기: ${target.title}`, rationale: 'build disarmed', outcome: 'skeleton(집행 0·대표 arming 대기)', refs: { slug: target.slug } });
    return { status: 'disarmed', target, next: 'autopilot.json build.armed=true 시 격리 구현.' };
  }

  const plan = await deps.createInstance(target.slug);
  assertIsolationSafe(plan); // 이중 안전
  try {
    const impl = await deps.implement(plan, target).catch((e) => ({ changed: false, error: true, summary: `impl 오류: ${e instanceof Error ? e.message : String(e)}` }));
    if (!impl.changed) {
      deps.dispose?.(plan);
      // 구현 오류(delegate 예외) → impl-failed. 오류 아닌 무변경 → no-op PASS(이미 구현됨·변경 불필요).
      //   (대표 2026-07-12: 이미 완성된 기능 재구현 미션은 대부분 페이즈가 no-op. 껍데기 built/억울한
      //   실패 대신 정직하게 "변경 불필요" 로 통과 — 가짜 PR·오탐 방지.)
      if ('error' in impl && impl.error) {
        record({ action: `격리 구현 실패: ${target.title}`, rationale: target.title, outcome: impl.summary.slice(0, 160) });
        // ★ P0-part2(PLAN-context-propagation §1·2026-07-22) — 원시 delegate 오류(impl.summary: "delegate
        //   오류: Command failed…401")를 next 에 실어 진단 텍스트로 스레딩한다. 종전엔 제네릭 "구현 산출
        //   없음"만 next 로 가 O1 classifyFailClass 가 401/command-failed 를 못 봐 budget-exhausted 로
        //   오귀속(2a014e). 이제 원문이 next→seResultToPhaseResult→진단 텍스트→O1→missing-capability.
        return { status: 'impl-failed', target, next: `구현 산출 없음(구현 오류): ${impl.summary.slice(0, 160)}` };
      }
      record({ action: `변경 불필요(no-op): ${target.title}`, rationale: target.title, outcome: '실제 코드 변경 0 — 이미 구현됨/변경 불필요' });
      return { status: 'no-change', target, next: '실제 코드 변경 없음 — 이미 구현되어 있거나 이 페이즈는 변경 불필요(no-op).' };
    }
    // ★ SE5.2 불변 코어 게이트 — 자율 구현이 매매/arming/safety/재부팅 코어를 건드리면
    // 무결성 게이트 이전에 차단(fail-closed). changedFiles 미주입이면 skip(fail-open·경고).
    if (deps.changedFiles) {
      const core = checkImmutableCore(deps.changedFiles(plan));
      if (!core.ok) {
        // ★ 시스템 수리 미션 예외(대표 2026-07-13) — 대표가 명시 opt-in(system-repair.json 등재)한
        //   미션만 IMMUTABLE_CORE 수정 허용(worktree 구현·PR 까지 · merge 는 여전히 HITL). 자율 발굴
        //   미션은 등재 불가라 항상 차단. fail-closed(미등재=차단). 감사 로그(systemRepair 표시).
        if (isSystemRepairAuthorized(target.id)) {
          record({ action: `⚠️ 시스템 수리 예외 — 불변 코어 수정 허용(대표 opt-in): ${target.title}`, rationale: target.title,
            outcome: `IMMUTABLE_CORE 수정(대표 승인·merge HITL): ${core.violations.join(', ')}`.slice(0, 200),
            refs: { slug: target.slug, violations: core.violations, systemRepair: true } });
        } else {
          deps.dispose?.(plan);
          record({ action: `불변 코어 위반 차단: ${target.title}`, rationale: target.title,
            outcome: `IMMUTABLE_CORE 수정 시도 → 폐기: ${core.violations.join(', ')}`.slice(0, 200), refs: { slug: target.slug, violations: core.violations } });
          return { status: 'core-violation', target, next: `불변 코어 위반(${core.violations.join(', ')}) — 폐기. 자기수정 금지 구역(시스템 수리 미션은 대표 opt-in 필요).` };
        }
      }
    }
    const evidence = await deps.gate(plan);
    if (!evidence.passed) {
      deps.dispose?.(plan);
      record({ action: `무결성 실패: ${target.title}`, rationale: target.title, outcome: `게이트 fail — merge 차단`, refs: { slug: target.slug } });
      return { status: 'gate-failed', target, evidence, next: '무결성 게이트 실패 — 대표 리포트(폐기 or 재시도).' };
    }
    // ★ R0 결정론 비평(대표 2026-07-12) — gate 통과 후 범위밖·Goodhart flag. fail/warn 이어도
    //   PR 은 만들되 본문에 비평 첨부·record 경고(사람 최종 판단·merge HITL). 미주입 시 skip.
    const critique = await deps.critique?.(plan, target);
    if (critique && critique.verdict !== 'pass') {
      record({ action: `자동 비평 ${critique.verdict.toUpperCase()}: ${target.title}`, rationale: target.title,
        outcome: critique.findings.join(' · ').slice(0, 200), refs: { slug: target.slug, verdict: critique.verdict, outOfScope: critique.outOfScope } });
    }
    // ★ 비평 FAIL 차단(대표 지시 2026-07-12) — verdict==='fail'(코어 훼손·Goodhart·미연결
    //   dead-code·심각 범위밖)이면 built 위증 금지. 테스트 게이트는 "회귀 없음" 만 보므로 타입
    //   stub 만 넣은 미완도 통과시켰다(dogfood: KGS 페이즈가 types.ts +15 만 넣고 built 위증).
    //   비평 지능이 이미 dead-code 를 fail 로 정확히 잡으니 이를 게이트로 승격 → gate-failed 반환.
    //   se-bridge 가 예산 상향 재시도(완성 유도)하고, 끝까지 fail 이면 정직하게 미완 보고. warn
    //   (경미 범위밖 등)은 기존대로 built + 본문 첨부(사람 재반영 판단). "실질 검증" 강화.
    if (critique && critique.verdict === 'fail') {
      deps.dispose?.(plan);
      record({ action: `자동 비평 FAIL 차단: ${target.title}`, rationale: target.title,
        outcome: `critique fail → built 차단(미완/훼손 의심): ${critique.findings.join(' · ').slice(0, 180)}`,
        refs: { slug: target.slug, verdict: critique.verdict, outOfScope: critique.outOfScope } });
      return { status: 'gate-failed', target, evidence, critique,
        next: `자동 비평 FAIL — 미완/훼손 의심: ${critique.findings[0]?.slice(0, 90) ?? ''}. 재구현 필요.` };
    }
    const pr = deps.makePr?.(plan, target, evidence, critique) ?? null;
    // ★ makePr no-op(대표 2026-07-21·705308 근본) — "nothing to commit"(이미 반영됨)은 실패가 아니다.
    //   gate 는 이미 통과했으므로 pr-failed(억울한 실패·예산 오힐)가 아니라 정직한 no-change PASS 로.
    if (pr && 'noop' in pr) {
      deps.dispose?.(plan);
      record({ action: `변경 불필요(no-op·커밋 없음): ${target.title}`, rationale: target.title, outcome: 'gate 통과·커밋할 변경 없음 — 이미 반영됨(정직 no-op)', refs: { slug: target.slug } });
      return { status: 'no-change', target, evidence, next: '커밋할 변경 없음 — 이미 반영됨/변경 불필요(no-op).' };
    }
    // ★ 실제 변경이 있는데 PR 생성 실패(대표 2026-07-12) — 껍데기 built 금지. makePr 주입됐는데
    //   null 이면 커밋/push/gh 실패 → 진짜 실패로 보고(리뷰 가능한 산출물 없음).
    if (deps.makePr && !pr) {
      deps.dispose?.(plan);
      record({ action: `PR 생성 실패: ${target.title}`, rationale: target.title, outcome: 'gate 통과했으나 커밋/push/gh 실패 — 리뷰 산출물 없음', refs: { slug: target.slug } });
      return { status: 'pr-failed', target, evidence, next: 'PR 생성 실패(커밋/push/gh) — 재구현 필요.' };
    }
    const prUrl = pr && 'url' in pr ? pr.url : undefined;
    deps.markBuilt?.(target.id, prUrl ?? 'built(no-pr)');
    // ★ built(PR push 완료) 후에도 로컬 worktree 정리 — origin 에 브랜치/PR 존재(로컬 누적
    //   방지·2026-07-12 dogfood: built 경로 dispose 누락으로 se-* worktree 가 쌓였다). 후속
    //   페이즈가 같은 베이스에서 깨끗이 시작. makePr 가 push 안 했으면(pr=null) 유지하지 않고도
    //   변경은 브랜치에 커밋돼 있으나, 미push 시 유실 방지 위해 pr 있을 때만 dispose.
    if (prUrl) deps.dispose?.(plan);
    record({ action: `격리 구현 완료: ${target.title}`, rationale: target.title, outcome: `무결성 green → PR 초안 ${prUrl ?? '(생성 실패)'}·merge HITL`, refs: { slug: target.slug, pr: prUrl } });
    return { status: 'built', target, evidence, ...(prUrl ? { prUrl } : {}), ...(critique ? { critique } : {}), next: '무결성 통과 — 대표 리뷰 후 merge(HITL).' };
  } catch (e) {
    deps.dispose?.(plan);
    return { status: 'impl-failed', target, next: `러너 오류: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160) };
  }
}

/** 승인 제안 큐 소진(순차·격리라 동시성 지양). armed off 면 전부 skeleton. */
export async function runNocturnal(approved: BuildTarget[], armed: boolean, deps: NocturnalDeps): Promise<NocturnalResult[]> {
  if (!approved.length) return [{ status: 'no-approved', next: '승인된 제안 없음 — SE2 승인 대기.' }];
  const out: NocturnalResult[] = [];
  // ⛔⭐ 통과 수 기준을 «여기»서 들지 않는다 — 무인 리뷰 must-fix(2026-08-04) 2라운드.
  //   종전 판은 단일 변수를 타깃 사이에 이어 써서 ⑴ 스코프가 다른 타깃끼리 비교하고
  //   ⑵ `result.passed` 를 안 보고 갱신해 5→4 실패 뒤 기준이 4로 내려가는 «하향 래칫»이 났다.
  //   ⇒ 기준 소유는 `makeNocturnalDeps` 의 스코프별 맵 «한 곳»이다(계약과 동작을 일치시킨다).
  for (const p of approved) out.push(await runNocturnalOne(p, armed, deps));
  return out;
}

export { isolatedPort };
