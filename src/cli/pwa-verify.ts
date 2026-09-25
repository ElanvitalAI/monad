import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { resolvePwaCwd } from './pwa-build.js';
import { checkPwaStaleness, type StalenessVerdict } from './pwa-staleness.js';
import { runPwaShow } from './pwa-show.js';

export type PwaVerifyMarkerStatus = 'present' | 'absent' | 'marker-unspecified' | 'unmeasurable';

export interface PwaVerifyLayerOne {
  status: 'measured' | 'unmeasurable';
  verdict?: StalenessVerdict;
  detail?: string;
}

export interface PwaVerifyMarkerLayer {
  status: PwaVerifyMarkerStatus;
  detail?: string;
}

export interface PwaVerifyResult {
  exitCode: 0;
  marker?: string;
  artifact: string | undefined;
  url?: string;
  staleness: PwaVerifyLayerOne;
  artifactMarker: PwaVerifyMarkerLayer;
  httpMarker: PwaVerifyMarkerLayer;
  browser: 'not-answered';
}

export interface PwaVerifyOpts {
  marker?: string;
  cwd?: string;
  projectCwd?: string;
  argvBin?: string;
  timeoutMs?: number;
  format?: 'human' | 'json';
  out?: { log: (message: string) => void };
  resolvePwaCwdFn?: () => string | undefined;
  stalenessFn?: (cwd: string) => StalenessVerdict;
  readFileFn?: (path: string) => Promise<string | Uint8Array>;
  readDirFn?: (path: string) => Promise<Dirent[]>;
  resolveEndpointFn?: (projectCwd: string) => Promise<string | undefined>;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultEndpoint(projectCwd: string): Promise<string | undefined> {
  const captured = { log: (_message: string) => {}, error: (_message: string) => {} };
  const result = await runPwaShow({ format: 'json', cwd: projectCwd, out: captured });
  return result.urls?.loopback;
}

async function scanArtifactMarker(
  artifactRoot: string,
  marker: string,
  readFileFn: NonNullable<PwaVerifyOpts['readFileFn']>,
  readDirFn: NonNullable<PwaVerifyOpts['readDirFn']>,
): Promise<PwaVerifyMarkerLayer> {
  const failures: string[] = [];
  const paths = [artifactRoot];
  let found = false;

  while (paths.length > 0) {
    const path = paths.pop()!;
    let entries: Dirent[];
    try {
      entries = await readDirFn(path);
    } catch (error) {
      failures.push(`${relative(artifactRoot, path) || '.'}: ${errorDetail(error)}`);
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        paths.push(entryPath);
      } else if (entry.isFile()) {
        try {
          const body = await readFileFn(entryPath);
          if (Buffer.from(body).includes(Buffer.from(marker))) found = true;
        } catch (error) {
          failures.push(`${relative(artifactRoot, entryPath)}: ${errorDetail(error)}`);
        }
      }
    }
  }

  const detail = failures.length > 0 ? `scan failures: ${failures.join('; ')}` : undefined;
  return found ? { status: 'present', ...(detail ? { detail } : {}) } : failures.length > 0
    ? { status: 'unmeasurable', detail }
    : { status: 'absent' };
}

function render(result: PwaVerifyResult, format: 'human' | 'json', out: NonNullable<PwaVerifyOpts['out']>): void {
  if (format === 'json') {
    out.log(JSON.stringify(result, null, 2));
    return;
  }
  const stale = result.staleness.status === 'measured'
    ? `${result.staleness.verdict!.stale ? 'stale' : 'fresh'} (${result.staleness.verdict!.reason})`
    : `unmeasurable (${result.staleness.detail})`;
  out.log(`① static artifact freshness: ${stale}`);
  out.log(`② artifact marker: ${result.artifactMarker.status}${result.artifactMarker.detail ? ` (${result.artifactMarker.detail})` : ''}`);
  out.log(`③ HTTP-served marker: ${result.httpMarker.status}${result.httpMarker.detail ? ` (${result.httpMarker.detail})` : ''}`);
  out.log('④ browser request scheduling: not answered by this command');
}

export async function runPwaVerify(opts: PwaVerifyOpts = {}): Promise<PwaVerifyResult> {
  const out = opts.out ?? console;
  const format = opts.format ?? 'human';
  const resolveCwd = opts.resolvePwaCwdFn ?? (() => resolvePwaCwd(opts.argvBin ?? process.argv[1] ?? ''));
  const pwaCwd = opts.cwd ?? resolveCwd();
  const marker = opts.marker;
  const artifact = pwaCwd ? join(pwaCwd, 'out') : undefined;
  let staleness: PwaVerifyLayerOne;
  if (!pwaCwd) {
    staleness = { status: 'unmeasurable', detail: 'apps/pwa could not be located' };
  } else {
    try {
      staleness = { status: 'measured', verdict: (opts.stalenessFn ?? checkPwaStaleness)(pwaCwd) };
    } catch (error) {
      staleness = { status: 'unmeasurable', detail: errorDetail(error) };
    }
  }

  let artifactMarker: PwaVerifyMarkerLayer = { status: 'marker-unspecified' };
  let httpMarker: PwaVerifyMarkerLayer = { status: 'marker-unspecified' };
  let url: string | undefined;
  if (marker !== undefined) {
    if (!artifact) {
      artifactMarker = { status: 'unmeasurable', detail: 'apps/pwa could not be located' };
    } else {
      artifactMarker = await scanArtifactMarker(
        artifact,
        marker,
        opts.readFileFn ?? ((path: string) => readFile(path)),
        opts.readDirFn ?? ((path: string) => readdir(path, { withFileTypes: true })),
      );
    }

    try {
      url = await (opts.resolveEndpointFn ?? defaultEndpoint)(opts.projectCwd ?? process.cwd());
      if (!url) {
        httpMarker = { status: 'unmeasurable', detail: 'no PWA daemon endpoint for this project' };
      } else {
        const response = await (opts.fetchFn ?? fetch)(url, {
          redirect: 'manual',
          signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
        });
        if (!response.ok) {
          httpMarker = { status: 'unmeasurable', detail: `HTTP ${response.status}` };
        } else {
          const bytes = new Uint8Array(await response.arrayBuffer());
          httpMarker = { status: Buffer.from(bytes).includes(Buffer.from(marker)) ? 'present' : 'absent' };
        }
      }
    } catch (error) {
      httpMarker = { status: 'unmeasurable', detail: errorDetail(error) };
    }
  }

  const result: PwaVerifyResult = { exitCode: 0, ...(marker !== undefined ? { marker } : {}), artifact, ...(url ? { url } : {}), staleness, artifactMarker, httpMarker, browser: 'not-answered' };
  render(result, format, out);
  return result;
}
