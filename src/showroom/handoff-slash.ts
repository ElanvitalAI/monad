// Showroom v2 · /lane slash command.
//
// Surface (PLAN §D7):
//   /lane <fromLane> <toLane>
//   /lane <fromLane> <toLane> --as user-message|system-note|attached-block
//   /lane <fromLane> <toLane> --room <roomId>
//   /lane list
//   /lane help
//
// Lane address forms:
//   <integer>      pane index (0-based)
//   <brand>        first member with matching brandRef (codex/claude/...)
//   <roleHint>     first member with matching roleHint (plan/exec/review/reflect)
//   build          alias for `exec`
//
// When `--room` is omitted, the most recently created live room is
// used. The pipeline:
//   1. Resolve from lane → pane source id (`vw-pane:<wid>/<pid>`)
//   2. Resolve to lane → target session id
//   3. Delegate to dispatchInjectCaptureToContext (HITL approver runs)
//   4. audit detail extended with via='showroom-handoff' + lane info

import { debug } from '../debug/log.js';
import {
  getDefaultAgentRoomRegistry,
  type AgentRoomRegistry,
  type AgentRoomSnapshot,
} from '../agent-room/registry.js';
import type { AgentRoomMemberInstance } from '../agent-room/types.js';
import {
  injectCapture,
  InjectError,
  type InjectMode,
  type InjectDeps,
} from '../capture/inject-context.js';
import { findLiveSessionById } from '../agent/spawn-embodied-agent-in-vw.js';
import { recordControlAudit } from '../control-audit-log.js';
import type {
  SlashExecuteRequest,
  SlashExecuteResult,
} from '../skills/tools/dashboard-slash.js';

const DEFAULT_AS: InjectMode = 'user-message';
const VALID_MODES: readonly InjectMode[] = [
  'user-message', 'system-note', 'attached-block',
];

export interface HandoffSlashResult extends SlashExecuteResult {
  ok: boolean;
  logLines: string[];
}

export interface HandoffSlashDeps {
  /** Test seam — the agent-room registry is shared global state in
   *  prod, but tests pass a fresh instance. */
  readonly registry?: AgentRoomRegistry;
  /** Test seam — bypass the HITL approver (matches inject-context's
   *  skipApprover convention). */
  readonly skipApprover?: boolean;
  /** Override `injectCapture` deps for tests. Falls back to the
   *  prod live-session lookup when absent. */
  readonly injectDeps?: Partial<InjectDeps>;
}

