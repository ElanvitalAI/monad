/**
 * `wireTox` — single-call, surface-agnostic TOX bootstrap.
 *
 * Origin: 내부 문서 `PLAN-session-tox-boot`.
 * Surface-agnostic rename (2026-05-13): the older `wireToxForDashboard`
 * name signalled a dashboard-only contract that the implementation
 * never actually had. The function builds graph + bus + registry +
 * dispatcher + generator + feedback-loop + retry policy +
 * andon-bridge + runtime-deps in one shot — every surface (NEXUS daemon,
 * PWA Intake, iPhone, MCP, ACP, future) can share one instance. The
 * legacy name is kept as a deprecated alias for source compat.
 *
 * Builds graph + bus + registry + dispatcher + generator + feedback-
 * loop + retry policy + andon-bridge + runtime-deps in one shot.
 * All IO is injected via the `ToxBootOptions` callables; the boot
 * helper itself doesn't touch fs / subprocesses — that stays in the
 * callables the caller wires.
 *
 * Caller boot adds ~3 lines:
 *
 *   const tox = wireTox({ surfaces, decompose, andon });
 *   // … use tox.graph / tox.loop etc. where needed
 *   // on shutdown: tox.dispose();
 *
 * Surface-agnostic boot rationale: see
 * `내부 문서 `RESEARCH-tox-surface-agnostic-boot-2026-05-13``.
 */
import { TaskGraph } from './graph.js';
import { TaskEventBus } from './events.js';
import { SurfaceRegistry } from './surface-registry.js';
import { TaskDispatcher } from './dispatcher.js';
import {
  TaskGenerator,
  type DecomposeCallable,
} from './generator.js';
import {
  TaskFeedbackLoop,
  type BudgetGate,
  type TerminationGate,
} from './feedback-loop.js';
import { RetryPolicy } from './retry.js';
import {
  startAndonBridge,
  type AndonSignalLike,
  type AndonSubscriberKind,
  type AndonUnsubscribe,
} from './andon-bridge.js';
import {
  registerSurfaceAdapters,
  type SurfaceAdapterDeps,
} from './surfaces/index.js';
import { setToxRuntimeDeps, resetToxRuntimeDepsForTest } from './runtime-deps.js';
import type { TaskSurfaceKind } from './types.js';
import type { TaskStore } from './store.js';

export type AndonSubscribeSeam = (
  fn: (signal: AndonSignalLike, kind: AndonSubscriberKind) => void,
) => AndonUnsubscribe;

export interface ToxBootOptions {
  surfaces?: SurfaceAdapterDeps;
  decompose?: DecomposeCallable;

  terminationCheck?: TerminationGate;
  budgetCheck?: BudgetGate;
  hasPendingCritical?: () => boolean;

  startFeedbackLoop?: boolean;
  startRetryPolicy?: boolean;

  andon?: {
    subscribe: AndonSubscribeSeam;
    hasPendingCritical?: () => boolean;
  };

  graph?: TaskGraph;
  bus?: TaskEventBus;
  registry?: SurfaceRegistry;
  store?: TaskStore;

  reprioritizeEvery?: number;
  maxRegenerateDepth?: number;
  retryBaseDelayMs?: number;
  retryFactor?: number;

  regenerateObjective?: (goalSlug: string) => string | null;
  reprioritize?: (graph: TaskGraph, goalSlug: string | undefined) => void;

  now?: () => number;
  log?: (line: string) => void;
}

export interface ToxBootHandle {
  graph: TaskGraph;
  bus: TaskEventBus;
  registry: SurfaceRegistry;
  dispatcher: TaskDispatcher;
  generator: TaskGenerator | null;
  loop: TaskFeedbackLoop;
  retry: RetryPolicy;
  disposeAndon: () => void;
  registeredSurfaceKinds: TaskSurfaceKind[];
  dispose(): void;
}

export function wireTox(opts: ToxBootOptions = {}): ToxBootHandle {
  const now = opts.now ?? Date.now;
  const log = opts.log;

  const graph = opts.graph ?? new TaskGraph();
  const bus = opts.bus ?? new TaskEventBus();
  const registry = opts.registry ?? new SurfaceRegistry();

  const registeredSurfaceKinds = opts.surfaces
    ? registerSurfaceAdapters(registry, { ...opts.surfaces, now, overwrite: true })
    : [];

  const dispatcher = new TaskDispatcher({ graph, registry, bus, now });

  const generator = opts.decompose
    ? new TaskGenerator({ callable: opts.decompose })
    : null;

  const loop = new TaskFeedbackLoop({
    graph,
    dispatcher,
    bus,
    generator: generator ?? undefined,
    terminationCheck: opts.terminationCheck,
    budgetCheck: opts.budgetCheck,
    hasPendingCritical: opts.hasPendingCritical,
    regenerateObjective: opts.regenerateObjective,
    reprioritize: opts.reprioritize,
    reprioritizeEvery: opts.reprioritizeEvery,
    maxRegenerateDepth: opts.maxRegenerateDepth,
    now,
    log,
  });

  const retry = new RetryPolicy({
    graph,
    bus,
    baseDelayMs: opts.retryBaseDelayMs,
    factor: opts.retryFactor,
    now,
    log,
  });

  if (opts.startFeedbackLoop !== false) loop.start();
  if (opts.startRetryPolicy !== false) retry.start();

  let disposeAndon: () => void = () => {};
  if (opts.andon) {
    disposeAndon = startAndonBridge({
      loop,
      subscribe: opts.andon.subscribe,
      hasPendingCritical: opts.andon.hasPendingCritical,
      log,
    });
  }

  // Make the runtime tool deps see our handles. Later boot cycles
  // will overwrite (tests frequently).
  setToxRuntimeDeps({
    getGraph: () => graph,
    getDispatcher: () => dispatcher,
    getGenerator: () => generator,
    getStore: () => opts.store ?? null,
    getFeedbackLoop: () => loop,
  });

  log?.(
    `[tox-boot] surfaces=${registeredSurfaceKinds.join(',') || 'none'} generator=${generator ? 'yes' : 'no'} andon=${opts.andon ? 'yes' : 'no'}`,
  );

  const handle: ToxBootHandle = {
    graph,
    bus,
    registry,
    dispatcher,
    generator,
    loop,
    retry,
    disposeAndon,
    registeredSurfaceKinds,
    dispose() {
      try {
        loop.stop();
      } catch {
        /* noop */
      }
      try {
        retry.stop();
      } catch {
        /* noop */
      }
      try {
        disposeAndon();
      } catch {
        /* noop */
      }
      resetToxRuntimeDepsForTest();
      log?.('[tox-boot] disposed');
    },
  };
  return handle;
}

/**
 * @deprecated Renamed to `wireTox` (2026-05-13) — the old name signalled
 * a dashboard-specific contract that the implementation never had. Kept
 * as an alias for source compat; new callers use `wireTox`. Tests can
 * also call `wireTox` directly; this alias may be removed once external
 * source references are migrated.
 */
export const wireToxForDashboard = wireTox;
