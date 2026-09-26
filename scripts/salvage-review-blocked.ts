#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';

export interface CmdResult { ok: boolean; rc: number; out: string; err: string }
export type CmdRunner = (cmd: string, args: readonly string[]) => CmdResult;

export const LOG_WINDOWS = ['60m', '6h', '24h', '7d'] as const;
export const PR_LIST_LIMIT = 200;

export interface PullRequestCandidate {
  number: number;
  state: string;
  headRefName?: string;
  isDraft?: boolean;
}

export interface SalvageInput {
  branch: string;
  logMatches: readonly number[];
  openHeadPullRequests: readonly PullRequestCandidate[];
  exactRemoteRef: CmdResult;
  fetch: CmdResult;
  diff: CmdResult;
}

export type SalvageVerdict =
  | { status: 'search-logs'; since: typeof LOG_WINDOWS[number] }
  | { status: 'search-prs'; topic: string; limit: number; candidates: readonly PullRequestCandidate[] }
  | { status: 'blocked'; reason: 'logs-failed' | 'pr-search-failed' | 'pr-data-invalid' | 'open-pr-exists' | 'branch-missing' | 'branch-query-failed' | 'fetch-failed' | 'diff-failed' | 'empty-deliverable'; detail: string }
  | { status: 'ready'; branch: string; fetchRefspec: string };

/** 문서 §6b 인수 전 판정. 외부 명령 결과만 받아 부재·정확 ref·동일 head 열린 PR·산출 불변식을 순수하게 적용한다. */
export function decideSalvage(input: SalvageInput): SalvageVerdict {
  if (input.logMatches.length > 0 && input.logMatches.every((count) => count === 0)) {
    const nextWindow = LOG_WINDOWS[input.logMatches.length];
    return nextWindow
      ? { status: 'search-logs', since: nextWindow }
      : { status: 'search-prs', topic: '', limit: PR_LIST_LIMIT, candidates: [] };
  }
  if (input.logMatches.length === 0) return { status: 'search-logs', since: LOG_WINDOWS[0] };
  if (input.openHeadPullRequests.length > 0) {
    return {
      status: 'blocked',
      reason: 'open-pr-exists',
      detail: `open PR already exists for head ${input.branch}: ${input.openHeadPullRequests.map((pr) => `#${pr.number}`).join(', ')}`,
    };
  }
  if (!input.exactRemoteRef.ok) {
    return input.exactRemoteRef.rc === 2
      ? { status: 'blocked', reason: 'branch-missing', detail: `exact ref missing: refs/heads/${input.branch}` }
      : { status: 'blocked', reason: 'branch-query-failed', detail: input.exactRemoteRef.err || input.exactRemoteRef.out || `exact ref query failed with rc ${input.exactRemoteRef.rc}` };
  }
  if (!input.fetch.ok) {
    return { status: 'blocked', reason: 'fetch-failed', detail: input.fetch.err || input.fetch.out || 'fetch failed' };
  }
  if (!input.diff.ok) {
    return { status: 'blocked', reason: 'diff-failed', detail: input.diff.err || input.diff.out || 'git diff --stat failed' };
  }
  if (input.diff.out.trim().length === 0) {
    return { status: 'blocked', reason: 'empty-deliverable', detail: 'git diff --stat produced no files' };
  }
  return { status: 'ready', branch: input.branch, fetchRefspec: salvageFetchRefspec(input.branch) };
}

/** §6b의 `grep -iE "blocked|verdict|reason"`와 동등하게 일치한 원문 로그 줄을 보존한다. */
export function parseLogEvidence(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => /blocked|verdict|reason/i.test(line));
}

/** `gh pr list --json` 결과를 엄격히 검증한다. 빈 배열만 "같은 head PR 없음"이며 손상·스키마 불일치는 판정 불가다. */
export function parsePullRequestCandidates(json: string): PullRequestCandidate[] | { error: string } {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return { error: 'gh pr list returned malformed JSON' };
  }
  if (!Array.isArray(rows)) return { error: 'gh pr list JSON must be an array' };
  const candidates: PullRequestCandidate[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) return { error: 'gh pr list JSON row must be an object' };
    const candidate = row as Record<string, unknown>;
    if (!Number.isSafeInteger(candidate.number) || (candidate.number as number) <= 0 || typeof candidate.state !== 'string' || candidate.state.length === 0) {
      return { error: 'gh pr list JSON row requires positive integer number and non-empty string state' };
    }
    if (candidate.headRefName !== undefined && typeof candidate.headRefName !== 'string') return { error: 'gh pr list JSON headRefName must be a string' };
    if (candidate.isDraft !== undefined && typeof candidate.isDraft !== 'boolean') return { error: 'gh pr list JSON isDraft must be a boolean' };
    const number = candidate.number as number;
    const state = candidate.state as string;
    candidates.push({
      number,
      state,
      ...(candidate.headRefName === undefined ? {} : { headRefName: candidate.headRefName as string }),
      ...(candidate.isDraft === undefined ? {} : { isDraft: candidate.isDraft as boolean }),
    });
  }
  return candidates;
}

