// H6 P4 · room-builder tests with stubbed spawn functions.
//
// We avoid the real adapter registry / PTY / VW infrastructure by
// injecting `spawnInitial` and `spawnIntoPane` stubs. The tests
// exercise:
//   - happy path · 2/3/4-pane build populates registry correctly
//   - layout ratio pattern · 1/(N-i) passed to successive splits
//   - all-or-nothing rollback on partial failure
//   - dispose cascade · closeWindow + session dispose in parallel
//   - arity validation surfaces before any spawn is attempted

import { describe, test, expect } from 'bun:test';
import { buildAgentRoom } from '../src/agent-room/room-builder.js';
import { AgentRoomRegistry } from '../src/agent-room/registry.js';
import type {
  EmbodiedAgentSession,
} from '../src/agent/embodiment.js';
import type {
  SpawnEmbodiedAgentOpts,
  SpawnEmbodiedAgentResult,
  SpawnEmbodiedAgentIntoPaneOpts,
  SpawnEmbodiedAgentIntoPaneResult,
} from '../src/agent/spawn-embodied-agent-in-vw.js';
// ⛔ 종전 경로 '../src/acp/vw-live-bridge.js' 는 «존재하지 않는 모듈»이었다.
//   게다가 그 넷 중 '...Opts' 둘은 저장소 «어디에도» 없었다 — 타입 전용 들여오기라 런타임은 지워서
//   지나가고, tsconfig 가 test/** 를 안 봐서 tsc 도 못 봤다. ⇒ 이 시험의 타입 계약은 «허구»였다.
// ⭐ 그래서 손으로 모양을 베끼지 «않는다» — 실제 계약 함수에서 «파생»시킨다.
//   (이 저장소는 손으로 베낀 타입이 원본보다 늙는 사고를 이미 겪었다.)
import type {
  SpawnAcpLiveSessionInVWFn,
  SpawnAcpLiveSessionResult,
  SpawnAcpLiveIntoPaneFn,
  SpawnAcpLiveIntoPaneResult,
} from '../src/agent-room/room-builder.js';

type SpawnAcpLiveSessionOpts = Parameters<SpawnAcpLiveSessionInVWFn>[0];
type SpawnAcpLiveIntoPaneOpts = Parameters<SpawnAcpLiveIntoPaneFn>[0];
import type { AgentRoomSpec } from '../src/agent-room/types.js';

function makeSession(id: string, onDispose?: () => void): EmbodiedAgentSession {
  return {
    id,
    launchSpec: { brand: 'stub' },
    transports: [{ kind: 'pty', id: `pty-${id}` }],
    state: () => ({ status: 'running' }),
    async send() {},
    async interrupt() {},
    async snapshot() { return ''; },
    async dispose() { onDispose?.(); },
  };
}

interface SpawnLog {
  initial: SpawnEmbodiedAgentOpts[];
  intoPane: SpawnEmbodiedAgentIntoPaneOpts[];
  /** PR-CL7 (C.3 · 2026-04-29) — ACP-lane spawn calls. Keeps PTY logs
   *  unchanged so legacy assertions (`log.initial[0].ratio` etc.) keep
   *  working when callers force PTY via `transportPref: 'pty'`. */
  acpInitial: SpawnAcpLiveSessionOpts[];
  acpIntoPane: SpawnAcpLiveIntoPaneOpts[];
  closedWindows: number[];
  disposed: string[];
  focused: Array<{ windowId: number; paneId: string }>;
  renamedWindows: Array<{ windowId: number; title: string }>;
  renamedPanes: Array<{ windowId: number; paneId: string; title: string }>;
}

