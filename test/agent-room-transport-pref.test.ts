// Showroom v2 Arc 2 · transportPref + brand compat tests.
//
// Covers:
//   - validateAgentRoomSpec enum check on member.transportPref
//   - checkTransportCompat compat-table cells (drop · warning · pass-through)
//   - composeFromLanes pipes lane.transportPref into member.transportPref
//   - room-builder surfaces compat warnings via BuildRoomResult.warnings

import { describe, test, expect, mock } from 'bun:test';
import { validateAgentRoomSpec } from '../src/agent-room/types.js';
import {
  checkTransportCompat,
  getLaneMatrixForBrand,
  LANE_MATRIX_BY_BRAND,
  resolveLaneKind,
} from '../src/agent-room/transport-compat.js';
import { executeAgentRoomSlash } from '../src/skills/tools/agent-room-slash.js';
import { AgentRoomRegistry } from '../src/agent-room/registry.js';
import type { AgentRoomSpec } from '../src/agent-room/types.js';

// ─── validateAgentRoomSpec · enum ─────────────────────────────────

describe('validateAgentRoomSpec · transportPref enum', () => {
  test('undefined transportPref is fine', () => {
    expect(() => validateAgentRoomSpec({
      preset: 'two-split',
      members: [{ brandRef: 'codex' }, { brandRef: 'claude' }],
    })).not.toThrow();
  });

  test('valid pref pty', () => {
    expect(() => validateAgentRoomSpec({
      preset: 'two-split',
      members: [{ brandRef: 'codex', transportPref: 'pty' }, { brandRef: 'claude' }],
    })).not.toThrow();
  });

  test('valid pref acp', () => {
    expect(() => validateAgentRoomSpec({
      preset: 'two-split',
      members: [{ brandRef: 'monad', transportPref: 'acp' }, { brandRef: 'claude' }],
    })).not.toThrow();
  });

  test('valid pref auto', () => {
    expect(() => validateAgentRoomSpec({
      preset: 'two-split',
      members: [{ brandRef: 'codex', transportPref: 'auto' }, { brandRef: 'claude' }],
    })).not.toThrow();
  });

  test('invalid enum throws', () => {
    expect(() => validateAgentRoomSpec({
      preset: 'two-split',
      members: [
        { brandRef: 'codex', transportPref: 'rest' as never },
        { brandRef: 'claude' },
      ],
    })).toThrow(/transportPref invalid/);
  });
});

// ─── checkTransportCompat · compat-table ──────────────────────────

describe('checkTransportCompat · ACP-only brands (monad)', () => {
  test('monad + pty → drop with warning', () => {
    const r = checkTransportCompat('monad', 'pty');
    expect(r.effective).toBeUndefined();
    expect(r.warning).toMatch(/no PTY adapter/);
  });

  test('monad + acp → pass through', () => {
    const r = checkTransportCompat('monad', 'acp');
    expect(r.effective).toBe('acp');
    expect(r.warning).toBeUndefined();
  });

  test('monad + auto/undefined → no hint', () => {
    expect(checkTransportCompat('monad', 'auto').effective).toBeUndefined();
    expect(checkTransportCompat('monad', undefined).effective).toBeUndefined();
  });
});

describe('checkTransportCompat · PTY-only embodied brands (codex/claude/gemini)', () => {
  test('codex + acp → drop with warning', () => {
    const r = checkTransportCompat('codex', 'acp');
    expect(r.effective).toBeUndefined();
    expect(r.warning).toMatch(/no ACP-embodied adapter yet/);
  });

  test('claude + acp → drop', () => {
    const r = checkTransportCompat('claude', 'acp');
    expect(r.effective).toBeUndefined();
    expect(r.warning).toMatch(/no ACP-embodied adapter/);
  });

  test('gemini + acp → drop', () => {
    const r = checkTransportCompat('gemini', 'acp');
    expect(r.effective).toBeUndefined();
  });

  test('codex + pty → pass through', () => {
    const r = checkTransportCompat('codex', 'pty');
    expect(r.effective).toBe('pty');
    expect(r.warning).toBeUndefined();
  });
});

describe('checkTransportCompat · local-llm', () => {
  test('local-llm + acp → drop with local-llm-specific reason', () => {
    const r = checkTransportCompat('local-llm', 'acp');
    expect(r.effective).toBeUndefined();
    expect(r.warning).toMatch(/local LLM is PTY only/);
  });

  test('lll:llama3 + acp → drop', () => {
    const r = checkTransportCompat('lll:llama3', 'acp');
    expect(r.effective).toBeUndefined();
    expect(r.warning).toMatch(/local LLM is PTY only/);
  });

  test('lll:llama3 + pty → pass through', () => {
    const r = checkTransportCompat('lll:llama3', 'pty');
    expect(r.effective).toBe('pty');
  });
});

