// UI-Core arc Phase U3 — TUI-as-ACP-client public surface.
//
// This module collects the pieces a consumer (future TUI boot path,
// Web client, iPhone app) needs to boot as an ACP client of a local
// or remote Monad server:
//
//   - In-process transport bridge (`acp-transport-local`) for Same-
//     Process wiring (TUI in the same bun process as the server).
//   - `monad/ui/*` envelope dispatcher (`monad-ui-handler`).
//   - Headless-core guard (`headless-core-guard`) — lint-level test
//     seam for the "core runs without TUI" contract.

export {
  createInProcessAcpBridge,
  roundTripBridge,
} from './acp-transport-local.js';

export {
  dispatchThoughtChunk,
  extractAgentThoughtText,
  type MonadUiHandler,
  type ThoughtChunkOutcome,
} from './monad-ui-handler.js';

export {
  extractImportSpecifiers,
  findForbiddenImports,
  HEADLESS_CORE_DEFAULT_FORBIDDEN,
} from './headless-core-guard.js';
