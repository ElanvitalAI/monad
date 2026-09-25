// Showroom v2 · /relay slash macro.
//
// Surface (PLAN §D8):
//   /relay plan-build-review                 # lane[0] → lane[1] → lane[2]
//   /relay broadcast                         # active lane → every other lane
//   /relay broadcast --from <lane>           # explicit source
//   /relay <fromLane> -> <toA>,<toB>,...     # explicit fan-out
//   /relay --room <id> ...                   # specific room
//   /relay help
//
// Each step routes through the same `executeHandoffSlash` pipeline so
// HITL + audit + agent-graph behavior is identical to one-by-one
// handoffs. A failed/denied step does NOT abort the whole macro — we
// record per-step status and continue, so the user sees a clear matrix
// of which lanes accepted vs rejected.

import { debug } from '../debug/log.js';
import {
  getDefaultAgentRoomRegistry,
  type AgentRoomRegistry,
  type AgentRoomSnapshot,
} from '../agent-room/registry.js';
import {
  executeHandoffSlash,
  resolveLaneAddress,
  type HandoffSlashDeps,
  type HandoffSlashResult,
} from './handoff-slash.js';
import {
  getDefaultAutoRelayOrchestrator,
  type AutoRelayOrchestrator,
} from './auto-relay/orchestrator.js';
import type {
  SlashExecuteRequest,
  SlashExecuteResult,
} from '../skills/tools/dashboard-slash.js';

export interface RelaySlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export interface RelaySlashDeps extends HandoffSlashDeps {
  /** Test seam — override the auto-relay orchestrator (Arc 4). */
  readonly orchestrator?: AutoRelayOrchestrator;
}

const KNOWN_MACROS = ['plan-build-review', 'broadcast'] as const;

