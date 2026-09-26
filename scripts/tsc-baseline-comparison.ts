import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { debug } from '../src/debug/log.js';
import { parseTypecheckErrors, type TypecheckError } from '../src/typecheck-ratchet.js';

export interface NormalizedDiagnostic { file: string; code: string; message: string; }
export type ComparisonOutcome =
  | { kind: 'clean'; added: NormalizedDiagnostic[]; removed: NormalizedDiagnostic[] }
  | { kind: 'removed-only'; added: NormalizedDiagnostic[]; removed: NormalizedDiagnostic[] }
  | { kind: 'added'; added: NormalizedDiagnostic[]; removed: NormalizedDiagnostic[] }
  | { kind: 'unavailable'; reason: string };
export interface ReportedOutcome { exitCode: number; lines: string[]; }
export interface CommandResult { status: number | null; signal?: NodeJS.Signals | null; stdout: string; stderr: string; error?: Error; }
export type CommandRunner = (command: string, args: string[], cwd: string, signal?: AbortSignal) => Promise<CommandResult>;
export interface ComparisonFilesystem {
  exists(path: string): boolean;
  makeTemp(prefix: string): string;
  read(path: string): string;
  link(source: string, destination: string): void;
  remove(path: string): void;
}

const filesystem: ComparisonFilesystem = {
  exists: existsSync,
  makeTemp: (prefix) => mkdtempSync(prefix),
  read: (path) => readFileSync(path, 'utf8'),
  link: (source, destination) => symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir'),
  remove: (path) => rmSync(path, { recursive: true, force: true }),
};
const scriptPath = fileURLToPath(import.meta.url);
let activeCleanup: WorktreeCleanup | undefined;

function diagnosticKey(diagnostic: NormalizedDiagnostic): string {
  return JSON.stringify([diagnostic.file, diagnostic.code, diagnostic.message]);
}
function normalizeDiagnostic(error: TypecheckError & { message?: string }, root: string): NormalizedDiagnostic {
  const match = error.line.match(/^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):\s+([^\n]*)$/);
  if (!match) throw new Error(`Unparseable TypeScript diagnostic: ${error.line}`);
  return {
    file: relative(root, resolve(root, match[1]!)).replaceAll('\\', '/'),
    code: match[2]!,
    message: (error.message ?? match[3]!).trim(),
  };
}
/** Converts parsed tsc errors to comparable identities without source coordinates, preserving every duplicate. */
export function normalizeDiagnostics(errors: readonly (TypecheckError & { message?: string })[], root: string): NormalizedDiagnostic[] {
  return errors.map((error) => normalizeDiagnostic(error, root));
}
function multisetDifference(left: readonly NormalizedDiagnostic[], right: readonly NormalizedDiagnostic[]): NormalizedDiagnostic[] {
  const remaining = new Map<string, number>();
  for (const diagnostic of right) remaining.set(diagnosticKey(diagnostic), (remaining.get(diagnosticKey(diagnostic)) ?? 0) + 1);
  const difference: NormalizedDiagnostic[] = [];
  for (const diagnostic of left) {
    const key = diagnosticKey(diagnostic);
    const count = remaining.get(key) ?? 0;
    if (count === 0) difference.push(diagnostic);
    else remaining.set(key, count - 1);
  }
  return difference;
}
export function compareDiagnostics(mine: readonly NormalizedDiagnostic[], baseline: readonly NormalizedDiagnostic[]): ComparisonOutcome {
  const added = multisetDifference(mine, baseline);
  const removed = multisetDifference(baseline, mine);
  return added.length ? { kind: 'added', added, removed } : removed.length ? { kind: 'removed-only', added, removed } : { kind: 'clean', added, removed };
}
export function unavailableOutcome(reason: string): ComparisonOutcome { return { kind: 'unavailable', reason }; }
function formatDiagnostics(label: string, diagnostics: readonly NormalizedDiagnostic[]): string[] {
  return [`[tsc-baseline] ${label}:`, ...diagnostics.map((diagnostic) => `  ${diagnostic.file}: ${diagnostic.code}: ${diagnostic.message}`)];
}
export function reportOutcome(outcome: ComparisonOutcome): ReportedOutcome {
  switch (outcome.kind) {
    case 'clean': return { exitCode: 0, lines: ['[tsc-baseline] CLEAN — no diagnostics were added.'] };
    case 'removed-only': return { exitCode: 0, lines: [`[tsc-baseline] CLEAN — no diagnostics were added; ${outcome.removed.length} diagnostic(s) removed.`, ...formatDiagnostics('Removed diagnostics', outcome.removed)] };
    case 'added': return { exitCode: 1, lines: [`[tsc-baseline] ADDED — ${outcome.added.length} diagnostic(s) added.`, ...formatDiagnostics('Added diagnostics', outcome.added), ...(outcome.removed.length ? formatDiagnostics('Informational removed diagnostics', outcome.removed) : [])] };
    case 'unavailable': return { exitCode: 2, lines: [`[tsc-baseline] UNAVAILABLE — comparison was not made: ${outcome.reason}`] };
  }
}

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* already exited */ }
  }
}
export function runCommand(command: string, args: string[], cwd: string, signal?: AbortSignal, killTimeoutMs = 5_000): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolveResult({ status: null, stdout: '', stderr: '', error: error instanceof Error ? error : new Error(String(error)) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let spawnError: Error | undefined;
    let interrupted = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const abort = () => {
      if (interrupted) return;
      interrupted = true;
      signalProcess(child, 'SIGTERM');
      forceTimer = setTimeout(() => signalProcess(child, 'SIGKILL'), killTimeoutMs);
      forceTimer.unref?.();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (status, exitSignal) => {
      if (forceTimer) clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      resolveResult({
        status,
        signal: exitSignal,
        stdout,
        stderr,
        ...(spawnError ? { error: spawnError } : interrupted ? { error: new Error(`${command} interrupted`) } : {}),
      });
    });
  });
}
function detail(result: CommandResult): string {
  return result.error?.message ?? (result.stderr.trim() || result.stdout.trim() || `exit ${String(result.status)}`);
}
async function requireSuccess(step: string, result: Promise<CommandResult>): Promise<void> {
  const value = await result;
  if (value.error || value.status !== 0) throw new Error(`${step} failed: ${detail(value)}`);
}
function baselineBranch(argv: readonly string[]): string {
  const index = argv.indexOf('--baseline');
  const branch = (index >= 0 ? argv[index + 1] : process.env.TSC_BASELINE_REF) || 'main';
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('/') || branch.endsWith('/')) throw new Error(`invalid baseline branch: ${branch}`);
  return branch.replace(/^origin\//, '');
}
function registeredWorktrees(output: string): string[] {
  return output.split('\n').flatMap((line) => line.startsWith('worktree ') ? [line.slice('worktree '.length)] : []);
}

