// WT-S-1 — PreviewTerminal → ACP attach adapter.
//
// Single re-export so dashboard / daemon boot can import from one
// stable path while WT-S-2 evolves the substrate. WT-S-2 will swap the
// direct `addRawOutputTap` hook for PaneFactory's `addTap('raw', ...)`
// without touching consumers.

export {
  registerPreviewTerminalForWebTap,
  unregisterPreviewTerminalForWebTap,
  getRegisteredPreviewTerminalCount,
} from './preview-tap-registry.js';
