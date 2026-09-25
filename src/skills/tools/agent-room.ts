// H6 P4 · LLM tools for agent-room composition.
//
// Three tools, mirroring the slash surface:
//   - AgentRoomCompose — launch N agents into one VW with a preset
//   - AgentRoomList    — read live rooms
//   - AgentRoomClose   — dispose one room (idempotent)
//
// Output contract matches the budget + policy tool family:
//   `{ output: string; metadata: object; isError?: true }`.
//
// Safety (PLAN §D10):
//   - Compose is T2 · `safety: ['agent','vw']` · turn cost scales with N
//     so the metadata includes `budgetAdvisory` with the worst-case
//     session-window usage across providers. LLM is expected to relay
//     the warning to the user via AskUserQuestion when >= 70%.
//   - Close is destructive but equivalent to a VW close; user can
//     always restart the same spec.

import type { LLMToolSpec } from '../../llm.js';
import { getUsageStore } from '../../budget/usage-store.js';
import type { UsageProvider } from '../../budget/types.js';
import {
  createDefaultPolicyDecide,
} from './agent-room-slash.js';
import { buildAgentRoom } from '../../agent-room/room-builder.js';
import {
  getDefaultAgentRoomRegistry,
  type AgentRoomRegistry,
} from '../../agent-room/registry.js';
import {
  AGENT_ROOM_PRESET_NAMES,
  AGENT_ROOM_ROLE_HINTS,
  presetArityFor,
  isAgentRoomPresetName,
  isAgentRoomRoleHint,
  type AgentRoomMember,
  type AgentRoomSpec,
} from '../../agent-room/types.js';

// ─── Shared helpers ──────────────────────────────────────────────────

/** Compute worst-case session-window usage across providers. Returns
 *  0 when no snapshots are available. Used by `AgentRoomCompose`'s
 *  `budgetAdvisory` metadata. */
function computeCurrentUsagePercent(): { percent: number; provider?: UsageProvider } {
  const store = getUsageStore();
  let worst = 0;
  let worstProvider: UsageProvider | undefined;
  for (const p of store.listProviders()) {
    const snap = store.getSnapshot(p);
    if (!snap) continue;
    for (const w of snap.windows) {
      if (w.kind !== 'session') continue;
      const used = 100 - (w.remainingPercent ?? 100);
      if (used > worst) {
        worst = used;
        worstProvider = p;
      }
    }
  }
  return worstProvider ? { percent: worst, provider: worstProvider } : { percent: worst };
}

const BUDGET_WARN_THRESHOLD = 70;

function buildBudgetAdvisory(agentCount: number): {
  currentUsagePercent: number;
  estimatedTurnMultiplier: number;
  warning?: string;
} {
  const { percent, provider } = computeCurrentUsagePercent();
  const advisory: { currentUsagePercent: number; estimatedTurnMultiplier: number; warning?: string } = {
    currentUsagePercent: Math.round(percent * 10) / 10,
    estimatedTurnMultiplier: agentCount,
  };
  if (percent >= BUDGET_WARN_THRESHOLD) {
    advisory.warning =
      `current session usage ${advisory.currentUsagePercent}% ` +
      (provider ? `(${provider}) ` : '') +
      `· ${agentCount} agents active means ~${agentCount}x turn cost · ` +
      `consider AskUserQuestion before composing the room`;
  }
  return advisory;
}

// ─── AgentRoomCompose ────────────────────────────────────────────────

export interface AgentRoomComposeArgs {
  preset: string;
  members: readonly {
    brandRef: string;
    roleHint?: string;
    cwd?: string;
    extraArgs?: readonly string[];
    title?: string;
  }[];
  roomTitle?: string;
  focusIndex?: number;
}

export interface AgentRoomComposeMetadata {
  roomId: string;
  windowId: number;
  preset: string;
  members: ReadonlyArray<{
    sessionId: string;
    paneId: string;
    brand: string;
    roleHint?: string;
  }>;
  warnings: string[];
  budgetAdvisory: {
    currentUsagePercent: number;
    estimatedTurnMultiplier: number;
    warning?: string;
  };
}

export interface AgentRoomComposeResult {
  output: string;
  metadata: AgentRoomComposeMetadata;
  isError?: true;
}

