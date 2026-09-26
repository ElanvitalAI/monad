// `elanous nexus config <list|get|set|unset>` — single ops surface for
// the UserConfig file at `~/.elanous/config.json`.
//
// User feedback (2026-05-07): "환경변수 방식 싫음 · 그 user config 자체도
// nexus 에서 컨트롤할 수 있게." Every knob already lives in UserConfig
// (per the SwitchRegistry design); the CLI just needs to surface
// list/get/set/unset of arbitrary dot-paths so users don't hand-edit
// JSON or memorise field names.
//
// Path shape:
//   global.<...>          — GlobalConfig fields, e.g. global.tools,
//                           global.pwa.devProxyUpstream, global.debug.enabled
//   tabs.<tabId>.<...>    — per-tab knobs, e.g. tabs.daemon:1.httpPort
//
// `set` parses the value as JSON first (so booleans, numbers, and JSON
// objects survive), falling back to a plain string if parsing fails.
// `unset` is no-op-on-missing — safe to script.

import {
  patchUserConfig,
  readSwitchValue,
  readUserConfig,
  unsetSwitchValue,
  writeSwitchValue,
} from '../nexus/config/user-config.js';

export interface NexusConfigDeps {
  /** Test seam — replace UserConfig read. Defaults to file-backed. */
  readFn?: () => ReturnType<typeof readUserConfig>;
  /** Test seam — replace UserConfig patch (mutator + persist). */
  patchFn?: (mutate: (cfg: ReturnType<typeof readUserConfig>) => void) => void;
  /** Output sink (default = console). */
  out?: { log: (s: string) => void; error: (s: string) => void };
}

export interface NexusConfigResult {
  exitCode: number;
}

const DEFAULT_DEPS: Required<Pick<NexusConfigDeps, 'readFn' | 'patchFn'>> = {
  readFn: readUserConfig,
  patchFn: (mutate) => {
    patchUserConfig(mutate);
  },
};

function resolveDeps(deps: NexusConfigDeps): {
  readFn: NonNullable<NexusConfigDeps['readFn']>;
  patchFn: NonNullable<NexusConfigDeps['patchFn']>;
  out: NonNullable<NexusConfigDeps['out']>;
} {
  return {
    readFn: deps.readFn ?? DEFAULT_DEPS.readFn,
    patchFn: deps.patchFn ?? DEFAULT_DEPS.patchFn,
    out: deps.out ?? console,
  };
}

export function nexusConfigList(deps: NexusConfigDeps = {}): NexusConfigResult {
  const { readFn, out } = resolveDeps(deps);
  const cfg = readFn();
  out.log(JSON.stringify(cfg, null, 2));
  return { exitCode: 0 };
}

export function nexusConfigGet(path: string, deps: NexusConfigDeps = {}): NexusConfigResult {
  const { readFn, out } = resolveDeps(deps);
  if (!isValidPath(path)) {
    out.error(`elanous nexus config get: invalid path "${path}" (use global.<...> or tabs.<id>.<...>).`);
    return { exitCode: 1 };
  }
  const cfg = readFn();
  const value = readSwitchValue(cfg, path);
  if (value === undefined) {
    out.error(`elanous nexus config get: ${path} is not set.`);
    return { exitCode: 1 };
  }
  out.log(typeof value === 'string' ? value : JSON.stringify(value));
  return { exitCode: 0 };
}

export function nexusConfigSet(
  path: string,
  rawValue: string,
  deps: NexusConfigDeps = {},
): NexusConfigResult {
  const { patchFn, out } = resolveDeps(deps);
  if (!isValidPath(path)) {
    out.error(`elanous nexus config set: invalid path "${path}" (use global.<...> or tabs.<id>.<...>).`);
    return { exitCode: 1 };
  }
  const value = parseValue(rawValue);
  try {
    patchFn((cfg) => writeSwitchValue(cfg, path, value));
  } catch (err) {
    out.error(`elanous nexus config set: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 1 };
  }
  out.log(`set ${path} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return { exitCode: 0 };
}

export function nexusConfigUnset(path: string, deps: NexusConfigDeps = {}): NexusConfigResult {
  const { patchFn, out } = resolveDeps(deps);
  if (!isValidPath(path)) {
    out.error(`elanous nexus config unset: invalid path "${path}" (use global.<...> or tabs.<id>.<...>).`);
    return { exitCode: 1 };
  }
  try {
    patchFn((cfg) => unsetSwitchValue(cfg, path));
  } catch (err) {
    out.error(`elanous nexus config unset: ${err instanceof Error ? err.message : String(err)}`);
    return { exitCode: 1 };
  }
  out.log(`unset ${path}`);
  return { exitCode: 0 };
}

function isValidPath(path: string): boolean {
  if (!path) return false;
  const parts = path.split('.');
  if (parts.length < 2) return false;
  if (parts[0] !== 'global' && parts[0] !== 'tabs') return false;
  // `tabs.<id>` (2 parts) targets the whole tab record — valid for
  // unset / set (rare). `tabs.<id>.<...>` targets a field. We accept
  // both; the underlying writers handle each case.
  if (parts[0] === 'tabs' && !parts[1]) return false;
  return parts.every((p) => p.length > 0);
}

/** Try JSON.parse first (catches booleans, numbers, arrays, objects).
 *  Fall back to the raw string so quote-less inputs still work. */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
