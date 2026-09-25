// ── Autopilot Repo Watching (2026-07-08 · P1.3) ───────────────────────────
//
// Autopilot 의 첫 실응용(RESEARCH §5 self-improving·대표 원 요구): 참조 에이전트 repo
// (hermes/openclaw/codex)를 주기 감시 → 새 커밋 분석 → **흡수 제안 리포트**. merge·재부팅은
// 상위 HITL(P2/P3). 여기는 watching+분석+제안까지(완전 자율 경계·RESEARCH §7).
//
// triage 라우터(P1.1)의 첫 라우팅 실사례: scheduler 실행모델 → schedule_manage 배선.
// 실행: scripts/repo-watch-cycle.ts(cron). 이 모듈은 순수 diff/report + 주입 gh/db.
//
// 거버넌스: READ-ONLY(gh api 조회만·write 없음). 흡수는 제안까지, 채택/PR/merge 는 HITL.

import { Database } from 'bun:sqlite';
import { monadStateRoot } from './state-paths.js';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** [ISO-3] MONAD_STATE_DIR 존중(lazy). */
export function repoWatchDbPath(): string { return join(monadStateRoot(), 'conatus/repo_watch.db'); }

/** 감시 대상 참조 repo — 대표 지시(hermes/openclaw/codex). owner/repo GitHub slug. */
export const WATCHED_REPOS = [
  { key: 'hermes', repo: 'nousresearch/hermes-agent', note: '에이전트 하니스 참조' },
  { key: 'openclaw', repo: 'openclaw/openclaw', note: '수집·크롤 참조' },
  { key: 'codex', repo: 'openai/codex', note: 'ultrawork·코딩 하니스 참조' },
] as const;

export interface CommitInfo { sha: string; date: string; msg: string }

/** 첫 폴링(last_sha 없음) 시 리포트에 담을 최대 커밋 수(홍수 방지). */
export const FIRST_POLL_CAP = 5;

// ──────────────────── 순수 로직 (diff·score·report) ─────────────────────

/** 새 커밋 추출 — commits 는 newest-first. last_sha 를 만나면 그 이전은 이미 본 것.
 *  last_sha=null(첫 폴링)이면 상위 FIRST_POLL_CAP 만(전체 히스토리 홍수 방지). */
export function diffNewCommits(commits: CommitInfo[], lastSha: string | null): CommitInfo[] {
  if (!lastSha) return commits.slice(0, FIRST_POLL_CAP);
  const out: CommitInfo[] = [];
  for (const c of commits) {
    if (c.sha.startsWith(lastSha) || lastSha.startsWith(c.sha)) break;
    out.push(c);
  }
  return out;
}

/** 흡수 관심도 휴리스틱 — monad 가 흡수할 가치가 있을 법한 커밋 키워드 매칭(0-5). */
export function absorptionScore(msg: string): number {
  const m = msg.toLowerCase();
  const kws = ['agent', 'loop', 'memory', 'tool', 'plan', 'goal', 'schedul', 'orchestr',
    'reason', 'context', 'retriev', 'recall', 'triage', 'autonom', 'mcp'];
  let s = 0;
  for (const k of kws) if (m.includes(k)) s++;
  return Math.min(5, s);
}

