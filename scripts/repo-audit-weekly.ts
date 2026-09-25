#!/usr/bin/env bun
/** 주간 사후 감사 세 자를 한 장으로 요약한다. 등록은 이 스크립트 밖의 실행 경계다. */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const AUDITORS = [
  { name: 'goal-marker-population', path: 'scripts/goal-marker-population.ts', args: (day: string) => [day] },
  { name: 'commit-claim-audit', path: 'scripts/commit-claim-audit.ts', args: () => ['--since', '7 days ago'] },
  { name: 'goal-method-audit', path: 'scripts/goal-method-audit.ts', args: () => [] },
  { name: 'parked-still-broken', path: 'scripts/parked-still-broken.ts', args: () => [] },
  { name: 'open-pr-staleness', path: 'scripts/open-pr-staleness.ts', args: () => [] },
  { name: 'graph-declaration-loss', path: 'scripts/graph-declaration-loss.ts', args: () => [] },
  { name: 'ad-reader-no-writer', path: 'scripts/ad-reader-no-writer.ts', args: () => [] },
] as const;
export type AuditName = typeof AUDITORS[number]['name'];

export interface ChildResult { readonly status: number | null; readonly signal?: NodeJS.Signals | null; readonly stdout: string; readonly stderr: string; readonly error?: string; }
export interface AuditSummary { readonly name: AuditName; readonly exitCode: number | null; readonly keyNumbers: string; readonly failed: boolean; }
export type ChildRunner = (path: string, args: readonly string[]) => ChildResult;

const ROOT = join(import.meta.dir, '..');
export function today(clock = new Date()): string { return clock.toISOString().slice(0, 10); }
export function runChild(path: string, args: readonly string[]): ChildResult {
  const child = spawnSync(process.execPath, [join(ROOT, path), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: child.status, signal: child.signal, stdout: child.stdout ?? '', stderr: child.stderr ?? '', ...(child.error ? { error: child.error.message } : {}) };
}
function compact(value: string): string { return value.replace(/\s+/g, ' ').trim(); }

export function extractKeyNumbers(name: AuditName, stdout: string): string {
  const lines = stdout.split(/\r?\n/);
  if (name === 'goal-marker-population') {
    const row = lines.find(line => /^\d{4}-\d{2}-\d{2}\s+\d/.test(line));
    const values = row?.replace(/^\d{4}-\d{2}-\d{2}\s+/, '').match(/\d+/g) ?? [];
    return values.length > 0 ? `카운트 ${values.join(' · ')}` : '보고 수 없음';
  }
  if (name === 'commit-claim-audit') {
    const match = stdout.match(/훑은 커밋\s+(\d+)\s+·\s+⚠️ 적발\s+(\d+)/u);
    return match ? `훑은 커밋 ${match[1]} · 적발 ${match[2]}` : '보고 수 없음';
  }
  if (name === 'parked-still-broken') {
    const match = stdout.match(/지금 통과 (\d+) · 지금도 실패 (\d+) · 골 문서 없음 (\d+) · 대상 시험 없음 (\d+) · 시험 실행 불가 (\d+)/u);
    return match ? `통과 ${match[1]} · 실패 ${match[2]} · 문서 없음 ${match[3]} · 시험 없음 ${match[4]} · 실행 불가 ${match[5]}` : '보고 수 없음';
  }
  if (name === 'open-pr-staleness') {
    const match = stdout.match(/^open-pr-staleness · 임계 (\d+)일 · 의도적 상설 (\d+) · 조건부 보류 (\d+) · 최근 (\d+) · ⚠️ 정지 (\d+)\s*$/mu);
    return match ? `임계 ${match[1]}일 · 상설 ${match[2]} · 조건부 보류 ${match[3]} · 최근 ${match[4]} · 정지 ${match[5]}` : '보고 수 없음';
  }
  if (name === 'graph-declaration-loss') {
    const match = stdout.match(/graph-declaration-loss · scanned files (\d+) · graphs (\d+) · nodes (\d+) · discarded fields (\d+) · unknown node keys (\d+) · unreadable files (\d+)/u);
    return match ? `파일 ${match[1]} · 그래프 ${match[2]} · 노드 ${match[3]} · 버린 칸 ${match[4]} · 모르는 키 ${match[5]} · 못 읽음 ${match[6]}` : '보고 수 없음';
  }
  if (name === 'ad-reader-no-writer') {
    const match = stdout.match(/ad-reader-no-writer · suspects (\d+).*?blindSpots: \{ spreadSupplied: (\d+) \}/su);
    return match ? `의심 ${match[1]} · 식별자 spread 사각 ${match[2]}` : '보고 수 없음';
  }
  const axes = lines.filter(line => /^축[①②③]/u.test(line)).map(line => compact(line.replace(/^축[①②③][^—]*—\s*/u, '')));
  return axes.length > 0 ? axes.join(' / ') : '보고 수 없음';
}
function format(summary: AuditSummary, child: ChildResult): string {
  if (!summary.failed) return `✅ ${summary.name} · 종료 코드 0 · 핵심 수 ${summary.keyNumbers}`;
  const status = summary.exitCode === null
    ? child.signal ? `신호 ${child.signal}로 종료(종료 코드 없음)` : child.error ? '실행 불가(종료 코드 없음)' : '종료 코드 없음'
    : `종료 코드 ${summary.exitCode}`;
  const detail = compact(child.error ?? child.stderr) || '오류 세부 없음';
  return `⛔ ${summary.name} · ${status} · 핵심 수 ${summary.keyNumbers} · 실패: ${detail}`;
}

export function runWeeklyAudit(run: ChildRunner = runChild, write: (line: string) => void = console.log, clock = new Date()): readonly AuditSummary[] {
  const summaries: AuditSummary[] = [];
  const day = today(clock);
  write(`📋 주간 저장소 사후 감사 — 기준일 ${day}`);
  for (const auditor of AUDITORS) {
    let child: ChildResult;
    try { child = run(auditor.path, auditor.args(day)); }
    catch (error) { child = { status: null, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error) }; }
    const summary: AuditSummary = { name: auditor.name, exitCode: child.status, keyNumbers: extractKeyNumbers(auditor.name, child.stdout), failed: child.status !== 0 || child.error !== undefined };
    summaries.push(summary);
    write(format(summary, child));
  }
  return summaries;
}

