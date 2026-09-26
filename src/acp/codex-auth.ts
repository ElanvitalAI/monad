// Codex native · OAuth B1 delegation (follow-up h4 · phase 1).
//
// We don't implement OAuth ourselves — the Codex binary already owns the
// full flow (keyring storage · callback server · device-code fallback ·
// refresh). When `codex exec` fails with an auth-related error, we:
//   1. detect the pattern in stderr (best-effort · broad heuristic)
//   2. spawn `codex login` as a blocking subprocess (user completes in
//      browser · ~10-30s typical · up to ~5 min for timeout)
//   3. retry the caller's operation ONCE (loop guard · no infinite
//      re-auth)
//
// Headless / no-browser: `webbrowser::open` inside the codex binary
// fails quickly · we detect via missing DISPLAY + no TTY and branch
// to `codex login --device-auth` which prints a device code + URL to
// stderr. The caller's `log` callback surfaces those lines so the user
// completes on another device.
//
// Reference (codex reference impl we delegate TO):
//   ref/codex/codex-rs/cli/src/login.rs:113-159 — login subcommands
//   ref/codex/codex-rs/rmcp-client/src/perform_oauth_login.rs:73-157 — callback server + browser flow
//   ref/codex/codex-rs/core/src/oauth.rs — keyring + fallback file · refresh logic
//
// elanous surface (this module) is intentionally thin: we DON'T touch
// the keyring · we DON'T parse OAuth tokens · we DON'T implement refresh.
// The binary is the single source of truth.

import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, delimiter, sep } from 'node:path';
import { debug } from '../debug/log.js';

/** Error shape thrown by `@openai/codex-sdk` when the subprocess exits
 *  non-zero. The SDK concatenates stderr into the message · we pattern-
 *  match that string. Heuristic by design — codex's error wording can
 *  change across versions · false negatives just surface the raw error
 *  to the caller · false positives only cost one retry. */
const AUTH_ERROR_PATTERNS: readonly RegExp[] = [
  /not\s+authenticated/i,
  /authentication\s+required/i,
  /unauthenticated/i,
  /invalid\s+(api\s+key|token|credentials)/i,
  /401/,
  /403\s+.*auth/i,
  /please\s+.*login/i,
  /no\s+.*credentials/i,
  /token\s+expired/i,
];

export function isCodexAuthError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return AUTH_ERROR_PATTERNS.some((re) => re.test(msg));
}

/** Try to detect a headless environment where `codex login`'s browser
 *  flow will fail fast. Default browser flow will still ATTEMPT to run
 *  · if it fails the caller should re-spawn with `--device-auth`. This
 *  predicate lets us skip the failed attempt and go straight to device
 *  code when the environment is obviously headless. */
export function isHeadlessEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  // No DISPLAY on Linux/BSD · no WAYLAND_DISPLAY · not an SSH terminal
  // with X forwarding. macOS / Windows GUI sessions always have a way
  // to open a browser even without DISPLAY, so we don't flag those.
  const isLinuxLike = process.platform === 'linux' || process.platform === 'freebsd' || process.platform === 'openbsd';
  if (!isLinuxLike) return false;
  if (env['DISPLAY']) return false;
  if (env['WAYLAND_DISPLAY']) return false;
  // SSH session without DISPLAY = almost certainly headless
  if (env['SSH_CONNECTION'] || env['SSH_CLIENT']) return true;
  return true;
}

/** Locate the bundled codex binary the SDK uses. Mirrors the SDK's
 *  `findCodexPath()` in `@openai/codex-sdk/dist/index.js` (L368) so we
 *  spawn the SAME binary for login as for exec — keyring state is
 *  consistent. Returns null if the optional platform package isn't
 *  installed (rare — npm install should fetch it via peerDeps). */