describe('checkTransportCompat · unknown brand', () => {
  test('unknown brand pass-through', () => {
    const r = checkTransportCompat('mystery', 'acp');
    expect(r.effective).toBe('acp');
    expect(r.warning).toBeUndefined();
  });
});

// ─── room-builder integration · warnings surface ─────────────────

describe('buildAgentRoom · transportPref warnings', () => {
  function makeStubs() {
    let seq = 0;
    return {
      spawnInitial: async () => ({
        session: {
          id: `s-${seq}`,
          launchSpec: { brand: 'stub' },
          transports: [{ kind: 'pty' as const, id: `pty-${seq}` }],
          state: () => ({ status: 'running' as const }),
          send: async () => {},
          interrupt: async () => {},
          snapshot: async () => '',
          dispose: async () => {},
        },
        windowId: 100,
        paneId: 'pane-0',
        ptyId: `pty-${seq++}`,
      }),
      spawnIntoPane: async () => ({
        session: {
          id: `s-${seq}`,
          launchSpec: { brand: 'stub' },
          transports: [{ kind: 'pty' as const, id: `pty-${seq}` }],
          state: () => ({ status: 'running' as const }),
          send: async () => {},
          interrupt: async () => {},
          snapshot: async () => '',
          dispose: async () => {},
        },
        windowId: 100,
        paneId: `pane-${seq}`,
        ptyId: `pty-${seq++}`,
      }),
      // PR-CL7 (C.3 · 2026-04-29) — ACP-lane stubs. After CL6 every
      // brand has a `laneKind`; brands that default to ACP (codex /
      // monad) route here unless `transportPref: 'pty'` narrows them
      // back. The transport-pref warning tests cover both branches.
      spawnAcpInitial: async (o: { backendId: string }) => {
        const sid = `acp-${seq++}`;
        return {
          sessionId: sid,
          backendId: o.backendId,
          windowId: 100,
          paneId: 'pane-0',
          dispose: async () => {},
        };
      },
      spawnAcpIntoPane: async (o: { backendId: string; targetWindowId: number }) => {
        const sid = `acp-${seq++}`;
        return {
          sessionId: sid,
          backendId: o.backendId,
          windowId: o.targetWindowId,
          paneId: `pane-${seq}`,
          dispose: async () => {},
        };
      },
      closeWindow: () => {},
      renameWindow: async () => true,
      renamePane: async () => true,
      focusPane: async () => true,
    };
  }

  test('monad + pty → warning surfaced', async () => {
    const reg = new AgentRoomRegistry();
    const stubs = makeStubs();
    // dynamic import inside to avoid circular module init
    const { buildAgentRoom } = await import('../src/agent-room/room-builder.js');
    const result = await buildAgentRoom(
      {
        preset: 'two-split',
        members: [
          { brandRef: 'monad', transportPref: 'pty' },
          { brandRef: 'codex' },
        ],
      },
      { registry: reg, ...stubs },
    );
    const warningText = result.warnings.join('\n');
    expect(warningText).toMatch(/transportPref 'pty' dropped/);
    expect(warningText).toMatch(/no PTY adapter/);
    expect(result.room.members.length).toBe(2);
  });

  test('lll:llama3 + acp → warning surfaced', async () => {
    const reg = new AgentRoomRegistry();
    const stubs = makeStubs();
    const { buildAgentRoom } = await import('../src/agent-room/room-builder.js');
    const result = await buildAgentRoom(
      {
        preset: 'two-split',
        members: [
          { brandRef: 'lll:llama3', transportPref: 'acp' },
          { brandRef: 'codex' },
        ],
      },
      { registry: reg, ...stubs },
    );
    const warningText = result.warnings.join('\n');
    expect(warningText).toMatch(/transportPref 'acp' dropped/);
    expect(warningText).toMatch(/local LLM is PTY only/);
  });

  test('codex + acp → warning surfaced', async () => {
    const reg = new AgentRoomRegistry();
    const stubs = makeStubs();
    const { buildAgentRoom } = await import('../src/agent-room/room-builder.js');
    const result = await buildAgentRoom(
      {
        preset: 'two-split',
        members: [
          { brandRef: 'codex', transportPref: 'acp' },
          { brandRef: 'claude' },
        ],
      },
      { registry: reg, ...stubs },
    );
    const warningText = result.warnings.join('\n');
    expect(warningText).toMatch(/no ACP-embodied adapter yet/);
  });

  test('compatible combo → no transport warning', async () => {
    const reg = new AgentRoomRegistry();
    const stubs = makeStubs();
    const { buildAgentRoom } = await import('../src/agent-room/room-builder.js');
    const result = await buildAgentRoom(
      {
        preset: 'two-split',
        members: [
          { brandRef: 'codex', transportPref: 'pty' },
          { brandRef: 'monad', transportPref: 'acp' },
        ],
      },
      { registry: reg, ...stubs },
    );
    const warningText = result.warnings.join('\n');
    expect(warningText).not.toMatch(/transportPref/);
  });
});

