// Showroom v2 Arc 4 · auto-relay policy tests.
//
// Pure function — exercised with synthetic room snapshots.

import { describe, test, expect } from 'bun:test';
import { proposeRelay } from '../src/showroom/auto-relay/policy.js';
import type { AgentRoomSnapshot } from '../src/agent-room/registry.js';
import type { AgentRoomRoleHint } from '../src/agent-room/types.js';

function snap(
  members: Array<{ brand: string; sessionId: string; roleHint?: AgentRoomRoleHint }>,
): AgentRoomSnapshot {
  return {
    id: 'room-test',
    windowId: 1,
    preset: members.length === 2 ? 'two-split' : members.length === 3 ? 'three-split' : 'four-quad',
    members: members.map((m, i) => ({
      sessionId: m.sessionId,
      paneId: `p${i}`,
      brand: m.brand,
      ...(m.roleHint ? { roleHint: m.roleHint } : {}),
      launchedAt: i,
    })),
    createdAt: 0,
  };
}

describe('proposeRelay · 2-pane pair-mirror', () => {
  test('lane 0 idle → propose 0 → 1', () => {
    const r = proposeRelay(
      snap([
        { brand: 'codex', sessionId: 's0' },
        { brand: 'claude', sessionId: 's1' },
      ]),
      's0',
    );
    expect(r).not.toBeNull();
    expect(r?.fromIndex).toBe(0);
    expect(r?.toIndex).toBe(1);
    expect(r?.reason).toBe('pair-mirror');
  });

  test('lane 1 idle → propose 1 → 0 (paired)', () => {
    const r = proposeRelay(
      snap([
        { brand: 'codex', sessionId: 's0' },
        { brand: 'claude', sessionId: 's1' },
      ]),
      's1',
    );
    expect(r?.fromIndex).toBe(1);
    expect(r?.toIndex).toBe(0);
  });
});

describe('proposeRelay · 3-pane plan-exec-review chain', () => {
  test('plan idle → propose to exec', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
      ]),
      's0',
    );
    expect(r?.fromIndex).toBe(0);
    expect(r?.toIndex).toBe(1);
    expect(r?.reason).toBe('role-chain');
    expect(r?.fromRole).toBe('plan');
    expect(r?.toRole).toBe('exec');
  });

  test('exec idle → propose to review', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
      ]),
      's1',
    );
    expect(r?.fromIndex).toBe(1);
    expect(r?.toIndex).toBe(2);
  });

  test('review idle (terminal) → null (no loop-back)', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
      ]),
      's2',
    );
    expect(r).toBeNull();
  });

  test('skips missing role · plan idle → review (exec absent)', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'gemini', sessionId: 's1', roleHint: 'review' },
      ]),
      's0',
    );
    // 2-pane → pair-mirror takes precedence over role-chain fallback.
    expect(r?.reason).toBe('pair-mirror');
    expect(r?.toIndex).toBe(1);
  });
});

describe('proposeRelay · 4-pane plan-exec-review-reflect', () => {
  test('plan→exec', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
        { brand: 'elanous',  sessionId: 's3', roleHint: 'reflect' },
      ]),
      's0',
    );
    expect(r?.toIndex).toBe(1);
  });

  test('exec→review', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
        { brand: 'elanous',  sessionId: 's3', roleHint: 'reflect' },
      ]),
      's1',
    );
    expect(r?.toIndex).toBe(2);
  });

  test('review→reflect', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
        { brand: 'elanous',  sessionId: 's3', roleHint: 'reflect' },
      ]),
      's2',
    );
    expect(r?.toIndex).toBe(3);
  });

  test('reflect → null (terminal)', () => {
    const r = proposeRelay(
      snap([
        { brand: 'claude', sessionId: 's0', roleHint: 'plan' },
        { brand: 'codex',  sessionId: 's1', roleHint: 'exec' },
        { brand: 'gemini', sessionId: 's2', roleHint: 'review' },
        { brand: 'elanous',  sessionId: 's3', roleHint: 'reflect' },
      ]),
      's3',
    );
    expect(r).toBeNull();
  });
});

describe('proposeRelay · index-fallback (no role hints)', () => {
  test('3-pane no roles · 0 → 1', () => {
    const r = proposeRelay(
      snap([
        { brand: 'a', sessionId: 's0' },
        { brand: 'b', sessionId: 's1' },
        { brand: 'c', sessionId: 's2' },
      ]),
      's0',
    );
    expect(r?.toIndex).toBe(1);
    expect(r?.reason).toBe('index-fallback');
  });

  test('3-pane no roles · 2 → null (last)', () => {
    const r = proposeRelay(
      snap([
        { brand: 'a', sessionId: 's0' },
        { brand: 'b', sessionId: 's1' },
        { brand: 'c', sessionId: 's2' },
      ]),
      's2',
    );
    expect(r).toBeNull();
  });
});

describe('proposeRelay · edge cases', () => {
  test('unknown sessionId → null', () => {
    const r = proposeRelay(
      snap([
        { brand: 'a', sessionId: 's0' },
        { brand: 'b', sessionId: 's1' },
      ]),
      'mystery',
    );
    expect(r).toBeNull();
  });
});