export function resolveBundledCodexPath(): string | null {
  const { platform, arch } = process;
  let targetTriple: string | null = null;
  if (platform === 'darwin') {
    targetTriple = arch === 'arm64' ? 'aarch64-apple-darwin' : arch === 'x64' ? 'x86_64-apple-darwin' : null;
  } else if (platform === 'linux') {
    targetTriple = arch === 'arm64' ? 'aarch64-unknown-linux-musl' : arch === 'x64' ? 'x86_64-unknown-linux-musl' : null;
  } else if (platform === 'win32') {
    targetTriple = arch === 'arm64' ? 'aarch64-pc-windows-msvc' : arch === 'x64' ? 'x86_64-pc-windows-msvc' : null;
  }
  if (!targetTriple) return null;
  const platformPackage = `@openai/codex-${platform === 'win32' ? 'win32' : platform}-${arch}`;
  try {
    // Prefer the SDK's own resolution path. The SDK depends on the
    // `@openai/codex` umbrella package which depends on the platform-
    // specific `@openai/codex-<platform>-<arch>` package. We resolve via
    // the SDK so the platform-package is picked up from wherever the
    // SDK expects it.
    const require = createRequire(import.meta.url);
    const codexPkgPath = require.resolve('@openai/codex/package.json');
    const codexRequire = createRequire(codexPkgPath);
    const platformPkgJson = codexRequire.resolve(`${platformPackage}/package.json`);
    const vendorRoot = join(dirname(platformPkgJson), 'vendor');
    const binName = platform === 'win32' ? 'codex.exe' : 'codex';
    const binPath = join(vendorRoot, targetTriple, 'codex', binName);
    if (existsSync(binPath)) return binPath;
    return null;
  } catch {
    return null;
  }
}

/** Parse `codex --version` output ("codex-cli 0.137.0") → [0,137,0]. */
function codexVersionTuple(bin: string): [number, number, number] | null {
  try {
    const out = execFileSync(bin, ['--version'], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  } catch {
    /* binary missing / not runnable */
  }
  return null;
}

function cmpVersion(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

let cachedPreferredCodex: string | null = null;
/**
 * Resolve the `codex` binary to spawn for the `codex app-server` backend,
 * preferring the HIGHEST version among (a) the system `codex` on PATH —
 * excluding this repo's `node_modules/.bin`, which ships a bundled copy that
 * can shadow the user's upgraded system install — and (b) the SDK's bundled
 * binary.
 *
 * Why this matters: the daemon's PATH prepends `<repo>/node_modules/.bin`,
 * where `@openai/codex` installs a `codex` shim. That bundled copy lags the
 * user's system codex (observed 2026-06-08: bundled 0.122.0 shadowing system
 * 0.137.0). The OpenAI backend gates NEW models on the Codex client version,
 * so spawning the stale bundled binary makes turns fail with "The '<model>'
 * model requires a newer version of Codex. Please upgrade to the latest app
 * or CLI" — even though the user's own `codex --yolo` runs that model fine.
 * Picking the newest available binary fixes it and auto-tracks future
 * upgrades. Falls back to `'codex'` (PATH default) when nothing resolves.
 * Memoized per process (restart to re-detect after a codex upgrade).
 */
export function resolvePreferredCodexBinary(): string {
  if (cachedPreferredCodex) return cachedPreferredCodex;
  const candidates: string[] = [];
  // (a) system codex — scan PATH but skip repo node_modules/.bin dirs.
  const binName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const skip = `node_modules${sep}.bin`;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || dir.includes(skip)) continue;
    const p = join(dir, binName);
    if (existsSync(p)) { candidates.push(p); break; }
  }
  // (b) SDK bundled binary.
  const bundled = resolveBundledCodexPath();
  if (bundled) candidates.push(bundled);

  let best: string | null = null;
  let bestVer: [number, number, number] | null = null;
  for (const c of candidates) {
    const v = codexVersionTuple(c);
    if (v && (!bestVer || cmpVersion(v, bestVer) > 0)) {
      bestVer = v;
      best = c;
    }
  }
  cachedPreferredCodex = best ?? 'codex';
  if (debug.enabled) {
    debug.log('acp.codex.binary', 'resolved', {
      binary: cachedPreferredCodex,
      version: bestVer ? bestVer.join('.') : null,
      candidates,
    });
  }
  return cachedPreferredCodex;
}

/** Test seam — clear the memoized preferred-binary resolution. */
export function resetPreferredCodexBinaryCacheForTesting(): void {
  cachedPreferredCodex = null;
}