export class WorktreeCleanup {
  private cleanupPromise: Promise<void> | undefined;
  constructor(private readonly repo: string, private readonly workspace: string, private readonly worktree: string, private readonly run: CommandRunner, private readonly fs: ComparisonFilesystem) {}
  async cleanup(): Promise<void> {
    if (!this.cleanupPromise) this.cleanupPromise = this.cleanupImpl();
    return this.cleanupPromise;
  }
  private async cleanupImpl(): Promise<void> {
    const failures: string[] = [];
    const remove = await this.run('git', ['worktree', 'remove', '--force', this.worktree], this.repo);
    if (remove.error || remove.status !== 0) failures.push(`remove: ${detail(remove)}`);
    try { this.fs.remove(this.worktree); } catch (error) { failures.push(`filesystem remove: ${error instanceof Error ? error.message : String(error)}`); }
    const prune = await this.run('git', ['worktree', 'prune', '--expire', 'now'], this.repo);
    if (prune.error || prune.status !== 0) failures.push(`prune: ${detail(prune)}`);
    try { this.fs.remove(this.workspace); } catch (error) { failures.push(`workspace remove: ${error instanceof Error ? error.message : String(error)}`); }
    const list = await this.run('git', ['worktree', 'list', '--porcelain'], this.repo);
    const listFailed = Boolean(list.error || list.status !== 0);
    if (listFailed) failures.push(`verification list: ${detail(list)}`);
    const stillRegistered = !listFailed && registeredWorktrees(list.stdout).some((path) => resolve(path) === resolve(this.worktree));
    const leaked = stillRegistered || this.fs.exists(this.worktree) || this.fs.exists(this.workspace);
    if (leaked || listFailed || (prune.error || prune.status !== 0)) {
      throw new Error(`baseline worktree cleanup failed for ${this.worktree}: ${failures.join('; ') || 'worktree remains registered'}`);
    }
  }
}

