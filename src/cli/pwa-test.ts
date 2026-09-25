// `monad nexus run --test` — single-command project-local test mode.
//
// One command does all of that with project-local impact only:
//
//     monad nexus run --test            # static · HTTP · 1 port (NEXUS)
//     monad nexus run --test --hmr      # HMR · HTTP · 2 ports (NEXUS + Next dev)
//     monad nexus run --test --https    # static · HTTPS via Tailscale Serve
//     monad nexus run --test --hmr --https
//     monad nexus run --test --status
//     monad nexus run --test --stop
//
// **2026-05-13 · config-dir-unify**: `--test` redirects ONLY the
// nexus state subtree (lock · runtime.json · logs · tabs) to
// `<repoRoot>/.monad-test/nexus/`. The config dir (config.json ·
// secrets.json · workflows · tasks) stays at the global root so the
// user's daily-driver provider / personas / scheduler all keep
// working in test mode. To use a different config dir as well, pass
// `--config-dir <path>` (works for both daily and `--test` modes).
//
// Project-local guarantees:
//   - State dir = `<repoRoot>/.monad-test/nexus/` (gitignored). User's
//     production daemon at `~/.monad/nexus/` is never touched.
//   - Tailscale Serve mounts only the test port we explicitly opened
//     and remembered in `<repoRoot>/.monad-test/tailscale-test-port.json`.
//     We never touch the user's other Serve config (e.g. their
//     personal :443 forwards).
//
// Auto port collision recovery:
//   - NEXUS port: prefer 31415 → 31420 (skip 31416-31419 to keep the
//     classic +5 NEXUS spacing) → 31421+. Skip if production daemon
//     (`~/.monad/nexus/.lock`) holds it OR an unrelated process binds
//     it (lsof check).
//   - Next dev port (HMR mode only): prefer 3210 → 3211 → 3212+.
//     Skip if any process binds the port.
//   - Stale `<repo>/.monad-test/.lock` is an idempotent reuse — the
//     command refuses with a clear hint unless `--force` is passed.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path';

import { setTestStateRoot, getTestStateRoot } from '../nexus/paths.js';
import { runPwaStart, type PwaStartMode, type PwaStartOpts, type PwaStartResult } from './pwa-start.js';
import { runPwaStop, type PwaStopOpts, type PwaStopResult } from './pwa-stop.js';
import {
  isAliveNexusLock,
  readNexusLock,
  type NexusLockMeta,
} from '../nexus/supervisor/lock.js';
import {
  mountTailscaleServe,
  unmountTailscaleServe,
  readMountedState,
  type MountTailscaleServeResult,
  type TailscaleServeOpts,
  type UnmountTailscaleServeResult,
} from './tailscale-serve.js';