/** 흡수 제안 리포트(markdown) — repo별 새 커밋 + 관심도 정렬. 빈 커밋=null. */
export function renderAbsorptionReport(repoKey: string, repo: string, newCommits: CommitInfo[]): string | null {
  if (newCommits.length === 0) return null;
  const scored = newCommits
    .map(c => ({ ...c, score: absorptionScore(c.msg) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.filter(c => c.score >= 2).slice(0, 8);
  const lines = (top.length ? top : scored.slice(0, 5)).map(
    c => `- ${'★'.repeat(c.score)}${c.score === 0 ? '·' : ''} \`${c.sha.slice(0, 7)}\` ${c.msg.slice(0, 90)}`,
  );
  const hi = scored.filter(c => c.score >= 3).length;
  return [
    `📥 [${repoKey}] ${repo} — 새 커밋 ${newCommits.length}건${hi ? ` · 흡수 후보 ${hi}건` : ''}`,
    ...lines,
    hi ? `\n흡수 검토 제안: 관심도 높은 ${hi}건 — 채택 시 PR 초안(HITL).` : '',
  ].filter(Boolean).join('\n');
}

// ──────────────────── IO (gh 폴링·상태 db) ──────────────────────────────

export function openRepoWatchDb(path: string = repoWatchDbPath()): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(`CREATE TABLE IF NOT EXISTS repo_state(
    repo TEXT PRIMARY KEY, last_sha TEXT, last_seen TEXT, last_new INT DEFAULT 0
  )`);
  return db;
}

export function getLastSha(db: Database, repo: string): string | null {
  const row = db.prepare(`SELECT last_sha FROM repo_state WHERE repo=?`).get(repo) as { last_sha: string | null } | undefined;
  return row?.last_sha ?? null;
}

export function setRepoState(db: Database, repo: string, sha: string, newCount: number, now: string): void {
  db.run(`INSERT INTO repo_state(repo, last_sha, last_seen, last_new) VALUES (?,?,?,?)
          ON CONFLICT(repo) DO UPDATE SET last_sha=excluded.last_sha, last_seen=excluded.last_seen, last_new=excluded.last_new`,
    [repo, sha, now, newCount]);
}

/** gh api 로 최근 커밋 조회(READ-ONLY). 주입 runGh 로 테스트 가능. 실패=[]. */
export type RunGh = (args: string[]) => string;
const defaultRunGh: RunGh = (args) => execFileSync('gh', args, { encoding: 'utf-8', timeout: 20_000 });

export function fetchCommits(repo: string, deps: { runGh?: RunGh } = {}): CommitInfo[] {
  const runGh = deps.runGh ?? defaultRunGh;
  try {
    const out = runGh(['api', `repos/${repo}/commits?per_page=30`,
      '--jq', '.[] | {sha: .sha, date: .commit.author.date, msg: (.commit.message | split("\n")[0])}']);
    return out.trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as CommitInfo);
  } catch {
    return [];
  }
}

export interface RepoWatchDeps {
  runGh?: RunGh;
  db?: Database;
  now?: () => string;
  /** 흡수 제안 리포트 발송(선택·기본 없음). */
  notify?: (report: string) => void;
  /** 자율행동 기록(선택·기본 없음). */
  record?: (input: { action: string; rationale: string; outcome: string; refs?: Record<string, unknown> }) => void;
}

export interface RepoWatchResult {
  repo: string; key: string; newCommits: number; report: string | null;
}

/** 감시 1사이클 — 전 repo 폴링 → 새 커밋 diff → 상태 갱신 → 리포트/기록. */
export function runRepoWatchCycle(deps: RepoWatchDeps = {}): RepoWatchResult[] {
  const db = deps.db ?? openRepoWatchDb();
  const ownDb = !deps.db;
  const now = deps.now?.() ?? new Date().toISOString();
  const results: RepoWatchResult[] = [];
  try {
    for (const { key, repo } of WATCHED_REPOS) {
      const commits = fetchCommits(repo, { ...(deps.runGh ? { runGh: deps.runGh } : {}) });
      if (commits.length === 0) { results.push({ repo, key, newCommits: 0, report: null }); continue; }
      const lastSha = getLastSha(db, repo);
      const fresh = diffNewCommits(commits, lastSha);
      const report = renderAbsorptionReport(key, repo, fresh);
      setRepoState(db, repo, commits[0]!.sha, fresh.length, now);
      results.push({ repo, key, newCommits: fresh.length, report });
      if (report) {
        deps.notify?.(report);
        deps.record?.({
          action: `[${key}] ${repo} 새 커밋 ${fresh.length}건 감지`,
          rationale: 'repo watching — 참조 에이전트 변경 감시(self-improving 흡수 후보)',
          outcome: `흡수 후보 ${fresh.filter(c => absorptionScore(c.msg) >= 3).length}건 제안(HITL 채택 대기)`,
          refs: { repo, headSha: commits[0]!.sha },
        });
      }
    }
    return results;
  } finally {
    if (ownDb) db.close();
  }
}