function makeSpawnStubs(opts: { failAtIndex?: number; failAcpAtIndex?: number } = {}): {
  log: SpawnLog;
  spawnInitial: (o: SpawnEmbodiedAgentOpts) => Promise<SpawnEmbodiedAgentResult>;
  spawnIntoPane: (o: SpawnEmbodiedAgentIntoPaneOpts) => Promise<SpawnEmbodiedAgentIntoPaneResult>;
  spawnAcpInitial: (o: SpawnAcpLiveSessionOpts) => Promise<SpawnAcpLiveSessionResult>;
  spawnAcpIntoPane: (o: SpawnAcpLiveIntoPaneOpts) => Promise<SpawnAcpLiveIntoPaneResult>;
  closeWindow: (id: number) => void;
  renameWindow: (windowId: number, title: string) => Promise<boolean>;
  renamePane: (windowId: number, paneId: string, title: string) => Promise<boolean>;
  focusPane: (windowId: number, paneId: string) => Promise<boolean>;
} {
  const log: SpawnLog = {
    initial: [],
    intoPane: [],
    acpInitial: [],
    acpIntoPane: [],
    closedWindows: [],
    disposed: [],
    focused: [],
    renamedWindows: [],
    renamedPanes: [],
  };
  let seq = 0;
  // Initial spawn order tracking — the room-builder picks lane based
  // on member.transportPref + brand-resolver, so a single boot may
  // route through either spawnInitial OR spawnAcpInitial. The test
  // helper exposes both paths and the room.members ordering keeps the
  // member-index → log mapping deterministic.
  return {
    log,
    spawnInitial: async (o) => {
      log.initial.push(o);
      if (opts.failAtIndex === 0) throw new Error('initial-fail');
      const sid = `sess-init-${seq++}`;
      return {
        session: makeSession(sid, () => log.disposed.push(sid)),
        windowId: 100,
        paneId: 'pane-0',
        ptyId: `pty-${sid}`,
      };
    },
    spawnIntoPane: async (o) => {
      log.intoPane.push(o);
      const idx = log.intoPane.length; // 1-based for member index
      if (opts.failAtIndex === idx) throw new Error(`intoPane-fail-${idx}`);
      const sid = `sess-pane-${seq++}`;
      return {
        session: makeSession(sid, () => log.disposed.push(sid)),
        windowId: 100,
        paneId: `pane-${idx}`,
        ptyId: `pty-${sid}`,
      };
    },
    spawnAcpInitial: async (o) => {
      log.acpInitial.push(o);
      if (opts.failAcpAtIndex === 0) throw new Error('acp-initial-fail');
      const sid = `acp-cli:${o.backendId}:s-${seq++}`;
      return {
        sessionId: sid,
        backendId: o.backendId,
        windowId: 100,
        paneId: 'pane-0',
        dispose: async () => { log.disposed.push(sid); },
      };
    },
    spawnAcpIntoPane: async (o) => {
      log.acpIntoPane.push(o);
      const totalSplitsSoFar = log.intoPane.length + log.acpIntoPane.length;
      if (opts.failAcpAtIndex === totalSplitsSoFar) throw new Error(`acp-intoPane-fail-${totalSplitsSoFar}`);
      const sid = `acp-cli:${o.backendId}:s-${seq++}`;
      return {
        sessionId: sid,
        backendId: o.backendId,
        windowId: o.targetWindowId,
        paneId: `pane-acp-${totalSplitsSoFar}`,
        dispose: async () => { log.disposed.push(sid); },
      };
    },
    closeWindow: (id) => log.closedWindows.push(id),
    renameWindow: async (windowId: number, title: string) => {
      log.renamedWindows.push({ windowId, title });
      return true;
    },
    renamePane: async (windowId: number, paneId: string, title: string) => {
      log.renamedPanes.push({ windowId, paneId, title });
      return true;
    },
    focusPane: async (windowId: number, paneId: string) => {
      log.focused.push({ windowId, paneId });
      return true;
    },
  };
}

/** PR-CL7 (C.3 · 2026-04-29) — most legacy tests assume codex / monad
 *  spawn through the PTY path. After CL6 introduced the brand × lane
 *  matrix (codex/monad default to ACP), tests need to either provide
 *  an ACP stub or pin transportPref to 'pty'. The latter is more
 *  explicit and keeps each legacy assertion's PTY intent intact, so
 *  this helper applies the pin to every member. */
function pinAllToPty<T extends { brandRef: string }>(
  members: readonly T[],
): Array<T & { transportPref: 'pty' }> {
  return members.map((m) => ({ ...m, transportPref: 'pty' as const }));
}

const threeSpec: AgentRoomSpec = {
  preset: 'three-split',
  members: pinAllToPty([
    { brandRef: 'codex' },
    { brandRef: 'claude' },
    { brandRef: 'gemini' },
  ]),
  layoutMode: 'single-vw',
};

