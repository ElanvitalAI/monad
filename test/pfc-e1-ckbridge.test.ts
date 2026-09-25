// ── PFC E1: startAutoModeContextBridge ──
//
// Lives alongside upstream `test/auto-mode-context-bridge.test.ts`
// (IDX-2b `wireAutoModeContextBridge` — different module). The two
// bridges cover complementary slices: IDX-2b mirrors only autoModeActive
// onto the dashboard singleton; PFC E1 additionally publishes
// budgetWarningActive + escalationPending and demonstrates the owner-
// gated publisher + equality-based no-op semantics.
//
// Follow-up refactor (noted in RECAP-merge-post-detection-axon.md):
// fold the two bridges into a single module that routes through
// `getDashboardContextKeyService()` (upstream singleton). For now the
// two coexist — functionally overlap on autoModeActive only.

import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getGlobalContextKeyService,
  resetGlobalContextKeysForTest,
} from '../src/input-core/global-context-keys';
import { startAutoModeContextBridge } from '../src/intelligence-map/auto-mode-context-bridge';
import {
  clearCostMeterSubscribersForTest,
  logUsage,
  type CostCapConfig,
  type CostSnapshot,
} from '../src/intelligence-map/cost-meter';
import {
  resetAutoModeForTest,
  setAutoModeState,
} from '../src/auto-research/auto-mode/session';
import {
  clearAllEscalationsForTest,
  emitEscalation,
  resolveEscalation,
} from '../src/cft/andon';

const noCapCfg: CostCapConfig = {};
const tightCapCfg: CostCapConfig = { weeklyCapUsd: 10, monthlyCapUsd: 40 };

function mkSnap(weeklyUsd: number, monthlyUsd: number): CostSnapshot {
  const now = Date.now();
  return {
    totalUsd: weeklyUsd + monthlyUsd,
    weeklyUsd,
    monthlyUsd,
    perModel: {},
    perGoal: {},
    weekStart: now - 7 * 24 * 60 * 60 * 1000,
    monthStart: now - 30 * 24 * 60 * 60 * 1000,
    eventsCount: 0,
    snapshotAt: now,
  };
}

beforeEach(() => {
  resetGlobalContextKeysForTest();
  resetAutoModeForTest();
  clearAllEscalationsForTest();
  clearCostMeterSubscribersForTest();
});

describe('startAutoModeContextBridge — initial publish', () => {
  test('publishes all 3 keys on start', () => {
    const dispose = startAutoModeContextBridge({
      loadConfig: () => noCapCfg,
      snapshot: () => mkSnap(0, 0),
    });
    const keys = getGlobalContextKeyService().keys;
    expect(keys.autoModeActive).toBe(false);
    expect(keys.budgetWarningActive).toBe(false);
    expect(keys.escalationPending).toBe(false);
    dispose();
  });

  test('reflects pre-start state (auto-mode already active)', () => {
    setAutoModeState({
      active: true,
      sessionId: 'x',
      goalSlug: 'g',
      startedAt: 0,
      maxTurns: 1,
      turnIndex: 0,
      phase: 'kickoff',
      lastKickoffRendered: '',
    });
    const dispose = startAutoModeContextBridge({
      loadConfig: () => noCapCfg,
      snapshot: () => mkSnap(0, 0),
    });
    expect(getGlobalContextKeyService().keys.autoModeActive).toBe(true);
    dispose();
  });
});

describe('startAutoModeContextBridge — reactive updates', () => {
  test('auto-mode state change → autoModeActive publish', () => {
    const dispose = startAutoModeContextBridge({
      loadConfig: () => noCapCfg,
      snapshot: () => mkSnap(0, 0),
    });
    setAutoModeState({
      active: true,
      sessionId: 's',
      goalSlug: 'g',
      startedAt: 0,
      maxTurns: 1,
      turnIndex: 0,
      phase: 'kickoff',
      lastKickoffRendered: '',
    });
    expect(getGlobalContextKeyService().keys.autoModeActive).toBe(true);
    dispose();
  });

  test('andon CRITICAL emit → escalationPending=true, resolve → false', async () => {
    const dispose = startAutoModeContextBridge({
      loadConfig: () => noCapCfg,
      snapshot: () => mkSnap(0, 0),
    });
    await emitEscalation(
      { agentId: 'a', severity: 'CRITICAL', reason: 'r' },
      { skipObsidian: true },
    );
    expect(getGlobalContextKeyService().keys.escalationPending).toBe(true);
    resolveEscalation('a');
    expect(getGlobalContextKeyService().keys.escalationPending).toBe(false);
    dispose();
  });

  test('HIGH severity does NOT flip escalationPending (CRITICAL-gated)', async () => {
    const dispose = startAutoModeContextBridge({
      loadConfig: () => noCapCfg,
      snapshot: () => mkSnap(0, 0),
    });
    await emitEscalation(
      { agentId: 'a', severity: 'HIGH', reason: 'r' },
      { skipObsidian: true },
    );
    expect(getGlobalContextKeyService().keys.escalationPending).toBe(false);
    dispose();
  });

  test('cost-meter logUsage triggers re-publish of budgetWarning', async () => {
    let weekly = 0;
    const dir = mkdtempSync(join(tmpdir(), 'ckbridge-'));
    const eventsPath = join(dir, 'cost-events.jsonl');

    const dispose = startAutoModeContextBridge({
      loadConfig: () => tightCapCfg,
      snapshot: () => mkSnap(weekly, weekly),
    });
    expect(getGlobalContextKeyService().keys.budgetWarningActive).toBe(false);

    weekly = 9.5;
    await logUsage(
      { modelId: 'm', inputTokens: 1, outputTokens: 1, usd: 0.01, skipAutoAttribution: true },
      { eventsPath },
    );
    expect(getGlobalContextKeyService().keys.budgetWarningActive).toBe(true);
    dispose();
  });
});

describe('dispose', () => {
  test('post-dispose updates are ignored', async () => {
    const dispose = startAutoModeContextBridge({
      loadConfig: () => noCapCfg,
      snapshot: () => mkSnap(0, 0),
    });
    dispose();
    await emitEscalation(
      { agentId: 'a', severity: 'CRITICAL', reason: 'r' },
      { skipObsidian: true },
    );
    expect(getGlobalContextKeyService().keys.escalationPending).toBe(false);
  });
});
