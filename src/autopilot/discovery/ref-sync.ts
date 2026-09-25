// ── Self-Evolution SE1 · 참조 repo 로컬 sync (외부 발굴 2순위 · 2026-07-09) ──
//
// 대표: "대상 repo(hermes/openclaw/codex)는 local code sync 도 자율적으로. ~/source/ref
// 대상으로 싱크." 커밋 메타(gh api)만이 아니라 실제 로컬 코드를 최신으로 유지해 diff 를
// 읽는다(ref-dig). fast-forward pull only(로컬 변경 보존·충돌 시 fetch만·fail-soft).
//
// READ-ONLY 의도(로컬에 새 커밋 안 만듦). 순수 로직 + 주입 runGit(테스트).

import { runGitCommand } from '../../git-fs/runner.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 업계 리딩 참조 repo(대표 지정) — ~/source/ref 로컬 클론. */
export const REF_REPOS = [
  { key: 'hermes', dir: join(homedir(), 'source/ref/hermes-agent'), remote: 'nousresearch/hermes-agent' },
  { key: 'openclaw', dir: join(homedir(), 'source/ref/openclaw'), remote: 'openclaw/openclaw' },
  { key: 'codex', dir: join(homedir(), 'source/ref/codex'), remote: 'openai/codex' },
] as const;

export type RunGit = (dir: string, args: string[]) => string;
const defaultRunGit: RunGit = (dir, args) => {
  const result = runGitCommand(dir, args, { encoding: 'utf-8', timeout: 120_000 });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
};

export interface SyncResult {
  key: string;
  dir: string;
  branch: string;
  beforeSha: string | null;
  afterSha: string | null;
  pulled: boolean;      // ff pull 실제 수행
  dirtyTracked: boolean; // 추적 파일 변경(있으면 pull 스킵·fetch만)
  note: string;
}

/** 추적 파일(??=untracked 제외) 변경 여부 — ff pull 안전 판정. */
function hasDirtyTracked(porcelain: string): boolean {
  return porcelain.split('\n').some(l => l.trim() && !l.startsWith('??'));
}

/** repo 1개 sync — fetch + (clean이면) ff-only merge. 실패=fetch만·fail-soft. */
export function syncRepo(repo: { key: string; dir: string }, runGit: RunGit = defaultRunGit): SyncResult {
  const git = (args: string[]): string => runGit(repo.dir, args).trim();
  const res: SyncResult = { key: repo.key, dir: repo.dir, branch: '', beforeSha: null, afterSha: null, pulled: false, dirtyTracked: false, note: '' };
  try {
    res.branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    res.beforeSha = git(['rev-parse', 'HEAD']);
    res.dirtyTracked = hasDirtyTracked(git(['status', '--porcelain']));
    // fetch — 실패(예: refs/remotes/origin/<x> 계층 충돌) 시 prune 후 1회 재시도.
    try {
      git(['fetch', '--quiet', 'origin']);
    } catch {
      try { git(['remote', 'prune', 'origin']); git(['fetch', '--quiet', 'origin']); }
      catch (e2) { res.note = `fetch 실패(prune 후에도): ${e2 instanceof Error ? e2.message : String(e2)}`.slice(0, 140); res.afterSha = res.beforeSha; return res; }
    }
    if (res.dirtyTracked) {
      res.note = '추적 변경 있음 → fetch만(pull 스킵)';
      res.afterSha = res.beforeSha;
      return res;
    }
    // ff-only merge(upstream). upstream 없으면 origin/<branch> 시도.
    try {
      git(['merge', '--ff-only', '--quiet', `origin/${res.branch}`]);
    } catch {
      res.note = 'ff 불가(분기/upstream 없음) → fetch만';
      res.afterSha = git(['rev-parse', 'HEAD']);
      return res;
    }
    res.afterSha = git(['rev-parse', 'HEAD']);
    res.pulled = res.afterSha !== res.beforeSha;
    res.note = res.pulled ? `pull ${res.beforeSha?.slice(0, 7)}..${res.afterSha?.slice(0, 7)}` : '이미 최신';
    return res;
  } catch (e) {
    res.note = `sync 실패: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
    return res;
  }
}

/** 전 참조 repo sync. */
export function syncAllRefs(runGit: RunGit = defaultRunGit): SyncResult[] {
  return REF_REPOS.map(r => syncRepo(r, runGit));
}