export function buildAgentRoomComposeTool(): LLMToolSpec {
  return {
    name: 'AgentRoomCompose',
    description:
      'Create a VW agent room with N panes (2/3/4), each running a different brand agent. ' +
      'Use for multi-agent workflows (plan/exec/review). `brandRef: "auto"` delegates brand ' +
      'selection to the policy router using `roleHint` (when set) or pane-index defaults ' +
      '(0=plan, 1=exec, 2=review, 3=reflect). Returns a `budgetAdvisory` — WARN and surface ' +
      'to the user via AskUserQuestion when `currentUsagePercent >= 70`. N agents run ' +
      'concurrently, so turn cost scales by N.',
    parameters: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: [...AGENT_ROOM_PRESET_NAMES],
          description: 'Layout preset · arity = two-split(2), three-split(3), four-quad(4).',
        },
        members: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          description: 'Members array length MUST match preset arity.',
          items: {
            type: 'object',
            properties: {
              brandRef: {
                type: 'string',
                description: 'Literal brand (codex/claude/gemini/monad), alias (cas/clc/gem/mac), "lll:<model>", or "auto".',
              },
              roleHint: {
                type: 'string',
                enum: [...AGENT_ROOM_ROLE_HINTS],
                description: 'Optional role for `auto` routing. Ignored for literal brands.',
              },
              cwd: { type: 'string' },
              extraArgs: { type: 'array', items: { type: 'string' } },
              title: { type: 'string' },
            },
            required: ['brandRef'],
            additionalProperties: false,
          },
        },
        roomTitle: {
          type: 'string',
          description: 'VW title. Defaults to `agent-room-<seq>`.',
        },
        focusIndex: {
          type: 'number',
          description: '0-based pane index to focus initially. Default 0.',
        },
      },
      required: ['preset', 'members'],
      additionalProperties: false,
    },
  };
}

export async function dispatchAgentRoomCompose(
  rawArgs: Record<string, unknown>,
  registry: AgentRoomRegistry = getDefaultAgentRoomRegistry(),
): Promise<AgentRoomComposeResult> {
  const preset = typeof rawArgs.preset === 'string' ? rawArgs.preset : '';
  if (!isAgentRoomPresetName(preset)) {
    return errorResult(
      `AgentRoomCompose: unknown preset '${preset}' · use one of ${AGENT_ROOM_PRESET_NAMES.join(', ')}`,
      preset,
    );
  }
  const rawMembers = Array.isArray(rawArgs.members) ? rawArgs.members : [];
  const arity = presetArityFor(preset);
  if (rawMembers.length !== arity) {
    return errorResult(
      `AgentRoomCompose: preset '${preset}' expects ${arity} members · got ${rawMembers.length}`,
      preset,
    );
  }
  const members: AgentRoomMember[] = [];
  for (let i = 0; i < rawMembers.length; i++) {
    const raw = rawMembers[i] as Record<string, unknown>;
    if (!raw || typeof raw.brandRef !== 'string' || !raw.brandRef.trim()) {
      return errorResult(`AgentRoomCompose: member[${i}].brandRef must be non-empty string`, preset);
    }
    const hint = isAgentRoomRoleHint(raw.roleHint) ? raw.roleHint : undefined;
    members.push({
      brandRef: raw.brandRef,
      ...(hint ? { roleHint: hint } : {}),
      ...(typeof raw.cwd === 'string' ? { cwd: raw.cwd } : {}),
      ...(Array.isArray(raw.extraArgs)
        ? { extraArgs: raw.extraArgs.filter((x) => typeof x === 'string') as readonly string[] }
        : {}),
      ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    });
  }
  const spec: AgentRoomSpec = {
    preset,
    members,
    layoutMode: 'single-vw',
    ...(typeof rawArgs.roomTitle === 'string' ? { roomTitle: rawArgs.roomTitle } : {}),
    ...(typeof rawArgs.focusIndex === 'number' ? { focusIndex: rawArgs.focusIndex } : {}),
  };
  try {
    const result = await buildAgentRoom(spec, {
      registry,
      policyDecide: createDefaultPolicyDecide(),
    });
    const advisory = buildBudgetAdvisory(result.room.members.length);
    const memberMeta = result.room.members.map((m) => ({
      sessionId: m.sessionId,
      paneId: m.paneId,
      brand: m.brand,
      ...(m.roleHint ? { roleHint: m.roleHint } : {}),
    }));
    const lines: string[] = [];
    lines.push(`AgentRoomCompose: ${result.room.id} · window ${result.room.windowId} · preset ${preset}`);
    for (const m of memberMeta) {
      lines.push(`  ${m.brand}${m.roleHint ? ` [${m.roleHint}]` : ''} · pane ${m.paneId}`);
    }
    if (result.warnings.length > 0) {
      lines.push(`  warnings: ${result.warnings.length}`);
    }
    if (advisory.warning) {
      lines.push(`  budget: ${advisory.warning}`);
    }
    return {
      output: lines.join('\n'),
      metadata: {
        roomId: result.room.id,
        windowId: result.room.windowId,
        preset,
        members: memberMeta,
        warnings: [...result.warnings],
        budgetAdvisory: advisory,
      },
    };
  } catch (err) {
    return errorResult(
      `AgentRoomCompose: ${err instanceof Error ? err.message : String(err)}`,
      preset,
    );
  }
}

