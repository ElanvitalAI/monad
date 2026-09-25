#!/usr/bin/env bun
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const DEFAULT_AXES = ['src/harness', 'src/self-dev', 'src/self-implement', 'src/agent-substrate', 'src/git-fs'] as const;

export type RunnerResult = { stdout: string; stderr: string; exitCode: number | null; signal?: string | null };
export type FileRunner = (file: string) => Promise<RunnerResult>;
export type FileDiscoverer = (axis: string) => Promise<string[]>;
export type TrackedTestFileDiscoverer = () => Promise<string[]>;
export type FileStatus = 'green' | 'red' | 'unmeasurable';

export type TrackedTestFiles =
  | { status: 'available'; files: string[] }
  | { status: 'unavailable'; error: string };

export type TrackedTestFilesUnavailable = { status: 'unavailable'; error: string };

export interface ContractRedSweepScope {
  axes: string[];
  observedFiles: number;
  trackedTestFiles: number | TrackedTestFilesUnavailable;
  unobservedFiles: number | TrackedTestFilesUnavailable;
  excludedFiles: number | TrackedTestFilesUnavailable;
}

export type FileResult = {
  file: string;
  status: FileStatus;
  pass: number | null;
  fail: number | null;
  exitCode: number | null;
  error?: string;
};

export type Discovery =
  | { status: 'ok'; files: string[] }
  | { status: 'empty'; files: [] }
  | { status: 'failed'; error: string };

export interface ContractRedSweepReport {
  createdAt: string;
  discovery: Discovery;
  status: 'ok' | 'empty' | 'failed' | 'limit-reached';
  files: FileResult[];
  filesScanned: number;
  redFiles: number;
  unmeasurableFiles: number;
  scope: ContractRedSweepScope;
  limit?: number;
}

export function parseTestSummary(output: string): { pass: number; fail: number } | null {
  const matches = [...output.matchAll(/(\d+)\s+pass\s*\n\s*(\d+)\s+fail/g)];
  if (matches.length !== 1) return null;
  return { pass: Number(matches[0][1]), fail: Number(matches[0][2]) };
}

export async function discoverTestFiles(axis: string): Promise<string[]> {
  const walk = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
    }));
    return nested.flat();
  };
  return walk(axis);
}