export async function executeRelaySlash(
  req: SlashExecuteRequest,
  deps: RelaySlashDeps = {},
): Promise<RelaySlashResult | null> {
  if (req.name !== 'relay') return null;
  const args = [...req.args];
  const first = (args[0] ?? '').toLowerCase();
  if (args.length === 0 || first === 'help' || first === '?') return helpOutput();

  // Arc 4 (2026-04-28) · `/relay watch <sub>` routes to the auto-relay
  // orchestrator. Sub-commands: start [roomId] · stop · status.
  if (first === 'watch') {
    return runWatchSubcommand(args.slice(1), deps);
  }

  const registry = deps.registry ?? getDefaultAgentRoomRegistry();
  const opts = parseSharedOpts(args);
  if ('error' in opts) return errorOutput(opts.error);

  const room = opts.roomId
    ? registry.list().find((r) => r.id === opts.roomId)
    : pickLatestRoom(registry);
  if (!room) {
    return errorOutput(
      opts.roomId
        ? `/relay: no live room with id '${opts.roomId}'`
        : '/relay: no live agent room · spawn one with /showroom first',
    );
  }

  const sub = (opts.positional[0] ?? '').toLowerCase();
  try {
    if (sub === 'plan-build-review') {
      return await runPlanBuildReview(room, deps);
    }
    if (sub === 'broadcast') {
      return await runBroadcast(room, opts, deps);
    }
    // Explicit `<from> -> <toA>,<toB>` shape.
    if (opts.positional.length >= 3 && opts.positional[1] === '->') {
      return await runExplicitFanOut(room, opts, deps);
    }
    return errorOutput(
      `/relay: unknown macro '${opts.positional[0] ?? ''}' · try ${KNOWN_MACROS.join(' · ')} · or '<from> -> <toA>,<toB>'`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (debug.enabled) debug.log('showroom.relay.error', sub, { error: msg }, { level: 'error' });
    return errorOutput(`/relay ${sub}: ${msg}`);
  }
}

// ─── Macro: plan-build-review ────────────────────────────────────────

async function runPlanBuildReview(
  room: AgentRoomSnapshot,
  deps: RelaySlashDeps,
): Promise<RelaySlashResult> {
  if (room.members.length < 3) {
    return errorOutput(
      `/relay plan-build-review: room ${room.id} has only ${room.members.length} pane(s) · needs 3+`,
    );
  }
  // Step 0: lane[0] → lane[1] · Step 1: lane[1] → lane[2]
  const steps: Array<[number, number]> = [[0, 1], [1, 2]];
  return runMacroSteps(room, steps, 'plan-build-review', deps);
}

// ─── Macro: broadcast ────────────────────────────────────────────────

async function runBroadcast(
  room: AgentRoomSnapshot,
  opts: ParsedRelayOpts,
  deps: RelaySlashDeps,
): Promise<RelaySlashResult> {
  if (room.members.length < 2) {
    return errorOutput(
      `/relay broadcast: room ${room.id} has only ${room.members.length} pane(s) · needs 2+`,
    );
  }
  const fromAddr = opts.fromLane ?? '0';
  const fromRes = resolveLaneAddress(room, fromAddr);
  if ('error' in fromRes) return errorOutput(`/relay broadcast: from ${fromRes.error}`);

  const steps: Array<[number, number]> = [];
  for (let i = 0; i < room.members.length; i++) {
    if (i !== fromRes.index) steps.push([fromRes.index, i]);
  }
  return runMacroSteps(room, steps, 'broadcast', deps);
}

// ─── Explicit fan-out: /relay <from> -> <to1>,<to2> ─────────────────

async function runExplicitFanOut(
  room: AgentRoomSnapshot,
  opts: ParsedRelayOpts,
  deps: RelaySlashDeps,
): Promise<RelaySlashResult> {
  const fromAddr = opts.positional[0]!;
  const toListRaw = opts.positional[2]!;
  const fromRes = resolveLaneAddress(room, fromAddr);
  if ('error' in fromRes) return errorOutput(`/relay: from ${fromRes.error}`);

  const toAddrs = toListRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (toAddrs.length === 0) {
    return errorOutput('/relay: empty target list after `->`');
  }
  const steps: Array<[number, number]> = [];
  for (const toAddr of toAddrs) {
    const toRes = resolveLaneAddress(room, toAddr);
    if ('error' in toRes) return errorOutput(`/relay: to ${toRes.error}`);
    if (toRes.index === fromRes.index) {
      return errorOutput(`/relay: target '${toAddr}' is the same as source`);
    }
    steps.push([fromRes.index, toRes.index]);
  }
  return runMacroSteps(room, steps, 'fan-out', deps);
}

// ─── Step runner ─────────────────────────────────────────────────────

interface StepOutcome {
  readonly fromIdx: number;
  readonly toIdx: number;
  readonly fromBrand: string;
  readonly toBrand: string;
  readonly ok: boolean;
  readonly note: string;
}

async function runMacroSteps(
  room: AgentRoomSnapshot,
  steps: ReadonlyArray<readonly [number, number]>,
  macroName: string,
  deps: RelaySlashDeps,
): Promise<RelaySlashResult> {
  const outcomes: StepOutcome[] = [];
  for (const [fromIdx, toIdx] of steps) {
    const fromMember = room.members[fromIdx]!;
    const toMember = room.members[toIdx]!;
    const args = [
      String(fromIdx), String(toIdx), '--room', room.id,
    ];
    if (debug.enabled) {
      debug.log('showroom.relay.step', `${macroName}`, {
        from: fromIdx, to: toIdx,
        fromBrand: fromMember.brand, toBrand: toMember.brand,
        roomId: room.id,
      });
    }
    let stepResult: HandoffSlashResult | null = null;
    try {
      stepResult = await executeHandoffSlash(
        { name: 'lane', args },
        deps,
      );
    } catch (err) {
      outcomes.push({
        fromIdx, toIdx,
        fromBrand: fromMember.brand, toBrand: toMember.brand,
        ok: false,
        note: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!stepResult || !stepResult.ok) {
      outcomes.push({
        fromIdx, toIdx,
        fromBrand: fromMember.brand, toBrand: toMember.brand,
        ok: false,
        note: stepResult?.message ?? 'handoff failed',
      });
      continue;
    }
    outcomes.push({
      fromIdx, toIdx,
      fromBrand: fromMember.brand, toBrand: toMember.brand,
      ok: true,
      note: stepResult.logLines[0] ?? 'ok',
    });
  }

  const ok = outcomes.every((o) => o.ok);
  const lines: string[] = [
    `/relay ${macroName} · room ${room.id} · ${outcomes.length} step(s)`,
  ];
  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i]!;
    const prefix = o.ok ? '  ✓' : '  ✗';
    lines.push(
      `${prefix} step ${i}: ${o.fromBrand}[${o.fromIdx}] → ${o.toBrand}[${o.toIdx}]${o.ok ? '' : ` · ${o.note}`}`,
    );
  }
  if (!ok) {
    lines.push('');
    lines.push('  some steps failed · review audit log for details');
  }
  return {
    ok,
    name: 'relay',
    args: [],
    logLines: lines,
    ...(ok ? {} : { message: 'one or more relay steps failed' }),
  };
}

// ─── Shared opts parser ──────────────────────────────────────────────

interface ParsedRelayOpts {
  positional: string[];
  roomId?: string;
  fromLane?: string;
}

function parseSharedOpts(tokens: string[]): ParsedRelayOpts | { error: string } {
  const positional: string[] = [];
  const out: ParsedRelayOpts = { positional };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--room') {
      const next = tokens[i + 1];
      if (!next) return { error: '/relay: --room requires a room id' };
      out.roomId = next;
      i += 2;
      continue;
    }
    if (t === '--from') {
      const next = tokens[i + 1];
      if (!next) return { error: '/relay: --from requires a lane address' };
      out.fromLane = next;
      i += 2;
      continue;
    }
    positional.push(t);
    i += 1;
  }
  return out;
}

