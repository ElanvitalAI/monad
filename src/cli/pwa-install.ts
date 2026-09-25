// PWA auto-install — runs `bun install` inside `apps/pwa` when
// `checkPwaBuildDeps` reports missing `node_modules`. The canonical
// `monad nexus run` entry calls this from `maybeAutoBuild` before
// invoking the build, so a fresh `git clone` (or a pulled lockfile
// change) starts working with one command instead of forcing the user
// through the "missing node_modules" diagnostic in pwa-build.ts.
//
// `pwa-build.ts:checkPwaBuildDeps` is the single source of truth for
// "are we installed?"; this module is the writer that fixes it.

import { spawn } from 'node:child_process';

export interface PwaInstallOpts {
  /** apps/pwa directory. Required — the caller resolved it already. */
  cwd: string;
  /** Output sink (default = console). bun's own output streams to the
   *  parent terminal via `stdio: 'inherit'` so the user sees progress. */
  out?: { log: (s: string) => void; error: (s: string) => void };
  /** Test seam — injectable spawn returning exit code. Production uses
   *  `child_process.spawn('bun', ['install'], { cwd, stdio: 'inherit' })`. */
  spawnFn?: (cmd: string, args: string[], cwd: string) => Promise<number>;
}

export interface PwaInstallResult {
  /** Child exit code (0 = success). */
  exitCode: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

function defaultSpawn(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
    child.on('error', (err) => reject(err));
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function runPwaInstall(opts: PwaInstallOpts): Promise<PwaInstallResult> {
  const out = opts.out ?? console;
  out.log(`monad nexus pwa install: ${opts.cwd}`);
  out.log('  bun install  (apps/pwa deps · ~30-60s typical)');
  const t0 = Date.now();
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const exitCode = await spawnFn('bun', ['install'], opts.cwd);
  const durationMs = Date.now() - t0;
  const secs = (durationMs / 1000).toFixed(1);
  if (exitCode === 0) {
    out.log(`✓ install succeeded in ${secs}s — apps/pwa/node_modules ready`);
  } else {
    out.error(`✗ install failed (exit ${exitCode}) after ${secs}s`);
  }
  return { exitCode, durationMs };
}