describe('buildAgentRoom · happy path', () => {
  test('3-split: spawns 1 initial + 2 into-pane · registers room', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs();
    const { room, warnings } = await buildAgentRoom(threeSpec, {
      registry,
      spawnInitial: stubs.spawnInitial,
      spawnIntoPane: stubs.spawnIntoPane,
      spawnAcpInitial: stubs.spawnAcpInitial,
      spawnAcpIntoPane: stubs.spawnAcpIntoPane,
      closeWindow: stubs.closeWindow,
      renameWindow: stubs.renameWindow,
      renamePane: stubs.renamePane,
      focusPane: stubs.focusPane,
      now: () => 1000,
    });
    expect(stubs.log.initial).toHaveLength(1);
    expect(stubs.log.intoPane).toHaveLength(2);
    expect(room.members).toHaveLength(3);
    expect(registry.get(room.id)?.windowId).toBe(100);
    expect(warnings).toEqual([]);
  });

  test('2-split works · 1 initial + 1 into-pane', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs();
    const { room } = await buildAgentRoom(
      {
        preset: 'two-split',
        members: pinAllToPty([{ brandRef: 'codex' }, { brandRef: 'claude' }]),
        layoutMode: 'single-vw',
      },
      {
        registry,
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    expect(stubs.log.intoPane).toHaveLength(1);
    expect(room.members).toHaveLength(2);
  });

  test('4-quad works · 1 initial + 3 into-pane', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs();
    const { room } = await buildAgentRoom(
      {
        preset: 'four-quad',
        members: pinAllToPty([
          { brandRef: 'codex' },
          { brandRef: 'claude' },
          { brandRef: 'gemini' },
          // PR-CL7 — `monad` is ACP-only (LANE_MATRIX_BY_BRAND), so a
          // PTY-only legacy assertion needs another brand. local-llm
          // defaults to PTY which preserves the original "1 init + 3
          // into-pane" expectation.
          { brandRef: 'local-llm' },
        ]),
        layoutMode: 'single-vw',
      },
      {
        registry,
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    expect(stubs.log.intoPane).toHaveLength(3);
    expect(room.members).toHaveLength(4);
  });
});

describe('buildAgentRoom · equal-width ratio pattern', () => {
  test('3-split ratios: 1st split = 1/3, 2nd split = 1/2 · yields 3 equal columns', async () => {
    const stubs = makeSpawnStubs();
    await buildAgentRoom(threeSpec, {
      registry: new AgentRoomRegistry(),
      spawnInitial: stubs.spawnInitial,
      spawnIntoPane: stubs.spawnIntoPane,
      spawnAcpInitial: stubs.spawnAcpInitial,
      spawnAcpIntoPane: stubs.spawnAcpIntoPane,
      closeWindow: stubs.closeWindow,
      renameWindow: stubs.renameWindow,
      renamePane: stubs.renamePane,
      focusPane: stubs.focusPane,
    });
    // Pattern from PLAN §4.4: ratio = 1/(N-i) at split index i (0-indexed
    // among splits). For N=3:
    //   split 0 (member 1): ratio = 1/3 (original pane keeps 1/3, new gets 2/3)
    //   split 1 (member 2): ratio = 1/2 (half of the 2/3 = 1/3 each)
    expect(stubs.log.intoPane[0]?.ratio).toBeCloseTo(1 / 3, 6);
    expect(stubs.log.intoPane[1]?.ratio).toBeCloseTo(1 / 2, 6);
    expect(stubs.log.intoPane[0]?.axis).toBe('h');
  });

  test('4-quad ratios: 1/4, 1/3, 1/2', async () => {
    const stubs = makeSpawnStubs();
    await buildAgentRoom(
      {
        preset: 'four-quad',
        members: pinAllToPty([
          { brandRef: 'codex' }, { brandRef: 'claude' },
          { brandRef: 'gemini' }, { brandRef: 'local-llm' },
        ]),
        layoutMode: 'single-vw',
      },
      {
        registry: new AgentRoomRegistry(),
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    expect(stubs.log.intoPane[0]?.ratio).toBeCloseTo(1 / 4, 6);
    expect(stubs.log.intoPane[1]?.ratio).toBeCloseTo(1 / 3, 6);
    expect(stubs.log.intoPane[2]?.ratio).toBeCloseTo(1 / 2, 6);
  });
});

describe('buildAgentRoom · partial-failure rollback', () => {
  test('member[2] fails · rolls back member[0]+[1] · closes window · throws', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs({ failAtIndex: 2 });
    await expect(
      buildAgentRoom(threeSpec, {
        registry,
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      }),
    ).rejects.toThrow(/member\[2\].*intoPane-fail-2/);
    // Window closed + both successful sessions disposed.
    expect(stubs.log.closedWindows).toEqual([100]);
    expect(stubs.log.disposed.length).toBe(2);
    // Registry left empty — no partial rooms.
    expect(registry.list()).toHaveLength(0);
  });

  test('initial spawn fails · no pane mounts attempted · no rollback', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs({ failAtIndex: 0 });
    await expect(
      buildAgentRoom(threeSpec, {
        registry,
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      }),
    ).rejects.toThrow(/member\[0\].*initial-fail/);
    expect(stubs.log.intoPane).toHaveLength(0);
    expect(stubs.log.closedWindows).toEqual([]);
  });
});

describe('buildAgentRoom · dispose cascade', () => {
  test('room.dispose() closes window + disposes every session', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs();
    const { room } = await buildAgentRoom(threeSpec, {
      registry,
      spawnInitial: stubs.spawnInitial,
      spawnIntoPane: stubs.spawnIntoPane,
      spawnAcpInitial: stubs.spawnAcpInitial,
      spawnAcpIntoPane: stubs.spawnAcpIntoPane,
      closeWindow: stubs.closeWindow,
      renameWindow: stubs.renameWindow,
      renamePane: stubs.renamePane,
      focusPane: stubs.focusPane,
    });
    await room.dispose();
    expect(stubs.log.closedWindows).toEqual([100]);
    expect(stubs.log.disposed.length).toBe(3);
  });
});