function pickLatestRoom(registry: AgentRoomRegistry): AgentRoomSnapshot | undefined {
  const rooms = registry.list();
  if (rooms.length === 0) return undefined;
  let latest = rooms[0]!;
  for (const r of rooms) if (r.createdAt > latest.createdAt) latest = r;
  return latest;
}

function helpOutput(): RelaySlashResult {
  return {
    ok: true, name: 'relay', args: [],
    logLines: [
      '/relay — multi-lane handoff macros + auto-relay watcher (HITL gated)',
      '  /relay plan-build-review                  3-pane sequential plan→build→review',
      '  /relay broadcast                          active lane → every other lane',
      '  /relay broadcast --from <lane>            explicit source for the fan-out',
      '  /relay <from> -> <toA>,<toB>              explicit fan-out',
      '  /relay <macro> --room <id>                target a specific room',
      '  /relay watch start [roomId]               auto-relay watcher · idle → propose handoff',
      '  /relay watch stop                         stop the auto-relay watcher',
      '  /relay watch status                       active watcher info',
      '  /relay help                               this text',
      '',
      '  Each step is an independent handoff (HITL approver each time).',
      '  Failed/denied steps are recorded but do NOT abort subsequent steps.',
      '',
      '  Examples:',
      '    /relay plan-build-review',
      '    /relay broadcast --from 0',
      '    /relay 0 -> 1,2',
      '    /relay claude -> codex,gemini',
      '    /relay watch start                       auto-propose handoffs in latest showroom',
      '    /relay watch status',
    ],
  };
}

// ─── Arc 4 · /relay watch sub-commands ────────────────────────────

async function runWatchSubcommand(
  rest: readonly string[],
  deps: RelaySlashDeps,
): Promise<RelaySlashResult> {
  const orchestrator = deps.orchestrator ?? getDefaultAutoRelayOrchestrator();
  const sub = (rest[0] ?? '').toLowerCase();
  if (!sub || sub === 'help' || sub === '?') return watchHelpOutput();

  if (sub === 'start') {
    const roomId = rest[1];
    const r = await orchestrator.start(roomId);
    return r.ok
      ? { ok: true, name: 'relay', args: ['watch', 'start'], logLines: [r.message] }
      : errorOutput(r.message);
  }
  if (sub === 'stop') {
    const r = await orchestrator.stop();
    return r.ok
      ? { ok: true, name: 'relay', args: ['watch', 'stop'], logLines: [r.message] }
      : errorOutput(r.message);
  }
  if (sub === 'status') {
    const s = orchestrator.status();
    const lines: string[] = [];
    if (!s.active) {
      lines.push('auto-relay: idle · run /relay watch start to begin');
    } else {
      lines.push(
        `auto-relay watching ${s.roomId} · ${s.watcherCount} lane(s)`,
      );
      lines.push(
        `  proposals=${s.proposalsSeen} dispatched=${s.dispatched} denied=${s.denied}`,
      );
    }
    return { ok: true, name: 'relay', args: ['watch', 'status'], logLines: lines };
  }
  return errorOutput(`/relay watch: unknown sub '${sub}' · try start | stop | status | help`);
}

function watchHelpOutput(): RelaySlashResult {
  return {
    ok: true, name: 'relay', args: ['watch', 'help'],
    logLines: [
      '/relay watch — background lane idle watcher (auto-propose handoffs)',
      '  /relay watch start [roomId]   begin watching (default = latest room)',
      '  /relay watch stop             halt the watcher',
      '  /relay watch status           active room / counts',
      '',
      '  When a lane goes idle (default 2.5s of no PTY output), the',
      '  watcher proposes a handoff (HITL yes/no).  Yes routes through',
      '  /lane skipping the inject approver (auto-relay HITL already',
      "  gated). No keeps the lane silent until it's active again.",
      '',
      '  v1 limits: one watched room at a time; ACP-only lanes without',
      '  observers are skipped automatically.',
    ],
  };
}

function errorOutput(msg: string): RelaySlashResult {
  return {
    ok: false, name: 'relay', args: [],
    logLines: [msg],
    message: msg,
  };
}
