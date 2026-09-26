// ── G10 안전봉투 2 — 무인 머지 회귀감지 → revert PR (2026-07-23) ──────────────
//
// ROADMAP-elanous-is-all §2b(무인레벨 삼각·G10). auto-review 자율머지(review-loop)가 main 을
// 바꾼 뒤, 그 머지 커밋의 변경 파일을 **최신 main 격리 worktree** 에서 tsc 재검(경량·changed-file)한다.
// 회귀(타입 깨짐)면 revert PR 을 자동 생성하고 대표에게 알린다(사람 원클릭 머지 — 자동 revert push 아님).
//
// 왜: auto-merge 前에 이미 3층(codex+tsc/test+Opus)을 통과하지만, **머지 시점의 최신 main 과의 통합**
// (다른 PR 과 병합된 상태)에서 타입이 깨질 수 있다(병렬 드리프트). 그 통합 회귀를 사후 그물로 잡는다.
// 검증 범위=tsc(변경파일)만 — full test 는 fast-moving main 서 flaky(self-implement 전례)라 경량.
//
// 재사용(재발명0): createWorktree/removeWorktree(node_modules symlink 자동)·changedFileTypecheck·
// dispatchOpenPullRequest·sendOutbound. 순수 파싱 + 주입 IO seam(테스트 격리).

import { execFileSync } from 'node:child_process';
import { runGitCommand } from '../git-fs/runner.js';
import { configuredWorktreeRoot } from '../user-config.js';
import { debug } from '../debug/log.js';

type TypecheckOutcome = 'no-regression' | 'regression' | 'inconclusive';

function passedForTypecheckOutcome(outcome: TypecheckOutcome): boolean {
  return outcome === 'no-regression';
}

export interface MergeSafetyResult {
  pr: string;
  mergeSha: string | null;
  /** 검증이 실제로 돌았나(머지 커밋 특정 성공). */
  verified: boolean;
  /** 회귀 없음(tsc 통과). verified=false 면 무의미. */
  passed: boolean;
  /** 변경 파일 typecheck의 결말. `inconclusive`는 실행 실패라서 회귀를 판정하지 못한 상태다. */
  typecheckOutcome: TypecheckOutcome;
  /** 회귀 시 생성한 revert PR url. */
  revertPr?: string;
  detail: string;
  /** ⭐ git 잔여로 정리가 **멈춘** 경우의 이유·관측·**어느 트리인지**. 멈춘 원인이 산출물까지
   *  남아야 한다(수용 기준). ⛔ 잔여가 아닌 정리 실패에는 실리지 않는다 — 그건 fail-open 이다. */
  residueBlock?: { reason: string; observation: unknown; worktreePath: string };
}

// ──────────────────── 순수 ────────────────────

/** revert 브랜치명 — PR 번호 + 머지 sha 앞 7자. */
export function revertBranchName(pr: string, sha: string): string {
  return `revert-pr${pr}-${sha.slice(0, 7)}`;
}

/** `gh pr view --json mergeCommit` → squash 머지 커밋 SHA. 미머지/파싱실패=null. */
export function parseMergeSha(prViewJson: string): string | null {
  try {
    const j = JSON.parse(prViewJson) as { mergeCommit?: { oid?: string } | null };
    const oid = j?.mergeCommit?.oid;
    return typeof oid === 'string' && oid.length > 0 ? oid : null;
  } catch { return null; }
}

