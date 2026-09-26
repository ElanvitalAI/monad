// P5 (2026-05-10) — `elanous nexus pwa global` commands.
//
// Two subcommands operating on the P4 registry:
//
//   status — list every PWA daemon currently registered on this host
//            (across folders / projects / `nexus` vs `elanous-test`).
//            JSON or human-readable output. Auto-prunes stale entries
//            (dead pids).
//
//   clean  — bring down every alive instance + unmount their Tailscale
//            Serve mounts + clear the registry file. Default = real
//            run (no confirm — caller named the action). `--dry-run`
//            previews. `--stale-only` keeps live instances and just
//            drops dead-pid entries.
//
// Why a separate orchestrator (not just `pwa stop`)? `pwa stop` only
// touches THIS folder's daemon (the lock at `~/.elanous/nexus/.lock` or
// `<repo>/.elanous-test/.lock`). The registry sees instances from
// elsewhere too — global cleanup needs the unified view.

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { unmountTailscaleServe } from './tailscale-serve.js';
import {
  clearPwaRegistry,
  inspectPwaInstances,
  listPwaInstances,
  unregisterPwaInstance,
  type PwaInstanceListResult,
  type PwaInstanceListing,
} from './pwa-registry.js';
import { probeTailscale, type TailscaleProbe } from '../nexus/onboarding/tailscale-probe.js';

type TailscaleServeStatusResult = { exitCode: number; stdout: string; stderr: string };
type TailscaleServeStatusFn = (binary: string) => Promise<TailscaleServeStatusResult>;

interface OrphanTailscaleMounts {
  ports: number[];
  error?: string;
}

type TlsTcpPortsFromServeStatus =
  | { ok: true; ports: number[] }
  | { ok: false; error: string };

function tlsTcpPortsFromServeStatus(status: string): TlsTcpPortsFromServeStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(status);
  } catch {
    return { ok: false, error: 'invalid Serve status JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'invalid Serve status schema' };
  }
  const tcp = (parsed as { TCP?: unknown }).TCP;
  if (tcp === undefined) return { ok: true, ports: [] };
  if (!tcp || typeof tcp !== 'object' || Array.isArray(tcp)) {
    return { ok: false, error: 'invalid Serve status TCP schema' };
  }

  const ports: number[] = [];
  for (const [portKey, mapping] of Object.entries(tcp)) {
    const port = Number(portKey);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return { ok: false, error: 'invalid Serve status TCP port' };
    }
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      return { ok: false, error: 'invalid Serve status TCP mapping' };
    }
    const { TerminateTLS, TCPForward } = mapping as Record<string, unknown>;
    if (typeof TerminateTLS === 'string' && typeof TCPForward === 'string') ports.push(port);
  }
  return { ok: true, ports: ports.sort((a, b) => a - b) };
}

/** 기본 조회 — ⛔ 인자 자체를 시험할 수 있게 실행 함수를 «주입 가능»하게 둔다(리뷰 should-fix).
 *  주입된 `serveStatusFn` 만 검증하면 「기본 구현이 무엇을 실행하는가」는 아무도 안 본다. */