export function selfCheck(write: (line: string) => void = console.log): number {
  const synthetic: Record<string, ChildResult> = {
    'scripts/goal-marker-population.ts': { status: 0, stdout: '2026-09-01     4      3        2      1        0        0         1        0\n', stderr: '' },
    'scripts/commit-claim-audit.ts': { status: 1, stdout: '훑은 커밋 12 · ⚠️ 적발 2\n', stderr: 'fixture failure\nsecond line' },
    'scripts/goal-method-audit.ts': { status: 0, stdout: '축① 로직화 — 조항 5 · ⛔ §0 판정이 «없는» 조항 1\n축② 사람 칸 — 조항 5 · 칸에 «걸린» 조항 4\n', stderr: '' },
    'scripts/parked-still-broken.ts': { status: 0, stdout: 'parked-still-broken · 지금 통과 1 · 지금도 실패 1 · 골 문서 없음 1 · 대상 시험 없음 1 · 시험 실행 불가 1\n', stderr: '' },
    'scripts/open-pr-staleness.ts': { status: 0, stdout: 'open-pr-staleness · 임계 14일 · 의도적 상설 2 · 조건부 보류 0 · 최근 1 · ⚠️ 정지 0\n', stderr: '' },
    'scripts/graph-declaration-loss.ts': { status: 0, stdout: 'graph-declaration-loss · scanned files 9 · graphs 6 · nodes 54 · discarded fields 206 · unknown node keys 0 · unreadable files 0\n', stderr: '' },
    'scripts/ad-reader-no-writer.ts': { status: 0, stdout: 'ad-reader-no-writer · suspects 3 · collectGroundingFacts, negativePromptPresent, safeAreaViolations\nblindSpots: { spreadSupplied: 1 }\n', stderr: '' },
  };
  const lines: string[] = [];
  const results = runWeeklyAudit((path) => synthetic[path]!, line => { lines.push(line); write(line); }, new Date('2026-09-01T12:00:00Z'));
  const successSeen = results.filter(result => !result.failed).length === AUDITORS.length - 1;
  const failureSeen = results.some(result => result.name === 'commit-claim-audit' && result.failed);
  const continued = results.length === AUDITORS.length && results.at(-1)?.name === AUDITORS.at(-1)?.name;
  const oneLine = lines.every(line => !line.includes('\n'));
  const pass = successSeen && failureSeen && continued && oneLine;
  write(`${pass ? '✅' : '⛔'} 합성 성공 갈래 ${successSeen ? '통과' : '실패'} · 합성 실패 갈래 ${failureSeen ? '통과' : '실패'} · fail-open 계속 ${continued ? '통과' : '실패'}`);
  return pass ? 0 : 1;
}

if (import.meta.main) process.exit(process.argv.includes('--self-check') ? selfCheck() : (runWeeklyAudit().some(result => result.failed) ? 1 : 0));