export interface PwaTestOpts {
  /** Override `process.argv[1]` (default = `process.argv[1]`). Used to
   *  resolve the repo root for project-local state. */
  argvBin?: string;
  /** Force a specific NEXUS port (skips auto-pick). When provided +
   *  occupied, the command errors instead of probing the next port. */
  port?: number;
  /** HMR mode (default = static). Static is the calm default —
   *  matches `pwa start` precedent. HMR adds Next.js dev server with
   *  auto-port-pick on collision. */
  hmr?: boolean;
  /** Mount Tailscale Serve TLS-terminated-tcp on the picked NEXUS
   *  port. iPad/external device gets `https://<magic-dns>:<port>/...`
   *  for `getUserMedia` (camera/mic) which only works in secure
   *  context. Sudo required (cached creds work). */
  https?: boolean;
  /** Alias for `https` — semantic name surfaced to dogfood callers
   *  who think in feature terms (voice/camera) rather than transport. */
  voice?: boolean;
  /** `--status` mode: print whatever a prior `pwa test` left behind
   *  (lock + tailscale state). No daemon spawn. */
  status?: boolean;
  /** `--stop` mode: cascade stop test daemon + dev BG + Tailscale
   *  Serve unmount. Idempotent — safe to run when nothing is up. */
  stop?: boolean;
  /** Take over a stale or live test instance. Maps to `pwa start
   *  --force` for the daemon spawn. */
  force?: boolean;
  /** Explicit working directory for tools in the detached test daemon. */
  toolCwd?: string;
  /** Build `apps/pwa/out` before starting (only relevant in static
   *  mode). Equivalent to `monad nexus pwa restart --rebuild`. */
  rebuild?: boolean;
  /** Opt-in: run an fs.watch loop inside the test daemon so source
   *  edits during a test session auto-rebuild. Default off — test mode
   *  is disposable (one-shot PR verification), so the noise of a long-
   *  running watcher is opt-in. Mirrors `monad nexus run --watch`. */
  watch?: boolean;
  /** Opt-in: static-mode staleness check before start. When true and
   *  `apps/pwa/out` is older than source, run a one-shot build. Default
   *  off for test mode — sibling `--rebuild` covers the explicit case
   *  and isolated test daemons usually run on a known-fresh tree. */
  autoBuild?: boolean;
  /** Opt-in: when `apps/pwa/node_modules` is missing, run `bun install`
   *  in apps/pwa before attempting a build. Default off for test mode
   *  — sibling to the canonical `nexus run` flag of the same name. */
  autoInstall?: boolean;
  /** Opt-in: same-tree auto-restart on port collision. Default off for
   *  test mode (collisions auto-fallback to the next port instead).
   *  Surfaced for parity with `monad nexus run`. */
  autoRestart?: boolean;
  /** FU8 PR #5 (2026-05-12) — fresh-on-start prune of
   *  `<stateDir>/workflows/` (and `<stateDir>/tasks/` + `<stateDir>/
   *  backups/`) so test runs never inherit prior-run artifacts (e.g.
   *  `greet-*` workflows accumulating across dogfood sessions).
   *  Preserves daemon state (lock · runtime.json · logs · IPC dir).
   *  Default = false (opt-in) so existing test routines keep their
   *  in-progress workflows.
   */
  fresh?: boolean;

  /** Output sink (default = console). */
  out?: { log: (s: string) => void; error: (s: string) => void };

  // ─── Test seams ─────────────────────────────────────────────
  /** Override the repo root resolution from `argvBin`. */
  repoRoot?: string;
  /** Replace the production-daemon lock probe. Defaults to reading
   *  `~/.monad/nexus/.lock` via the public helpers. */
  productionLockProbeFn?: () => NexusLockMeta | null;
  /** Replace the production-daemon liveness check. */
  productionLockAliveFn?: (meta: NexusLockMeta) => boolean;
  /** Replace the port collision probe. Defaults to `lsof -ti :<port>`. */
  portInUseFn?: (port: number) => boolean;
  /** Replace the runPwaStart dependency (the underlying daemon + dev
   *  bring-up · we compose this rather than reimplement). */
  pwaStartFn?: (opts: PwaStartOpts) => Promise<PwaStartResult>;
  /** Replace the runPwaStop dependency. */
  pwaStopFn?: (opts: PwaStopOpts) => Promise<PwaStopResult>;
  /** Replace the Tailscale Serve mount/unmount helpers. Test seam onto
   *  the unified `mountTailscaleServe` / `unmountTailscaleServe`.
   *  `pwa test --https` always uses `tls-tcp` mode + `upstreamPort==port`,
   *  so the seam takes `port` separately and the orchestrator fills in
   *  `mode` + `upstreamPort` before delegating. */
  tailscaleMountFn?: (
    port: number,
    opts: Omit<TailscaleServeOpts, 'upstreamPort'>,
  ) => Promise<MountTailscaleServeResult>;
  tailscaleUnmountFn?: (
    opts: Omit<TailscaleServeOpts, 'upstreamPort'>,
  ) => Promise<UnmountTailscaleServeResult>;
  /** Skip running `pwa build` automatically when static mode finds the
   *  out dir missing. Tests bypass the spawn. */
  rebuildFn?: (cwd: string) => Promise<{ exitCode: number }>;
}

