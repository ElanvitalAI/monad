#!/usr/bin/env bun
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readAndRemeasureStoredReds, type ContractRedFreshnessReport, type FreshnessRecord } from './contract-red-freshness.js';

const DISPATCH_TASK_PREFIX = 'Fix the currently red contract test file ';
const DISPATCH_PR_MARKER_PREFIX = '<!-- contract-red-dispatch:file=';
const DISPATCH_PR_MARKER_SUFFIX = ' -->';

type DispatchStatus = 'dispatched' | 'no-candidates' | 'suppressed' | 'preflight-failed' | 'executor-failed' | 'state-persist-failed';
type FailureSource = 'preflight' | 'executor' | 'postflight';
type SuppressionReason = 'active-run' | 'open-pull-request' | 'recent-executor-failure';
type Eligibility = { status: 'eligible' } | { status: 'suppressed'; reason: SuppressionReason } | { status: 'unavailable'; error: string };
// 신선도에서 오는 네 수는 `null` 을 가질 수 있다 — 「세어 보니 0」과 「못 셌다」를 같은 값으로 두면
// 그 산출을 읽는 쪽이 둘을 영영 못 가른다. 상류 `contract-red-freshness` 도 같은 이유로 number|null 이다.
// selected·leftBehind·executorCalls 는 이 자리가 «항상» 아는 값이라 number 로 남는다.
type DispatchCounts = { candidates: number | null; stillRed: number | null; nowGreen: number | null; unmeasurable: number | null; selected: number; leftBehind: number; executorCalls: number };
export type ExecutorRequest = { file: string; task: string; pullRequestMarker: string; openPullRequest: true; autoMerge: false };
type ExecutorResult = { exitCode: number | null; stdout: string; stderr: string };
type ProcessRunner = (command: string[]) => Promise<ExecutorResult>;
type DispatchState = { activeFiles: string[]; openPullRequestFiles: string[]; recentExecutorFailureFiles: Record<string, string> };
type ContractRedDispatchReport = {
  status: DispatchStatus; failureSource: FailureSource | null; selected: string | null; counts: DispatchCounts;
  limitReached: boolean; executor: { request: ExecutorRequest; result: ExecutorResult } | null;
  suppression: SuppressionReason | null; error: string | null;
};
type DispatchDependencies = {
  execute: (request: ExecutorRequest) => Promise<ExecutorResult>;
  eligibility?: (file: string) => Promise<Eligibility>;
  beforeExecute?: (request: ExecutorRequest) => Promise<void>;
};
type CliDependencies = Partial<DispatchDependencies> & {
  readFreshness?: (path: string) => Promise<ContractRedFreshnessReport>;
  readState?: (path: string) => Promise<DispatchState>;
  writeState?: (path: string, state: DispatchState) => Promise<void>;
  openPullRequests?: (files: string[]) => Promise<string[]>;
  now?: () => Date;
  cooldownMs?: number;
  processRunner?: ProcessRunner;
  log?: (line: string) => void;
};

const DEFAULT_EXECUTOR_FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const emptyState = (): DispatchState => ({ activeFiles: [], openPullRequestFiles: [], recentExecutorFailureFiles: {} });
const unique = (files: string[]) => [...new Set(files)].sort((left, right) => left.localeCompare(right));
const without = (files: string[], file: string) => files.filter((value) => value !== file);
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function parseDispatchState(value: unknown): DispatchState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Partial<DispatchState>;
  const validFiles = (files: unknown): files is string[] => Array.isArray(files) && files.every((file) => typeof file === 'string' && file.length > 0);
  const validFailures = (failures: unknown): failures is Record<string, string> => failures !== null && typeof failures === 'object' && !Array.isArray(failures) && Object.entries(failures).every(([file, timestamp]) => file.length > 0 && typeof timestamp === 'string' && !Number.isNaN(new Date(timestamp).getTime()));
  return validFiles(state.activeFiles) && validFiles(state.openPullRequestFiles) && validFailures(state.recentExecutorFailureFiles)
    ? { activeFiles: unique(state.activeFiles), openPullRequestFiles: unique(state.openPullRequestFiles), recentExecutorFailureFiles: { ...state.recentExecutorFailureFiles } }
    : null;
}

export async function readDispatchState(path: string): Promise<DispatchState> {
  try {
    const state = parseDispatchState(JSON.parse(await readFile(path, 'utf8')));
    if (!state) throw new Error('dispatch state is malformed');
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw error;
  }
}

