// Showroom v2 · /showroom slash N-lane composer end-to-end tests.
//
// Covers PLAN §B + §C + §D2-§D11:
//   - default 2-pane (codex + claude) when no tokens (regression-safe)
//   - 3-pane lane composition with role hints
//   - 4-pane four-quad
//   - badge titles wired into AgentRoomMember.title
//   - --focus tail
//   - arity errors (1 / 5+)
//   - lll:<model> end-to-end through the parser
//   - auto:<role> legacy compat

import { describe, test, expect, mock } from 'bun:test';
import { executeAgentRoomSlash } from '../src/skills/tools/agent-room-slash.js';
import { AgentRoomRegistry } from '../src/agent-room/registry.js';
import type { AgentRoomSpec } from '../src/agent-room/types.js';

function fakeBuildRoom(memberCount: number) {
  return mock(async (spec: AgentRoomSpec) => ({
    room: {
      id: 'room-test',
      windowId: 1,
      preset: spec.preset,
      members: Array.from({ length: memberCount }, (_, i) => ({
        sessionId: `s-${i}`,
        paneId: `p-${i}`,
        brand: spec.members[i]?.brandRef ?? 'unknown',
        ...(spec.members[i]?.roleHint ? { roleHint: spec.members[i]!.roleHint } : {}),
        launchedAt: i,
      })),
      createdAt: 0,
      dispose: async () => {},
    },
    resolvedBrands: spec.members.map((m) => ({
      brand: m.brandRef,
      resolution: 'literal' as const,
    })),
    warnings: [],
  }));
}

describe('/showroom v2 · default behavior (regression)', () => {
  test('no args → 2-pane codex + claude with badge titles', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: [] }, reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.preset).toBe('two-split');
    expect(spec.members).toEqual([
      { brandRef: 'codex', title: 'codex · auto' },
      { brandRef: 'claude', title: 'claude · auto' },
    ]);
  });

  test('--focus 1 alone preserves default 2-pane + sets focus', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['--focus', '1'] }, reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.preset).toBe('two-split');
    expect(spec.focusIndex).toBe(1);
  });
});

describe('/showroom v2 · 3-pane plan-build-review', () => {
  test('plan:claude build:codex review:gemini → roleHints + titles', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(3);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['plan:claude', 'build:codex', 'review:gemini'] },
      reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.preset).toBe('three-split');
    expect(spec.members).toEqual([
      { brandRef: 'claude', roleHint: 'plan',   title: 'plan · claude · auto' },
      // build → exec internally
      { brandRef: 'codex',  roleHint: 'exec',   title: 'exec · codex · auto' },
      { brandRef: 'gemini', roleHint: 'review', title: 'review · gemini · auto' },
    ]);
  });

  test('with explicit transport · plan:claude:acp build:codex:pty', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['plan:claude:acp', 'build:codex:pty'] },
      reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members).toEqual([
      { brandRef: 'claude', roleHint: 'plan', title: 'plan · claude · acp', transportPref: 'acp' },
      { brandRef: 'codex',  roleHint: 'exec', title: 'exec · codex · pty', transportPref: 'pty' },
    ]);
  });
});

describe('/showroom v2 · 4-quad', () => {
  test('4 lanes → four-quad preset', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(4);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: [
        'plan:claude', 'build:codex', 'review:gemini', 'reflect:elanous',
      ] },
      reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.preset).toBe('four-quad');
    expect(spec.members.length).toBe(4);
    expect(spec.members[3]).toEqual({
      brandRef: 'elanous', roleHint: 'reflect', title: 'reflect · elanous · auto',
    });
  });
});

describe('/showroom v2 · local-llm lane', () => {
  test('build:lll:llama3:pty parses through to brandRef lll:llama3', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['build:lll:llama3:pty', 'review:gemini'] },
      reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]).toEqual({
      brandRef: 'lll:llama3', roleHint: 'exec',
      title: 'exec · lll:llama3 · pty',
      transportPref: 'pty',
    });
  });
});

describe('/showroom v2 · auto legacy compat', () => {
  test('auto:plan auto:exec auto:review still works', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(3);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['auto:plan', 'auto:exec', 'auto:review'] },
      reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]?.brandRef).toBe('auto');
    expect(spec.members[0]?.roleHint).toBe('plan');
    expect(spec.members[2]?.roleHint).toBe('review');
  });

  test('bare auto + bare auto inherits pane-index default hints', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['auto', 'auto'] }, reg, { buildRoom },
    );
    expect(r?.ok).toBe(true);
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]?.roleHint).toBe('plan');
    expect(spec.members[1]?.roleHint).toBe('exec');
  });
});

describe('/showroom v2 · arity errors', () => {
  test('1 lane → error', async () => {
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['claude'] }, new AgentRoomRegistry(),
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/supported arity 2\/3\/4/);
  });

  test('5 lanes → error', async () => {
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['a', 'b', 'c', 'd', 'e'] },
      new AgentRoomRegistry(),
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/supported arity 2\/3\/4/);
  });

  test('invalid transport → error', async () => {
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: ['claude:bogus', 'codex'] },
      new AgentRoomRegistry(),
    );
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/transport must be pty\|acp\|auto/);
  });
});

describe('/showroom v2 · output lines', () => {
  test('output mentions handoff/relay tip', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    const r = await executeAgentRoomSlash(
      { name: 'showroom', args: [] }, reg, { buildRoom },
    );
    const text = r?.logLines.join('\n') ?? '';
    expect(text).toMatch(/\/lane/);
    expect(text).toMatch(/\/relay plan-build-review/);
    expect(text).toMatch(/\/relay watch start/);
  });
});
