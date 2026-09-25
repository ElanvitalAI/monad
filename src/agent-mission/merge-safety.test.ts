// G10 안전봉투 2 — merge-safety 테스트. 순수 파싱 + verifyMergeAndMaybeRevert 주입 seam(실 git/gh/worktree 없이).
import { describe, test, expect } from 'bun:test';
import { GitResidueBlockedError } from '../git-fs/worktree.js';
import { debug } from '../debug/log.js';
import {
  revertBranchName, parseMergeSha, parseChangedFiles, revertPrBody,
  verifyMergeAndMaybeRevert, type MergeSafetyDeps,
} from './merge-safety.js';

describe('순수 헬퍼', () => {
  test('revertBranchName — pr + sha7', () => {
    expect(revertBranchName('5170', 'abcdef1234567890')).toBe('revert-pr5170-abcdef1');
  });
  test('parseMergeSha — mergeCommit.oid', () => {
    expect(parseMergeSha('{"mergeCommit":{"oid":"deadbeef"}}')).toBe('deadbeef');
    expect(parseMergeSha('{"mergeCommit":null}')).toBeNull();
    expect(parseMergeSha('not json')).toBeNull();
  });
  test('parseChangedFiles — 줄단위 trim·빈줄 제거', () => {
    expect(parseChangedFiles('src/a.ts\n\nsrc/b.ts\n  ')).toEqual(['src/a.ts', 'src/b.ts']);
  });
  test('revertPrBody — tsc 로그 포함', () => {
    const b = revertPrBody('5170', 'deadbeefcafe', 'error TS2304');
    expect(b).toContain('#5170');
    expect(b).toContain('error TS2304');
  });
});

// 공통 주입 — 회귀 여부만 바꿔가며 경로 검증.
function mkDeps(over: Partial<MergeSafetyDeps> & { passed: boolean; executed?: boolean; mergeSha?: string | null }): MergeSafetyDeps & { calls: string[] } {
  const calls: string[] = [];
  const deps: MergeSafetyDeps & { calls: string[] } = {
    calls,
    gh: (args) => {
      calls.push(`gh:${args.join(' ')}`);
      if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ mergeCommit: over.mergeSha === undefined ? { oid: 'sha1234567890' } : (over.mergeSha ? { oid: over.mergeSha } : null) });
      return '';
    },
    git: (cwd, args) => { calls.push(`git:${args[0]}`); if (args[0] === 'show') return 'src/x.ts\n'; return ''; },
    typecheck: () => ({
      passed: over.passed,
      executed: over.executed ?? true,
      log: over.passed ? '' : 'error TS2304: Cannot find name',
    }),
    createWt: (b) => { calls.push(`createWt:${b}`); return { path: `/tmp/wt/${b}` }; },
    removeWt: (p) => { calls.push(`removeWt:${p}`); },
    openPr: (a) => { calls.push(`openPr:${a.head}`); return { url: `https://github.com/x/y/pull/999`, number: 999 }; },
    notify: (t) => { calls.push(`notify:${t.slice(0, 20)}`); },
    ...over,
  };
  return deps;
}