export interface PwaTestResult {
  exitCode: number;
  /** When start succeeded, the URL to surface in the iPad guide. */
  url?: string;
  /** Picked ports for diagnostics + status. */
  picked?: {
    nexusPort: number;
    devPort?: number;
  };
  /** Set when `--https` mode mounted Tailscale Serve. */
  tailscaleMounted?: boolean;
}

const DEFAULT_NEXUS_PORT = 31415;
const NEXUS_FALLBACK_PORTS = [31420, 31421, 31422, 31423, 31424];
const DEFAULT_DEV_PORT = 3210;
const DEV_FALLBACK_RANGE = [3211, 3212, 3213, 3214, 3215];

interface RepoLayout {
  repoRoot: string;
  stateDir: string;
  lockPath: string;
  runtimePath: string;
  tailscaleStatePath: string;
  pwaOutDir: string;
  pwaCwd: string;
}

/** Resolve `<repoRoot>` from `argvBin` (process.argv[1]). The bin
 *  symlink lives at `<repo>/bin/monad.mjs`, so the parent of `bin/` is
 *  the repo. Bun-linked global `monad` follows the symlink target so
 *  this still resolves to the linked checkout. */
function resolveRepoRoot(argvBin: string | undefined): string | undefined {
  if (!argvBin) return undefined;
  const candidate = resolvePath(dirname(argvBin), '..');
  // Sanity-check by looking for `apps/pwa` + `bin/monad.mjs` siblings.
  if (!existsSync(joinPath(candidate, 'bin', 'monad.mjs'))) return undefined;
  if (!existsSync(joinPath(candidate, 'apps', 'pwa'))) return undefined;
  return candidate;
}

function resolveLayout(opts: PwaTestOpts): RepoLayout | null {
  const argvBin = opts.argvBin ?? process.argv[1] ?? '';
  const repoRoot = opts.repoRoot ?? resolveRepoRoot(argvBin);
  if (!repoRoot) return null;
  const stateDir = joinPath(repoRoot, '.monad-test');
  return {
    repoRoot,
    stateDir,
    lockPath: joinPath(stateDir, '.lock'),
    runtimePath: joinPath(stateDir, 'runtime.json'),
    tailscaleStatePath: joinPath(stateDir, 'tailscale-test-port.json'),
    pwaOutDir: joinPath(repoRoot, 'apps', 'pwa', 'out'),
    pwaCwd: joinPath(repoRoot, 'apps', 'pwa'),
  };
}

function defaultPortInUse(port: number): boolean {
  try {
    // `lsof -ti :<port>` exits 0 + prints PIDs when something is
    // listening; exits 1 with empty stdout when free.
    const stdout = execFileSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return String(stdout).trim().length > 0;
  } catch {
    return false;
  }
}