describe('buildAgentRoom · validation', () => {
  test('arity mismatch surfaces before any spawn attempt', async () => {
    const stubs = makeSpawnStubs();
    await expect(
      buildAgentRoom(
        {
          preset: 'three-split',
          members: [{ brandRef: 'codex' }],
          layoutMode: 'single-vw',
        },
        {
          registry: new AgentRoomRegistry(),
          spawnInitial: stubs.spawnInitial,
          spawnIntoPane: stubs.spawnIntoPane,
          spawnAcpInitial: stubs.spawnAcpInitial,
          spawnAcpIntoPane: stubs.spawnAcpIntoPane,
          closeWindow: stubs.closeWindow,
          renameWindow: stubs.renameWindow,
          renamePane: stubs.renamePane,
          focusPane: stubs.focusPane,
        },
      ),
    ).rejects.toThrow(/expects 3 members/);
    expect(stubs.log.initial).toEqual([]);
  });

  test('multi-vw layoutMode rejected with Bundle 2 message', async () => {
    const stubs = makeSpawnStubs();
    await expect(
      buildAgentRoom(
        {
          preset: 'two-split',
          members: pinAllToPty([{ brandRef: 'codex' }, { brandRef: 'claude' }]),
          layoutMode: 'multi-vw',
        },
        {
          registry: new AgentRoomRegistry(),
          spawnInitial: stubs.spawnInitial,
          spawnIntoPane: stubs.spawnIntoPane,
          spawnAcpInitial: stubs.spawnAcpInitial,
          spawnAcpIntoPane: stubs.spawnAcpIntoPane,
          closeWindow: stubs.closeWindow,
          renameWindow: stubs.renameWindow,
          renamePane: stubs.renamePane,
          focusPane: stubs.focusPane,
        },
      ),
    ).rejects.toThrow(/Bundle 2/);
  });
});

