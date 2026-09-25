// ── PFC-S3: CFT barrel ──

export type {
  EscalationSeverity,
  EscalationSignal,
  EmitEscalationInput,
  EmitOpts,
  ResolveOpts,
  AndonListResult,
} from './andon.js';

export {
  emitEscalation,
  resolveEscalation,
  listEscalations,
  hasPendingCritical,
  getPendingCriticalSignals,
  countsBySeverity,
  buildAndonListResult,
  buildAndonPreamble,
  subscribeAndon,
  clearAllEscalationsForTest,
} from './andon.js';

export {
  buildEscalateSignalTool,
  dispatchEscalateSignal,
} from './tools/escalate-signal.js';
export type { EscalateSignalInput, EscalateSignalResult } from './tools/escalate-signal.js';

export {
  buildResolveEscalationTool,
  dispatchResolveEscalation,
} from './tools/resolve-escalation.js';
export type { ResolveEscalationInput, ResolveEscalationResult } from './tools/resolve-escalation.js';

export {
  buildAndonListTool,
  dispatchAndonList,
} from './tools/andon-list.js';
export type { AndonListInput, AndonListToolResult } from './tools/andon-list.js';

// ── PFC-S3.2: SPC ProcessHealthMetric ──
export {
  SPC_DEFAULT_CAPACITY,
  SPC_SIGMA_THRESHOLD,
  SPC_WARMUP_N,
  clearSpcForTest,
  getStats,
  listSeries,
  recordSample,
} from './spc.js';
export type {
  ProcessHealthSample,
  ProcessHealthStats,
} from './spc.js';

export {
  buildEmitProcessHealthTool,
  dispatchEmitProcessHealth,
} from './tools/emit-process-health.js';
export type {
  EmitProcessHealthInput,
  EmitProcessHealthResult,
} from './tools/emit-process-health.js';

// ── PFC-S3.3: Poka-Yoke ──
export {
  guardWrite,
  parseShallowFrontmatter,
  validate,
} from './pokayoke.js';
export type {
  GuardResult,
  GuardWriteArgs,
  PokaSchema,
  ValidateResult,
  ValidationFailure,
} from './pokayoke.js';
