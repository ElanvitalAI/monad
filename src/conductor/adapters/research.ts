// ── PFC-S2 generalization: research adapter ──
//
// Backward-compat adapter — the original Auto-Research Loop. When the
// classifier picks 'research', this adapter just records the routing
// decision; the existing `EnterAutoMode` path continues to drive the
// loop (src/auto-research/auto-mode/tool-enter.ts). We intentionally
// do NOT re-execute the loop here — the adapter is a routing marker.

import type { Adapter, AdapterResult } from '../types.js';

export const researchAdapter: Adapter = async (ctx) => {
  const result: AdapterResult = {
    kind: 'research',
    status: 'routed',
    adapter: 'research',
    hint: `auto-research loop 기존 경로 (AutoResearch/${ctx.goalSlug}/) 그대로 구동`,
  };
  return result;
};