export async function executeHandoffSlash(
  req: SlashExecuteRequest,
  deps: HandoffSlashDeps = {},
): Promise<HandoffSlashResult | null> {
  if (req.name !== 'lane') return null;
  const args = [...req.args];
  const first = (args[0] ?? '').toLowerCase();
  if (args.length === 0 || first === 'help' || first === '?') {
    return helpOutput();
  }
  if (first === 'list') {
    return listOutput(deps.registry ?? getDefaultAgentRoomRegistry());
  }
  try {
    const parsed = parseArgs(args);
    if ('error' in parsed) return errorOutput(parsed.error);

    const registry = deps.registry ?? getDefaultAgentRoomRegistry();
    const room = parsed.opts.roomId
      ? registry.list().find((r) => r.id === parsed.opts.roomId)
      : pickLatestRoom(registry);
    if (!room) {
      return errorOutput(
        parsed.opts.roomId
          ? `/lane: no live room with id '${parsed.opts.roomId}'`
          : '/lane: no live agent room · spawn one with /showroom first',
      );
    }

    const fromMember = resolveLaneAddress(room, parsed.fromLane);
    if ('error' in fromMember) return errorOutput(`/lane from: ${fromMember.error}`);
    const toMember = resolveLaneAddress(room, parsed.toLane);
    if ('error' in toMember) return errorOutput(`/lane to: ${toMember.error}`);
    if (fromMember.member.sessionId === toMember.member.sessionId) {
      return errorOutput(
        `/lane: from and to lanes resolved to the same session ` +
        `(${fromMember.member.brand} · pane ${fromMember.member.paneId})`,
      );
    }

    const sourceId = `vw-pane:${room.windowId}/${fromMember.member.paneId}`;
    const targetSessionId = toMember.member.sessionId;
    const as = parsed.opts.as ?? DEFAULT_AS;

    if (debug.enabled) {
      debug.log('showroom.handoff.dispatch', `${room.id}`, {
        sourceId, targetSessionId, as,
        fromBrand: fromMember.member.brand,
        toBrand: toMember.member.brand,
        fromRole: fromMember.member.roleHint,
        toRole: toMember.member.roleHint,
      });
    }

    const injectDeps: InjectDeps = {
      lookupSession: deps.injectDeps?.lookupSession ?? ((id: string) => {
        const e = findLiveSessionById(id);
        return e ? { session: e.session } : undefined;
      }),
      ...(deps.injectDeps?.registry ? { registry: deps.injectDeps.registry } : {}),
      ...(deps.injectDeps?.approver ? { approver: deps.injectDeps.approver } : {}),
      ...(deps.injectDeps?.graph ? { graph: deps.injectDeps.graph } : {}),
      ...(deps.injectDeps?.now ? { now: deps.injectDeps.now } : {}),
      // Audit shim — wraps the underlying recorder so the lane / via
      // detail is appended to every event the inject pipeline emits.
      audit: makeLaneAuditShim(
        deps.injectDeps?.audit ?? recordControlAudit,
        {
          via: 'showroom-handoff',
          fromLane: fromMember.index,
          toLane: toMember.index,
          fromRole: fromMember.member.roleHint,
          toRole: toMember.member.roleHint,
          fromBrand: fromMember.member.brand,
          toBrand: toMember.member.brand,
          roomId: room.id,
        },
      ),
    };

    const result = await injectCapture({
      sourceId,
      targetSessionId,
      as,
      ...(deps.skipApprover ? { skipApprover: true } : {}),
    }, injectDeps);

    const lines: string[] = [];
    if (result.denied) {
      const why = result.warnings.includes('approver-timeout') ? 'timed out' : 'denied';
      lines.push(
        `/lane: approver ${why} · ${fromMember.member.brand} → ${toMember.member.brand}`,
      );
    } else {
      lines.push(
        `/lane: ${fromMember.member.brand} → ${toMember.member.brand} ` +
        `· as=${as} · ${result.injectedBytes}B · approved via ${result.approvedVia}`,
      );
      lines.push(
        `  source ${sourceId} · target ${targetSessionId} · room ${room.id}`,
      );
    }
    if (result.warnings.length > 0) {
      lines.push(`  warnings: ${result.warnings.join(', ')}`);
    }
    return {
      ok: !result.denied,
      name: 'lane',
      args: req.args,
      logLines: lines,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof InjectError) {
      return errorOutput(`/lane: ${msg}`);
    }
    if (debug.enabled) {
      debug.log('showroom.handoff.error', 'dispatch', { error: msg, args }, { level: 'error' });
    }
    return errorOutput(`/lane: ${msg}`);
  }
}

// ─── Lane resolution ─────────────────────────────────────────────────

interface LaneResolution {
  readonly index: number;
  readonly member: AgentRoomMemberInstance;
}

export function resolveLaneAddress(
  room: AgentRoomSnapshot,
  rawAddr: string,
): LaneResolution | { error: string } {
  if (!rawAddr || !rawAddr.trim()) {
    return { error: 'empty lane address' };
  }
  const addr = rawAddr.trim();

  // Pure integer → pane index.
  if (/^\d+$/.test(addr)) {
    const idx = Number(addr);
    if (idx < 0 || idx >= room.members.length) {
      return {
        error: `pane index ${idx} out of range [0, ${room.members.length})`,
      };
    }
    return { index: idx, member: room.members[idx]! };
  }

  const lower = addr.toLowerCase();

  // Role match (build → exec).
  const roleSearch = lower === 'build' ? 'exec' : lower;
  for (let i = 0; i < room.members.length; i++) {
    if (room.members[i]!.roleHint === roleSearch) {
      return { index: i, member: room.members[i]! };
    }
  }

  // Brand match (literal or alias passes through brand string).
  for (let i = 0; i < room.members.length; i++) {
    if (room.members[i]!.brand.toLowerCase() === lower) {
      return { index: i, member: room.members[i]! };
    }
  }

  return {
    error: `'${rawAddr}' did not match any pane index, role hint, or brand in room ${room.id}`,
  };
}

function pickLatestRoom(registry: AgentRoomRegistry): AgentRoomSnapshot | undefined {
  const rooms = registry.list();
  if (rooms.length === 0) return undefined;
  let latest = rooms[0]!;
  for (const r of rooms) if (r.createdAt > latest.createdAt) latest = r;
  return latest;
}