// ─── composeFromLanes · transportPref pipe ────────────────────────

describe('composeFromLanes · transportPref pipe', () => {
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

  test('explicit pty → member.transportPref=pty', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    await executeAgentRoomSlash(
      { name: 'showroom', args: ['claude:pty', 'codex:acp'] },
      reg, { buildRoom },
    );
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]?.transportPref).toBe('pty');
    expect(spec.members[1]?.transportPref).toBe('acp');
  });

  test('explicit auto → member.transportPref undefined (drop bare auto)', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    await executeAgentRoomSlash(
      { name: 'showroom', args: ['claude:auto', 'codex:auto'] },
      reg, { buildRoom },
    );
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]?.transportPref).toBeUndefined();
    expect(spec.members[1]?.transportPref).toBeUndefined();
  });

  test('no transport segment → member.transportPref undefined', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    await executeAgentRoomSlash(
      { name: 'showroom', args: ['claude', 'codex'] },
      reg, { buildRoom },
    );
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]?.transportPref).toBeUndefined();
  });

  test('local-llm with explicit pty pipes through', async () => {
    const reg = new AgentRoomRegistry();
    const buildRoom = fakeBuildRoom(2);
    await executeAgentRoomSlash(
      { name: 'showroom', args: ['build:lll:llama3:pty', 'review:gemini'] },
      reg, { buildRoom },
    );
    const spec = buildRoom.mock.calls[0]?.[0] as AgentRoomSpec;
    expect(spec.members[0]?.brandRef).toBe('lll:llama3');
    expect(spec.members[0]?.transportPref).toBe('pty');
  });
});

// ─── PR-CL6 (C.2 · 2026-04-29) — Lane matrix exposure ─────────────────
//
// Verifies that LANE_MATRIX_BY_BRAND advertises the correct defaults,
// getLaneMatrixForBrand handles aliases / lll:<model> / unknown brand,
// and resolveLaneKind narrows a user transportPref to the brand's
// supported set.

describe('LANE_MATRIX_BY_BRAND', () => {
  test('contains an entry for every recognized brand', () => {
    expect(Object.keys(LANE_MATRIX_BY_BRAND).sort()).toEqual([
      'claude', 'codex', 'gemini', 'local-llm', 'monad',
    ]);
  });

  test('codex defaults to acp + supports pty acp hybrid', () => {
    const e = LANE_MATRIX_BY_BRAND.codex!;
    expect(e.defaultLane).toBe('acp');
    expect(e.supported).toEqual(['pty', 'acp', 'hybrid']);
  });

  test('claude is pty-only', () => {
    const e = LANE_MATRIX_BY_BRAND.claude!;
    expect(e.defaultLane).toBe('pty');
    expect(e.supported).toEqual(['pty']);
  });

  test('monad is acp-only', () => {
    const e = LANE_MATRIX_BY_BRAND.monad!;
    expect(e.defaultLane).toBe('acp');
    expect(e.supported).toEqual(['acp']);
  });
});

describe('getLaneMatrixForBrand', () => {
  test('canonical brand → entry', () => {
    expect(getLaneMatrixForBrand('codex')?.defaultLane).toBe('acp');
  });

  test('case-insensitive lookup', () => {
    expect(getLaneMatrixForBrand('CLAUDE')?.defaultLane).toBe('pty');
  });

  test('lll:<model> maps to local-llm entry', () => {
    expect(getLaneMatrixForBrand('lll:qwen-32b')?.defaultLane).toBe('pty');
  });

  test('unknown brand → null', () => {
    expect(getLaneMatrixForBrand('not-a-real-brand')).toBeNull();
  });
});

describe('resolveLaneKind', () => {
  test('no pref → defaultLane', () => {
    expect(resolveLaneKind('codex', undefined)).toBe('acp');
    expect(resolveLaneKind('claude', undefined)).toBe('pty');
  });

  test('auto pref → defaultLane', () => {
    expect(resolveLaneKind('codex', 'auto')).toBe('acp');
  });

  test('explicit pref narrows to supported', () => {
    expect(resolveLaneKind('codex', 'pty')).toBe('pty');
    expect(resolveLaneKind('codex', 'acp')).toBe('acp');
  });

  test('unsupported pref drops to defaultLane', () => {
    // claude has no acp adapter; user request narrows back to pty.
    expect(resolveLaneKind('claude', 'acp')).toBe('pty');
  });

  test('unknown brand → null', () => {
    expect(resolveLaneKind('mystery-brand', 'pty')).toBeNull();
  });
});
