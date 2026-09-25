// ── PX-4 P6 dogfood smoke test ──
//
// Exercises the full mission pipeline — evaluator script → runtime
// registry → terminal completion — using the count-to-5 fixture
// that ships with the hello plugin. This is the minimum proof that
// PX-4 composes end-to-end outside of a plugin-host activate path.

import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { MissionRegistry } from '../src/plugin-missions/registry';
import { runMissionEvaluator } from '../src/plugin-missions/evaluator-runner';

const HELLO_PLUGIN_DIR = join(__dirname, '..', 'plugins', 'hello');
const COUNT_TO_5 = join(HELLO_PLUGIN_DIR, 'missions', 'count-to-5');

describe('PX-4 P6 — hello plugin count-to-5 dogfood', () => {
  test('evaluator reports done=false for iteration < 5', async () => {
    const result = await runMissionEvaluator(
      {
        id: 'count-to-5',
        name: 'Count',
        goalPath: 'mission.md',
        sandboxPath: 'sandbox.md',
        evaluator: {
          command: join(COUNT_TO_5, 'evaluator.sh'),
          format: 'json',
          timeoutMs: 5_000,
        },
        keepPolicy: 'pass_only',
        maxIterations: 6,
      },
      {
        missionId: 'count-to-5',
        iteration: 3,
        workDir: COUNT_TO_5,
        goalContent: '', sandboxContent: '',
      },
    );
    expect(result.done).toBe(false);
    expect(result.reason).toContain('iteration 3');
  });

  test('evaluator reports done=true at iteration 5', async () => {
    const result = await runMissionEvaluator(
      {
        id: 'count-to-5',
        name: 'Count',
        goalPath: 'mission.md',
        sandboxPath: 'sandbox.md',
        evaluator: {
          command: join(COUNT_TO_5, 'evaluator.sh'),
          format: 'json',
          timeoutMs: 5_000,
        },
        keepPolicy: 'pass_only',
        maxIterations: 6,
      },
      {
        missionId: 'count-to-5',
        iteration: 5,
        workDir: COUNT_TO_5,
        goalContent: '', sandboxContent: '',
      },
    );
    expect(result.done).toBe(true);
    expect(result.reason).toBe('reached 5');
  });

  test('registry tick loop completes the count-to-5 mission over repeated ticks', async () => {
    const reg = new MissionRegistry();
    reg.register({
      pluginId: 'hello',
      pluginDir: HELLO_PLUGIN_DIR,
      def: {
        id: 'count-to-5',
        name: 'Count',
        goalPath: 'missions/count-to-5/mission.md',
        sandboxPath: 'missions/count-to-5/sandbox.md',
        evaluator: {
          command: join(COUNT_TO_5, 'evaluator.sh'),
          format: 'json',
          timeoutMs: 5_000,
        },
        // 'never' so iteration increments each tick (our evaluator
        // reads `iteration` from stdin to decide when to complete).
        keepPolicy: 'never',
        maxIterations: 10,
        autostart: true,
      },
    });
    // Evaluator reads the iteration we pass in and returns done=true
    // at iteration >= 5. Under keepPolicy 'never', iteration advances
    // by 1 each tick, so after ≤ 5 ticks the mission is 'done'.
    for (let t = 0; t < 6; t++) {
      await reg.tick(t);
      if (reg.state('count-to-5')?.status === 'done') break;
    }
    const state = reg.state('count-to-5');
    expect(state?.status).toBe('done');
    expect(state?.history.length).toBeGreaterThanOrEqual(5);
  });
});