function readProjectLock(lockPath: string): NexusLockMeta | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NexusLockMeta;
    if (typeof parsed.pid !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function pickNexusPort(
  preferred: number | undefined,
  layout: RepoLayout,
  opts: PwaTestOpts,
): { port: number; reason: string } | { error: string } {
  const inUseFn = opts.portInUseFn ?? defaultPortInUse;
  const productionProbeFn =
    opts.productionLockProbeFn ?? readNexusLock;
  const productionAliveFn = opts.productionLockAliveFn ?? isAliveNexusLock;

  if (preferred !== undefined) {
    if (inUseFn(preferred)) {
      return { error: `port ${preferred} already in use (lsof match)` };
    }
    return { port: preferred, reason: 'explicit --port' };
  }

  // Default: 31415. Production daemon (`~/.monad/nexus/.lock`) takes
  // precedence — we never want to clobber the user's primary daemon.
  const candidates = [DEFAULT_NEXUS_PORT, ...NEXUS_FALLBACK_PORTS];

  // Production probe must read `~/.monad/nexus/.lock`, not our test
  // lock. Temporarily clear any in-process test state override so
  // `readNexusLock` falls through to the default config-dir path.
  // (Same-process re-entry only — fresh `monad` invocations start
  // with testStateRoot=undefined automatically.)
  const savedTestStateRoot = getTestStateRoot();
  setTestStateRoot(null);
  let prodLock: NexusLockMeta | null = null;
  try { prodLock = productionProbeFn(); } catch { /* swallow */ }
  finally {
    if (savedTestStateRoot !== undefined) setTestStateRoot(savedTestStateRoot);
  }
  const productionAlive = prodLock && productionAliveFn(prodLock);

  // Project test lock — distinct path; reuse when alive (idempotent
  // start = informative status), force-take when --force.
  const projectLock = readProjectLock(layout.lockPath);

  for (const port of candidates) {
    if (port === DEFAULT_NEXUS_PORT && productionAlive) continue;
    if (inUseFn(port)) {
      // The test lock might describe THIS port — if so, it's our own
      // prior instance and the orchestrator's flow handles that
      // separately (errors with reuse/force hint at the entry point).
      if (
        projectLock
        && projectLock.pid !== prodLock?.pid
        && opts.force !== true
      ) {
        // We can't tell which port the prior test was on without
        // reading runtime.json — leave that to the entry point.
        // Continue to next candidate so a second port lookup keeps
        // working when the prior is stale.
      }
      continue;
    }
    return {
      port,
      reason:
        port === DEFAULT_NEXUS_PORT
          ? 'default :31415 free'
          : productionAlive
            ? `:31415 taken by production daemon (pid ${prodLock!.pid}) → fallback`
            : 'collision · auto-pick',
    };
  }
  return { error: `no free port in [${candidates.join(', ')}]` };
}

function pickDevPort(opts: PwaTestOpts): number | { error: string } {
  const inUseFn = opts.portInUseFn ?? defaultPortInUse;
  const candidates = [DEFAULT_DEV_PORT, ...DEV_FALLBACK_RANGE];
  for (const port of candidates) {
    if (!inUseFn(port)) return port;
  }
  return { error: `no free Next dev port in [${candidates.join(', ')}]` };
}

function ensureStateDir(layout: RepoLayout): void {
  mkdirSync(layout.stateDir, { recursive: true });
}

function clearStaleLock(layout: RepoLayout, opts: PwaTestOpts): void {
  // The bg-launch path also clears stale locks itself, but doing it
  // here makes the diagnostic banner accurate (lock hint suppression).
  const lock = readProjectLock(layout.lockPath);
  if (!lock) return;
  const aliveFn = opts.productionLockAliveFn ?? isAliveNexusLock;
  if (!aliveFn(lock)) {
    try { rmSync(layout.lockPath, { force: true }); } catch { /* swallow */ }
  }
}

function urlForLanHttp(port: number): string[] {
  // We can't reliably enumerate the user's LAN IP without a /sbin call
  // that varies across macOS / linux. Surface localhost + 0.0.0.0
  // hint; the caller can run `ipconfig getifaddr en0` if they need the
  // actual LAN IP.
  return [
    `http://localhost:${port}/app/showroom/`,
    `http://<Mac LAN IP>:${port}/app/showroom/`,
    `http://<Tailscale IP · 100.x>:${port}/app/showroom/`,
  ];
}

function defaultRebuild(cwd: string): Promise<{ exitCode: number }> {
  return new Promise(async (resolve) => {
    try {
      const { runPwaBuild } = await import('./pwa-build.js');
      const res = await runPwaBuild({ cwd });
      resolve({ exitCode: res.exitCode });
    } catch {
      resolve({ exitCode: 1 });
    }
  });
}

/** FU8 PR #5 (2026-05-12) — paths that get nuked by `--fresh` on
 *  every test start. **Excluded**: anything daemon-lifecycle (lock ·
 *  runtime.json · logs · `tabs/` IPC dir) and the orchestrator's own
 *  config files. Adding new transient dirs here is the cheapest way
 *  to keep `pwa test --fresh` honest. */
const FRESH_PRUNE_RELATIVE_PATHS: readonly string[] = [
  'workflows',  // accreting `greet-*` artifacts in the HANDOFF observation
  'tasks',      // TOX SQLite + per-mission goal-* dirs from this test session
  'backups',    // any backup invocation triggered during a test run
];

function pruneStaleArtifacts(
  layout: RepoLayout,
  out: NonNullable<PwaTestOpts['out']>,
): { pruned: string[] } {
  const pruned: string[] = [];
  for (const rel of FRESH_PRUNE_RELATIVE_PATHS) {
    const target = joinPath(layout.stateDir, rel);
    if (existsSync(target)) {
      try {
        rmSync(target, { recursive: true, force: true });
        pruned.push(rel);
      } catch (err) {
        out.error(`  ! could not prune ${rel}/: ${(err as Error).message}`);
      }
    }
  }
  return { pruned };
}

async function runStart(
  layout: RepoLayout,
  opts: PwaTestOpts,
  out: NonNullable<PwaTestOpts['out']>,
): Promise<PwaTestResult> {
  ensureStateDir(layout);
  clearStaleLock(layout, opts);

  // FU8 PR #5 (2026-05-12) — `--fresh` opt-in prune. Runs before the
  // daemon spawn so the spawned NEXUS sees an empty workflows /
  // tasks tree. Daemon state files (lock · runtime.json · logs · the
  // `tabs/` IPC dir) are NOT in the prune list, so an in-flight
  // `pwa test --status` still answers correctly across `--fresh`
  // invocations of follow-up tests.
  if (opts.fresh === true) {
    const { pruned } = pruneStaleArtifacts(layout, out);
    if (pruned.length > 0) {
      out.log(`monad nexus run --test --fresh: pruned ${pruned.map((p) => `${p}/`).join(' · ')}`);
    } else {
      out.log('monad nexus run --test --fresh: nothing to prune (.monad-test/ was already clean).');
    }
  }

  // Static mode requires `apps/pwa/out`. Auto-rebuild when --rebuild
  // flag is on (matches `pwa restart --rebuild` semantics).
  const isHmr = opts.hmr === true;
  if (!isHmr && (opts.rebuild || !existsSync(layout.pwaOutDir))) {
    if (!opts.rebuild && !existsSync(layout.pwaOutDir)) {
      out.log('monad nexus run --test: apps/pwa/out missing — running `pwa build` first.');
    }
    const rebuildFn = opts.rebuildFn ?? defaultRebuild;
    const r = await rebuildFn(layout.pwaCwd);
    if (r.exitCode !== 0) {
      out.error(`✗ pwa build failed (exit ${r.exitCode}). Aborting test start.`);
      // Most common cause on a fresh/pulled tree: declared deps were never
      // installed (webpack "Module not found"). Surface the one-line fix on
      // the LAST line so it isn't lost above the build's own output. --test
      // keeps auto-install opt-in, so point at both the manual fix and flag.
      try {
        const { checkPwaBuildDeps } = await import('./pwa-build.js');
        const deps = checkPwaBuildDeps(layout.pwaCwd);
        if (!deps.ok) {
          const shown = deps.missing.slice(0, 3).join(', ');
          const more = deps.missing.length > 3 ? ` (+${deps.missing.length - 3} more)` : '';
          out.error(`  ↳ apps/pwa 의존성 미설치: ${shown}${more}`);
          out.error(`    fix:  cd "${layout.pwaCwd}" && bun install   (또는 \`nexus run --test --auto-install\`)`);
        }
      } catch { /* hint is best-effort */ }
      return { exitCode: r.exitCode };
    }
  }

  const nexusPick = pickNexusPort(opts.port, layout, opts);
  if ('error' in nexusPick) {
    out.error(`✗ ${nexusPick.error}`);
    return { exitCode: 1 };
  }
  const nexusPort = nexusPick.port;

  let devPort: number | undefined;
  if (isHmr) {
    const devPick = pickDevPort(opts);
    if (typeof devPick !== 'number') {
      out.error(`✗ ${devPick.error}`);
      return { exitCode: 1 };
    }
    devPort = devPick;
  }

  // Project-local nexus state subtree. The detached daemon will see
  // this override via `--test-state-dir <path>` argv re-appended in
  // `bg-launch.ts` (2026-05-13 · config-dir-unify replaces the
  // previous `process.env.MONAD_NEXUS_DIR` inheritance).
  setTestStateRoot(layout.stateDir);

  // ISO-2 (2026-07-13 · 대표 결정) — config 도 완전 분기. `--test` 하나로
  // state + config 전부 <repo>/.monad-test/ 아래로 간다. 운영 config 는
  // 물질화 사본(sync-test)으로만 전달되고, 테스트 프로세스는 운영
  // config.json 을 아예 열지 않는다(overlay 은퇴). bg-launch 가 부모의
  // config-dir 를 `--config-dir` argv 로 자식에 물려주므로 여기서 부모를
  // 분기하면 데몬 자식도 자동 상속된다.
  try {
    const { setMonadConfigDir } = await import('../monad-config-dir.js');
    setMonadConfigDir(layout.stateDir);
    const { syncTestConfig, isTestConfigStale } = await import('./config-test-sync.js');
    if (!existsSync(joinPath(layout.stateDir, 'config.json'))) {
      const r = syncTestConfig(layout.stateDir);
      out.log(`config 격리: 운영 config 물질화 → ${r.testConfigPath} (telegram=${r.telegramMode})`);
    } else if (isTestConfigStale(layout.stateDir)) {
      out.log(`config 격리: ⚠️ 운영 config 가 테스트 사본보다 최신 — 'monad config sync-test' 로 갱신 권장`);
    }
  } catch (e) {
    out.error(`✗ config 격리 실패: ${e instanceof Error ? e.message : String(e)} — 운영 오염 위험이라 기동 중단`);
    return { exitCode: 1 };
  }

  // Bind interface depends on transport mode:
  //   - --https → loopback only (Tailscale Serve binds the Tailscale
  //     interface :<port> separately and needs us out of its way).
  //   - HTTP only → 0.0.0.0 so iPad can reach via LAN IP / Tailscale
  //     IP / localhost.
  const wantsHttps = opts.https === true || opts.voice === true;
  const httpHost = wantsHttps ? '127.0.0.1' : '0.0.0.0';

  const pwaStartFn = opts.pwaStartFn ?? runPwaStart;
  const mode: PwaStartMode = isHmr ? 'hmr' : 'static';
  const startOpts: PwaStartOpts = {
    mode,
    httpHost,
    httpPort: nexusPort,
    out,
    ...(opts.force ? { force: true } : {}),
    ...(opts.toolCwd !== undefined ? { toolCwd: opts.toolCwd } : {}),
    ...(devPort !== undefined ? { devPort } : {}),
    // Parity with `monad nexus run` — staleness build / same-tree
    // restart / fs.watch are all opt-in for test mode (vs. opt-out for
    // the canonical entry). The user surface adds `--watch` /
    // `--auto-build` / `--auto-restart` if they want the same calm
    // auto-reload that `nexus run` provides.
    ...(opts.autoBuild === true ? { autoBuild: true } : {}),
    ...(opts.autoInstall === true ? { autoInstall: true } : {}),
    ...(opts.autoRestart === true ? { autoRestart: true } : {}),
    ...(opts.watch === true && mode === 'static' ? { watch: true } : {}),
    // Test mode never auto-shares via the `pwa share enable` switch —
    // we manage Tailscale Serve ourselves via the unified helper in
    // tailscale-serve.ts (TLS-tcp mode · WS-friendly).
    readShareSwitchFn: () => 'disabled',
  };
  const startRes = await pwaStartFn(startOpts);
  if (startRes.exitCode !== 0) return { exitCode: startRes.exitCode };

  let url: string | undefined;
  let tailscaleMounted = false;

  if (wantsHttps) {
    out.log('');
    out.log('monad nexus run --test --https: mounting Tailscale Serve (TLS-terminated-tcp)…');
    const mountFn =
      opts.tailscaleMountFn
      ?? ((port: number, mountOpts: Omit<TailscaleServeOpts, 'upstreamPort'>) =>
        mountTailscaleServe({
          ...mountOpts,
          mode: { kind: 'tls-tcp', port },
          upstreamPort: port,
        }));
    const mountRes = await mountFn(nexusPort, {
      statePath: layout.tailscaleStatePath,
      out,
    });
    if (!mountRes.ok) {
      out.error(`✗ Tailscale Serve mount failed: ${mountRes.reason ?? 'unknown'}`);
      if (mountRes.detail) out.error(`  ${mountRes.detail}`);
      out.error('  Daemon is up; HTTPS surface is NOT — fall back to HTTP URLs:');
      for (const u of urlForLanHttp(nexusPort)) out.error(`    ${u}`);
      return {
        exitCode: 1,
        picked: { nexusPort, ...(devPort !== undefined ? { devPort } : {}) },
      };
    }
    tailscaleMounted = true;
    url = mountRes.url ?? undefined;
    if (mountRes.swappedFrom !== undefined) {
      out.log(`  swapped Serve from port ${mountRes.swappedFrom.upstreamPort} → ${nexusPort}`);
    }
    out.log(`  ✓ Serve ON · ${url}`);
  }

  // Persist a quick-read state file so `--status` doesn't have to
  // re-derive everything. Single shot · idempotent.
  writeFileSync(
    joinPath(layout.stateDir, 'test-state.json'),
    JSON.stringify(
      {
        mode: isHmr ? 'hmr' : 'static',
        nexusPort,
        ...(devPort !== undefined ? { devPort } : {}),
        https: wantsHttps,
        url: url ?? null,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  out.log('');
  out.log('────────────── monad nexus run --test ──────────────');
  out.log(`  mode      ${isHmr ? 'hmr' : 'static'}`);
  out.log(`  nexus     :${nexusPort}${nexusPick.reason ? `  (${nexusPick.reason})` : ''}`);
  if (devPort !== undefined) out.log(`  next-dev  :${devPort}`);
  out.log(`  state     ${layout.stateDir}`);
  out.log('');
  if (wantsHttps && url) {
    out.log('  iPad / external (HTTPS · voice/camera OK):');
    out.log(`    ${url}`);
  } else {
    out.log('  iPad / external (HTTP · voice/camera disabled):');
    for (const u of urlForLanHttp(nexusPort)) out.log(`    ${u}`);
  }
  out.log('');
  out.log('  stop      monad nexus run --test --stop');
  out.log('  status    monad nexus run --test --status');
  out.log('────────────────────────────────────────────────');

  return {
    exitCode: 0,
    ...(url !== undefined ? { url } : {}),
    picked: { nexusPort, ...(devPort !== undefined ? { devPort } : {}) },
    tailscaleMounted,
  };
}

async function runStop(
  layout: RepoLayout,
  opts: PwaTestOpts,
  out: NonNullable<PwaTestOpts['out']>,
): Promise<PwaTestResult> {
  // Mirror runStart — flip the in-process nexus state root so the
  // stop signal targets `<.monad-test>/nexus/.lock` (not the user's
  // `~/.monad/nexus/.lock`). config dir untouched.
  setTestStateRoot(layout.stateDir);
  const pwaStopFn = opts.pwaStopFn ?? runPwaStop;
  out.log('monad nexus run --test --stop: cascade');

  // Tailscale Serve unmount FIRST — the user's iPad URL stops working
  // immediately, then we tear down daemon + dev. This order matches
  // the start order in reverse. `upstreamPort: 0` is a sentinel meaning
  // "read from state file" — the unified helper consults `statePath`
  // when no explicit mode is supplied.
  const unmountFn =
    opts.tailscaleUnmountFn
    ?? ((unmountOpts: Omit<TailscaleServeOpts, 'upstreamPort'>) =>
      unmountTailscaleServe({ ...unmountOpts, upstreamPort: 0 }));
  const unmountRes = await unmountFn({
    statePath: layout.tailscaleStatePath,
    out,
  });
  if (!unmountRes.ok && unmountRes.reason !== 'no-state') {
    out.error(`  Tailscale Serve unmount issue: ${unmountRes.reason ?? 'unknown'}`);
    if (unmountRes.detail) out.error(`  ${unmountRes.detail}`);
  } else if (unmountRes.unmounted?.upstreamPort !== undefined) {
    out.log(`  ✓ Tailscale Serve OFF (was port ${unmountRes.unmounted.upstreamPort})`);
  }

  // Reuse `runPwaStop` to cascade dev BG + daemon. We pass our own
  // tailscale reset that's a no-op so we don't double-touch (and so we
  // don't clobber the user's other Serves). The dev BG stop also
  // DELETEs the admin endpoint via its own `finally`.
  const stopRes = await pwaStopFn({
    out,
    shareProbeFn: async () => ({ installed: false, alive: false }),
    shareResetFn: async () => ({ exitCode: 0 }),
  });

  // Cleanup state files — leave logs/ for post-mortem.
  const stateFile = joinPath(layout.stateDir, 'test-state.json');
  if (existsSync(stateFile)) {
    try { rmSync(stateFile, { force: true }); } catch { /* swallow */ }
  }

  return { exitCode: stopRes.exitCode };
}

function runStatus(
  layout: RepoLayout,
  out: NonNullable<PwaTestOpts['out']>,
): PwaTestResult {
  const stateFile = joinPath(layout.stateDir, 'test-state.json');
  if (!existsSync(stateFile)) {
    out.log('monad nexus run --test: no active test instance.');
    return { exitCode: 0 };
  }
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      mode?: string;
      nexusPort?: number;
      devPort?: number;
      https?: boolean;
      url?: string | null;
      startedAt?: string;
    };
    out.log('monad nexus run --test --status:');
    out.log(`  mode      ${parsed.mode ?? '(unknown)'}`);
    out.log(`  nexus     :${parsed.nexusPort ?? '?'}`);
    if (parsed.devPort !== undefined) out.log(`  next-dev  :${parsed.devPort}`);
    out.log(`  https     ${parsed.https ? 'ON' : 'OFF'}`);
    if (parsed.url) out.log(`  url       ${parsed.url}`);
    out.log(`  started   ${parsed.startedAt ?? '(unknown)'}`);

    const tsState = readMountedState(layout.tailscaleStatePath);
    if (tsState && tsState.mode.kind === 'tls-tcp') {
      out.log(`  tailscale port=${tsState.mode.port} hostname=${tsState.hostname ?? '?'}`);
    }
    return { exitCode: 0 };
  } catch (err) {
    out.error(`monad nexus run --test --status: state file unreadable — ${(err as Error).message}`);
    return { exitCode: 1 };
  }
}

export async function runPwaTest(opts: PwaTestOpts = {}): Promise<PwaTestResult> {
  const out = opts.out ?? console;
  const layout = resolveLayout(opts);
  if (!layout) {
    out.error(
      `monad nexus run --test: could not resolve repo root from argv[1]=${opts.argvBin ?? process.argv[1] ?? '(empty)'}`,
    );
    out.error('  Run from a checkout of monad-agent (the bin symlink lives at <repo>/bin/monad.mjs).');
    return { exitCode: 1 };
  }

  if (opts.status) return runStatus(layout, out);
  if (opts.stop) return runStop(layout, opts, out);
  return runStart(layout, opts, out);
}
