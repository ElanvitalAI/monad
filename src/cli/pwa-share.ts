// P.4 — `monad nexus pwa share <enable|disable|status>` mind-change CLI.
//
// Mirror of the first-boot wizard's outcome lever. The wizard (P.3)
// asks once; this CLI is the always-available knob for users who
// changed their mind, joined a new tailnet, or want to script automation.
//
// Behavior summary
//   enable  → flip switch → tailscale serve (idempotent · safe to repeat)
//   disable → flip switch → unmount this port's serve (idempotent · per-port)
//   status  → report { switchValue, tailscale: { installed, alive, host, ips } }
//
// As of P1 mode unification (2026-05-10), `enable` mounts the
// `--tls-terminated-tcp <port>` mode (HTTP/1.1 · WebSocket-friendly)
// instead of the legacy `--https=443` mode (HTTP/2 · WS 502). `disable`
// correspondingly unmounts only this port's serve via the unified
// helper, leaving any other Tailscale Serve mounts (e.g. concurrent
// multi-instance) untouched. The legacy `tailscale serve reset` global
// nuke is no longer used.

import {
  inspectTailscaleServeMount,
  unmountTailscaleServe,
  type TailscaleServeMountStatus,
} from './tailscale-serve.js';
import { probeTailscale, type TailscaleProbe } from '../nexus/onboarding/tailscale-probe.js';
import { defaultServe } from '../nexus/onboarding/pwa-share-prompt.js';
import {
  patchUserConfig,
  readSwitchValue,
  readUserConfig,
  writeSwitchValue,
} from '../nexus/config/user-config.js';
import { resolveNexusPwa, type NexusPwaResolution } from './nexus-show.js';
import { debug } from '../debug/log.js';

export type ShareTailnetValue = 'ask' | 'enabled' | 'disabled';
type SharePortSource = 'default' | 'explicit' | 'nexus' | 'unknown';

interface SharePortResolution {
  port?: number;
  source: SharePortSource;
  reason?: string;
}

