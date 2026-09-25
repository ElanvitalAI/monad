// ⭐⭐ 「명령줄 → 사슬 끝」 배선 테스트.
//
// 무엇을 무나: 함수 하나를 직접 부르는 게 아니라, **진짜 argv 를 commander 로 파싱**해서 나온 값이
// 마디를 하나씩 지나 사슬 «끝»(rework 미션 spec 의 backend · createWorktree 인자의 재사용 요청)에
// 도달하는지를 본다. 마디는 넷이다:
//   ① 옵션 정의(registerReviewLoopOptions) → ② opts 조립(buildReviewLoopOpts)
//   → ③ rework 미션(runReworkMission·runMission 심으로 spec 을 그대로 본다)
//   → ④ 워크트리 인자(buildMissionWorktreeRequest)
// ⛔ 중간 어느 마디를 되돌려도 여기서 실패한다 — 그것이 이 파일이 있는 이유다.
// ⛔ ③ 의 몸통(PTY spawn)은 부르지 않는다. 그래서 ④ 를 «함수»로 꺼냈다(인라인 리터럴은 못 문다).
import { describe, test, expect } from 'bun:test';
import { Command } from 'commander';
import { registerReviewLoopOptions, buildReviewLoopOpts, type ReviewLoopCliOpts } from './review-loop-cli.js';
import { runReworkMission } from './review-loop.js';
import { buildMissionWorktreeRequest, type AgentMissionResult, type AgentMissionSpec } from './driver.js';
import type { CreateWorktreeOpts } from '../git-fs/worktree.js';

const MISSION_RESULT: AgentMissionResult = {
  ok: true, worktree: '/tmp/wt', branch: 'pr-branch', rounds: 1,
  evidencePath: null, committed: true, usedOmniCrawl: false, detail: 'ok',
};

/** 진짜 명령줄 한 줄을 파싱한다 — 옵션 정의 자체가 이 경로에 걸린다(없는 플래그면 commander 가 던진다). */
function parseArgv(argv: string[]): ReviewLoopCliOpts {
  let captured: ReviewLoopCliOpts | undefined;
  const program = new Command();
  program.exitOverride(); // 파싱 실패가 process.exit 이 아니라 예외로 오게(테스트가 볼 수 있게)
  const cmd = program.command('review-loop <pr>');
  registerReviewLoopOptions(cmd).action((_pr: string, opts: ReviewLoopCliOpts) => { captured = opts; });
  program.parse(argv, { from: 'user' });
  if (!captured) throw new Error('액션이 안 불렸다');
  return captured;
}

/** 명령줄 한 줄 → 사슬 끝 두 값(rework backend · 워크트리 생성 인자). */
async function driveChain(argv: string[]): Promise<{ backend: string | undefined; request: CreateWorktreeOpts; spec: AgentMissionSpec }> {
  const built = buildReviewLoopOpts(parseArgv(argv));
  if (!built.ok) throw new Error(`opts 조립 실패: ${built.message}`);
  let spec: AgentMissionSpec | undefined;
  await runReworkMission('8300', 'pr-branch', 'pr-branch', ['리뷰 지적'], {
    ...built.opts,
    runMission: async (received: AgentMissionSpec): Promise<AgentMissionResult> => { spec = received; return MISSION_RESULT; },
  }, '', 1);
  if (!spec) throw new Error('rework 미션이 안 불렸다');
  return {
    backend: spec.agent?.name,
    request: buildMissionWorktreeRequest(spec, { repoRoot: '/repo', worktreeRoot: '/wt-root' }),
    spec,
  };
}

describe('review-loop 명령줄 → 사슬 끝 배선', () => {
  test('인자를 준 경우와 안 준 경우가 사슬 끝에서 «다른 값»이다', async () => {
    const withArgs = await driveChain(['review-loop', '8300', '--rework-backend', 'claude', '--reuse-worktree']);
    const without = await driveChain(['review-loop', '8300']);

    // ① rework backend — 명령줄 값이 미션 spec 까지 갔다.
    expect(withArgs.backend).toBe('claude');
    expect(without.backend).toBe('codex'); // 안 주면 지금까지와 같은 기본값
    expect(withArgs.backend).not.toBe(without.backend);

    // ② 소유 워크트리 재사용 — 명령줄 값이 createWorktree 인자까지 갔다.
    expect(withArgs.request.reuseOwnedWorktree).toBe(true);
    expect(without.request.reuseOwnedWorktree).toBeUndefined();
    expect('reuseOwnedWorktree' in without.request).toBe(false); // 미지정은 «키 자체가 없다»
  });

  test('인자를 안 주면 워크트리 인자 문면이 종전 그대로다', async () => {
    const { request, spec } = await driveChain(['review-loop', '8300']);
    expect(request).toEqual({ repoRoot: '/repo', branch: 'pr-branch', worktreeRoot: '/wt-root', resetExisting: true, base: 'pr-branch' });
    // 미션 spec 도 종전 그대로(브랜치·base·evidence·라운드·commit).
    expect(spec).toMatchObject({ branch: 'pr-branch', base: 'pr-branch', evidence: { kind: 'tsc' }, maxRounds: 14, commit: true });
  });

  test('--rework-backend 는 --judge-backend 를 건드리지 않는다(짝이지 대체가 아니다)', async () => {
    const built = buildReviewLoopOpts(parseArgv(['review-loop', '8300', '--rework-backend', 'claude', '--judge-backend', 'gemini']));
    if (!built.ok) throw new Error(built.message);
    expect(built.opts.reworkBackend).toBe('claude');
    expect(built.opts.judgeBackend).toBe('gemini');
    // 한쪽만 줘도 다른 쪽은 비어 있다(각자 기본 해석을 그대로 탄다).
    const judgeOnly = buildReviewLoopOpts(parseArgv(['review-loop', '8300', '--judge-backend', 'gemini']));
    if (!judgeOnly.ok) throw new Error(judgeOnly.message);
    expect(judgeOnly.opts.reworkBackend).toBeUndefined();
    expect(judgeOnly.opts.reuseOwnedWorktree).toBeUndefined();
  });

  test('미등록 rework 백엔드는 조용한 폴백 없이 사슬 중간에서 터진다', async () => {
    let error: Error | undefined;
    try { await driveChain(['review-loop', '8300', '--rework-backend', 'no-such-backend']); }
    catch (e) { error = e as Error; }
    expect(error?.message).toContain('no-such-backend');
  });

  test('기존 옵션 조립이 그대로다(기본값·--no-verify-merge·evidence 에러 문면)', () => {
    const base = buildReviewLoopOpts(parseArgv(['review-loop', '8300']));
    if (!base.ok) throw new Error(base.message);
    expect(base.opts).toMatchObject({
      evidence: { kind: 'tsc' }, maxRounds: 14, judgeRounds: 3,
      autoMergeOnOk: false, finalJudge: false, autoMerge: false, verifyMerge: true,
    });
    const off = buildReviewLoopOpts(parseArgv(['review-loop', '8300', '--no-verify-merge']));
    if (!off.ok) throw new Error(off.message);
    expect(off.opts.verifyMerge).toBe(false);
    const bad = buildReviewLoopOpts(parseArgv(['review-loop', '8300', '--evidence', 'test']));
    expect(bad).toEqual({ ok: false, message: 'test 모드엔 --test-path 필요' });
  });
});
