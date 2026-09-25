#!/usr/bin/env bun
/** Read-only auditor for every open pull request; it never changes pull-request state or metadata. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const DEFAULT_STALENESS_DAYS = 14;
export const OPEN_PULL_REQUEST_LIMIT = 200;
export type Classification = 'intentional-permanent' | 'conditional-hold' | 'recent' | 'stale';
export interface OpenPullRequest {
  readonly number: number;
  readonly title: string;
  readonly updatedAt: string;
  readonly labels: readonly string[];
  readonly isDraft: boolean;
  readonly headRefName: string;
}
export interface AuditRow { readonly pullRequest: OpenPullRequest; readonly classification: Classification; }
export interface GhResult { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: string; }
export type GhRunner = (args: readonly string[]) => GhResult;

export function parseThresholdDays(args: readonly string[]): number {
  const value = args.find(arg => arg.startsWith('--days='))?.slice('--days='.length);
  if (value === undefined) return DEFAULT_STALENESS_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0) throw new Error('--days must be a non-negative integer');
  return days;
}

export function openPullRequestListArgs(limit = OPEN_PULL_REQUEST_LIMIT): string[] {
  return ['gh', 'pr', 'list', '--state', 'open', '--limit', String(limit), '--json', 'number,title,updatedAt,labels,isDraft,headRefName'];
}

export function parseOpenPullRequests(output: string, limit = OPEN_PULL_REQUEST_LIMIT): OpenPullRequest[] {
  let rows: unknown;
  try { rows = JSON.parse(output); } catch { throw new Error('gh pr list returned malformed JSON'); }
  if (!Array.isArray(rows)) throw new Error('gh pr list JSON must be an array');
  if (rows.length >= limit) throw new Error(`gh pr list returned ${rows.length} rows at its ${limit} row limit, so the open pull request snapshot may be truncated`);
  return rows.map((row): OpenPullRequest => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('gh pr list JSON row must be an object');
    const candidate = row as Record<string, unknown>;
    const labels = candidate.labels;
    if (!Number.isSafeInteger(candidate.number) || (candidate.number as number) <= 0 || typeof candidate.title !== 'string' || typeof candidate.updatedAt !== 'string' || typeof candidate.isDraft !== 'boolean' || typeof candidate.headRefName !== 'string' || !Array.isArray(labels) || !labels.every(label => label !== null && typeof label === 'object' && typeof (label as { name?: unknown }).name === 'string')) {
      throw new Error('gh pr list JSON row requires number, title, updatedAt, labels, isDraft, and headRefName');
    }
    if (Number.isNaN(new Date(candidate.updatedAt).getTime())) throw new Error('gh pr list JSON row requires an ISO updatedAt');
    return { number: candidate.number as number, title: candidate.title, updatedAt: candidate.updatedAt, labels: labels.map(label => (label as { name: string }).name), isDraft: candidate.isDraft, headRefName: candidate.headRefName };
  });
}

const PERMANENT_MERGE_PROHIBITION = /\b(?:do not merge|never merge|not for merge|merge (?:is )?(?:forbidden|prohibited)|permanent)\b/i;
const KOREAN_PERMANENT_MERGE_PROHIBITION = /머지 금지|머지하지 마|병합 금지|상설/u;
const CONDITIONAL_HOLD = /^(?:⏸️|\[보류)/u;

function hasSignal(pullRequest: OpenPullRequest, signal: RegExp): boolean {
  return signal.test(pullRequest.title) || pullRequest.labels.some(label => signal.test(label));
}

export function isIntentionalPermanent(pullRequest: OpenPullRequest): boolean {
  return hasSignal(pullRequest, PERMANENT_MERGE_PROHIBITION) || hasSignal(pullRequest, KOREAN_PERMANENT_MERGE_PROHIBITION);
}

export function isConditionalHold(pullRequest: OpenPullRequest): boolean {
  return hasSignal(pullRequest, CONDITIONAL_HOLD);
}

export function classifyOpenPullRequests(pullRequests: readonly OpenPullRequest[], thresholdDays = DEFAULT_STALENESS_DAYS, clock = new Date()): AuditRow[] {
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return pullRequests.map(pullRequest => ({
    pullRequest,
    classification: isIntentionalPermanent(pullRequest)
      ? 'intentional-permanent'
      : isConditionalHold(pullRequest)
        ? 'conditional-hold'
        : clock.getTime() - new Date(pullRequest.updatedAt).getTime() > thresholdMs ? 'stale' : 'recent',
  }));
}

export function auditOpenPullRequests(run: GhRunner, thresholdDays = DEFAULT_STALENESS_DAYS, clock = new Date()): AuditRow[] {
  const result = run(openPullRequestListArgs());
  if (result.status !== 0) throw new Error(result.stderr || result.error || `gh pr list exited with ${result.status ?? 'no exit code'}`);
  return classifyOpenPullRequests(parseOpenPullRequests(result.stdout), thresholdDays, clock);
}

export function report(rows: readonly AuditRow[], thresholdDays = DEFAULT_STALENESS_DAYS, write: (line: string) => void = console.log): number {
  const named = (classification: Classification) => rows.filter(row => row.classification === classification).map(row => `#${row.pullRequest.number} ${row.pullRequest.title}`).join(' · ') || '없음';
  const count = (classification: Classification) => rows.filter(row => row.classification === classification).length;
  write(`open-pr-staleness · 임계 ${thresholdDays}일 · 의도적 상설 ${count('intentional-permanent')} · 조건부 보류 ${count('conditional-hold')} · 최근 ${count('recent')} · ⚠️ 정지 ${count('stale')}`);
  write(`의도적 상설 PR · ${named('intentional-permanent')}`);
  write(`조건부 보류 PR · ${named('conditional-hold')}`);
  write(`최근 PR · ${named('recent')}`);
  write(`⚠️ 정지 PR · ${named('stale')}`);
  return 0;
}

const ROOT = join(import.meta.dir, '..');
export function runGh(args: readonly string[]): GhResult {
  const result = spawnSync(args[0]!, args.slice(1), { cwd: ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', ...(result.error ? { error: result.error.message } : {}) };
}

export function runCli(args = process.argv.slice(2), run: GhRunner = runGh, write: (line: string) => void = console.log, clock = new Date()): number {
  try {
    const thresholdDays = parseThresholdDays(args);
    const rows = auditOpenPullRequests(run, thresholdDays, clock);
    return report(rows, thresholdDays, write);
  } catch (error) { write(`⛔ open-pr-staleness · 못 셌다 · ${error instanceof Error ? error.message : String(error)}`); return 1; }
}

if (import.meta.main) process.exit(runCli());
