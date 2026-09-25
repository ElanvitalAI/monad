// Dashboard HITL wiring — T1-P3.
//
// Stitches the callback server, Pushcut client, and
// requestConfirmation default channels together. One init() at
// dashboard startup, one stop() at shutdown. Kept in its own
// module so tests can substitute fakes without dragging in the
// whole dashboard.ts.
//
// Startup path:
//
//   1. createHitlCallbackServer({ port, secret }) — a small HTTP
//      listener bound to 127.0.0.1. When Pushcut's Shortcut POSTs
//      to /hitl/callback/:requestId the matching awaitCallback()
//      promise resolves.
//
//   2. getPushcutClient() — may be configured:false when the
//      user hasn't dropped a pushcut.json. In that case the
//      Pushcut channel still registers but every request() returns
//      null so other channels (terminal) win the race.
//
//   3. registerDefaultConfirmChannels([pushcut, terminal]) —
//      requestConfirmation picks these up when no explicit
//      channels are passed (the common case).
//
// Env knobs:
//
//   MONAD_HITL_PORT              — override default 17645; scan on
//                                  EADDRINUSE up to PORT_SCAN_RANGE
//   MONAD_HITL_CALLBACK_PORT     — strict port (no scan). 0 =
//                                  OS-assigned. Takes precedence
//                                  over MONAD_HITL_PORT. Use this
//                                  when the Pushcut Shortcut URL is
//                                  already baked to a specific port
//                                  and you want the dashboard to
//                                  fail fast instead of sliding
//                                  silently (CB4).
//   MONAD_HITL_PORT_SCAN_RANGE   — forward-scan distance (default 20)
//   MONAD_HITL_SECRET            — require X-Monad-Secret header on POSTs
//   MONAD_HITL_NOTIFY            — pushcut notification name (default
//                                  monad-confirm)

import {
  createHitlCallbackServer,
  type HitlCallbackServer,
  type HitlCallbackServerOpts,
} from '../../hitl/callback-server.js';
import {
  createPushcutConfirmChannel,
  createTerminalConfirmChannel,
  registerDefaultConfirmChannels,
  type ConfirmChannel,
  type TerminalConfirmDeps,
} from '../../hitl/confirm.js';
import { getPushcutClient } from '../../pushcut/client.js';
import { addAllowed } from '../../tool-hints/api-allowlist.js';

export interface DashboardHitlDeps {
  /** Provide a factory so the listener can be swapped out (tests). */
  serverFactory?: (opts: HitlCallbackServerOpts) => HitlCallbackServer;
  /** Override the Pushcut client lookup (tests inject fakes). */
  pushcutClientFactory?: () => ReturnType<typeof getPushcutClient>;
  /** Terminal channel's host hooks — show/clear prompt + await
   *  keyboard answer. */
  terminal?: TerminalConfirmDeps;
  /** Override env-based config. */
  port?: number;
  /** How many ports to try starting at `port` before giving up.
   *  Default 20 (CB1). env override: MONAD_HITL_PORT_SCAN_RANGE. */
  portScanRange?: number;
  /** Called once when the listener binds to a port other than the
   *  one requested. Used to notify the user their Pushcut Shortcut
   *  URL needs updating (CB3). */
  onPortShift?: (info: { wanted: number; actual: number }) => void;
  secret?: string;
  notificationName?: string;
  /** When true, don't register Pushcut channel (e.g. unit tests
   *  that don't need round-tripping). */
  skipPushcut?: boolean;
}

export interface DashboardHitlState {
  server: HitlCallbackServer;
  channels: ConfirmChannel[];
  /** Final bound port. Null when start() failed. */
  callbackPort: number | null;
  /** Full callback URL — `http://127.0.0.1:<port>`. Null when
   *  start() failed. The Pushcut Shortcut needs this URL as the
   *  "POST to" target; it lives for the process lifetime. */
  callbackUrl: string | null;
  /** True when the bound port differs from what was requested. */
  portShifted: boolean;
  wantedPort: number;
}

let state: DashboardHitlState | null = null;

