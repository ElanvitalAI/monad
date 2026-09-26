// W9d-FU U5 daemon boot — composes the Patcher pipeline at NEXUS startup.
// Cf. 내부 문서 §2.3 follow-up #2.
//
// The W5 substrate (PR #2412) + W9c boot wire (PR #2443 startPatcherDaemon)
// already exist. This module is the NEXUS-level composer: read user
// config → resolve logger + bridge + store → start daemon → expose handle
// for graceful shutdown.
//
// Pattern mirrors `src/notifications/outbound-boot.ts` (PR #2453):
// - Sparse + dependency-injected (every IO seam is overridable)
// - Returns `{ handle, skipReason? }` so NEXUS boot can `console.warn`
//   on misconfigured / disabled state instead of crashing the daemon
// - Real LLM callables (entity-extractor + embedding-generator) are
//   passed in by the caller. When omitted the boot reports
//   `'patcher-llm-deps-missing'` and the daemon stays inactive even
//   when config.enabled === true (so a half-wired NEXUS does not write
//   bogus KGS rows).

import type { UserIntentLogger } from '../user-intent/logger.js';
import { userIntentLogger } from '../user-intent/logger.js';
import { PatcherBridge } from '../user-intent/sinks/patcher-bridge.js';
import { kgsStoreSingleton } from '../knowledge/kgs/sqlite-store.js';
import { EntityExtractor, type EntityExtractorCallable } from './patcher-extractors/entity-extractor.js';
import { EmbeddingGenerator, type EmbeddingCallable } from './patcher-extractors/embedding-generator.js';
import {
  loadPatcherConfig,
  fileSystemPatcherConfigSource,
  type PatcherConfig,
  type PatcherConfigSource,
} from './patcher-config.js';
import {
  startPatcherDaemon,
  type KgsCardStore,
  type PatcherDaemonHandle,
} from './patcher-daemon.js';

export type PatcherSkipReason =
  | 'patcher-disabled-in-config'
  | 'patcher-llm-deps-missing'
  | 'patcher-boot-error';

export interface PatcherSubstrate {
  handle: PatcherDaemonHandle | null;
  skipReason?: PatcherSkipReason;
  /** Detail line attached to `skipReason` (e.g. config path · error
   *  message). Surface logs render this verbatim so a misconfigured
   *  daemon is debuggable from `console.warn` alone. */
  detail?: string;
  /** The resolved config (defaults applied). Surface tooling can
   *  read this to display the effective state in `/v1/health` etc. */
  config: PatcherConfig;
}

export interface BuildPatcherSubstrateOpts {
  /** LLM-backed entity extractor. When omitted the boot returns
   *  `patcher-llm-deps-missing` even if config.enabled is true. */
  entityExtractorCallable?: EntityExtractorCallable;
  /** Embedding generator callable. Same gating rule as above. */
  embeddingCallable?: EmbeddingCallable;
  /** Override config source. Defaults to
   *  `fileSystemPatcherConfigSource()` (reads
   *  `~/.elanous/background-reasoning/patcher.yaml`). */
  configSource?: PatcherConfigSource;
  /** Override the UserIntentLogger singleton (test seam). */
  loggerOverride?: UserIntentLogger;
  /** Override the KGS card store (test seam). */
  storeOverride?: KgsCardStore;
  /** Override the PatcherBridge (test seam). */
  bridgeOverride?: PatcherBridge;
}

export function buildPatcherSubstrate(opts: BuildPatcherSubstrateOpts = {}): PatcherSubstrate {
  const configSource = opts.configSource ?? fileSystemPatcherConfigSource();
  const config = loadPatcherConfig(configSource);

  if (!config.enabled) {
    return {
      handle: null,
      skipReason: 'patcher-disabled-in-config',
      detail: 'set enabled: true in ~/.elanous/background-reasoning/patcher.yaml',
      config,
    };
  }

  if (!opts.entityExtractorCallable || !opts.embeddingCallable) {
    return {
      handle: null,
      skipReason: 'patcher-llm-deps-missing',
      detail: 'entityExtractorCallable + embeddingCallable required when enabled',
      config,
    };
  }

  try {
    const logger = opts.loggerOverride ?? userIntentLogger();
    const bridge = opts.bridgeOverride ?? new PatcherBridge();
    const store = opts.storeOverride ?? kgsStoreSingleton();
    const entityExtractor = new EntityExtractor({ callable: opts.entityExtractorCallable });
    const embeddingGenerator = new EmbeddingGenerator({ callable: opts.embeddingCallable });

    const handle = startPatcherDaemon({
      logger,
      bridge,
      store,
      entityExtractor,
      embeddingGenerator,
      config: {
        enabled: config.enabled,
        tickIntervalMs: config.tickIntervalMs,
      },
    });
    return { handle, config };
  } catch (err: unknown) {
    return {
      handle: null,
      skipReason: 'patcher-boot-error',
      detail: err instanceof Error ? err.message : String(err),
      config,
    };
  }
}

/** Graceful shutdown helper — invoke from NEXUS stop path so the
 *  Patcher daemon's interval + bridge sink are removed before the
 *  process exits. Idempotent on null handle. */
export function stopPatcherSubstrate(substrate: PatcherSubstrate | undefined): void {
  if (substrate?.handle) {
    try { substrate.handle.stop(); } catch { /* best-effort */ }
  }
}
