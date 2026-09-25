// Public façade for the global element registry (Phase A of
// PLAN-llm-active-context-and-control). Modules register handles on
// create/destroy; `context.*` LLM tools resolve addresses through
// this singleton before delegating to kind-specific read/control code.

export type {
  ElementKind,
  ElementHandle,
  ParsedElementAddress,
} from './types.js';
export {
  KIND_PREFIX,
  ADDR_PREFIX_TO_KIND,
} from './types.js';
export {
  parseElementAddress,
  formatElementAddress,
  ensureQualified,
  isQualifiedAddress,
} from './address.js';
export {
  createElementRegistry,
  getGlobalElementRegistry,
  _resetGlobalElementRegistryForTesting,
  type ElementRegistry,
} from './registry.js';
export {
  createElementEventBus,
  getGlobalElementEventBus,
  _resetGlobalElementEventBusForTesting,
  type ElementEvent,
  type ElementEventBus,
  type ElementEventType,
} from './event-bus.js';
export {
  createElementStateStore,
  getGlobalElementStateStore,
  _resetGlobalElementStateStoreForTesting,
  attachStateStoreToBus,
  type ElementStateEntry,
  type ElementStateStore,
} from './state-store.js';
export { publishElementEvent, initElementObservability } from './observability.js';