describe('verifyMergeAndMaybeRevert', () => {
  test('머지 커밋 없으면 skip(verified=false)', async () => {
    const deps = mkDeps({ passed: true, mergeSha: null });
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.verified).toBe(false);
    expect(r.passed).toBe(true);
    expect(r.typecheckOutcome).toBe('inconclusive');
    expect(deps.calls.some(c => c.startsWith('createWt'))).toBe(false); // worktree 안 만듦
  });

  test('회귀 없음(tsc pass) → passed=true·revert 안 함·worktree 정리', async () => {
    const deps = mkDeps({ passed: true });
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.verified).toBe(true);
    expect(r.passed).toBe(true);
    expect(r.typecheckOutcome).toBe('no-regression');
    expect(r.revertPr).toBeUndefined();
    expect(deps.calls.some(c => c.startsWith('openPr'))).toBe(false); // revert PR 안 엶
    expect(deps.calls.some(c => c.startsWith('removeWt'))).toBe(true); // worktree 정리
  });

  test('tsc 미실행 → 판정 불가·revert 안 함·관측을 남김', async () => {
    const logs: { category: string; event: string; data?: unknown }[] = [];
    const originalLog = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown) => {
      logs.push({ category, event, data });
    }) as typeof debug.log;
    try {
      const executionFailureLog = '[tsc: 타입 검사 실행 실패 (status=null, signal=none, error=Executable not found in PATH bunx, durationMs=0) — tsc 설정·실행 파일·시간 제한을 확인한 뒤 다시 실행하라.]';
      const deps = mkDeps({
        passed: false,
        executed: false,
        typecheck: () => ({ passed: false, executed: false, log: executionFailureLog }),
      });
      const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
      expect(r.verified).toBe(true);
      expect(r.passed).toBe(false);
      expect(r.typecheckOutcome).toBe('inconclusive');
      expect(r.revertPr).toBeUndefined();
      expect(deps.calls.some(c => c === 'git:revert')).toBe(false);
      expect(deps.calls.some(c => c.startsWith('openPr'))).toBe(false);
      expect(logs).toContainEqual(expect.objectContaining({
        category: 'review-loop', event: 'merge-safety-inconclusive',
        data: expect.objectContaining({ executed: false, log: executionFailureLog }),
      }));
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
    }
  });

  test('회귀(tsc fail) → revert 커밋+push+PR+알림·passed=false', async () => {
    const deps = mkDeps({ passed: false });
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.verified).toBe(true);
    expect(r.passed).toBe(false);
    expect(r.typecheckOutcome).toBe('regression');
    expect(r.revertPr).toBe('https://github.com/x/y/pull/999');
    expect(deps.calls.some(c => c === 'git:revert')).toBe(true);
    expect(deps.calls.some(c => c === 'git:push')).toBe(true);
    expect(deps.calls.some(c => c.startsWith('openPr:revert-pr5170'))).toBe(true);
    expect(deps.calls.some(c => c.startsWith('notify:'))).toBe(true);
    expect(deps.calls.some(c => c.startsWith('removeWt'))).toBe(true);
  });

  test('회귀 뒤 revert 실패도 typecheckOutcome=regression을 보존한다', async () => {
    const deps = mkDeps({ passed: false });
    deps.git = (_cwd, args) => {
      deps.calls.push(`git:${args[0]}`);
      if (args[0] === 'show') return 'src/x.ts\n';
      if (args[0] === 'revert') throw new Error('revert failed');
      return '';
    };
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.passed).toBe(false);
    expect(r.typecheckOutcome).toBe('regression');
    expect(r.revertPr).toBeUndefined();
  });

  test('회귀 뒤 PR 생성 실패도 typecheckOutcome=regression을 보존한다', async () => {
    const deps = mkDeps({ passed: false });
    deps.openPr = () => { throw new Error('open PR failed'); };
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.passed).toBe(false);
    expect(r.typecheckOutcome).toBe('regression');
    expect(r.revertPr).toBeUndefined();
  });

  test('미실행 관측은 정리 실패보다 먼저 남는다', async () => {
    const logs: { category: string; event: string; data?: unknown }[] = [];
    const originalLog = debug.log;
    (debug as { log: typeof debug.log }).log = ((category: string, event: string, data?: unknown) => {
      logs.push({ category, event, data });
    }) as typeof debug.log;
    try {
      const executionFailureLog = '[tsc: 타입 검사 실행 실패 (status=null, signal=none, error=Executable not found in PATH bunx, durationMs=0)]';
      const deps = mkDeps({ passed: false, executed: false });
      deps.typecheck = () => ({ passed: false, executed: false, log: executionFailureLog });
      deps.removeWt = () => { throw new Error('cleanup failed'); };
      const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
      expect(r.verified).toBe(false);
      expect(r.passed).toBe(false);
      expect(r.typecheckOutcome).toBe('inconclusive');
      expect(logs).toContainEqual(expect.objectContaining({
        category: 'review-loop', event: 'merge-safety-inconclusive',
        data: expect.objectContaining({ executed: false, log: executionFailureLog }),
      }));
    } finally {
      (debug as { log: typeof debug.log }).log = originalLog;
    }
  });

  test('cleanup residue error is surfaced rather than silently swallowed', async () => {
    const deps = mkDeps({ passed: true });
    // ⛔ **타입으로 가른다** — 평범한 Error 로는 잔여 차단인지 알 수 없다(무인 리뷰 must-fix).
    deps.removeWt = () => {
      throw new GitResidueBlockedError('git residue blocks operation: merge', { state: 'observed', residues: ['merge'] }, '/wt');
    };
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('git residue blocks operation: merge');
    // 멈춘 이유와 관측이 **산출물까지** 살아 남는다(수용 기준).
    expect(r.residueBlock).toMatchObject({ reason: 'git residue blocks operation: merge' });
  });

  // ⛔ 회귀 — **정리를 재시도하면 차단 사실을 잃는다**(무인 리뷰 must-fix). 첫 호출만 잔여로
  //    막고 두 번째는 성공하는 stub 이라야 이 결함이 드러난다. 항상 던지는 stub 은 가린다.
  test('a residue block on the first cleanup is not erased by a retry', async () => {
    const deps = mkDeps({ passed: true });
    let calls = 0;
    deps.removeWt = () => {
      calls += 1;
      if (calls === 1) {
        throw new GitResidueBlockedError('git residue blocks operation: merge', { state: 'observed', residues: ['merge'] }, '/wt');
      }
      // 두 번째는 성공한다(잠금이 사라진 상황) — 재시도하면 여기서 통과해 버린다.
    };
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(calls).toBe(1);                     // ⛔ 재시도하지 않는다
    expect(r.passed).toBe(false);              // 차단 사실이 판정에 남는다
    expect(r.residueBlock).toMatchObject({ worktreePath: '/wt' });
  });

  // ⛔ 회귀 — 잔여가 **아닌** 정리 실패는 종전대로 fail-open 이어야 한다. 초판은 어떤 정리
  //    실패든 passed 를 뒤집어, 이 골과 무관한 공유 동작을 넓게 바꿨다(무인 리뷰 must-fix).
  test('a non-residue cleanup failure stays fail-open', async () => {
    const deps = mkDeps({ passed: true });
    deps.removeWt = () => { throw new Error('EBUSY: 파일이 잠겨 있음'); };
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.passed).toBe(true);
    expect(r.residueBlock).toBeUndefined();
  });

  test.each([
    ['createWt', (deps: MergeSafetyDeps) => { deps.createWt = () => { throw new Error('worktree 생성 실패'); }; }],
    ['git show', (deps: MergeSafetyDeps) => { deps.git = (_cwd, args) => { if (args[0] === 'show') throw new Error('git show 실패'); return ''; }; }],
    ['typecheck', (deps: MergeSafetyDeps) => { deps.typecheck = () => { throw new Error('tsc 폭발'); }; }],
  ])('%s 예외는 판정 불가이며 passed=false', async (_name, configure) => {
    const deps = mkDeps({ passed: true });
    configure(deps);
    const r = await verifyMergeAndMaybeRevert('5170', '/repo', deps);
    expect(r.verified).toBe(false);
    expect(r.passed).toBe(false);
    expect(r.typecheckOutcome).toBe('inconclusive');
    expect(r.revertPr).toBeUndefined();
  });
});