export async function initDashboardHitl(deps: DashboardHitlDeps = {}): Promise<DashboardHitlState> {
  if (state) return state;
  const factory = deps.serverFactory ?? createHitlCallbackServer;
  // CB4 — MONAD_HITL_CALLBACK_PORT is a strict requirement (no scan),
  //       wins over MONAD_HITL_PORT when both are set. =0 means OS-
  //       assigned. Absent → fall through to scan-friendly PORT.
  const envCallbackPort = process.env['MONAD_HITL_CALLBACK_PORT'];
  const envCallbackParsed = envCallbackPort !== undefined
    ? Number.parseInt(envCallbackPort, 10)
    : NaN;
  const strictCallbackPort = Number.isFinite(envCallbackParsed) && envCallbackParsed >= 0
    ? envCallbackParsed
    : null;
  const port = deps.port ?? strictCallbackPort ?? (() => {
    const envPort = process.env['MONAD_HITL_PORT'];
    const parsed = envPort ? Number.parseInt(envPort, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 17645;
  })();
  // Strict env pins range to 1 (no scan). Test/dev can override via
  // deps.portScanRange which wins.
  const portScanRange = deps.portScanRange ?? (strictCallbackPort !== null ? 1 : (() => {
    const envRange = process.env['MONAD_HITL_PORT_SCAN_RANGE'];
    const parsed = envRange ? Number.parseInt(envRange, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
  })());
  const secret = deps.secret ?? process.env['MONAD_HITL_SECRET'];
  const notificationName = deps.notificationName
    ?? process.env['MONAD_HITL_NOTIFY']
    ?? 'monad-confirm';

  let shiftInfo: { wanted: number; actual: number } | null = null;
  const server = factory({
    port,
    portScanRange,
    secret,
    onPortShift: (info) => {
      shiftInfo = info;
      try { deps.onPortShift?.(info); } catch { /* ignore */ }
    },
  });
  try { await server.start(); }
  catch (err) {
    // Surface but don't crash the dashboard — HITL degrades to
    // terminal-only. Most likely cause: port already in use.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[hitl] callback listener failed to start on ${port}: ${msg}. Running terminal-only.`);
  }

  const channels: ConfirmChannel[] = [];

  if (!deps.skipPushcut) {
    const clientFactory = deps.pushcutClientFactory ?? getPushcutClient;
    const pushcutClient = clientFactory();
    channels.push(createPushcutConfirmChannel({
      client: pushcutClient,
      notificationName,
      awaitCallback: (requestId) => server.awaitCallback(requestId),
    }));
    // T1-P4 — session-scope allowlist so an agent can call Pushcut
    // endpoints via the generic api_call tool without the user
    // running `/api-allow add api.pushcut.io` by hand. Persistent
    // flag stays false: next session still needs explicit opt-in
    // for persistent policy.
    if (pushcutClient.configured) {
      try {
        addAllowed('api.pushcut.io', { sessionOnly: true, reason: 'pushcut HITL' });
      } catch { /* allowlist failure is non-fatal */ }
    }
  }

  if (deps.terminal) {
    channels.push(createTerminalConfirmChannel(deps.terminal));
  }

  registerDefaultConfirmChannels(channels);
  const callbackPort = server.port();
  const callbackUrl = server.url();
  state = {
    server,
    channels,
    callbackPort,
    callbackUrl,
    portShifted: shiftInfo !== null,
    wantedPort: port,
  };
  return state;
}

/** Process-wide accessor — returns the Pushcut callback URL for the
 *  running dashboard. Null when the listener never came up. */
export function getHitlCallbackUrl(): string | null {
  return state?.callbackUrl ?? null;
}

/** Process-wide accessor — returns the bound port. */
export function getHitlCallbackPort(): number | null {
  return state?.callbackPort ?? null;
}

export function getDashboardHitl(): DashboardHitlState | null {
  return state;
}

export async function stopDashboardHitl(): Promise<void> {
  if (!state) return;
  const s = state.server;
  state = null;
  try { await s.stop(); } catch { /* ignore */ }
  registerDefaultConfirmChannels([]);
}

/** Test-only reset. Tears down the listener and clears singletons. */
export async function _resetDashboardHitlForTesting(): Promise<void> {
  await stopDashboardHitl();
}
