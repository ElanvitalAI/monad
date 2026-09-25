// ── PFC-S5 P6: intelligence-map barrel ──

export type {
  ModelEntry,
  ModelCatalog,
  ModelProvider,
  SystemSnapshot,
  UsageEvent,
  CostSnapshot,
  CostPerModel,
  CostPerGoal,
  CostCapConfig,
  CostCapStatus,
} from './types.js';

export {
  BUILTIN_CATALOG,
  discoverModels,
  enabledModels,
  getCatalogPath,
  loadCatalog,
  persistCatalog,
} from './model-catalog.js';

export {
  buildClassifyMessages,
  classifyModelsFromText,
  classifyModelsFromTextDetailed,
  parseClassifyReply,
  type ClassifyOpts,
  type ClassifyStatus,
  type DetailedClassifyResult,
  type ModelCandidate,
} from './model-classifier.js';

export {
  applyApprovedCandidates,
  mergeCandidates,
  type ApplyResult,
  type MergeOpts,
  type MergeResult,
} from './catalog-merge.js';

export {
  PROVIDER_MODEL_SOURCES,
  runModelWatchIntake,
  type WatchIntakeDeps,
  type WatchIntakeResult,
  type WatchPage,
  type WatchSourceResult,
} from './model-watch-intake.js';

export {
  getModelWatchProposalPath,
  runModelIntelligenceWatch,
  type ModelWatchDeps,
  type ModelWatchOpts,
} from './model-watch-mission.js';

export {
  COST_WARNING_RATIO,
  clearCostMeterSubscribersForTest,
  getCostConfigPath,
  getCostEventPath,
  loadCostConfig,
  logUsage,
  monthlyCapStatus,
  persistCostConfig,
  snapshotCost,
  subscribeCostMeter,
  weeklyCapStatus,
} from './cost-meter.js';
export type { CostMeterSubscriber } from './cost-meter.js';

export {
  startAutoModeContextBridge,
} from './auto-mode-context-bridge.js';
export type { StartBridgeOpts } from './auto-mode-context-bridge.js';

export {
  DEFAULT_TTL_MS as SYSTEM_DEFAULT_TTL_MS,
  formatSystemLine,
  getSystemSnapshot,
  resetSystemMonitorCacheForTest,
} from './system-monitor.js';

export {
  estimateCost,
  recommendModel,
} from './recommend-model.js';
export type {
  ModelRecommendation,
  RecommendHints,
  RecommendContext,
  TaskType,
} from './recommend-model.js';

export {
  buildRouteToModelTool,
  dispatchRouteToModel,
} from './tools/route-to-model.js';
export type {
  RouteToModelInput,
  RouteToModelDispatchOpts,
} from './tools/route-to-model.js';

export {
  buildIntelligenceMapTool,
  dispatchIntelligenceMap,
  formatIntelligenceMap,
} from './tools/intelligence-map.js';
export type {
  IntelligenceMapResult,
  IntelligenceMapDispatchOpts,
} from './tools/intelligence-map.js';