function errorResult(message: string, preset: string): AgentRoomComposeResult {
  return {
    output: message,
    metadata: {
      roomId: '',
      windowId: -1,
      preset,
      members: [],
      warnings: [],
      budgetAdvisory: {
        currentUsagePercent: 0,
        estimatedTurnMultiplier: 0,
      },
    },
    isError: true,
  };
}

// ─── AgentRoomList ───────────────────────────────────────────────────

export interface AgentRoomListResult {
  output: string;
  metadata: {
    rooms: ReadonlyArray<{
      id: string;
      windowId: number;
      preset: string;
      members: ReadonlyArray<{
        sessionId: string;
        paneId: string;
        brand: string;
        roleHint?: string;
      }>;
      createdAt: number;
    }>;
  };
  isError?: true;
}

export function buildAgentRoomListTool(): LLMToolSpec {
  return {
    name: 'AgentRoomList',
    description:
      'List live agent rooms with their member sessions. Read-only. ' +
      'Use before AgentRoomClose to discover room ids.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };
}

export async function dispatchAgentRoomList(
  _rawArgs: Record<string, unknown>,
  registry: AgentRoomRegistry = getDefaultAgentRoomRegistry(),
): Promise<AgentRoomListResult> {
  const rooms = registry.list();
  const lines: string[] = [];
  if (rooms.length === 0) {
    lines.push('AgentRoomList: no live rooms');
  } else {
    lines.push(`AgentRoomList: ${rooms.length} room(s)`);
    for (const r of rooms) {
      lines.push(`  ${r.id} · window ${r.windowId} · ${r.preset} · ${r.members.length} member(s)`);
    }
  }
  return {
    output: lines.join('\n'),
    metadata: {
      rooms: rooms.map((r) => ({
        id: r.id,
        windowId: r.windowId,
        preset: r.preset,
        members: r.members.map((m) => ({
          sessionId: m.sessionId,
          paneId: m.paneId,
          brand: m.brand,
          ...(m.roleHint ? { roleHint: m.roleHint } : {}),
        })),
        createdAt: r.createdAt,
      })),
    },
  };
}

// ─── AgentRoomClose ──────────────────────────────────────────────────

export interface AgentRoomCloseResult {
  output: string;
  metadata: {
    closed: boolean;
    disposedSessions: number;
    roomId: string;
  };
  isError?: true;
}

export function buildAgentRoomCloseTool(): LLMToolSpec {
  return {
    name: 'AgentRoomClose',
    description:
      'Close an agent room — dispose all member agents and close the VW. ' +
      'Idempotent: a second call on the same id returns `closed: false` without error.',
    parameters: {
      type: 'object',
      properties: {
        roomId: { type: 'string', description: 'Room id from AgentRoomList.' },
      },
      required: ['roomId'],
      additionalProperties: false,
    },
  };
}

export async function dispatchAgentRoomClose(
  rawArgs: Record<string, unknown>,
  registry: AgentRoomRegistry = getDefaultAgentRoomRegistry(),
): Promise<AgentRoomCloseResult> {
  const roomId = typeof rawArgs.roomId === 'string' ? rawArgs.roomId : '';
  if (!roomId.trim()) {
    return {
      output: 'AgentRoomClose: roomId required',
      metadata: { closed: false, disposedSessions: 0, roomId },
      isError: true,
    };
  }
  const result = await registry.dispose(roomId);
  return {
    output: result.closed
      ? `AgentRoomClose: ${roomId} closed · ${result.disposedSessions} session(s) disposed`
      : `AgentRoomClose: no room with id '${roomId}'`,
    metadata: {
      closed: result.closed,
      disposedSessions: result.disposedSessions,
      roomId,
    },
    // Not-found is NOT an error · idempotent no-op contract. LLM sees
    // `closed: false` and moves on.
  };
}

// ─── Bootstrap ───────────────────────────────────────────────────────

/** Bootstrap — no-op by design. Tools share the default registry
 *  singleton (`getDefaultAgentRoomRegistry`). Exists as a parity
 *  surface with `initPolicyRouter` / `initTtySnapshotTools` so the
 *  dashboard bootstrap sequence reads uniformly. */
export function initAgentRoomTools(): void {
  // Eager-touch the registry so the module is wired before the first
  // LLM invocation. No other work needed — dispatch functions lazily
  // resolve the registry when invoked.
  getDefaultAgentRoomRegistry();
}