export async function defaultServeStatus(
  binary: string,
  execFn: typeof execFile = execFile,
): Promise<TailscaleServeStatusResult> {
  return new Promise((resolve) => {
    execFn(binary, ['serve', 'status', '--json'], (error, stdout, stderr) => {
      resolve({
        exitCode: error && typeof error.code === 'number' ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

async function findOrphanTailscaleMounts(
  instances: PwaInstanceListing[],
  probeFn: () => Promise<TailscaleProbe>,
  serveStatusFn: TailscaleServeStatusFn,
): Promise<OrphanTailscaleMounts> {
  try {
    const probe = await probeFn();
    if (!probe.installed) return { ports: [], error: 'tailscale not installed' };
    const status = await serveStatusFn(probe.binary ?? 'tailscale');
    if (status.exitCode !== 0) return { ports: [], error: (status.stderr || status.stdout || `exit ${status.exitCode}`).slice(0, 400) };
    const tlsPorts = tlsTcpPortsFromServeStatus(status.stdout);
    if (!tlsPorts.ok) return { ports: [], error: tlsPorts.error };
    const registeredPorts = new Set(
      instances
        .filter((entry) => entry.alive)
        .flatMap((entry) => entry.ports)
        .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535),
    );
    return { ports: tlsPorts.ports.filter((port) => !registeredPorts.has(port)) };
  } catch (error) {
    return { ports: [], error: error instanceof Error ? error.message : 'Serve status lookup failed' };
  }
}

export interface PwaGlobalStatusOpts {
  /** Format. Default 'human'. */
  format?: 'human' | 'json';
  /** Registry inspection seam. Its result carries both entries and diagnostics. */
  listFn?: (opts: { prune?: boolean }) => PwaInstanceListResult;
  /** Test seam — probe Tailscale before Serve status lookup. */
  probeFn?: () => Promise<TailscaleProbe>;
  /** Test seam — read `tailscale serve status --json`. */
  serveStatusFn?: TailscaleServeStatusFn;
  /** Output sink. Default = console. */
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface PwaGlobalStatusResult {
  exitCode: number;
  instances: PwaInstanceListing[];
  diagnostics?: PwaInstanceListResult['diagnostics'];
  orphanMountPorts: number[];
  orphanMountError?: string;
}

export async function runPwaGlobalStatus(
  opts: PwaGlobalStatusOpts = {},
): Promise<PwaGlobalStatusResult> {
  const out = opts.out ?? console;
  const format = opts.format ?? 'human';
  // This existing status path always receives the complete inspection result,
  // so a registry lookup is never rendered as a service-absence conclusion.
  const inspection = (opts.listFn ?? inspectPwaInstances)({ prune: true });
  const { instances, diagnostics } = inspection;
  const orphanMounts = await findOrphanTailscaleMounts(
    instances,
    opts.probeFn ?? (() => probeTailscale()),
    opts.serveStatusFn ?? defaultServeStatus,
  );
  const result = {
    exitCode: 0,
    instances,
    diagnostics,
    orphanMountPorts: orphanMounts.ports,
    ...(orphanMounts.error ? { orphanMountError: orphanMounts.error } : {}),
  };

  if (format === 'json') {
    out.log(JSON.stringify(result, null, 2));
    return result;
  }

  const renderOrphanMounts = () => {
    if (orphanMounts.error) out.log(`Disconnected Tailscale mounts: unavailable (${orphanMounts.error}).`);
    else out.log(`Disconnected Tailscale mounts: ${orphanMounts.ports.length === 0 ? '0' : orphanMounts.ports.join(', ')}.`);
  };

  const renderDiagnostics = () => {
    out.log(`Registry liveness criterion: ${diagnostics.livenessProbe}; service observation: ${diagnostics.serviceObservation}.`);
    out.log(`This read pruned ${diagnostics.pruned.length} entry(s)${diagnostics.pruned.length ? `: ${diagnostics.pruned.map((entry) => `pid ${entry.pid} (${entry.reason})`).join(', ')}` : ''}.`);
    if (diagnostics.serviceMismatch) out.log('Registry/service mismatch: no PWA daemon is registered, but an expected service endpoint responded.');
  };

  if (instances.length === 0) {
    out.log(`No PWA daemons registered on this host (registry ${diagnostics.readState}; this does not establish service absence).`);
    renderDiagnostics();
    renderOrphanMounts();
    out.log('Bring one up: `elanous nexus run --hmr`');
    return result;
  }

  out.log(`PWA daemons on this host (${instances.length}):`);
  renderDiagnostics();
  out.log('');
  for (const e of instances) {
    const aliveTag = e.alive ? '✓' : '✗ (stale)';
    const portsStr = e.ports.join(', ');
    const shareTag = e.shareMounted
      ? (e.https ? 'share=ad-hoc(--https)' : 'share=on')
      : 'share=off';
    out.log(`  pid ${e.pid} ${aliveTag} · ${e.mode} · ports [${portsStr}] · ${shareTag}`);
    out.log(`    cwd       ${e.cwd}`);
    out.log(`    daemonDir ${e.daemonDir}`);
    out.log(`    started   ${e.startedAt}`);
    out.log('');
  }
  renderOrphanMounts();
  out.log('Cleanup all: `elanous nexus pwa global clean`');
  return result;
}

export interface PwaGlobalCleanOpts {
  /** Preview only — no kills, no unmounts, no registry wipe. */
  dryRun?: boolean;
  /** Skip live instances; only prune dead-pid entries. */
  staleOnly?: boolean;
  /** Test seam — read registry. */
  listFn?: (opts: { prune?: boolean }) => PwaInstanceListing[];
  /** Test seam — clear registry file. */
  clearFn?: () => void;
  /** Test seam — remove one registry entry after its share unmount succeeds. */
  unregisterFn?: (pid: number) => void;
  /** Test seam — send SIGINT to a pid. */
  killFn?: (pid: number) => void;
  /** Test seam — probe tailscale. */
  probeFn?: () => Promise<TailscaleProbe>;
  /** Test seam — read `tailscale serve status --json`. */
  serveStatusFn?: TailscaleServeStatusFn;
  /** Test seam — safely remove one unregistered TLS Serve mapping. */
  /** Test seam — per-port unmount. Default uses unified helper with
   *  tls-tcp mode + sudo. */
  unmountFn?: (binary: string, port: number) => Promise<{ ok: boolean }>;
  /** Output sink. */
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface PwaGlobalCleanResult {
  exitCode: number;
  killed: number[];
  unmountedPorts: number[];
  failedUnmountPorts: number[];
  pruned: number;
  cleared: boolean;
}

async function defaultUnmount(binary: string, port: number): Promise<{ ok: boolean }> {
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
  return { ok: r.ok || r.reason === 'serve-cmd-failed' || r.reason === 'no-state' };
}

export async function runPwaGlobalClean(
  opts: PwaGlobalCleanOpts = {},
): Promise<PwaGlobalCleanResult> {
  const out = opts.out ?? console;
  const listFn = opts.listFn ?? listPwaInstances;
  const clearFn = opts.clearFn ?? clearPwaRegistry;
  const unregisterFn = opts.unregisterFn ?? unregisterPwaInstance;
  const killFn = opts.killFn ?? ((pid: number) => { try { process.kill(pid, 'SIGINT'); } catch { /* swallow */ } });
  const probeFn = opts.probeFn ?? (() => probeTailscale());
  const serveStatusFn = opts.serveStatusFn ?? defaultServeStatus;
  const unmountFn = opts.unmountFn ?? defaultUnmount;
  const dryRun = opts.dryRun === true;
  const staleOnly = opts.staleOnly === true;

  // prune 하지 않는다: 조회가 상태를 바꾸면 `--dry-run` 이 「아무것도 안 한다」는 계약을 깨고,
  // stale 대상·`pruned` 집계·`--stale-only` 가 비어 보인다.
  const instances = listFn({ prune: false });

  const orphanMounts = await findOrphanTailscaleMounts(instances, probeFn, serveStatusFn);

  // ⛔ 등록 항목이 0이면 «고아가 있든 없든» 보고하고 끝낸다.
  //   종전엔 고아가 있을 때 이 반환을 건너뛰어 아래 clearFn() 까지 흘러갔다 —
  //   지울 항목이 «없는데» 표를 비우고 'registry cleared' 를 찍었고, 그것은 이 착지의
  //   「보고까지」 범위 밖의 상태 변경이다.
  if (instances.length === 0) {
    out.log('No PWA daemons registered.');
    if (orphanMounts.error) out.log(`Disconnected Tailscale mounts: unavailable (${orphanMounts.error}).`);
    else out.log(`Disconnected Tailscale mounts: ${orphanMounts.ports.length === 0 ? '0' : orphanMounts.ports.join(', ')}.`);
    return { exitCode: 0, killed: [], unmountedPorts: [], failedUnmountPorts: [], pruned: 0, cleared: false };
  }

  const liveTargets = staleOnly ? [] : instances.filter((e) => e.alive);
  const staleTargets = instances.filter((e) => !e.alive);
  const liveUnmountPorts = liveTargets.filter((e) => e.shareMounted).flatMap((e) => e.ports);
  const staleUnmountPorts = staleTargets.filter((e) => e.shareMounted).flatMap((e) => e.ports);
  const portsToUnmount = Array.from(new Set([...liveUnmountPorts, ...staleUnmountPorts]));

  out.log(`PWA global clean${dryRun ? ' (dry-run)' : ''}:`);
  out.log(`  live instances:   ${liveTargets.length}${staleOnly ? ' (skipped — --stale-only)' : ''}`);
  out.log(`  stale entries:    ${staleTargets.length}`);
  out.log(`  live share ports: ${liveUnmountPorts.length === 0 ? '(none)' : liveUnmountPorts.join(', ')}`);
  out.log(`  stale share ports:${staleUnmountPorts.length === 0 ? ' (none)' : ` ${staleUnmountPorts.join(', ')}`}`);
  out.log(`  ports to unmount: ${portsToUnmount.length === 0 ? '(none)' : portsToUnmount.join(', ')}`);
  if (orphanMounts.error) out.log(`  disconnected Tailscale mounts: unavailable (${orphanMounts.error})`);
  else out.log(`  disconnected Tailscale mounts: ${orphanMounts.ports.length === 0 ? '0' : orphanMounts.ports.join(', ')}`);
  out.log('');

  if (dryRun) {
    return {
      exitCode: 0,
      killed: [],
      unmountedPorts: [],
      failedUnmountPorts: [],
      pruned: 0,
      cleared: false,
    };
  }

  // Step 1 — safely inspect and remove only the disconnected mappings before
  // legacy registered-port cleanup can issue `serve reset`.
  // ⛔⭐ 이 착지는 고아 마운트를 «보고»까지만 한다 — 걷지 않는다(하니스 분해기 판정 ①②).
  //   걷기는 legacy unmount 목록과 stale 레지스트리 항목 제거에 얽혀 있어 별도 착지로 간다
  //   (거부된 포트의 레지스트리 항목을 남겨 재시도 소유를 지키는 문제 · 이미 정리한 포트의 이중 처리).

  // Step 2 — SIGINT live targets.
  const killed: number[] = [];
  for (const e of liveTargets) {
    out.log(`  → SIGINT pid ${e.pid} (${e.mode} · cwd=${e.cwd})`);
    killFn(e.pid);
    killed.push(e.pid);
  }

  // Step 3 — per-port Tailscale Serve unmount (only when share was
  // actually mounted by us).
  const unmountedPorts: number[] = [];
  const failedUnmountPorts: number[] = [];
  if (portsToUnmount.length > 0) {
    try {
      const probe = await probeFn();
      if (probe.installed) {
        const binary = probe.binary ?? 'tailscale';
        for (const port of portsToUnmount) {
          out.log(`  → unmount Tailscale Serve port :${port}`);
          try {
            const r = await unmountFn(binary, port);
            if (r.ok) unmountedPorts.push(port);
            else failedUnmountPorts.push(port);
          } catch {
            failedUnmountPorts.push(port);
          }
        }
      } else {
        out.log('  (tailscale not installed — skipping unmount)');
        failedUnmountPorts.push(...portsToUnmount);
      }
    } catch {
      out.log('  (tailscale probe threw — skipping unmount)');
      failedUnmountPorts.push(...portsToUnmount);
    }
  }
  if (failedUnmountPorts.length > 0) {
    out.log(`  failed unmount ports: ${failedUnmountPorts.join(', ')}`);
  }

  // Step 4 — remove only entries whose shared mounts were confirmed
  // unmounted. Failed ports retain their owning registry entries for retry.
  const failedPorts = new Set(failedUnmountPorts);
  const removableTargets = instances.filter((entry) =>
    !entry.shareMounted || entry.ports.every((port) => !failedPorts.has(port)),
  );
  let cleared = false;
  let pruned = 0;
  if (!staleOnly && removableTargets.length === instances.length) {
    clearFn();
    cleared = true;
    pruned = staleTargets.length;
  } else {
    const targetsToRemove = staleOnly
      ? removableTargets.filter((entry) => !entry.alive)
      : removableTargets;
    for (const entry of targetsToRemove) unregisterFn(entry.pid);
    pruned = targetsToRemove.filter((entry) => !entry.alive).length;
  }

  out.log('');
  out.log(`Done. killed=${killed.length} · unmounted=${unmountedPorts.length} · pruned=${pruned}${cleared ? ' · registry cleared' : ''}`);

  return { exitCode: 0, killed, unmountedPorts, failedUnmountPorts, pruned, cleared };
}

// Suppress unused-import lint when this file is re-exported.
export const PWA_GLOBAL_INTERNAL_DAEMON_DIR_HINT = join(homedir(), '.elanous', 'pwa-registry.json');