export async function runBunTest(file: string): Promise<RunnerResult> {
  const child = Bun.spawn({ cmd: [process.execPath, 'test', file], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

export async function discoverTrackedTestFiles(): Promise<string[]> {
  // git-spawn-allow: measurement-only read-only enumeration of tracked test files.
  const child = Bun.spawn({ cmd: ['git', 'ls-files', '--', '*.test.ts'], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(stderr.trim() || `git ls-files exited with ${exitCode}`);
  return stdout.split('\n').filter(Boolean);
}

export function selectTrackedTestFiles(
  discoveredFiles: readonly string[],
  tracked: TrackedTestFiles,
): { files: string[]; excludedFiles: number | TrackedTestFilesUnavailable } {
  const discoveredByPath = new Map<string, string>();
  for (const file of discoveredFiles) discoveredByPath.set(resolve(file), file);
  const uniqueDiscovered = [...discoveredByPath.entries()].sort(([left], [right]) => left.localeCompare(right));
  if (tracked.status === 'unavailable') {
    return { files: uniqueDiscovered.map(([, file]) => file), excludedFiles: { status: 'unavailable', error: tracked.error } };
  }
  const trackedFiles = new Set(tracked.files.map((file) => resolve(file)));
  const files = uniqueDiscovered.filter(([path]) => trackedFiles.has(path)).map(([, file]) => file);
  return { files, excludedFiles: uniqueDiscovered.length - files.length };
}

export function buildContractRedSweepScope(
  axes: readonly string[],
  discoveredFiles: readonly string[],
  tracked: TrackedTestFiles,
): ContractRedSweepScope {
  const normalizedAxes = [...new Set(axes)].sort();
  const eligible = selectTrackedTestFiles(discoveredFiles, tracked);
  const observed = new Set(eligible.files.map((file) => resolve(file)));
  if (tracked.status === 'unavailable') {
    const unavailable = { status: 'unavailable' as const, error: tracked.error };
    return { axes: normalizedAxes, observedFiles: observed.size, trackedTestFiles: unavailable, unobservedFiles: unavailable, excludedFiles: unavailable };
  }
  const trackedFiles = new Set(tracked.files.map((file) => resolve(file)));
  return {
    axes: normalizedAxes,
    observedFiles: observed.size,
    trackedTestFiles: trackedFiles.size,
    unobservedFiles: Math.max(0, trackedFiles.size - observed.size),
    excludedFiles: eligible.excludedFiles,
  };
}

export async function sweepContractReds(
  axes: readonly string[] = DEFAULT_AXES,
  io: { discover?: FileDiscoverer; run?: FileRunner; discoverTracked?: TrackedTestFileDiscoverer; limit?: number } = {},
): Promise<ContractRedSweepReport> {
  const createdAt = new Date().toISOString();
  const normalizedAxes = [...new Set(axes)].sort();
  const discover = io.discover ?? discoverTestFiles;
  const run = io.run ?? runBunTest;
  const discoverTracked = io.discoverTracked ?? discoverTrackedTestFiles;
  const discoveredResult = await Promise.allSettled([Promise.all(normalizedAxes.map(discover)), discoverTracked()]);
  const tracked: TrackedTestFiles = discoveredResult[1].status === 'fulfilled'
    ? { status: 'available', files: discoveredResult[1].value }
    : { status: 'unavailable', error: discoveredResult[1].reason instanceof Error ? discoveredResult[1].reason.message : String(discoveredResult[1].reason) };
  if (discoveredResult[0].status === 'rejected') {
    const message = discoveredResult[0].reason instanceof Error ? discoveredResult[0].reason.message : String(discoveredResult[0].reason);
    return {
      createdAt,
      discovery: { status: 'failed', error: message },
      status: 'failed',
      files: [],
      filesScanned: 0,
      redFiles: 0,
      unmeasurableFiles: 0,
      scope: buildContractRedSweepScope(normalizedAxes, [], tracked),
    };
  }
  const unique = [...new Set(discoveredResult[0].value.flat())].sort();
  const eligible = selectTrackedTestFiles(unique, tracked);
  const scope = buildContractRedSweepScope(normalizedAxes, unique, tracked);
  if (eligible.files.length === 0) return { createdAt, discovery: { status: 'empty', files: [] }, status: 'empty', files: [], filesScanned: 0, redFiles: 0, unmeasurableFiles: 0, scope };
  const selected = io.limit === undefined ? eligible.files : eligible.files.slice(0, io.limit);
  const files: FileResult[] = [];
  for (const file of selected) {
    try {
      const result = await run(file);
      const summary = result.signal || result.exitCode === null ? null : parseTestSummary(`${result.stdout}${result.stderr}`);
      if (!summary) {
        files.push({ file, status: 'unmeasurable', pass: null, fail: null, exitCode: result.exitCode, error: result.signal ? `runner terminated by ${result.signal}` : 'test summary unavailable or ambiguous' });
      } else {
        files.push({ file, status: summary.fail === 0 ? 'green' : 'red', pass: summary.pass, fail: summary.fail, exitCode: result.exitCode });
      }
    } catch (error) {
      files.push({ file, status: 'unmeasurable', pass: null, fail: null, exitCode: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    createdAt,
    discovery: { status: 'ok', files: eligible.files },
    status: selected.length < eligible.files.length ? 'limit-reached' : 'ok',
    files,
    filesScanned: files.length,
    redFiles: files.filter((file) => file.status === 'red').length,
    unmeasurableFiles: files.filter((file) => file.status === 'unmeasurable').length,
    scope,
    ...(selected.length < eligible.files.length ? { limit: io.limit } : {}),
  };
}

if (import.meta.main) {
  const axes = process.argv.slice(2);
  if (axes.some((axis) => axis.startsWith('-'))) throw new Error('axes must be directory paths');
  const report = await sweepContractReds(axes.length === 0 ? DEFAULT_AXES : axes);
  console.log(JSON.stringify(report));
}
