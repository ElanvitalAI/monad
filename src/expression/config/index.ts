// Public API for `src/expression/config/` — the 5-layer config merge
// kernel + answer-file + env-bridge surfaces. Consumers
// (`onboarding.ts`, the dashboard `/setup` slash, the CLI) import
// from here.

export {
  type Layer,
  type LayerSource,
  mergeLayers,
  explainLayers,
} from './layers.js';

export {
  type AnswerFile,
  defaultAnswerFilePath,
  loadAnswerFile,
  saveAnswerFile,
} from './answer-file.js';

export {
  type EnvBridgeOptions,
  buildEnvOverrides,
} from './env-bridge.js';
