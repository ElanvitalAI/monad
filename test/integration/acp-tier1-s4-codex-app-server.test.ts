// M7 (2026-04-28) — Tier 1 · S4 · codex-app-server real-binary smoke.
//
// Spawns the real `codex app-server` binary via CodexAppServerAgent and
// verifies the protocol handshake completes + capabilities populate.
// The assistant doesn't issue an LLM turn — that requires an API key
// and would burn tokens. The smoke is "binary launches + initialize
// roundtrip + capabilities visible". Fuller scenarios (multi-turn,
// approval routing) are tracked separately.
//
// Gated by MONAD_CODEX_TIER1_SMOKE=1 — see test/integration/_helpers.ts.

import { describe, test, expect } from 'bun:test';
import { CodexAppServerAgent } from '../../src/acp/codex-app-server-agent.js';
import { tier1SkipReason, logSkipReason } from './_helpers.js';

const skipReason = tier1SkipReason();
logSkipReason('S4', skipReason);

describe.skipIf(skipReason !== null)('Tier 1 · S4 · codex-app-server real binary', () => {
  test('initialize handshake completes + capabilities surface', async () => {
    const agent = new CodexAppServerAgent({
      backendId: 'codex-app-server',
      cwd: process.cwd(),
      idleTimeoutMs: 0, // disable hibernate during the test
    });
    try {
      await agent.start();
      const caps = agent.getCapabilities();
      // Capability surface is visible after start — exact flag values
      // depend on which sprint(s) have merged at the time of this run.
      // Assert only protocol-level invariants so the test stays valid
      // across the sprint progression. The shape itself is what we're
      // verifying — that the real binary survives JSON-RPC initialize +
      // returns the expected envelope structure.
      expect(caps).not.toBeNull();
      expect(caps!.protocolVersion).toBe(1);
      expect(typeof caps!.loadSession).toBe('boolean');
      expect(typeof caps!.planMode).toBe('boolean');
      expect(caps!.fileOps).toBeDefined();
      expect(caps!.ui).toBeDefined();
    } finally {
      await agent.stop();
    }
  }, 30_000);
});
