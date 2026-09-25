// 도메인 executor — skill 실행형 (트랙 X1 · 2026-07-22)
//
// PLAN-execution-cycle-harness-expansion §트랙 X: "Executor 일반화 — `execute`가 seams.implement(코딩)만 →
// 도메인 executor 라우팅 seam(코드/투자/배포)." 이 모듈은 그 첫 도메인 executor: **skill 실행형**.
// 코드 executor(implement=goal-loop 로 파일 편집)의 형제로, objective 를 skill fan-out(S7)/chain(S8)으로
// 실행하고 산출을 worktree 파일로 materialize 해 changes 로 낸다 → Review/Deploy 가 코드와 **동일 경로**로
// 처리(리포트 PR·apply). 규율 재사용(재발명 0): 격리(invokeResearch)·allowlist·fail-soft·관측.
//
// 배선: buildHarnessSeams({ domainExecute }) 로 execute 스테이지를 이걸로 대체(opt-in). 미주입=코드 implement
// (무회귀). 투자/크롤배포 도메인(R2 프리셋)이 chain 스텝을 주입해 수집→점수→리포트 파이프를 구성.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fanOutHarnessSkills, chainHarnessSkills, type HarnessSkillChainStep } from './skill-compose.js';
import { debug } from '../debug/log.js';

/** execute 스테이지의 도메인-무관 계약 — 코드/skill/투자 executor 가 공유(트랙 X 라우팅 seam). */
export interface DomainExecuteCtx {
  objective: string;
  round: number;
  /** worktree(산출 materialize 대상). */
  cwd: string;
  /** rework 라운드면 직전 리뷰 지적(반영). */
  priorFindings?: string[];
  /** ★ 관측 보강(제1원칙·2026-07-23) — domain executor(웹 게시·범용 스킬 등)가 실행 중(수 분) 진행을 표면/로그로
   *  버블. 종전엔 코드 executor 만 onExecuteProgress 배선돼 domain executor 는 execute 중 블라인드였다. 미주입=no-op. */
  onProgress?: (msg: string) => void;
}
interface DomainExecuteBase {
  ok: boolean;
  summary: string;
  /** worktree 상대 변경 파일(Review/Deploy 가 코드와 동일 처리). */
  changes: string[];
}

/** 무변경 terminal 성공으로 승격할 수 있는 producer별 결과 조합. */
type VerifiedNonCodeOutcome =
  /** generic: 이번 실행에서 생성되어 종료 시에도 남은 artifact. web: 유효한 게시 URL. */
  | { outcome: 'published'; ref: string; nonCodeEvidence: 'artifact-created' | 'published-url' }
  /** execution: 완료한 주문 또는 취소 action의 감사 ref. */
  | { outcome: 'executed'; ref: string; nonCodeEvidence: 'execution-completed' };

/**
 * execute 스테이지 반환 계약. `outcome`과 `nonCodeEvidence`는 독립 optional 값이 아니다.
 * signaled는 표시용 type 값으로 남기되 운영 producer와 승격 증거가 없으므로 terminal 성공 조합을 만들 수 없다.
 */
export type DomainExecuteResult = DomainExecuteBase & (
  | { outcome?: undefined; ref?: undefined; nonCodeEvidence?: undefined }
  | VerifiedNonCodeOutcome
  /** Producer may report publication without proof; seams must leave it as no-changes. */
  | { outcome: 'published'; ref?: undefined; nonCodeEvidence?: undefined }
  | { outcome: 'signaled'; ref?: string; nonCodeEvidence?: undefined }
);

/** Shared proof contract for promoting a no-change domain outcome to a non-code terminal. */
export function verifiedNonCodeOutcome(result: Pick<DomainExecuteResult, 'outcome' | 'ref' | 'nonCodeEvidence'>): boolean {
  return result.outcome === 'published'
    ? (result.nonCodeEvidence === 'artifact-created' || result.nonCodeEvidence === 'published-url') && !!result.ref
    : result.outcome === 'executed'
      ? result.nonCodeEvidence === 'execution-completed' && !!result.ref
      : false;
}

export type DomainExecute = (ctx: DomainExecuteCtx) => Promise<DomainExecuteResult>;

export interface SkillExecutorOpts {
  /** ★ R2 프리셋(2026-07-22) — fan-out 고정 skill 세트(주어지면 luna 픽 우회·도메인 레시피용). chain 과 배타. */
  skills?: readonly string[];
  /** 주어지면 S8 체인(순차 output→input)·없으면 S7 fan-out(병렬). */
  chain?: HarnessSkillChainStep[];
  /** 산출 파일명(worktree 상대·기본 'skill-output.md'). */
  outputFile?: string;
  /** 테스트 seam. */
  fanOut?: typeof fanOutHarnessSkills;
  runChain?: typeof chainHarnessSkills;
  writeFile?: (path: string, content: string) => void;
}

const observe = (event: string, data: Record<string, unknown>): void => {
  try { debug.log('harness.executor', event, data); } catch { /* fail-soft */ }
};

/**
 * X1 skill 도메인 executor — objective 를 skill fan-out(S7) 또는 chain(S8)으로 실행하고 산출을 worktree 파일로
 * materialize 해 changes 로 낸다. rework 라운드면 priorFindings 를 objective 에 얹어 재실행(코드 executor 동형).
 * skill 산출 없음/실패 → ok:false(하니스가 escalate/재시도 판정). 부작용=worktree 파일 쓰기(격리·안전).
 */
export function buildSkillDomainExecute(opts: SkillExecutorOpts = {}): DomainExecute {
  const fanOut = opts.fanOut ?? fanOutHarnessSkills;
  const runChain = opts.runChain ?? chainHarnessSkills;
  const write = opts.writeFile ?? ((p: string, c: string) => writeFileSync(p, c, 'utf-8'));
  const outFile = opts.outputFile ?? 'skill-output.md';

  return async (ctx: DomainExecuteCtx): Promise<DomainExecuteResult> => {
    const obj = ctx.priorFindings && ctx.priorFindings.length
      ? `${ctx.objective}\n\n[이전 리뷰 지적 — 반영]\n${ctx.priorFindings.map((f) => `- ${f}`).join('\n')}`
      : ctx.objective;

    let output = ''; let ok = false; let detail = '';
    if (opts.chain && opts.chain.length) {
      const r = await runChain(obj, opts.chain);
      output = r.finalOutput; ok = r.results.some((x) => x.ok); detail = `chain ${r.results.length}스텝`;
    } else {
      const r = await fanOut(obj, opts.skills && opts.skills.length ? { skills: opts.skills } : {});
      if (r) { output = r.combinedOutput; ok = r.results.some((x) => x.ok); detail = `fan-out(${r.source}) ${r.results.filter((x) => x.ok).length}`; }
      else detail = 'no-skill';
    }

    if (!ok || !output.trim()) {
      observe('skill-empty', { round: ctx.round, detail });
      return { ok: false, summary: `skill executor 산출 없음(${detail})`, changes: [] };
    }
    try {
      write(join(ctx.cwd, outFile), output);
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e).slice(0, 120);
      observe('skill-write-failed', { round: ctx.round, file: outFile, error: msg });
      return { ok: false, summary: `산출 쓰기 실패: ${msg}`, changes: [] };
    }
    observe('skill-materialized', { round: ctx.round, file: outFile, chars: output.length, detail });
    return { ok: true, summary: `skill executor(${detail}) → ${outFile}`, changes: [outFile] };
  };
}
