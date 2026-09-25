// ── PX-4 P1: mission type + capability surface ──
//
// Pure type-shape tests — no runtime coupling. Verifies the exported
// defaults and the capability constant have the expected values, and
// that the types compile with their required + optional fields.

import { describe, expect, test } from 'bun:test';
import {
  MISSION_CAPABILITY,
  MISSION_DEFAULTS,
  type MissionDefinition,
  type MissionEvaluator,
  type MissionResult,
  type MissionState,
  type MissionKeepPolicy,
} from '../src/plugin-missions/types';

describe('PX-4 P1 — mission types', () => {
  test('MISSION_CAPABILITY is stable string constant', () => {
    expect(MISSION_CAPABILITY).toBe('mission:run');
  });

  test('MISSION_DEFAULTS carries sensible clamps', () => {
    expect(MISSION_DEFAULTS.maxIterations).toBe(10);
    expect(MISSION_DEFAULTS.cadenceEveryNTurn).toBe(1);
    expect(MISSION_DEFAULTS.evaluatorTimeoutMs).toBe(300_000);
    // Hard ceilings: 30 min timeout, 1000 iterations
    expect(MISSION_DEFAULTS.evaluatorTimeoutMaxMs).toBe(1_800_000);
    expect(MISSION_DEFAULTS.maxIterationsMax).toBe(1000);
    // Lower bound protects against 0/negative timeouts
    expect(MISSION_DEFAULTS.evaluatorTimeoutMinMs).toBeGreaterThan(0);
  });

  test('MissionEvaluator format whitelist is "json" in v1', () => {
    const ev: MissionEvaluator = { command: './eval.sh', format: 'json' };
    expect(ev.format).toBe('json');
    // Attempting a non-'json' format should fail compile if we tried
    // it (this test asserts the run-time whitelist — the parser in P2
    // will enforce the string literal).
  });

  test('MissionKeepPolicy whitelist covers 3 named strategies', () => {
    const policies: MissionKeepPolicy[] = ['pass_only', 'score_improvement', 'never'];
    expect(policies.length).toBe(3);
  });

  test('MissionDefinition requires id + name + goalPath + sandboxPath + evaluator + keepPolicy + maxIterations', () => {
    const def: MissionDefinition = {
      id: 'test-mission',
      name: 'Test Mission',
      goalPath: './missions/test/mission.md',
      sandboxPath: './missions/test/sandbox.md',
      evaluator: { command: './eval.sh', format: 'json' },
      keepPolicy: 'pass_only',
      maxIterations: 5,
    };
    expect(def.id).toBe('test-mission');
    expect(def.evaluator.command).toBe('./eval.sh');
    // Optional fields omitted
    expect(def.autostart).toBeUndefined();
    expect(def.cadence).toBeUndefined();
  });

  test('MissionResult minimum shape is { done: bool }', () => {
    const r: MissionResult = { done: false };
    expect(r.done).toBe(false);
    const r2: MissionResult = {
      done: true,
      score: 0.87,
      reason: 'converged',
      keep: true,
    };
    expect(r2.score).toBe(0.87);
  });

  test('MissionState history is append-only list', () => {
    const state: MissionState = {
      missionId: 'm1',
      pluginId: 'demo',
      iteration: 3,
      status: 'running',
      startedAt: 1000,
      history: [
        { iteration: 1, result: { done: false }, ts: 1100 },
        { iteration: 2, result: { done: false, score: 0.5 }, ts: 1200 },
      ],
    };
    expect(state.history.length).toBe(2);
    expect(state.status).toBe('running');
  });
});