describe('buildAgentRoom · brand resolution', () => {
  test('PolicyDecide is called for auto members with role hint', async () => {
    const policyCalls: Array<{ task: string }> = [];
    const stubs = makeSpawnStubs();
    const { room } = await buildAgentRoom(
      {
        preset: 'three-split',
        members: [
          { brandRef: 'auto', roleHint: 'plan' },
          { brandRef: 'auto', roleHint: 'exec' },
          { brandRef: 'auto', roleHint: 'review' },
        ],
        layoutMode: 'single-vw',
      },
      {
        registry: new AgentRoomRegistry(),
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
        policyDecide: ({ task }) => {
          policyCalls.push({ task });
          // Alternate brands so R8 diversity doesn't collapse.
          if (task.includes('plan')) return { brand: 'claude' };
          if (task.includes('exec')) return { brand: 'codex' };
          return { brand: 'gemini' };
        },
      },
    );
    expect(policyCalls).toHaveLength(3);
    expect(room.members.map((m) => m.brand)).toEqual(['claude', 'codex', 'gemini']);
  });

  test('diversity post-filter kicks in when router returns duplicate brand', async () => {
    const stubs = makeSpawnStubs();
    const { room, warnings } = await buildAgentRoom(
      {
        preset: 'three-split',
        members: [
          { brandRef: 'auto', roleHint: 'plan' },
          { brandRef: 'auto', roleHint: 'exec' },
          { brandRef: 'auto', roleHint: 'review' },
        ],
        layoutMode: 'single-vw',
      },
      {
        registry: new AgentRoomRegistry(),
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
        // Always returns codex — forces diversity filter to kick in.
        policyDecide: () => ({ brand: 'codex' }),
      },
    );
    // Member 0 keeps codex; members 1+2 get diversity-redirected.
    expect(room.members[0]!.brand).toBe('codex');
    expect(room.members[1]!.brand).not.toBe('codex');
    expect(room.members[2]!.brand).not.toBe('codex');
    // Warnings surface the redirects so user sees why picks diverged.
    expect(warnings.some((w) => /already in room/.test(w))).toBe(true);
  });
});

