import {
  registerPwaInstance,
  resolvePwaLauncherProvenance,
  unregisterPwaInstance,
  type PwaInstanceKind,
  type PwaInstanceMode,
  type PwaLauncherProvenance,
  type PwaRegistryEntry,
} from '../cli/pwa-registry.js';
import { debug } from '../debug/log.js';

export interface PwaRegistrationDeps {
  register?: (entry: PwaRegistryEntry) => void;
  unregister?: (pid: number) => void;
  resolveLauncher?: () => PwaLauncherProvenance;
  observe?: (event: 'registered' | 'register-failed' | 'unregistered' | 'unregister-failed' | 'port-unknown' | 'register-skipped-closed', data: Record<string, unknown>) => void;
}

export interface PwaRegistrationOptions {
  pid: number;
  port: number | undefined;
  mode: PwaInstanceMode;
  kind: PwaInstanceKind;
  cwd: string;
  daemonDir: string;
  shareMounted: boolean;
  https: boolean;
  startedAt: string;
}

type PwaRegistrationResult =
  | { status: 'registered' }
  | { status: 'port-unknown' }
  | { status: 'closed' }
  | { status: 'register-failed' };

type PwaUnregistrationResult =
  | { status: 'unregistered' }
  | { status: 'not-registered' }
  | { status: 'unregister-failed' };

const defaultObserve: NonNullable<PwaRegistrationDeps['observe']> = (event, data) => {
  debug.log('nexus.pwa-registration', event, data);
};

function observeSafely(
  observe: NonNullable<PwaRegistrationDeps['observe']>,
  event: Parameters<NonNullable<PwaRegistrationDeps['observe']>>[0],
  data: Record<string, unknown>,
): void {
  try { observe(event, data); } catch { /* observation is best-effort */ }
}

export function createPwaRegistration(deps: PwaRegistrationDeps = {}) {
  const register = deps.register ?? registerPwaInstance;
  const unregister = deps.unregister ?? unregisterPwaInstance;
  const resolveLauncher = deps.resolveLauncher ?? (() => resolvePwaLauncherProvenance({ env: process.env, isTTY: process.stdin.isTTY }));
  const observe = deps.observe ?? defaultObserve;
  let registeredPid: number | undefined;
  let closed = false;

  return {
    register(options: PwaRegistrationOptions): PwaRegistrationResult {
      if (closed) {
        observeSafely(observe, 'register-skipped-closed', { pid: options.pid });
        return { status: 'closed' };
      }
      const port = options.port;
      if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
        observeSafely(observe, 'port-unknown', { pid: options.pid, port });
        return { status: 'port-unknown' };
      }
      try {
        const entry: PwaRegistryEntry = {
          pid: options.pid,
          ports: [port],
          mode: options.mode,
          kind: options.kind,
          cwd: options.cwd,
          daemonDir: options.daemonDir,
          shareMounted: options.shareMounted,
          https: options.https,
          startedAt: options.startedAt,
          launcherProvenance: resolveLauncher(),
        };
        register(entry);
        registeredPid = options.pid;
        observeSafely(observe, 'registered', { pid: entry.pid, ports: entry.ports, shareMounted: entry.shareMounted });
        return { status: 'registered' };
      } catch (error) {
        observeSafely(observe, 'register-failed', { pid: options.pid, ports: [port], error: String(error) });
        return { status: 'register-failed' };
      }
    },
    unregister(): PwaUnregistrationResult {
      closed = true;
      if (registeredPid === undefined) {
        observeSafely(observe, 'unregistered', { status: 'not-registered' });
        return { status: 'not-registered' };
      }
      const pid = registeredPid;
      registeredPid = undefined;
      try {
        unregister(pid);
        observeSafely(observe, 'unregistered', { pid });
        return { status: 'unregistered' };
      } catch (error) {
        observeSafely(observe, 'unregister-failed', { pid, error: String(error) });
        return { status: 'unregister-failed' };
      }
    },
  };
}
