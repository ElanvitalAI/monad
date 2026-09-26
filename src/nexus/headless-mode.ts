// P.1.5 — `--headless` flag · resolve headless-mode opt + env.
//
// Background (HANDOFF Track P §3): `elanous nexus` default is a foreground
// TUI render loop. The same process owns both the HTTP API + WS bridge
// (PWA / iPhone backend, service responsibility) and the TUI render loop
// (developer debug, dev tool responsibility). When the TUI exits, the
// service exits with it — so the lifecycle is bound to a controlling
// terminal and is incompatible with `nohup ... &`, launchd, systemd-user,
// or Docker containers (any environment without an interactive tty).
//
// Headless mode breaks the binding: `ELANOUS_NEXUS_HEADLESS=1 elanous nexus`
// (or `elanous nexus --headless`) skips `runNexusTui` entirely + blocks on
// SIGINT / SIGTERM. The HTTP API + supervisor + meta-API stay live so
// PWA + remote attach keep working.

export interface ResolveHeadlessOptions {
  /** Explicit opt — wins over env when set (true | false). */
  headless?: boolean;
  /** Env source. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

const TRUTHY_ENV = new Set(['1', 'true', 'yes', 'on']);

/** Resolve whether NEXUS should boot in headless mode (no TUI).
 *
 *  Resolution order:
 *
 *    1. `opts.headless` (boolean) — explicit opt wins, including
 *       `false` to opt out even when env is set.
 *    2. env `ELANOUS_NEXUS_HEADLESS` truthy (`1` / `true` / `yes` / `on`).
 *    3. default false (TUI mode).
 *
 *  Note: this resolver does NOT consult `process.stdin.isTTY`. A non-TTY
 *  environment is a strong hint headless is wanted, but auto-flipping
 *  on TTY absence would surprise users running `elanous nexus | tee` or
 *  similar pipelines. The first-boot wizard (P.3) is the layer that
 *  reads isTTY for prompt suppression. */
export function resolveHeadlessMode(opts: ResolveHeadlessOptions = {}): boolean {
  if (typeof opts.headless === 'boolean') return opts.headless;
  const env = opts.env ?? process.env;
  const raw = env.ELANOUS_NEXUS_HEADLESS?.trim().toLowerCase() ?? '';
  return TRUTHY_ENV.has(raw);
}