describe('buildAgentRoom · initial focus', () => {
  test('defaults to pane 0 after all panes are mounted', async () => {
    const stubs = makeSpawnStubs();
    await buildAgentRoom(threeSpec, {
      registry: new AgentRoomRegistry(),
      spawnInitial: stubs.spawnInitial,
      spawnIntoPane: stubs.spawnIntoPane,
      spawnAcpInitial: stubs.spawnAcpInitial,
      spawnAcpIntoPane: stubs.spawnAcpIntoPane,
      closeWindow: stubs.closeWindow,
      renameWindow: stubs.renameWindow,
      renamePane: stubs.renamePane,
      focusPane: stubs.focusPane,
    });
    expect(stubs.log.focused).toEqual([{ windowId: 100, paneId: 'pane-0' }]);
  });

  test('focusIndex targets the requested pane after mount', async () => {
    const stubs = makeSpawnStubs();
    await buildAgentRoom(
      {
        ...threeSpec,
        focusIndex: 2,
      },
      {
        registry: new AgentRoomRegistry(),
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    expect(stubs.log.focused).toEqual([{ windowId: 100, paneId: 'pane-2' }]);
  });

  test('room and pane titles are stabilized for showroom identity', async () => {
    const stubs = makeSpawnStubs();
    await buildAgentRoom(
      {
        preset: 'two-split',
        members: pinAllToPty([
          { brandRef: 'codex', roleHint: 'plan' as const },
          { brandRef: 'claude', roleHint: 'review' as const },
        ]),
        roomTitle: 'showroom',
        layoutMode: 'single-vw',
      },
      {
        registry: new AgentRoomRegistry(),
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    expect(stubs.log.renamedWindows).toEqual([{ windowId: 100, title: 'showroom' }]);
    expect(stubs.log.renamedPanes).toEqual([
      { windowId: 100, paneId: 'pane-0', title: 'codex · plan' },
      { windowId: 100, paneId: 'pane-1', title: 'claude · review' },
    ]);
  });
});

// ── PR-CL7 (C.3 · 2026-04-29) — Mixed-lane room ─────────────────────
//
// Verifies that an agent-room composed of brands with different default
// lanes routes each member through the correct spawn entry. Codex/monad
// default to ACP (CL6 lane matrix); claude/gemini default to PTY. The
// expected outcome for `/agent-room 4 codex claude gemini monad` is:
//
//   member 0 (codex)  → spawnAcpInitial
//   member 1 (claude) → spawnIntoPane (PTY split)
//   member 2 (gemini) → spawnIntoPane (PTY split)
//   member 3 (monad)  → spawnAcpIntoPane (ACP split)

describe('buildAgentRoom · mixed-lane (PR-CL7)', () => {
  test('codex/monad default to ACP · claude/gemini default to PTY · room mounts via correct spawners', async () => {
    const registry = new AgentRoomRegistry();
    const stubs = makeSpawnStubs();
    const { room, resolvedBrands, warnings } = await buildAgentRoom(
      {
        preset: 'four-quad',
        members: [
          { brandRef: 'codex' },
          { brandRef: 'claude' },
          { brandRef: 'gemini' },
          { brandRef: 'monad' },
        ],
        layoutMode: 'single-vw',
      },
      {
        registry,
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    expect(room.members).toHaveLength(4);
    // Member 0 (codex) routed to ACP initial.
    expect(stubs.log.acpInitial).toHaveLength(1);
    expect(stubs.log.acpInitial[0]?.backendId).toBe('codex');
    expect(stubs.log.initial).toHaveLength(0);
    // Members 1 (claude) + 2 (gemini) → PTY splits.
    expect(stubs.log.intoPane).toHaveLength(2);
    expect(stubs.log.intoPane[0]?.brand).toBe('claude');
    expect(stubs.log.intoPane[1]?.brand).toBe('gemini');
    // Member 3 (monad) → ACP split.
    expect(stubs.log.acpIntoPane).toHaveLength(1);
    expect(stubs.log.acpIntoPane[0]?.backendId).toBe('monad');
    // resolvedBrands.laneKind reflects the matrix.
    expect(resolvedBrands.map((r) => r.laneKind)).toEqual(['acp', 'pty', 'pty', 'acp']);
    expect(warnings).toEqual([]);
  });

  test('mixed-lane ratios match equal-width pattern across both lanes', async () => {
    const stubs = makeSpawnStubs();
    await buildAgentRoom(
      {
        preset: 'four-quad',
        members: [
          { brandRef: 'codex' },
          { brandRef: 'claude' },
          { brandRef: 'gemini' },
          { brandRef: 'monad' },
        ],
        layoutMode: 'single-vw',
      },
      {
        registry: new AgentRoomRegistry(),
        spawnInitial: stubs.spawnInitial,
        spawnIntoPane: stubs.spawnIntoPane,
        spawnAcpInitial: stubs.spawnAcpInitial,
        spawnAcpIntoPane: stubs.spawnAcpIntoPane,
        closeWindow: stubs.closeWindow,
        renameWindow: stubs.renameWindow,
        renamePane: stubs.renamePane,
        focusPane: stubs.focusPane,
      },
    );
    // 4-quad ratio pattern: split index 0 = 1/4, 1 = 1/3, 2 = 1/2.
    // claude (split 0) + gemini (split 1) go through PTY; monad (split 2)
    // through ACP. The ratio sequence is shared because the room-builder
    // computes it from the member index regardless of lane.
    expect(stubs.log.intoPane[0]?.ratio).toBeCloseTo(1 / 4, 6);
    expect(stubs.log.intoPane[1]?.ratio).toBeCloseTo(1 / 3, 6);
    expect(stubs.log.acpIntoPane[0]?.ratio).toBeCloseTo(1 / 2, 6);
  });

  test('mixed-lane rollback: PTY split fails → both ACP and PTY sessions disposed', async () => {
    const registry = new AgentRoomRegistry();
    // Fail at PTY split index 1 (member 1 = claude). After member 0
    // (codex acp) succeeds, the rollback path must dispose both lanes.
    const stubs = makeSpawnStubs({ failAtIndex: 1 });
    await expect(
      buildAgentRoom(
        {
          preset: 'two-split',
          members: [
            { brandRef: 'codex' },
            { brandRef: 'claude' },
          ],
          layoutMode: 'single-vw',
        },
        {
          registry,
          spawnInitial: stubs.spawnInitial,
          spawnIntoPane: stubs.spawnIntoPane,
          spawnAcpInitial: stubs.spawnAcpInitial,
          spawnAcpIntoPane: stubs.spawnAcpIntoPane,
          closeWindow: stubs.closeWindow,
          renameWindow: stubs.renameWindow,
          renamePane: stubs.renamePane,
          focusPane: stubs.focusPane,
        },
      ),
    ).rejects.toThrow(/member\[1\].*intoPane-fail/);
    expect(stubs.log.closedWindows).toEqual([100]);
    // Codex ACP session must have been disposed during rollback.
    expect(stubs.log.disposed.length).toBeGreaterThanOrEqual(1);
    expect(registry.list()).toHaveLength(0);
  });
});