/** 부분 매칭 없이 원격 branch 존재를 물을 실제 인자. */
export function exactRemoteRefArgs(branch: string): readonly string[] {
  return ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${branch}`];
}

/** origin tracking ref를 항상 물질화하는 fetch refspec. */
export function salvageFetchRefspec(branch: string): string {
  return `+refs/heads/${branch}:refs/remotes/origin/${branch}`;
}

export function fetchArgs(branch: string): readonly string[] {
  return ['fetch', 'origin', salvageFetchRefspec(branch)];
}

export function diffArgs(branch: string): readonly string[] {
  return ['diff', '--stat', `origin/main...origin/${branch}`];
}

export function topicPrListArgs(topic: string): readonly string[] {
  return ['pr', 'list', '--state', 'all', '--search', topic, '--limit', String(PR_LIST_LIMIT), '--json', 'number,state,headRefName,isDraft'];
}

/** 동일 head의 열린 PR만 권위적으로 조회하는 인자. 빈 배열만 인수를 계속할 수 있다. */
export function openHeadPrListArgs(branch: string): readonly string[] {
  return ['pr', 'list', '--head', branch, '--state', 'open', '--limit', String(PR_LIST_LIMIT), '--json', 'number,state,headRefName,isDraft'];
}

export const defaultRunner: CmdRunner = (cmd, args) => {
  try {
    const result = spawnSync(cmd, [...args], { encoding: 'utf8', env: process.env });
    const rc = result.status ?? 1;
    return { ok: rc === 0, rc, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
  } catch (error) {
    return { ok: false, rc: 1, out: '', err: error instanceof Error ? error.message : String(error) };
  }
};

function blocked(reason: Extract<SalvageVerdict, { status: 'blocked' }>['reason'], result: CmdResult): SalvageVerdict {
  return { status: 'blocked', reason, detail: result.err || result.out || `${reason} command failed` };
}

function candidatesOrBlocked(result: CmdResult): PullRequestCandidate[] | SalvageVerdict {
  const parsed = parsePullRequestCandidates(result.out);
  return Array.isArray(parsed) ? parsed : { status: 'blocked', reason: 'pr-data-invalid', detail: parsed.error };
}

/** 외부 명령을 주입받아 §6b 절차를 실행하되 출력 부수효과 없이 verdict만 만든다. */
export function evaluateSalvageCli(runId: string, branch: string, topic: string, run: CmdRunner = defaultRunner): SalvageVerdict {
  const logMatches: number[] = [];
  for (const since of LOG_WINDOWS) {
    const logs = run('elanous', ['logs', '--grep', runId, '--since', since, '--test', '--limit', '40']);
    if (!logs.ok) return blocked('logs-failed', logs);
    const evidence = parseLogEvidence(logs.out);
    logMatches.push(evidence.length);
    if (evidence.length > 0) break;
  }

  if (logMatches.every((count) => count === 0)) {
    const prs = run('gh', topicPrListArgs(topic));
    const candidates = prs.ok ? candidatesOrBlocked(prs) : blocked('pr-search-failed', prs);
    return Array.isArray(candidates)
      ? { status: 'search-prs', topic, limit: PR_LIST_LIMIT, candidates }
      : candidates;
  }

  const openHeadPrs = run('gh', openHeadPrListArgs(branch));
  const openHeadPullRequests = openHeadPrs.ok ? candidatesOrBlocked(openHeadPrs) : blocked('pr-search-failed', openHeadPrs);
  if (!Array.isArray(openHeadPullRequests)) return openHeadPullRequests;

  const openPrVerdict = decideSalvage({
    branch,
    logMatches,
    openHeadPullRequests,
    exactRemoteRef: { ok: true, rc: 0, out: '', err: '' },
    fetch: { ok: true, rc: 0, out: '', err: '' },
    diff: { ok: true, rc: 0, out: 'pending open-PR validation', err: '' },
  });
  if (openPrVerdict.status === 'blocked') return openPrVerdict;

  const exactRemoteRef = run('git', exactRemoteRefArgs(branch));
  const exactVerdict = decideSalvage({
    branch,
    logMatches,
    openHeadPullRequests,
    exactRemoteRef,
    fetch: { ok: true, rc: 0, out: '', err: '' },
    diff: { ok: true, rc: 0, out: 'pending exact-ref validation', err: '' },
  });
  if (exactVerdict.status === 'blocked') return exactVerdict;

  const fetch = run('git', fetchArgs(branch));
  if (!fetch.ok) return blocked('fetch-failed', fetch);

  const diff = run('git', diffArgs(branch));
  if (!diff.ok) return blocked('diff-failed', diff);

  return decideSalvage({ branch, logMatches, openHeadPullRequests, exactRemoteRef, fetch, diff });
}

/** 얇은 CLI: 모든 성공·실패 verdict를 단일 출력 지점에서 stdout JSON 한 줄로 기록한다. */
export function runSalvageCli(runId: string, branch: string, topic: string, run: CmdRunner = defaultRunner): SalvageVerdict {
  const verdict = evaluateSalvageCli(runId, branch, topic, run);
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  return verdict;
}

if (import.meta.main) {
  const [runId, branch, topic] = process.argv.slice(2);
  if (!runId || !branch || !topic) {
    process.stderr.write('usage: bun scripts/salvage-review-blocked.ts <run-id> <branch> <topic>\n');
    process.exitCode = 2;
  } else {
    runSalvageCli(runId, branch, topic);
  }
}