// ─── Audit shim ──────────────────────────────────────────────────────

interface LaneAuditExtras {
  readonly via: 'showroom-handoff' | 'showroom-relay' | 'lane-handoff-tool';
  readonly fromLane: number;
  readonly toLane: number;
  readonly fromRole?: string;
  readonly toRole?: string;
  readonly fromBrand: string;
  readonly toBrand: string;
  readonly roomId: string;
}

type AuditWriter = NonNullable<InjectDeps['audit']>;

function makeLaneAuditShim(base: AuditWriter, extras: LaneAuditExtras): AuditWriter {
  return (ev) => {
    const detail = (ev.detail && typeof ev.detail === 'object')
      ? { ...(ev.detail as Record<string, unknown>) }
      : {};
    base({
      ...ev,
      detail: { ...detail, lane: extras },
    });
  };
}

// ─── Arg parser ──────────────────────────────────────────────────────

interface ParsedHandoffOpts {
  as?: InjectMode;
  roomId?: string;
}

interface ParsedHandoffArgs {
  readonly fromLane: string;
  readonly toLane: string;
  readonly opts: ParsedHandoffOpts;
}

function parseArgs(tokens: string[]): ParsedHandoffArgs | { error: string } {
  const positional: string[] = [];
  const opts: ParsedHandoffOpts = {};
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t === '--as') {
      const next = tokens[i + 1];
      if (!next) return { error: `--as requires a mode (${VALID_MODES.join(' | ')})` };
      if (!(VALID_MODES as readonly string[]).includes(next)) {
        return { error: `invalid --as '${next}' · must be one of ${VALID_MODES.join(', ')}` };
      }
      opts.as = next as InjectMode;
      i += 2;
      continue;
    }
    if (t === '--room') {
      const next = tokens[i + 1];
      if (!next) return { error: '--room requires a room id' };
      opts.roomId = next;
      i += 2;
      continue;
    }
    positional.push(t);
    i += 1;
  }
  if (positional.length !== 2) {
    return {
      error: `expected exactly 2 positional args (from to) · got ${positional.length}`,
    };
  }
  return { fromLane: positional[0]!, toLane: positional[1]!, opts };
}

// ─── Output helpers ──────────────────────────────────────────────────

function helpOutput(): HandoffSlashResult {
  return {
    ok: true,
    name: 'lane',
    args: [],
    logLines: [
      '/lane — cross-lane context inject (HITL approver gates every send)',
      '  /lane <from> <to>                          default --as user-message',
      '  /lane <from> <to> --as <mode>              user-message | system-note | attached-block',
      '  /lane <from> <to> --room <roomId>          target a specific room',
      '  /lane list                                 show live rooms + lane index map',
      '  /lane help                                 this text',
      '',
      '  Lane address forms:',
      '    <integer>     pane index (0-based)',
      '    <role>        plan | build (=exec) | exec | review | reflect',
      '    <brand>       codex | claude | gemini | monad | local-llm | alias',
      '',
      '  Examples:',
      '    /handoff 0 1                          left → right · as user message',
      '    /handoff plan build                   plan lane → build lane',
      '    /handoff claude codex --as system-note',
    ],
  };
}

function listOutput(registry: AgentRoomRegistry): HandoffSlashResult {
  const rooms = registry.list();
  if (rooms.length === 0) {
    return {
      ok: true, name: 'lane', args: ['list'],
      logLines: ['no live agent rooms · spawn one with /showroom'],
    };
  }
  const lines: string[] = [`${rooms.length} live room(s):`];
  for (const r of rooms) {
    lines.push(`  ${r.id} · window ${r.windowId} · ${r.preset} · ${r.members.length} pane(s)`);
    for (let i = 0; i < r.members.length; i++) {
      const m = r.members[i]!;
      const role = m.roleHint ? ` [${m.roleHint}]` : '';
      lines.push(`    [${i}] ${m.brand}${role} · pane ${m.paneId} · session ${m.sessionId}`);
    }
  }
  return { ok: true, name: 'lane', args: ['list'], logLines: lines };
}

function errorOutput(msg: string): HandoffSlashResult {
  return {
    ok: false, name: 'lane', args: [],
    logLines: [msg],
    message: msg,
  };
}
