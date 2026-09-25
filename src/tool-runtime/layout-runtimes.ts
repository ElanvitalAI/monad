// ── Layout* runtimes — VW save/load/preset bridge ──
//
// Wraps dispatchSaveLayout / dispatchLoadLayout / dispatchApplyLayoutPreset
// in the ToolRuntime shape. Registration requires a WindowRegistry
// (captured at first init), so this module exports a factory
// registerLayoutRuntimes(registry) instead of a bare side-effectful
// register() — dashboard boot calls it after the registry is built.

import {
  buildApplyLayoutPresetTool,
  buildLoadLayoutTool,
  buildSaveLayoutTool,
  dispatchApplyLayoutPreset,
  dispatchLoadLayout,
  dispatchSaveLayout,
} from '../virtual-windows/layout/layout-tools.js';
import type { WindowRegistry } from '../virtual-windows/window-registry.js';
import type { ArtifactStore } from '../artifact/index.js';
import { registerToolRuntime } from './registry.js';
import type { ToolRuntime } from './types.js';

type Args = Record<string, unknown>;
type Out = { output: string };

function stringifyOutput(obj: unknown): Out {
  return { output: JSON.stringify(obj) };
}

let registered = false;

export interface RegisterLayoutRuntimesOpts {
  /** Bundle B-5 (P6-4) — when provided, SaveLayout output goes
   *  through unified `ArtifactStore.put('layout', ...)` under
   *  `~/.monad/artifacts/layout/`. Legacy `~/.monad/layouts/` path is
   *  the fallback for callers without store DI. */
  readonly artifactStore?: ArtifactStore;
}

export function registerLayoutRuntimes(
  registry: WindowRegistry,
  opts: RegisterLayoutRuntimesOpts = {},
): void {
  if (registered) return;
  const deps = {
    registry,
    ...(opts.artifactStore !== undefined ? { artifactStore: opts.artifactStore } : {}),
  };

  const saveRuntime: ToolRuntime<Args, Out> = {
    id: 'layout_save',
    spec: buildSaveLayoutTool(),
    async run(req) {
      return stringifyOutput(await dispatchSaveLayout(deps, req));
    },
  };

  const loadRuntime: ToolRuntime<Args, Out> = {
    id: 'layout_load',
    spec: buildLoadLayoutTool(),
    async run(req) {
      return stringifyOutput(await dispatchLoadLayout(deps, req));
    },
  };

  const applyRuntime: ToolRuntime<Args, Out> = {
    id: 'layout_apply_preset',
    spec: buildApplyLayoutPresetTool(),
    async run(req) {
      return stringifyOutput(dispatchApplyLayoutPreset(deps, req));
    },
  };

  registerToolRuntime(saveRuntime);
  registerToolRuntime(loadRuntime);
  registerToolRuntime(applyRuntime);
  registered = true;
}

export function __resetLayoutRuntimesForTest(): void {
  registered = false;
}
