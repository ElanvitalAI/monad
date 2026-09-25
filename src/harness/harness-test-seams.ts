// 테스트 전용 — 실 git worktree 기반 fake SelfImplementSeams.
//
// 왜 실 git 인가: 버그A 수정(2026-07-20) 이후 buildHarnessSeams 의 execute/deploy 가 실 git
// (changedFiles·commitWorktree)에 의존한다. 가짜 경로(/tmp/wt/...)면 변경이 0 으로 잡혀 deploy 가
// 'no-changes' 로 빠진다. 하니스↔seam 통합테스트는 실 저장소를 써야 충실하다. createWorktree=temp
// repo+브랜치(clean·seed 커밋), implement=파일 1개 씀(over 로 재정의). no-changes 검증 테스트는
// implement 를 no-op 로 override 하면 clean worktree 라 그대로 잡힌다.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SelfImplementSeams } from '../self-implement/orchestrator.js';
import { runGitCommand } from '../git-fs/runner.js';

function gitq(cwd: string, args: string[]): void { runGitCommand(cwd, args, { encoding: 'utf8' }); }

/** 실 temp git repo + 브랜치(seed 커밋·clean 워킹트리) 생성. */
export async function realCreateWorktree({ branch }: { branch: string; base?: string }): Promise<{ path: string; branch: string }> {
  const path = mkdtempSync(join(tmpdir(), 'harness-wt-'));
  gitq(path, ['init', '-q']);
  gitq(path, ['config', 'user.email', 't@t']);
  gitq(path, ['config', 'user.name', 't']);
  writeFileSync(join(path, 'seed.txt'), 'seed\n');
  gitq(path, ['add', '-A']);
  gitq(path, ['commit', '-qm', 'seed']);
  gitq(path, ['checkout', '-qb', branch]);
  return { path, branch };
}

/** 실 worktree fake seams. 기본 implement 는 feature.ts 를 쓴다(untracked 변경). */
export function realWorktreeSeams(over: Partial<SelfImplementSeams> = {}): SelfImplementSeams {
  return {
    createWorktree: realCreateWorktree,
    async implement({ cwd }) { writeFileSync(join(cwd, 'feature.ts'), 'export const x = 1;\n'); return { ok: true, summary: '구현 완료' }; },
    async gate() { return { passed: true }; },
    async openPr({ head }) { return { url: `https://pr/${head}`, number: 7 }; },
    ...over,
  };
}
