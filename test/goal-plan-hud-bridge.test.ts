// Goal + plan-mode HUD bridge tests — FU-3.

import { afterEach, describe, expect, test } from 'bun:test';
import { _resetForTesting as resetGoals, startGoal, setStatus } from '../src/goals/index.js';
import { resetPlanModeState, setPlanModeState } from '../src/plan-mode/index.js';
import { setPlanToolPlanModeGuard } from '../src/code-edit/plan-tool.js';
import { setPolicy } from '../src/code-edit/index.js';
import { createHud, renderHud } from '../src/panes/hud.js';
import { wireGoalPlanHudBridge } from '../src/dashboard/goal-plan-hud-bridge.ts';

afterEach(() => {
  resetGoals();
  resetPlanModeState();
  setPlanToolPlanModeGuard(null);
  setPolicy({ mode: 'ask-edit' });
});

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('wireGoalPlanHudBridge', () => {
  test('paints empty when neither active', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    expect(renderHud(hud, 200)).toBe('');
    dispose();
  });

  test('paints goal pill on start', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    startGoal({ objective: 'fix bug', budget: { maxTurns: 20 } });
    expect(stripAnsi(renderHud(hud, 200))).toContain('🎯 goal · 0/20');
    dispose();
  });

  test('updates pill on status change', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    startGoal({ objective: 'x' });
    setStatus('paused');
    expect(stripAnsi(renderHud(hud, 200))).toContain('paused');
    dispose();
  });

  test('paints plan-mode pill on activation', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    setPlanModeState({
      active: true,
      sessionId: 'sid',
      startedAt: Date.now(),
      phase: 'design',
      planFilePath: '/tmp/p.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    expect(stripAnsi(renderHud(hud, 200))).toContain('📋 plan · design');
    dispose();
  });

  test('both pills render together with separator', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    startGoal({ objective: 'x' });
    setStatus('paused'); // Codex pattern simulation
    setPlanModeState({
      active: true,
      sessionId: 'sid',
      startedAt: Date.now(),
      phase: 'explore',
      planFilePath: '/tmp/p.md',
      previousPolicy: { mode: 'ask-edit' },
    });
    const out = stripAnsi(renderHud(hud, 200));
    expect(out).toContain('paused');
    expect(out).toContain('plan · explore');
    expect(out).toContain('·');
    dispose();
  });

  test('budget-limited status surfaces warning text', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    startGoal({ objective: 'x', budget: { maxTurns: 1 } });
    setStatus('budget-limited');
    expect(stripAnsi(renderHud(hud, 200))).toContain('budget');
    dispose();
  });

  test('complete status surfaces ✅', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    startGoal({ objective: 'x' });
    setStatus('complete');
    expect(stripAnsi(renderHud(hud, 200))).toContain('complete');
    dispose();
  });

  test('dispose clears segments', () => {
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => {} });
    startGoal({ objective: 'x' });
    expect(stripAnsi(renderHud(hud, 200))).toContain('🎯');
    dispose();
    // After dispose, no listeners + segments cleared
    setStatus('paused');
    expect(renderHud(hud, 200)).toBe('');
  });

  test('draw callback fires on state changes', () => {
    let drawCount = 0;
    const hud = createHud();
    const dispose = wireGoalPlanHudBridge({ hud, draw: () => { drawCount += 1; } });
    const initialDraws = drawCount; // 1 from initial paint
    startGoal({ objective: 'x' });
    expect(drawCount).toBeGreaterThan(initialDraws);
    dispose();
  });
});
