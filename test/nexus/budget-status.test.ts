// M3-1 (Phase 3) — `GET /v1/budget/status` handler unit tests.
//
// Sandboxes XDG_CONFIG_HOME so we never touch the user's real config,
// and swaps in a `disablePersist` voice cost tracker so the JSONL log
// stays out of the user's home dir.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleBudgetStatusGet } from '../../src/nexus/api/budget-status.js';
import {
  __resetXdgDeprecationWarningForTests,
  reloadUserConfig,
} from '../../src/user-config.js';
import {
  createVoiceCostTracker,
  setGlobalVoiceCostTrackerForTesting,
} from '../../src/voice/cost-tracker.js';
import { handleModelTierPut } from '../../src/nexus/api/config-model-tier.js';

let tmpDir: string;
let restoreTracker: () => void;
const PREV_XDG = process.env.XDG_CONFIG_HOME;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'm3-1-budget-'));
  process.env.XDG_CONFIG_HOME = tmpDir;
  process.env.ELANOUS_SUPPRESS_XDG_WARNING = '1';
  __resetXdgDeprecationWarningForTests();
  reloadUserConfig();
  restoreTracker = setGlobalVoiceCostTrackerForTesting(
    createVoiceCostTracker({ disablePersist: true }),
  );
});

afterEach(() => {
  restoreTracker();
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = PREV_XDG;
  reloadUserConfig();
});

function configPutRequest(body: unknown): Request {
  return new Request('http://localhost/v1/config/model-tier', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function asJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('M3-1 · GET /v1/budget/status', () => {
  test('passive mode (no budget) · ok with null percent', async () => {
    const res = handleBudgetStatusGet();
    expect(res.status).toBe(200);
    const body = await asJson(res);
    expect(body.status).toBe('ok');
    expect(body.percent).toBeNull();
    expect(body.monthlyUsdCap).toBeUndefined();
    expect(body.monthSoFarUsd).toBe(0);
    expect(typeof body.monthYYYYMM).toBe('string');
    expect((body.monthYYYYMM as string).length).toBe(7); // YYYY-MM
  });

  test('cap set, below 80% · ok with percent', async () => {
    await handleModelTierPut(configPutRequest({ budget: { monthlyUsdCap: 50 } }));
    const res = handleBudgetStatusGet();
    const body = await asJson(res);
    expect(body.status).toBe('ok');
    expect(body.percent).toBe(0); // no spend yet
    expect(body.monthlyUsdCap).toBe(50);
  });

  test('after spending past 80% threshold · warning with fallback', async () => {
    await handleModelTierPut(configPutRequest({ budget: { monthlyUsdCap: 50 } }));
    // gpt-realtime-whisper = $0.017/min · 2400 min ≈ $40.80 → 81.6% of $50.
    const liveTracker = createVoiceCostTracker({ disablePersist: true });
    liveTracker.recordStt({
      providerId: 'gpt-realtime-whisper',
      durationMs: 2400 * 60_000,
    });
    const restore = setGlobalVoiceCostTrackerForTesting(liveTracker);
    try {
      const res = handleBudgetStatusGet();
      const body = await asJson(res);
      expect(body.status).toBe('warning');
      expect(body.recommendedFallback).toBe('budget');
      expect(typeof body.percent).toBe('number');
      expect((body.percent as number) >= 80).toBe(true);
      expect((body.monthSoFarUsd as number) >= 40).toBe(true);
    } finally {
      restore();
    }
  });

  test('cap exceeded → cap-exceeded with custom fallbackTier', async () => {
    await handleModelTierPut(
      configPutRequest({ budget: { monthlyUsdCap: 5, fallbackTier: 'balanced' } }),
    );
    const liveTracker = createVoiceCostTracker({ disablePersist: true });
    liveTracker.recordStt({
      providerId: 'gpt-realtime-whisper',
      durationMs: 600 * 60_000, // 600 min ≈ $10.20
    });
    const restore = setGlobalVoiceCostTrackerForTesting(liveTracker);
    try {
      const res = handleBudgetStatusGet();
      const body = await asJson(res);
      expect(body.status).toBe('cap-exceeded');
      expect(body.recommendedFallback).toBe('balanced');
      expect(body.monthlyUsdCap).toBe(5);
    } finally {
      restore();
    }
  });

  test('custom notifyAtPct echoed back', async () => {
    await handleModelTierPut(
      configPutRequest({ budget: { monthlyUsdCap: 100, notifyAtPct: 50 } }),
    );
    const res = handleBudgetStatusGet();
    const body = await asJson(res);
    expect(body.notifyAtPct).toBe(50);
  });
});
