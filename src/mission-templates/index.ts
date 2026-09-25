// W9b Z15.b · mission-templates barrel — Device-aware capability degradation
// substrate. Cf. ROADMAP-showroom-x-task-fabric §3 S23 + §4 Z15.b.

export type { DeviceKind, DeviceCapabilitySet, RawDeviceRow, DeviceFleetSource } from './device-detector.js';
export { DEVICE_KINDS, detectFleet, isDeviceKind, staticDeviceFleetSource } from './device-detector.js';

export type {
  OptionalRequirement,
  RequirementOutcome,
  CapabilityDecision,
  EnablementSet,
  FallbackChainEntry,
  ResolveOpts,
  ResolveResult,
} from './capability-resolver.js';
export {
  resolveCapabilities,
  evalFallbackExpr,
  hasAnyEnablement,
} from './capability-resolver.js';

export type {
  FleetSignature,
  FleetChange,
  FleetChangeKind,
  FleetChangeEvent,
  FleetWatcherState,
  FleetUpgradeWatcherDeps,
  FleetCapabilitySetLike,
} from './upgrade-watcher.js';
export {
  compareFleets,
  createFleetWatcherState,
  fleetSignature,
  tickUpgradeWatcher,
} from './upgrade-watcher.js';