/** `git show --name-only --pretty=format:` 출력 → 변경 파일 경로 목록. */
export function parseChangedFiles(showOut: string): string[] {
  return showOut.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** revert PR 본문. */
export function revertPrBody(pr: string, sha: string, tscLog: string): string {
  return [
    `## 자동 회귀 감지 (G10 안전봉투)`,
    `무인 리뷰루프(auto-review)가 자율 머지한 PR #${pr}(머지 커밋 \`${sha.slice(0, 12)}\`)이 최신 main 통합 후`,
    `**변경 파일 tsc 회귀**를 냈다. 이 revert PR 은 그 머지를 되돌린다 — 검토 후 머지(사람 결정).`,
    ``,
    `### tsc 회귀`,
    '```',
    tscLog.slice(0, 1500),
    '```',
    `> 자동 revert push 는 하지 않았다(잘못된 판정 방지·사람 원클릭). 통합 회귀가 아니라고 판단되면 이 PR 을 닫아라.`,
  ].join('\n');
}

// ──────────────────── IO seam ────────────────────

export interface MergeSafetyDeps {
  gh?: (args: string[]) => string;
  git?: (cwd: string, args: string[]) => string;
  /** 변경파일 tsc 재검(기본 changedFileTypecheck). */
  typecheck?: (cwd: string, files: string[]) => { passed: boolean; executed: boolean; log: string };
  /** 격리 worktree 생성(기본 createWorktree base=origin/main). */
  createWt?: (branch: string) => { path: string };
  removeWt?: (path: string) => void;
  /** revert PR open(기본 dispatchOpenPullRequest). */
  openPr?: (a: { title: string; body: string; head: string; base: string; cwd: string }) => { url: string; number: number | null };
  /** 대표 알림(기본 sendOutbound). */
  notify?: (text: string) => void;
}

const defGh = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024, env: process.env });
const defGit = (cwd: string, args: string[]): string => {
  const result = runGitCommand(cwd, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout;
};

/**
 * 무인 머지 회귀검증 + (회귀 시) revert PR 생성. repoRoot=main 체크아웃(review-watch CWD).
 * 흐름: 머지 SHA 특정 → 격리 worktree(최신 main) → 변경파일 tsc → 회귀면 revert 커밋 push + PR + 알림.
 */
export async function verifyMergeAndMaybeRevert(pr: string, repoRoot: string, deps: MergeSafetyDeps = {}): Promise<MergeSafetyResult> {
  const gh = deps.gh ?? defGh;
  const git = deps.git ?? defGit;

  debug.log('review-loop', 'merge-safety-start', { pr });
  const mergeSha = parseMergeSha(gh(['pr', 'view', pr, '--json', 'mergeCommit']));
  if (!mergeSha) {
    debug.log('review-loop', 'merge-safety-skip', { pr, reason: 'no-merge-commit', typecheckOutcome: 'inconclusive' });
    return { pr, mergeSha: null, verified: false, passed: true, typecheckOutcome: 'inconclusive', detail: '머지 커밋 미확인 — 검증 skip' };
  }

  const branch = revertBranchName(pr, mergeSha);
  const typecheck = deps.typecheck ?? ((cwd: string, files: string[]) => {
    const { changedFileTypecheck } = require('../self-implement/seams.js') as typeof import('../self-implement/seams.js');
    const r = changedFileTypecheck(cwd, files);
    return { passed: r.passed, executed: r.executed, log: r.log };
  });
  const createWt = deps.createWt ?? ((b: string) => {
    const { createWorktree } = require('../git-fs/worktree.js') as typeof import('../git-fs/worktree.js');
    return createWorktree({ repoRoot, branch: b, worktreeRoot: configuredWorktreeRoot(), base: 'origin/main', resetExisting: true });
  });
  const rawRemoveWt = deps.removeWt ?? ((p: string) => {
    const { removeWorktree } = require('../git-fs/worktree.js') as typeof import('../git-fs/worktree.js');
    removeWorktree(repoRoot, p, true);
  });
  // ⛔ **정리는 한 번만 시도한다**(무인 리뷰 should-fix). 성공 경로의 정리가 던지면 catch 로
  //   떨어지는데, 거기서 다시 부르면 **잔여든 아니든 중복 시도**가 되고 detail 도 달라진다.
  //   ⇒ 시도 여부를 기억해 catch 가 재시도하지 않게 한다.
  let cleanupAttempted = false;
  const removeWt = (p: string): void => { cleanupAttempted = true; rawRemoveWt(p); };

  // 최신 main 확보 후 격리 worktree.
  try { git(repoRoot, ['fetch', 'origin', 'main']); } catch { /* fetch 실패 시도 계속(로컬 origin/main) */ }
  let wtPath = '';
  let typecheckOutcome: MergeSafetyResult['typecheckOutcome'] = 'inconclusive';
  try {
    wtPath = createWt(branch).path;
    const files = parseChangedFiles(git(wtPath, ['show', '--name-only', '--pretty=format:', mergeSha]));
    const tc = typecheck(wtPath, files);
    typecheckOutcome = !tc.executed
      ? 'inconclusive'
      : tc.passed ? 'no-regression' : 'regression';
    debug.log('review-loop', 'merge-safety-tsc', {
      pr, mergeSha: mergeSha.slice(0, 12), files: files.length,
      passed: tc.passed, executed: tc.executed, typecheckOutcome,
    });
    if (typecheckOutcome === 'no-regression') {
      removeWt(wtPath);
      return { pr, mergeSha, verified: true, passed: passedForTypecheckOutcome(typecheckOutcome), typecheckOutcome, detail: `회귀 없음(변경 ${files.length}파일 tsc 통과)` };
    }
    if (typecheckOutcome === 'inconclusive') {
      // 실행 실패의 status/signal/error 로그는 정리 실패와 무관하게 반드시 남긴다.
      debug.log('review-loop', 'merge-safety-inconclusive', {
        pr, mergeSha: mergeSha.slice(0, 12), files: files.length, executed: tc.executed, log: tc.log,
      }, { level: 'warn' });
      removeWt(wtPath);
      return { pr, mergeSha, verified: true, passed: passedForTypecheckOutcome(typecheckOutcome), typecheckOutcome, detail: `판정 불가(변경 ${files.length}파일 tsc 미실행)` };
    }

    // 회귀 — revert 커밋 + push + PR + 알림 (자동 머지 안 함).
    git(wtPath, ['revert', '--no-edit', mergeSha]); // squash 커밋=단일 부모(-m 불필요)
    git(wtPath, ['push', 'origin', `HEAD:${branch}`]);
    const openPr = deps.openPr ?? ((a) => {
      const { dispatchOpenPullRequest } = require('../tool-runtime/git-pr-runtime.js') as typeof import('../tool-runtime/git-pr-runtime.js');
      const r = dispatchOpenPullRequest({ title: a.title, body: a.body, head: a.head, base: a.base }, { cwd: a.cwd });
      return { url: r.url, number: r.number };
    });
    const rp = openPr({
      title: `revert: PR #${pr} 무인 머지 tsc 회귀 (G10 안전봉투)`,
      body: revertPrBody(pr, mergeSha, tc.log),
      head: branch, base: 'main', cwd: wtPath,
    });
    const notify = deps.notify ?? ((t: string) => {
      const { sendOutbound } = require('../domains/outbound-alert.js') as typeof import('../domains/outbound-alert.js');
      sendOutbound(t, 'regression');
    });
    notify(`⚠️ auto-review 무인 머지 #${pr} 회귀 감지(tsc) → revert PR 자동 생성: ${rp.url}\n검토 후 머지 결정(사람).`);
    removeWt(wtPath);
    debug.log('review-loop', 'merge-safety-revert', { pr, mergeSha: mergeSha.slice(0, 12), revertPr: rp.url });
    return { pr, mergeSha, verified: true, passed: passedForTypecheckOutcome('regression'), typecheckOutcome: 'regression', revertPr: rp.url, detail: `회귀 감지 → revert PR ${rp.url}` };
  } catch (e) {
    const error = (e as Error).message;
    // ⛔ **잔여 차단만 판정을 뒤집는다**(무인 리뷰 must-fix). 초판은 *어떤* 정리 실패든
    //   `passed:false` 로 만들어, 종전 fail-open 이던 공유 동작을 이 골과 무관한 범위까지
    //   바꿨다. ⇒ `GitResidueBlockedError` 만 가르고 나머지는 **종전대로 fail-open**.
    // ⚠️ 이 파일은 worktree 모듈을 **지연 require** 로만 쓴다(순환 회피). 타입 판정도 같은 경로로.
    const { GitResidueBlockedError } = require('../git-fs/worktree.js') as typeof import('../git-fs/worktree.js');
    let residueBlock: { reason: string; observation: unknown; worktreePath: string } | undefined;
    let otherCleanupError: string | undefined;
    const noteResidue = (err: InstanceType<typeof GitResidueBlockedError>): void => {
      residueBlock = { reason: err.message, observation: err.observation, worktreePath: err.worktreePath };
      debug.log('review-loop', 'merge-safety-cleanup-blocked', { pr, ...residueBlock }, { level: 'error' });
    };
    // ⛔⭐ **정리를 재시도하지 않는다**(무인 리뷰 must-fix). 성공 경로의 정리가 잔여로 막혀
    //   여기 떨어졌는데 다시 부르면, 그 사이 잠금이 사라졌을 때 **차단 사실과 관측을 잃고**
    //   worktree 를 지운 뒤 `passed: true` 로 통과한다. ⇒ 던진 것이 이미 잔여 차단이면
    //   그것을 그대로 사유로 삼고 **다시 시도하지 않는다.**
    if (e instanceof GitResidueBlockedError) {
      noteResidue(e);
    } else if (wtPath && !cleanupAttempted) {   // 이미 시도했으면 재시도하지 않는다(위 주석)
      try {
        removeWt(wtPath);
      } catch (cleanup) {
        if (cleanup instanceof GitResidueBlockedError) noteResidue(cleanup);
        else otherCleanupError = (cleanup as Error).message;   // 종전 fail-soft 그대로
      }
    }
    debug.log('review-loop', 'merge-safety-error', { pr, error, ...(residueBlock ? { residueBlock } : {}), ...(otherCleanupError ? { otherCleanupError } : {}) }, { level: 'error' });
    const detail = residueBlock
      ? `검증/ revert 오류: ${error}; 정리 중단(git 잔여): ${residueBlock.reason}`
      : `검증/ revert 오류(fail-open): ${error}`;
    return {
      pr, mergeSha,
      verified: typecheckOutcome !== 'inconclusive',
      passed: passedForTypecheckOutcome(typecheckOutcome) && residueBlock === undefined,
      typecheckOutcome, detail,
      ...(residueBlock ? { residueBlock } : {}),
    };
  }
}
