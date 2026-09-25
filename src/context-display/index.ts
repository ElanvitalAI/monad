// ── Wave 1 · context-display barrel ──────────────────────────────────

export {
  recordLlmCall,
  recordLlmUsage,
  getRecentCalls,
  getLatestCall,
  getSessionStats,
  telemetryBufferStats,
  clearTelemetryForTest,
} from './telemetry.js';
export type { LlmCallTelemetry, SessionStats } from './telemetry.js';

export {
  formatContextSummary,
  formatNumber,
  formatProgressBar,
} from './format.js';
export type { FormatContextOpts, FormattedContextSummary } from './format.js';

export {
  buildContextSlashCommand,
} from './context-slash.js';
export type { ContextSlashCommandDescriptor } from './context-slash.js';

export {
  buildUsageSlashCommand,
  formatUsageSummary,
  type UsageSlashCommandDescriptor,
} from './usage-slash.js';
export {
  buildCostSlashCommand,
  formatCostSummary,
  type CostSlashCommandDescriptor,
} from './cost-slash.js';
export {
  buildMemorySlashCommand,
  listMemory,
  showMemory,
  type MemorySlashCommandDescriptor,
} from './memory-slash.js';