interface SerializedDiagnostic { line: string; message: string; }
interface SerializedMeasurement { version: 1; diagnostics: SerializedDiagnostic[]; }
function isSerializedDiagnostic(value: unknown): value is SerializedDiagnostic {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.line === 'string' && typeof candidate.message === 'string' && Object.keys(candidate).every((key) => key === 'line' || key === 'message');
}
export function parseTypecheckMeasurement(output: string, root: string): NormalizedDiagnostic[] {
  let value: unknown;
  try { value = JSON.parse(output); } catch { throw new Error('typecheck produced non-JSON output'); }
  if (!value || typeof value !== 'object') throw new Error('typecheck produced an invalid measurement envelope');
  const envelope = value as Partial<SerializedMeasurement> & Record<string, unknown>;
  if (envelope.version !== 1 || !Array.isArray(envelope.diagnostics) || !envelope.diagnostics.every(isSerializedDiagnostic) || Object.keys(envelope).some((key) => key !== 'version' && key !== 'diagnostics')) {
    throw new Error('typecheck produced an invalid measurement envelope');
  }
  return envelope.diagnostics.map((diagnostic) => {
    const parsed = parseTypecheckErrors(diagnostic.line);
    if (parsed.length !== 1 || parsed[0]!.line !== diagnostic.line) throw new Error(`typecheck produced an unsupported diagnostic: ${diagnostic.line}`);
    return normalizeDiagnostic({ ...parsed[0]!, message: diagnostic.message }, root);
  });
}
async function emitTypecheckMeasurement(root: string): Promise<void> {
  const compilerPath = join(root, 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (!existsSync(compilerPath)) throw new Error(`TypeScript compiler dependency is missing at ${compilerPath}`);
  const ts = await import(pathToFileURL(compilerPath).href) as typeof import('typescript');
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error(`tsconfig.json was not found under ${root}`);
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath), { noEmit: true }, configPath);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences }))];
  const serialized: SerializedDiagnostic[] = diagnostics.map((diagnostic) => {
    if (!diagnostic.file || diagnostic.start === undefined) throw new Error(`unsupported global TypeScript diagnostic TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    const firstLine = message.split('\n', 1)[0]!;
    return { line: `${diagnostic.file.fileName}(${position.line + 1},${position.character + 1}): error TS${diagnostic.code}: ${firstLine}`, message };
  });
  const measurement: SerializedMeasurement = { version: 1, diagnostics: serialized };
  process.stdout.write(`${JSON.stringify(measurement)}\n`);
}
async function runTypecheck(cwd: string, run: CommandRunner, signal: AbortSignal): Promise<NormalizedDiagnostic[]> {
  const result = await run('bun', [scriptPath, '--emit-typecheck-json', cwd], cwd, signal);
  if (result.error || result.status !== 0) throw new Error(`typecheck in ${cwd} failed: ${detail(result)}`);
  if (result.stderr.trim()) throw new Error(`typecheck in ${cwd} produced unexpected stderr: ${result.stderr.trim()}`);
  try { return parseTypecheckMeasurement(result.stdout.trim(), cwd); }
  catch (error) { throw new Error(`typecheck in ${cwd} failed validation: ${error instanceof Error ? error.message : String(error)}`); }
}
function lockfilesMatch(repo: string, worktree: string, fs: ComparisonFilesystem): boolean {
  const current = join(repo, 'bun.lock');
  const baseline = join(worktree, 'bun.lock');
  return fs.exists(current) && fs.exists(baseline) && fs.read(current) === fs.read(baseline);
}
async function prepareDependencies(repo: string, worktree: string, run: CommandRunner, fs: ComparisonFilesystem, signal: AbortSignal): Promise<void> {
  const sameLockfile = lockfilesMatch(repo, worktree, fs);
  const baselineModules = join(worktree, 'node_modules');
  if (sameLockfile) {
    const currentModules = join(repo, 'node_modules');
    if (!fs.exists(currentModules)) throw new Error(`reuse baseline dependencies failed: ${currentModules} does not exist`);
    try { fs.link(currentModules, baselineModules); }
    catch (error) { throw new Error(`reuse baseline dependencies failed: ${error instanceof Error ? error.message : String(error)}`); }
    if (!fs.exists(baselineModules)) throw new Error('reuse baseline dependencies failed: node_modules link was not created');
    debug.log('typecheck.baseline', 'dependencies-reused', { evidence: 'bun.lock contents are byte-identical', source: currentModules, destination: baselineModules });
    return;
  }
  await requireSuccess('install baseline dependencies', run('bun', ['install', '--frozen-lockfile'], worktree, signal));
  if (!fs.exists(baselineModules)) throw new Error('install baseline dependencies failed: node_modules was not created');
  debug.log('typecheck.baseline', 'dependencies-installed', { evidence: 'bun.lock contents differ or one lockfile is absent', worktree });
}

export interface RunComparisonOptions { run?: CommandRunner; fs?: ComparisonFilesystem; signal?: AbortSignal; }
export async function runComparison(repo: string, argv: readonly string[] = process.argv.slice(2), options: RunComparisonOptions = {}): Promise<ComparisonOutcome> {
  const run = options.run ?? runCommand;
  const fs = options.fs ?? filesystem;
  const signal = options.signal ?? new AbortController().signal;
  let cleanup: WorktreeCleanup | undefined;
  let outcome: ComparisonOutcome;
  try {
    const branch = baselineBranch(argv);
    const remoteRef = `origin/${branch}`;
    await requireSuccess('fetch baseline ref', run('git', ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/${remoteRef}`], repo, signal));
    const resolved = await run('git', ['rev-parse', '--verify', `${remoteRef}^{commit}`], repo, signal);
    await requireSuccess('resolve baseline ref', Promise.resolve(resolved));
    const commit = resolved.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(commit)) throw new Error(`resolved baseline ref is not a commit: ${commit}`);
    debug.log('typecheck.baseline', 'baseline-resolved', { branch, remoteRef, commit });
    const workspace = fs.makeTemp(join(tmpdir(), 'elanous-tsc-baseline-'));
    const worktree = join(workspace, 'baseline');
    cleanup = new WorktreeCleanup(repo, workspace, worktree, run, fs);
    activeCleanup = cleanup;
    await requireSuccess('create baseline worktree', run('git', ['worktree', 'add', '--detach', worktree, commit], repo, signal));
    await prepareDependencies(repo, worktree, run, fs, signal);
    const baseline = await runTypecheck(worktree, run, signal);
    const mine = await runTypecheck(repo, run, signal);
    debug.log('typecheck.baseline', 'diagnostics-counted', { baseline: baseline.length, mine: mine.length });
    outcome = compareDiagnostics(mine, baseline);
  } catch (error) {
    outcome = unavailableOutcome(error instanceof Error ? error.message : String(error));
  }
  try {
    if (cleanup) await cleanup.cleanup();
  } catch (error) {
    const cleanupReason = error instanceof Error ? error.message : String(error);
    outcome = unavailableOutcome(outcome.kind === 'unavailable' ? `${outcome.reason}; additionally, ${cleanupReason}` : cleanupReason);
  } finally {
    if (activeCleanup === cleanup) activeCleanup = undefined;
  }
  debug.log('typecheck.baseline', 'verdict', outcome.kind === 'unavailable' ? { verdict: outcome.kind, reason: outcome.reason } : { verdict: outcome.kind, added: outcome.added.length, removed: outcome.removed.length });
  return outcome;
}

