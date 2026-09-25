// 리뷰 폐루프 CLI 글루 — 옵션 «정의»와 「그 값이 ReviewLoopOpts 로 어떻게 실리나」의 단일 자리.
// U4b `mission-cli.ts` 와 같은 결(액션은 I/O 만·글루는 주입 가능한 순수 함수).
//
// ⭐ 왜 index.ts 액션에서 내렸나: 정의와 조립이 액션 안에 인라인으로 있으면 「명령줄에서 들어온 값이
//    사슬 끝(rework 미션 spec·워크트리 생성 인자)까지 갔나」를 «구조적으로» 물 수 없다 — 액션은
//    process.exit/console 을 타서 테스트가 부를 수 없고, 옵션 정의는 그 파일 밖에서 파싱할 수 없다.
//    여기로 내리면 테스트가 «진짜 argv» 를 commander 로 파싱해 그 산출을 그대로 사슬에 흘릴 수 있다.
// ⛔ 정책(어느 값이 기본인가)은 여기서 새로 만들지 않는다 — 미지정은 «키를 싣지 않는» 것으로 표현해
//    아래 마디들의 기존 기본값 해석을 그대로 둔다(무인 스위치는 명시할 때만 켜진다).
import type { Command } from 'commander';
import type { ReviewLoopOpts } from './review-loop.js';
import type { EvidenceMode } from './driver.js';
import type { ReviewDepthConfig } from './review-depth.js';

/** commander 가 채운 raw 옵션(문자열·불리언 그대로). */
export interface ReviewLoopCliOpts {
  evidence?: string;
  testPath?: string;
  file?: string;
  reworkBranch?: string;
  maxRounds: string;
  autoMergeOnOk?: boolean;
  finalJudge?: boolean;
  autoMerge?: boolean;
  /** `--no-verify-merge` → false. 미지정이면 commander 가 true 를 채운다. */
  verifyMerge?: boolean;
  judgeRounds: string;
  judgeBackend?: string;
  judgeModel?: string;
  /** ⭐ `--judge-backend` 의 짝 — rework 에이전트 백엔드. */
  reworkBackend?: string;
  /** ⭐ 소유 워크트리 재사용 요청(명시할 때만). */
  reuseWorktree?: boolean;
  screens?: string;
  context?: string[];
  contextText?: string[];
}

/** 명령줄 밖에서 온 것들(설정·argv 순서) — 액션이 읽어 넘긴다. */
export interface ReviewLoopCliContext {
  configuredJudgeBackend?: string;
  configuredReworkBackend?: string;
  depthConfig?: ReviewDepthConfig;
  contextOrder?: ReviewLoopOpts['contextOrder'];
}

export type ReviewLoopCliBuild =
  | { ok: true; opts: ReviewLoopOpts }
  | { ok: false; message: string };

/** review-loop 옵션 정의 — ⛔ 이 목록이 유일한 정의 자리다(index.ts 는 이 함수를 부른다). */
export function registerReviewLoopOptions(cmd: Command): Command {
  return cmd
    .option('--evidence <mode>', 'rework 증거 tsc|test (기본 tsc)', 'tsc')
    .option('--test-path <p>', 'test 모드: bun test 대상')
    .option('--file <rel>', 'test 모드: 존재 확인 파일')
    .option('--rework-branch <name>', 'rework worktree 브랜치(기본 PR 브랜치 in-place)')
    .option('--max-rounds <n>', 'rework RFC 최대 라운드 (기본 14)', '14')
    .option('--auto-merge-on-ok', 'OK 판정 시 자동 squash-merge')
    .option('--final-judge', '⭐ 최종 완결 판정을 ACP Claude Code 독립 심판으로 (L2)')
    .option('--auto-merge', '심판 merge 판정 시 자동 squash-merge (아니면 준비됨만 표시)')
    .option('--no-verify-merge', 'G10 안전봉투 해제 — 자율머지 후 통합 회귀검증(tsc→revert PR) 안 함 (기본: 검증 on)')
    .option('--judge-rounds <n>', '심판 rework 최대 라운드 (기본 3)', '3')
    .option('--judge-backend <id>', '심판 ACP 백엔드 (기본: 설정 acp.reviewBackend, 없으면 공유 기본값)')
    .option('--judge-model <alias>', '⭐ 심판 모델 tier (opus|sonnet|haiku·기본=백엔드 기본). ACP session/set_model 로 고정')
    .option('--rework-backend <id>', '⭐ rework 에이전트 백엔드 codex|claude|gemini|grok (--judge-backend 의 짝·기본: 지금까지와 같은 codex). claude 는 PTY 구독이라 API 과금이 없다')
    .option('--reuse-worktree', '⭐ rework 미션이 그 브랜치를 이미 쥔 «소유» 워크트리를 지우지 말고 재사용(수리 라운드를 같은 브랜치에 이어 붙일 때). 안 주면 지금 그대로 — 커밋되지 않은 변경이 있으면 재사용은 거부된다')
    .option('--screens <dir>', '스크린 캡처 디렉토리')
    .option('--context <path>', '리뷰어에게 추가할 저장소 내부 참고 자료 경로(반복 가능)', (value: string, previous: string[] = []) => [...previous, value])
    .option('--context-text <text>', '리뷰어에게 추가할 인라인 참고 자료(반복 가능)', (value: string, previous: string[] = []) => [...previous, value]);
}

/** raw CLI 옵션 → `runReviewLoop` 인자. process.exit·console 없음(호출부가 I/O). */
export function buildReviewLoopOpts(cli: ReviewLoopCliOpts, ctx: ReviewLoopCliContext = {}): ReviewLoopCliBuild {
  let evidence: EvidenceMode;
  if (cli.evidence === 'test') {
    if (!cli.testPath) return { ok: false, message: 'test 모드엔 --test-path 필요' };
    evidence = { kind: 'test', testPath: cli.testPath, ...(cli.file ? { fileRel: cli.file } : {}) };
  } else { evidence = { kind: 'tsc' }; }

  return {
    ok: true,
    opts: {
      evidence,
      maxRounds: parseInt(cli.maxRounds, 10),
      autoMergeOnOk: cli.autoMergeOnOk === true,
      finalJudge: cli.finalJudge === true,
      autoMerge: cli.autoMerge === true,
      verifyMerge: cli.verifyMerge !== false, // G10 안전봉투 기본 on(--no-verify-merge 로 해제)
      judgeRounds: parseInt(cli.judgeRounds, 10),
      ...(cli.judgeBackend ? { judgeBackend: cli.judgeBackend } : {}),
      ...(ctx.configuredJudgeBackend ? { configuredJudgeBackend: ctx.configuredJudgeBackend } : {}),
      ...(cli.reworkBackend ? { reworkBackend: cli.reworkBackend } : {}),
      ...(ctx.configuredReworkBackend ? { configuredReworkBackend: ctx.configuredReworkBackend } : {}),
      // ⛔ 명시할 때만 실린다 — 안 주면 키가 없어 rework 미션 spec 이 종전과 «같다».
      ...(cli.reuseWorktree === true ? { reuseOwnedWorktree: true } : {}),
      ...(ctx.depthConfig ? { depthConfig: ctx.depthConfig } : {}), // 2계층 무게 임계
      ...(cli.judgeModel ? { judgeModel: cli.judgeModel } : {}),
      ...(cli.reworkBranch ? { reworkBranch: cli.reworkBranch } : {}),
      ...(cli.screens ? { screensDir: cli.screens } : {}),
      ...(ctx.contextOrder && ctx.contextOrder.length > 0 ? { contextOrder: ctx.contextOrder } : {}),
    },
  };
}
