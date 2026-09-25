// ── Presentation P5a · Scenario catalog · public barrel ──

export {
  type ScenarioDef,
  type ScenarioCatalog,
  type ScenarioLoadError,
} from './types.js';

export {
  loadScenarioCatalog,
  type LoadScenarioCatalogOptions,
} from './catalog.js';

export { materializeScenario } from './materialize.js';

export {
  expandDecorationShorthand,
  expandScenarioShorthand,
} from './shorthand.js';