// ⛔ 제자리 덮어쓰기는 중간에 끊기면 «반쯤 쓴 JSON» 을 실제 경로에 남기고, 다음 기동은 그것을
//   malformed 로 읽어 억제 상태를 통째로 잃는다 ⇒ 이미 PR 이 열린 파일에 «또» 발화한다.
//   ⇒ 임시 경로에 다 쓴 뒤 rename 으로 «한 번에» 바꾼다. 쓰기가 도중에 죽으면 실제 경로는 «옛 내용 그대로»다.
//   ⭐ write 를 주입받는 이유는 그 성질을 «잴 수 있게» 하기 위해서다 — 중단을 주입해 옛 내용이 남는지 본다.
type StateFileWriter = (path: string, body: string) => Promise<void>;

export async function writeDispatchState(path: string, state: DispatchState, write: StateFileWriter = writeFile): Promise<void> {
  const body = `${JSON.stringify({ activeFiles: unique(state.activeFiles), openPullRequestFiles: unique(state.openPullRequestFiles), recentExecutorFailureFiles: state.recentExecutorFailureFiles })}\n`;
  const temporaryPath = `${path}.writing`;
  try {
    await write(temporaryPath, body);
    await rename(temporaryPath, path);
  } catch (error) {
    // ⛔ 잔해를 두면 「반쯤 쓴 파일이 안 남는다」가 «실제 경로에서만» 참이 된다 — 임시 경로에도 안 남겨야 한다.
    //   정리 자체가 실패해도 «원래 실패»를 가리지 않는다(그 사유가 진단의 본체다).
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function eligibilityFromState(state: DispatchState, file: string, now = new Date(), cooldownMs = DEFAULT_EXECUTOR_FAILURE_COOLDOWN_MS): Eligibility {
  if (state.activeFiles.includes(file)) return { status: 'suppressed', reason: 'active-run' };
  if (state.openPullRequestFiles.includes(file)) return { status: 'suppressed', reason: 'open-pull-request' };
  const failedAt = state.recentExecutorFailureFiles[file];
  if (failedAt && now.getTime() - new Date(failedAt).getTime() < cooldownMs) return { status: 'suppressed', reason: 'recent-executor-failure' };
  return { status: 'eligible' };
}

// report === null 은 「신선도를 못 읽었다」다 ⇒ 그 넷은 0 이 아니라 null.
function counts(report: ContractRedFreshnessReport | null, selected: number, leftBehind: number, executorCalls: number): DispatchCounts {
  return report === null
    ? { candidates: null, stillRed: null, nowGreen: null, unmeasurable: null, selected, leftBehind, executorCalls }
    : { candidates: report.candidates, stillRed: report.stillRed, nowGreen: report.nowGreen, unmeasurable: report.unmeasurable, selected, leftBehind, executorCalls };
}

function preflight(report: ContractRedFreshnessReport): string | null {
  if (!Array.isArray(report.files)) return 'freshness files are unavailable';
  for (const key of ['candidates', 'stillRed', 'nowGreen', 'unmeasurable'] as const) if (!Number.isInteger(report[key]) || report[key] < 0) return `freshness ${key} count is invalid`;
  if (report.candidates !== report.files.length) return 'freshness candidate count does not match files';
  if (report.stillRed !== report.files.filter((file) => file.status === 'still-red').length) return 'freshness still-red count does not match files';
  if (report.nowGreen !== report.files.filter((file) => file.status === 'now-green').length) return 'freshness now-green count does not match files';
  if (report.unmeasurable !== report.files.filter((file) => file.status === 'unmeasurable').length) return 'freshness unmeasurable count does not match files';
  return report.status !== 'ok' || report.unmeasurable !== 0 ? 'freshness report is not fully measurable' : null;
}

export function pullRequestMarkerFor(file: string): string {
  return `${DISPATCH_PR_MARKER_PREFIX}${encodeURIComponent(file)}${DISPATCH_PR_MARKER_SUFFIX}`;
}

function requestFor(file: FreshnessRecord): ExecutorRequest {
  const pullRequestMarker = pullRequestMarkerFor(file.file);
  return { file: file.file, task: `${DISPATCH_TASK_PREFIX}${file.file}. Open a pull request for the fix, but do not enable automatic merge. Include this exact marker in the pull request body: ${pullRequestMarker}`, pullRequestMarker, openPullRequest: true, autoMerge: false };
}

// ⛔ 상한을 «키워» 「안 닿게」 만드는 것은 완전한 스냅샷이 아니라 더 큰 임의의 상한일 뿐이다 —
//   그 자리엔 「닿았나」를 묻는 검사가 없어 조용히 잘린 목록을 「전부」로 읽는다.
//   ⇒ 상한을 «이름 있는 값»으로 두고, 그 값에 «닿았으면» 잘림으로 보고 던진다. 던진 것은
//     호출 사슬에서 eligibility 'unavailable' 로 실려 preflight 실패가 된다(= 억제 판정을 안 믿는다).
export const OPEN_PULL_REQUEST_LIST_LIMIT = 200;

export function openPullRequestListArgs(limit: number = OPEN_PULL_REQUEST_LIST_LIMIT): string[] {
  return ['gh', 'pr', 'list', '--state', 'open', '--limit', String(limit), '--json', 'body,state'];
}

function parseOpenPullRequestFiles(output: string, trackedFiles: string[], limit: number = OPEN_PULL_REQUEST_LIST_LIMIT): string[] {
  let rows: unknown;
  try { rows = JSON.parse(output); } catch { throw new Error('gh pr list returned malformed JSON'); }
  if (!Array.isArray(rows)) throw new Error('gh pr list JSON must be an array');
  // 「상한과 같은 수」는 「마침 그만큼」과 「더 있는데 잘렸다」를 구별할 수 없다 ⇒ 잘림으로 읽는다.
  if (rows.length >= limit) throw new Error(`gh pr list returned ${rows.length} rows at its ${limit} row limit, so the open pull request snapshot may be truncated`);
  const markers = new Map(trackedFiles.map((file) => [pullRequestMarkerFor(file), file]));
  const openFiles: string[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('gh pr list JSON row must be an object');
    const { body, state } = row as { body?: unknown; state?: unknown };
    if (typeof body !== 'string' || typeof state !== 'string') throw new Error('gh pr list JSON row requires string body and state');
    if (state !== 'OPEN') continue;
    for (const [marker, file] of markers) if (body.includes(marker)) openFiles.push(file);
  }
  return unique(openFiles);
}

export async function openContractRedPullRequests(files: string[], runner: ProcessRunner = bunProcessRunner, limit: number = OPEN_PULL_REQUEST_LIST_LIMIT): Promise<string[]> {
  const result = await runner(openPullRequestListArgs(limit));
  if (result.exitCode !== 0) throw new Error(result.stderr || `gh pr list exited with ${result.exitCode ?? 'no exit code'}`);
  return parseOpenPullRequestFiles(result.stdout, files, limit);
}

function reportFor(status: DispatchStatus, report: ContractRedFreshnessReport | null, options:{ failureSource?: FailureSource; selected?: string; leftBehind?: number; executorCalls?: number; executor?: ContractRedDispatchReport['executor']; suppression?: SuppressionReason; error?: string } = {}): ContractRedDispatchReport {
  const selected = options.selected ?? null;
  const leftBehind = options.leftBehind ?? 0;
  return { status, failureSource: options.failureSource ?? null, selected, counts: counts(report, selected === null ? 0 : 1, leftBehind, options.executorCalls ?? 0), limitReached: leftBehind > 0, executor: options.executor ?? null, suppression: options.suppression ?? null, error: options.error ?? null };
}

export async function dispatchContractRed(report: ContractRedFreshnessReport, dependencies: DispatchDependencies): Promise<ContractRedDispatchReport> {
  const error = preflight(report);
  if (error) return reportFor('preflight-failed', report, { failureSource: 'preflight', error });
  const candidates = report.files.filter((file) => file.status === 'still-red').sort((left, right) => left.file.localeCompare(right.file));
  if (candidates.length === 0) return reportFor('no-candidates', report);
  const request = requestFor(candidates[0]);
  const leftBehind = candidates.length - 1;
  let eligibility: Eligibility;
  try { eligibility = await dependencies.eligibility?.(request.file) ?? { status: 'eligible' }; }
  catch (caught) { return reportFor('preflight-failed', report, { failureSource: 'preflight', selected: request.file, leftBehind, error: message(caught) }); }
  if (eligibility.status === 'unavailable') return reportFor('preflight-failed', report, { failureSource: 'preflight', selected: request.file, leftBehind, error: eligibility.error });
  if (eligibility.status === 'suppressed') return reportFor('suppressed', report, { selected: request.file, leftBehind, suppression: eligibility.reason });
  try { await dependencies.beforeExecute?.(request); }
  catch (caught) { return reportFor('preflight-failed', report, { failureSource: 'preflight', selected: request.file, leftBehind, error: message(caught) }); }
  try {
    const result = await dependencies.execute(request);
    const executor = { request, result };
    return result.exitCode === 0
      ? reportFor('dispatched', report, { selected: request.file, leftBehind, executorCalls: 1, executor })
      : reportFor('executor-failed', report, { failureSource: 'executor', selected: request.file, leftBehind, executorCalls: 1, executor, error: result.stderr || `executor exited with ${result.exitCode ?? 'no exit code'}` });
  } catch (caught) {
    return reportFor('executor-failed', report, { failureSource: 'executor', selected: request.file, leftBehind, executorCalls: 1, error: message(caught) });
  }
}

async function bunProcessRunner(command: string[]): Promise<ExecutorResult> {
  const child = Bun.spawn({ cmd: command, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

export async function executeContractRedDev(request: ExecutorRequest, runner: ProcessRunner = bunProcessRunner): Promise<ExecutorResult> {
  return runner([process.execPath, 'bin/elanous.mjs', '--test', 'dev', '--open-pr', '--no-auto-merge', '--no-auto-review', request.task]);
}

export async function runContractRedDispatchCli(path: string | undefined = process.argv[2], dependencies: CliDependencies = {}): Promise<ContractRedDispatchReport> {
  if (!path) throw new Error('stored report path is required');
  let report: ContractRedFreshnessReport;
  try {
    report = await (dependencies.readFreshness ?? readAndRemeasureStoredReds)(path);
  } catch (caught) {
    // ⛔ 여기서 네 수를 0 으로 적으면 「빨강 후보가 0개였다」와 「신선도를 못 읽었다」가 같은 산출이 된다.
    const result = reportFor('preflight-failed', null, { failureSource: 'preflight', error: message(caught) });
    (dependencies.log ?? console.log)(JSON.stringify(result));
    return result;
  }
  const freshnessError = preflight(report);
  if (freshnessError) {
    const result = reportFor('preflight-failed', report, { failureSource: 'preflight', error: freshnessError });
    (dependencies.log ?? console.log)(JSON.stringify(result));
    return result;
  }
  if (report.files.every((file) => file.status !== 'still-red')) {
    const result = reportFor('no-candidates', report);
    (dependencies.log ?? console.log)(JSON.stringify(result));
    return result;
  }
  const statePath = `${path}.dispatch-state.json`;
  const readState = dependencies.readState ?? readDispatchState;
  const writeState = dependencies.writeState ?? writeDispatchState;
  const log = dependencies.log ?? console.log;
  let state: DispatchState;
  try { state = await readState(statePath); }
  catch (caught) {
    const result = await dispatchContractRed(report, { execute: dependencies.execute ?? ((request) => executeContractRedDev(request, dependencies.processRunner)), eligibility: async () => ({ status: 'unavailable', error: message(caught) }) });
    log(JSON.stringify(result));
    return result;
  }
  try {
    const trackedFiles = report.files.filter((file) => file.status === 'still-red').map((file) => file.file);
    const openPullRequests = dependencies.openPullRequests ?? ((files: string[]) => openContractRedPullRequests(files, dependencies.processRunner));
    state = { ...state, openPullRequestFiles: unique(await openPullRequests(trackedFiles)) };
    await writeState(statePath, state);
  } catch (caught) {
    const result = await dispatchContractRed(report, { execute: dependencies.execute ?? ((request) => executeContractRedDev(request, dependencies.processRunner)), eligibility: async () => ({ status: 'unavailable', error: message(caught) }) });
    log(JSON.stringify(result));
    return result;
  }
  const execute = dependencies.execute ?? ((request: ExecutorRequest) => executeContractRedDev(request, dependencies.processRunner));
  const now = dependencies.now ?? (() => new Date());
  const result = await dispatchContractRed(report, {
    execute,
    beforeExecute: async (request) => {
      state = { ...state, activeFiles: unique([...state.activeFiles, request.file]) };
      await writeState(statePath, state);
    },
    eligibility: async (file) => eligibilityFromState(state, file, now(), dependencies.cooldownMs ?? DEFAULT_EXECUTOR_FAILURE_COOLDOWN_MS),
  });
  if (result.counts.executorCalls === 1 && result.selected) {
    const file = result.selected;
    const recentExecutorFailureFiles = { ...state.recentExecutorFailureFiles };
    if (result.status === 'executor-failed') recentExecutorFailureFiles[file] = now().toISOString();
    else delete recentExecutorFailureFiles[file];
    state = {
      activeFiles: without(state.activeFiles, file),
      openPullRequestFiles: result.status === 'dispatched' ? unique([...state.openPullRequestFiles, file]) : state.openPullRequestFiles,
      recentExecutorFailureFiles,
    };
    try { await writeState(statePath, state); }
    catch (caught) { result.status = 'state-persist-failed'; result.failureSource = 'postflight'; result.error = message(caught); }
  }
  log(JSON.stringify(result));
  return result;
}

// ⛔ 실패해도 0 으로 끝나면 이 입구를 «부르는 정기 작업»이 그 주기를 「성공」으로 적는다 —
//   그것이 이 PR 이 고치던 형태(측정 실패를 정상으로 보고)의 프로세스 판본이다.
//   ⭐ 다만 「빨강이 하나도 없었다」와 「억제됐다」는 실패가 «아니다» — 그 둘은 0 이다.
export function exitCodeFor(status: DispatchStatus): number {
  return status === 'dispatched' || status === 'no-candidates' || status === 'suppressed' ? 0 : 1;
}

if (import.meta.main) process.exitCode = exitCodeFor((await runContractRedDispatchCli()).status);