export interface SignalRegistrar {
  once(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  off(signal: 'SIGINT' | 'SIGTERM', handler: () => void): void;
}
export interface SignalCleanupOptions {
  abort(): void;
  waitForCommand(): Promise<void>;
  cleanup(): Promise<void>;
  exit(code: number): never;
  signals?: SignalRegistrar;
}
export function installSignalCleanup(options: SignalCleanupOptions): () => void {
  const signals = options.signals ?? process;
  let handling = false;
  const handle = (signal: 'SIGINT' | 'SIGTERM') => {
    if (handling) return;
    handling = true;
    options.abort();
    void options.waitForCommand()
      .then(() => options.cleanup())
      .catch((error) => console.error(`[tsc-baseline] shutdown after ${signal} failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => options.exit(signal === 'SIGINT' ? 130 : 143));
  };
  const interrupt = () => handle('SIGINT');
  const terminate = () => handle('SIGTERM');
  signals.once('SIGINT', interrupt);
  signals.once('SIGTERM', terminate);
  return () => { signals.off('SIGINT', interrupt); signals.off('SIGTERM', terminate); };
}

if (import.meta.main) {
  if (process.argv[2] === '--emit-typecheck-json') {
    await emitTypecheckMeasurement(resolve(process.argv[3] ?? process.cwd()));
  } else {
    const controller = new AbortController();
    let comparisonPromise: Promise<ComparisonOutcome> = Promise.resolve(unavailableOutcome('comparison did not start'));
    const removeSignalHandlers = installSignalCleanup({
      abort: () => controller.abort(),
      waitForCommand: async () => { await comparisonPromise; },
      cleanup: () => activeCleanup?.cleanup() ?? Promise.resolve(),
      exit: (code) => process.exit(code),
    });
    comparisonPromise = runComparison(process.cwd(), process.argv.slice(2), { signal: controller.signal });
    const outcome = await comparisonPromise;
    removeSignalHandlers();
    const report = reportOutcome(outcome);
    for (const line of report.lines) console.log(line);
    process.exitCode = report.exitCode;
  }
}