export interface PwaShareDeps {
  /** Read switch (default: UserConfig). */
  readSwitch?: () => ShareTailnetValue;
  /** Persist switch (default: UserConfig). */
  saveSwitch?: (v: ShareTailnetValue) => void;
  /** Probe Tailscale. */
  probeFn?: () => Promise<TailscaleProbe>;
  /** Run `tailscale serve --bg --tls-terminated-tcp <port> tcp://localhost:<port>`. */
  serveFn?: (binary: string, port: number) => Promise<{ exitCode: number }>;
  /** Unmount THIS port's `tls-tcp` serve (per-port, not global reset). */
  resetFn?: (binary: string, port: number) => Promise<{ exitCode: number }>;
  /** Probe whether nexus is currently listening on the share port. Used
   *  by `enable` to add a hint when nexus isn't running yet. Default
   *  fetches `/v1/health`. */
  nexusAliveFn?: (port: number) => Promise<boolean>;
  /** Read this port's live Tailscale Serve mount without changing it. */
  mountStatusFn?: (binary: string, port: number) => Promise<TailscaleServeMountStatus>;
  /** Resolve the current daemon PWA URL for status reporting. */
  resolveNexusPwaFn?: () => NexusPwaResolution;
  /** HTTP port for the serve forward. Explicit values override daemon resolution. */
  port?: number;
  /** Output sink (default = console). */
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface PwaShareReport {
  switchValue: ShareTailnetValue;
  mountStatus: TailscaleServeMountStatus;
  port?: number;
  portSource: SharePortSource;
  portReason?: string;
  tailscale: {
    installed: boolean;
    alive: boolean;
    hostname?: string;
    magicDnsHost?: string;
    ips?: string[];
  };
  urls: {
    local: string;
    tailnet?: string;
  };
}

export interface PwaShareResult {
  exitCode: number;
  report?: PwaShareReport;
}

function defaultReadSwitch(): ShareTailnetValue {
  try {
    const v = readSwitchValue(readUserConfig(), 'global.nexus.pwa.shareTailnet');
    if (v === 'enabled' || v === 'disabled') return v;
  } catch { /* swallow */ }
  return 'ask';
}

function defaultSaveSwitch(v: ShareTailnetValue): void {
  try {
    patchUserConfig((cfg) => writeSwitchValue(cfg, 'global.nexus.pwa.shareTailnet', v));
  } catch { /* swallow */ }
}

async function defaultReset(binary: string, port: number): Promise<{ exitCode: number }> {
  // Per-port unmount via the unified helper. Other Tailscale Serve
  // mounts (e.g. concurrent multi-instance, or unrelated user mounts)
  // stay intact — the legacy `serve reset` global nuke is gone.
  const r = await unmountTailscaleServe({
    mode: { kind: 'tls-tcp', port },
    upstreamPort: port,
    useSudo: true,
    probeFn: async () => ({
      installed: true,
      alive: true,
      hostname: 'localhost',
      magicDnsHost: 'localhost',
      binary,
    }),
  });
  if (r.ok) return { exitCode: 0 };
  // Best-effort exit-code recovery: serve-cmd-failed often means
  // "nothing to unmount" which we surface as 0 (idempotent contract).
  if (r.reason === 'serve-cmd-failed' || r.reason === 'no-state') return { exitCode: 0 };
  return { exitCode: 1 };
}

async function defaultNexusAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function defaultMountStatus(binary: string, port: number): Promise<TailscaleServeMountStatus> {
  return inspectTailscaleServeMount({ binary, port, useSudo: true });
}

function resolveDeps(deps: PwaShareDeps): Required<PwaShareDeps> & { portExplicit: boolean } {
  return {
    readSwitch: deps.readSwitch ?? defaultReadSwitch,
    saveSwitch: deps.saveSwitch ?? defaultSaveSwitch,
    probeFn: deps.probeFn ?? (() => probeTailscale()),
    serveFn: deps.serveFn ?? defaultServe,
    resetFn: deps.resetFn ?? defaultReset,
    nexusAliveFn: deps.nexusAliveFn ?? defaultNexusAlive,
    mountStatusFn: deps.mountStatusFn ?? defaultMountStatus,
    resolveNexusPwaFn: deps.resolveNexusPwaFn ?? resolveNexusPwa,
    port: deps.port ?? 31415,
    portExplicit: deps.port !== undefined,
    out: deps.out ?? console,
  };
}

function resolveStatusPort(r: ReturnType<typeof resolveDeps>): SharePortResolution {
  if (r.portExplicit) return { port: r.port, source: 'explicit' };
  try {
    const pwa = r.resolveNexusPwaFn();
    if (!('loopback' in pwa)) return { source: 'unknown', reason: pwa.reason };
    const url = new URL(pwa.loopback);
    const port = Number(url.port);
    return Number.isInteger(port) && port >= 1 && port <= 65_535
      ? { port, source: 'nexus' }
      : { source: 'unknown', reason: 'pwa-port-unknown' };
  } catch {
    return { source: 'unknown', reason: 'pwa-query-failed' };
  }
}

function buildReport(args: {
  switchValue: ShareTailnetValue;
  mountStatus: TailscaleServeMountStatus;
  probe: TailscaleProbe;
  portResolution: SharePortResolution;
}): PwaShareReport {
  const { switchValue, mountStatus, probe, portResolution } = args;
  const { port } = portResolution;
  const tailnetHost = probe.magicDnsHost ?? probe.hostname ?? probe.ips?.[0];
  return {
    switchValue,
    mountStatus,
    ...(port !== undefined ? { port } : {}),
    portSource: portResolution.source,
    ...(portResolution.reason !== undefined ? { portReason: portResolution.reason } : {}),
    tailscale: {
      installed: probe.installed,
      alive: probe.alive,
      ...(probe.hostname !== undefined ? { hostname: probe.hostname } : {}),
      ...(probe.magicDnsHost !== undefined ? { magicDnsHost: probe.magicDnsHost } : {}),
      ...(probe.ips !== undefined ? { ips: probe.ips } : {}),
    },
    urls: {
      local: port === undefined ? 'unknown (PWA port unavailable)' : `http://127.0.0.1:${port}/app/`,
      ...(switchValue === 'enabled' && mountStatus !== 'unmounted' && tailnetHost && port !== undefined ? { tailnet: `https://${tailnetHost}:${port}/app/` } : {}),
    },
  };
}

export async function pwaShareEnable(deps: PwaShareDeps = {}): Promise<PwaShareResult> {
  const r = resolveDeps(deps);
  const probe = await r.probeFn();
  if (!probe.installed) {
    r.out.error('monad nexus pwa share enable: Tailscale not installed.');
    r.out.error('  Install: https://tailscale.com/download');
    return { exitCode: 1 };
  }
  if (!probe.alive) {
    r.out.error(`monad nexus pwa share enable: Tailscale not active (BackendState=${probe.backendState ?? 'unknown'}).`);
    r.out.error('  Start Tailscale + retry.');
    return { exitCode: 1 };
  }
  // Persist the user's intent to UserConfig BEFORE attempting serve.
  // The switch is the source of truth read by `pwa start` — saving it
  // first means a transient `tailscale serve` failure doesn't lose the
  // user's "I want share enabled" decision: the next `pwa start` (or
  // `pwa share enable` retry) auto-brings the forward up.
  r.saveSwitch('enabled');
  const serveResult = await r.serveFn(probe.binary ?? 'tailscale', r.port);
  if (serveResult.exitCode !== 0) {
    r.out.error(`monad nexus pwa share enable: tailscale serve failed (exit ${serveResult.exitCode}).`);
    r.out.error('  Switch saved (shareTailnet=enabled) — next `pwa start` will retry the forward.');
    return { exitCode: serveResult.exitCode };
  }
  const host = probe.magicDnsHost ?? probe.hostname ?? probe.ips?.[0] ?? '<host>';
  r.out.log(`✓ tailnet share enabled. URL: https://${host}:${r.port}/app/`);
  // Quick nexus health probe — if nothing is listening on r.port, the
  // forward is registered but has no upstream yet. Tell the user how to
  // bring nexus up so they don't think the share is broken.
  const nexusUp = await r.nexusAliveFn(r.port);
  if (!nexusUp) {
    r.out.log(`⚠ nexus is not currently running on :${r.port} — \`monad nexus run\` to bring it up.`);
  }
  return {
    exitCode: 0,
    report: buildReport({
      switchValue: 'enabled',
      mountStatus: 'mounted',
      probe,
      portResolution: { port: r.port, source: r.portExplicit ? 'explicit' : 'default' },
    }),
  };
}

export async function pwaShareDisable(deps: PwaShareDeps = {}): Promise<PwaShareResult> {
  const r = resolveDeps(deps);
  const probe = await r.probeFn();
  if (probe.installed && probe.alive) {
    const resetResult = await r.resetFn(probe.binary ?? 'tailscale', r.port);
    if (resetResult.exitCode !== 0) {
      // unmount is idempotent — non-zero usually means "nothing to
      // unmount on this port", which is a non-fatal warning.
      r.out.error(`(warn) tailscale serve unmount exit ${resetResult.exitCode} — assuming port :${r.port} already off.`);
    }
  }
  r.saveSwitch('disabled');
  r.out.log('✓ local-only. Re-enable: `monad nexus pwa share enable`.');
  return {
    exitCode: 0,
    report: buildReport({
      switchValue: 'disabled',
      mountStatus: 'unmounted',
      probe,
      portResolution: { port: r.port, source: r.portExplicit ? 'explicit' : 'default' },
    }),
  };
}

export async function pwaShareStatus(
  deps: PwaShareDeps = {},
  format: 'human' | 'json' = 'human',
): Promise<PwaShareResult> {
  const r = resolveDeps(deps);
  const switchValue = r.readSwitch();
  const probe = await r.probeFn();
  const portResolution = resolveStatusPort(r);
  debug.log('pwa.share', 'status-port-resolved', {
    source: portResolution.source,
    port: portResolution.port,
    reason: portResolution.reason,
  });
  const mountStatus = portResolution.port === undefined
    ? 'unknown'
    : await r.mountStatusFn(probe.binary ?? 'tailscale', portResolution.port);
  const report = buildReport({ switchValue, mountStatus, probe, portResolution });
  if (format === 'json') {
    r.out.log(JSON.stringify(report, null, 2));
    return { exitCode: 0, report };
  }
  r.out.log(`switch       ${switchValue}`);
  r.out.log(`tailscale    installed=${probe.installed} alive=${probe.alive}${probe.backendState ? ` (${probe.backendState})` : ''}`);
  r.out.log(`mount        ${mountStatus}`);
  r.out.log(`port         ${portResolution.port ?? `unknown${portResolution.reason ? ` (${portResolution.reason})` : ''}`}`);
  if (probe.magicDnsHost) r.out.log(`host         ${probe.magicDnsHost}`);
  if (probe.ips?.length) r.out.log(`ips          ${probe.ips.join(', ')}`);
  r.out.log(`local URL    ${report.urls.local}`);
  if (report.urls.tailnet) r.out.log(`tailnet URL  ${report.urls.tailnet}`);
  return { exitCode: 0, report };
}
