// ── Autopilot Absorb Flow (2026-07-08 · P2) ───────────────────────────────
//
// self-improving 자율 개발·검증(RESEARCH §5·§6). repo watching(P1.3) 흡수 후보 →
// (arming 게이트) → delegate_code_agent 로 PR 초안 → 빌드+테스트 자율 실행 → 증거 첨부.
// merge 는 하지 않는다(HITL·P2.3). 기본 disarmed(arming.absorb.armed=false) → 제안만.
//
// 자율 경계(RESEARCH §7): ✅ PR 초안 + 테스트 실행까지 자율 · 🚦 merge = HITL.
// 안전: 자기가 짠 코드 자기검증=순환 → 빌드/테스트 증거는 독립 신호(failing-first).
//
// 순수 오케스트레이션 + 주입 deps(delegate·runBuild·runTest). 실 delegate/빌드는 스크립트가 주입.

import type { AutopilotArming } from './arming.js';

export interface AbsorbCandidate {
  repo: string;
  key: string;
  commitSha: string;
  title: string;
  /** 흡수 근거(왜 이 커밋을 흡수할 가치가 있나). */
  rationale: string;
}

export interface Evidence {
  build: 'pass' | 'fail' | 'skipped';
  test: 'pass' | 'fail' | 'skipped';
  log: string;
}

export type AbsorbStatus = 'disarmed' | 'drafted' | 'delegate-failed' | 'evidence-failed';

export interface AbsorbResult {
  status: AbsorbStatus;
  candidate: AbsorbCandidate;
  /** delegate 산출(PR 초안 텍스트·요약). */
  draft?: string;
  evidence?: Evidence;
  /** 다음 행동 안내(HITL). */
  next: string;
}

/** delegate_code_agent 에 보낼 PR 초안 task 프롬프트(맥락 포함·독립 실행). ASCII+한글. */
export function buildAbsorbTask(candidate: AbsorbCandidate): string {
  return [
    `[Autopilot 흡수 제안 · PR 초안]`,
    `참조 repo ${candidate.repo} 의 커밋 ${candidate.commitSha.slice(0, 7)} ("${candidate.title}")`,
    `를 elanous 에 흡수할 가치가 있는지 검토하고, 있다면 elanous 코드베이스에 맞게 적용하는`,
    `작은 PR 초안(브랜치 + 변경)을 만들어라. 근거: ${candidate.rationale}`,
    ``,
    `제약(중요):`,
    `- 새 브랜치에서 작업. main 직접 커밋 금지.`,
    `- 매매/재부팅/안전 게이트 로직(trade-*·nexus reboot·arming)은 수정 금지(불변 코어).`,
    `- 변경 후 반드시 관련 bun test 를 돌려 통과를 확인하고 결과를 보고하라.`,
    `- merge 는 하지 마라(대표 HITL). PR 초안까지만.`,
    `- 흡수 가치가 없다고 판단되면 그 이유를 명확히 보고하고 변경하지 마라.`,
  ].join('\n');
}

export interface AbsorbDeps {
  /** delegate_code_agent 호출(주입). 산출 텍스트 반환. */
  delegate?: (task: string, backend: string) => Promise<string>;
  /** 빌드 실행(주입). 성공=true. */
  runBuild?: () => Promise<boolean>;
  /** 테스트 실행(주입). 성공=true. */
  runTest?: () => Promise<boolean>;
  /** 자율행동 기록(주입). */
  record?: (input: { action: string; rationale: string; outcome: string; refs?: Record<string, unknown> }) => void;
}

/** 흡수 흐름 1건 — arming 게이트 → delegate PR 초안 → 빌드/테스트 증거. merge 안 함(HITL). */
export async function runAbsorbFlow(
  candidate: AbsorbCandidate,
  arming: AutopilotArming,
  deps: AbsorbDeps = {},
): Promise<AbsorbResult> {
  const record = deps.record ?? (() => {});

  // 게이트 — disarmed 면 제안만(집행 0·fail-closed 기본).
  if (!arming.absorb.armed || !deps.delegate) {
    record({
      action: `[${candidate.key}] 흡수 후보 제안: ${candidate.title.slice(0, 80)}`,
      rationale: candidate.rationale,
      outcome: 'disarmed — 제안만(대표 arming 시 PR 초안 자율 생성)',
      refs: { repo: candidate.repo, commitSha: candidate.commitSha },
    });
    return { status: 'disarmed', candidate, next: '대표 arming(autopilot.json absorb.armed=true) 시 PR 초안 자율 생성.' };
  }

  // delegate PR 초안(자율 코드작성).
  let draft: string;
  try {
    draft = await deps.delegate(buildAbsorbTask(candidate), arming.absorb.backend);
  } catch (e) {
    const outcome = `delegate 실패: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    record({ action: `[${candidate.key}] PR 초안 위임 실패`, rationale: candidate.rationale, outcome });
    return { status: 'delegate-failed', candidate, next: 'delegate 재시도 또는 대표 확인.' };
  }

  // 빌드+테스트 증거(독립 검증·failing-first). 미주입=skipped.
  const build = deps.runBuild ? (await deps.runBuild().catch(() => false) ? 'pass' : 'fail') : 'skipped';
  const test = deps.runTest ? (await deps.runTest().catch(() => false) ? 'pass' : 'fail') : 'skipped';
  const evidence: Evidence = { build, test, log: `build=${build} test=${test}` };

  const evidenceOk = build !== 'fail' && test !== 'fail';
  const status: AbsorbStatus = evidenceOk ? 'drafted' : 'evidence-failed';
  record({
    action: `[${candidate.key}] PR 초안 ${evidenceOk ? '작성' : '증거 실패'}: ${candidate.title.slice(0, 60)}`,
    rationale: candidate.rationale,
    outcome: `${evidence.log} · merge 대기(HITL)`,
    refs: { repo: candidate.repo, commitSha: candidate.commitSha },
  });

  return {
    status,
    candidate,
    draft: draft.slice(0, 4000),
    evidence,
    next: evidenceOk
      ? '빌드/테스트 통과 — 대표 리뷰 후 merge(HITL·P2.3).'
      : '빌드/테스트 실패 — merge 차단. 대표 확인 또는 폐기.',
  };
}