export interface SpawnCodexLoginOpts {
  /** Override the binary path for tests. Production resolves via SDK path. */
  codexPath?: string;
  /** Whether to force device-code flow (for headless / SSH). Default:
   *  auto-detect via `isHeadlessEnv()`. */
  deviceAuth?: boolean;
  /** stdout + stderr callback — production wires this into a log pane
   *  so the user sees the device code / URL without opening dev tools. */
  log?: (line: string) => void;
  /** Timeout for the whole flow. Default 5 min — plenty for a human to
   *  complete an OAuth browser flow; Codex itself enforces 10 min. */
  timeoutMs?: number;
  /** Inject env for tests. */
  env?: NodeJS.ProcessEnv;
  /** Seam for tests — spawn replacement. */
  spawnImpl?: typeof spawn;
}

export interface CodexLoginResult {
  ok: boolean;
  /** Exit code of the subprocess (null for signal / timeout). */
  exitCode: number | null;
  /** Mode the flow actually used. */
  mode: 'browser' | 'device-code';
  /** Combined stdout+stderr for surfacing to the user when ok=false. */
  output: string;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** Spawn `codex login` and wait for it to complete. Returns result —
 *  success (ok=true) means the token is now stored in the codex binary's
 *  keyring and subsequent `codex exec` calls will pick it up. Does NOT
 *  throw on failure · returns { ok: false } with the captured output so
 *  the caller can surface it. */
export async function spawnCodexLogin(
  opts: SpawnCodexLoginOpts = {},
): Promise<CodexLoginResult> {
  const codexPath = opts.codexPath ?? resolveBundledCodexPath();
  if (!codexPath) {
    return {
      ok: false,
      exitCode: null,
      mode: 'browser',
      output: 'Bundled codex binary not found — `@openai/codex-<platform>-<arch>` package missing. Re-run `bun install`.',
    };
  }
  const useDeviceAuth = opts.deviceAuth ?? isHeadlessEnv(opts.env);
  const args = useDeviceAuth ? ['login', '--device-auth'] : ['login'];
  const mode: CodexLoginResult['mode'] = useDeviceAuth ? 'device-code' : 'browser';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
  const spawnFn = opts.spawnImpl ?? spawn;

  if (debug.enabled) {
    debug.log('acp.codex.login.start', mode, { codexPath, args });
  }

  return new Promise<CodexLoginResult>((resolve) => {
    let settled = false;
    const parts: string[] = [];
    const child = spawnFn(codexPath, args, {
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as unknown as ChildProcessWithoutNullStreams;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
      if (debug.enabled) debug.log('acp.codex.login.timeout', mode, { timeoutMs }, { level: 'warn' });
      resolve({ ok: false, exitCode: null, mode, output: parts.join('') + '\n[codex login timed out]' });
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf-8');
      parts.push(text);
      if (opts.log) {
        for (const line of text.split('\n')) {
          if (line.trim().length > 0) opts.log(line);
        }
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (debug.enabled) debug.log('acp.codex.login.spawn-error', mode, { message: (err as Error)?.message }, { level: 'error' });
      resolve({ ok: false, exitCode: null, mode, output: parts.join('') + `\n[spawn error: ${err.message}]` });
    });

    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (debug.enabled) debug.log('acp.codex.login.exit', mode, { code });
      resolve({
        ok: code === 0,
        exitCode: code,
        mode,
        output: parts.join(''),
      });
    });
  });
}

/** Check whether the bundled codex binary is currently authenticated.
 *  Runs `codex login status` synchronously (fast · no network). Returns
 *  `true` on `Logged in ...`, `false` otherwise. Used for optional
 *  pre-flight checks — current design is lazy (we skip this) so callers
 *  don't normally need it, but it's available for diagnostics / UX. */
export async function isCodexLoggedIn(
  opts: { codexPath?: string; spawnImpl?: typeof spawn; timeoutMs?: number } = {},
): Promise<boolean> {
  const codexPath = opts.codexPath ?? resolveBundledCodexPath();
  if (!codexPath) return false;
  const spawnFn = opts.spawnImpl ?? spawn;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const parts: string[] = [];
    const child = spawnFn(codexPath, ['login', 'status'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as unknown as ChildProcessWithoutNullStreams;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
      resolve(false);
    }, timeoutMs);
    const onData = (chunk: Buffer): void => { parts.push(chunk.toString('utf-8')); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(false);
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Codex prints "Logged in using ChatGPT" / "Logged in using API key"
      // on stdout with exit 0 when authenticated · other shapes (e.g.
      // "Not logged in") exit non-zero OR print a no-match string.
      const text = parts.join('');
      resolve(code === 0 && /logged\s+in/i.test(text));
    });
  });
}
