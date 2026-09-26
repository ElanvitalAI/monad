// H6 P4 · Agent Room types.
//
// An agent room groups N embodied agents into one VirtualWindow with
// N side-by-side panes. v1 supports arity 2/3/4 via built-in presets
// that map 1:1 onto the layout preset library (`two-pane-split`,
// `three-pane-split`, `four-pane-kanban`).
//
// Design rails (PLAN §D1, §D4, §D7, §D10):
//   - D1  v1 = 1-VW-N-pane · v2 = N-VW (multi-vw) · schema already
//         carries `layoutMode` so the later migration doesn't break
//         callers.
//   - D4  `brandRef: 'auto'` delegates to PolicyDecide (when a router
//         is wired). Slash + LLM tool both round-trip through the
//         same resolver.
//   - D7  Room-builder is all-or-nothing: a partial launch rolls back
//         every successful session and closes the VW.
//   - D10 `AgentRoomCompose` / `AgentRoomList` / `AgentRoomClose` LLM
//         tools share these types — keep them serializable (no live
//         handles in the shape).

import type { AgentLaunchMode } from '../agent/embodiment.js';

/** Built-in preset names. User-defined YAML presets are Bundle 2. */
export type AgentRoomPresetName = 'two-split' | 'three-split' | 'four-quad';

/** Role hints fed to the policy router when resolving `brandRef: 'auto'`.
 *  Slash path auto-assigns by pane index (0=plan, 1=exec, 2=review,
 *  3=reflect). LLM tool path passes hints through verbatim. */
export type AgentRoomRoleHint = 'plan' | 'exec' | 'review' | 'reflect';

export const AGENT_ROOM_PRESET_NAMES: readonly AgentRoomPresetName[] = [
  'two-split',
  'three-split',
  'four-quad',
];

export const AGENT_ROOM_ROLE_HINTS: readonly AgentRoomRoleHint[] = [
  'plan',
  'exec',
  'review',
  'reflect',
];

/** Pane-index → role-hint default (slash auto path · §D4). */
export const DEFAULT_ROLE_HINT_BY_INDEX: readonly AgentRoomRoleHint[] = [
  'plan',
  'exec',
  'review',
  'reflect',
];

/** Transport preference hint surfaced through the lane parser into
 *  `AgentRoomMember`. Showroom v2 Arc 2 (2026-04-28) — `'auto'` (or
 *  unset) lets the brand-driven adapter pick the transport; explicit
 *  `'pty'` / `'acp'` is validated against the brand × transport
 *  compat table in `room-builder.ts` and silently dropped (with a
 *  warning) when incompatible. See:
 *  `내부 문서 `PLAN-showroom-v2-arc2-transport-pref-2026-04-28`` §D1. */
export type LaneTransportPref = 'pty' | 'acp' | 'auto';

export const LANE_TRANSPORT_PREFS: readonly LaneTransportPref[] = [
  'pty', 'acp', 'auto',
];

export function isLaneTransportPref(raw: unknown): raw is LaneTransportPref {
  return typeof raw === 'string'
    && (LANE_TRANSPORT_PREFS as readonly string[]).includes(raw);
}

/** PR-CL6 (C.2 · 2026-04-29) — Resolved lane kind for an embodied
 *  agent in a virtual window. Distinct from `LaneTransportPref`:
 *
 *    - `LaneTransportPref` is the user-facing hint (`'auto'` = system
 *      decides, `'pty'` / `'acp'` = explicit request).
 *    - `LaneKind` is the post-resolution outcome — what the spawn
 *      actually uses. `'hybrid'` is reserved for future paths that
 *      mix PTY transcript + ACP structured event stream (Track A
 *      `acceptBroadcast` makes this feasible · sprint 21+).
 *
 *  pane-spawner (PR-CL5) imports this type from here so the agent-room
 *  side can decide the lane matrix without taking a dependency on the
 *  spawner module. */
export type LaneKind = 'pty' | 'acp' | 'hybrid';

export const LANE_KINDS: readonly LaneKind[] = ['pty', 'acp', 'hybrid'];

export function isLaneKind(raw: unknown): raw is LaneKind {
  return typeof raw === 'string'
    && (LANE_KINDS as readonly string[]).includes(raw);
}

export interface AgentRoomMember {
  /** `codex` | `claude` | `gemini` | `elanous` | `lll:<model>` | `auto` | alias. */
  readonly brandRef: string;
  readonly roleHint?: AgentRoomRoleHint;
  readonly mode?: AgentLaunchMode;
  readonly cwd?: string;
  readonly extraArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly title?: string;
  /** Showroom v2 Arc 2 (2026-04-28) · transport hint validated at
   *  build-room time. May be dropped (with a warning) when incompatible
   *  with the brand-driven adapter pick. */
  readonly transportPref?: LaneTransportPref;
}

export interface AgentRoomSpec {
  readonly preset: AgentRoomPresetName;
  readonly members: readonly AgentRoomMember[];
  readonly roomTitle?: string;
  readonly focusIndex?: number;
  /** D1 migration path — v1 is hardcoded to `'single-vw'`.
   *  Bundle 2 unlocks `'multi-vw'`. Keeping the field in the schema
   *  from the start keeps the LLM tool contract stable across the
   *  migration. */
  readonly layoutMode?: 'single-vw' | 'multi-vw';
}

export interface AgentRoomMemberInstance {
  readonly sessionId: string;
  readonly paneId: string;
  readonly brand: string;
  readonly roleHint?: AgentRoomRoleHint;
  readonly launchedAt: number;
}

export interface AgentRoomInstance {
  readonly id: string;
  readonly windowId: number;
  readonly preset: AgentRoomPresetName;
  readonly members: readonly AgentRoomMemberInstance[];
  readonly createdAt: number;
  /** Dispose the room — best-effort dispose of every member session
   *  plus the VW. Idempotent: repeated calls return without error. */
  dispose(): Promise<void>;
}

export function presetArityFor(name: AgentRoomPresetName): 2 | 3 | 4 {
  switch (name) {
    case 'two-split':   return 2;
    case 'three-split': return 3;
    case 'four-quad':   return 4;
  }
}

export function presetForArity(arity: number): AgentRoomPresetName {
  switch (arity) {
    case 2: return 'two-split';
    case 3: return 'three-split';
    case 4: return 'four-quad';
    default:
      throw new Error(`agent-room arity must be 2/3/4 · got ${arity}`);
  }
}

export function isAgentRoomPresetName(raw: unknown): raw is AgentRoomPresetName {
  return typeof raw === 'string'
    && (AGENT_ROOM_PRESET_NAMES as readonly string[]).includes(raw);
}

export function isAgentRoomRoleHint(raw: unknown): raw is AgentRoomRoleHint {
  return typeof raw === 'string'
    && (AGENT_ROOM_ROLE_HINTS as readonly string[]).includes(raw);
}

/** Validate spec shape against preset arity. Throws with a clear
 *  message; caller is responsible for surfacing to user/LLM. */
export function validateAgentRoomSpec(spec: AgentRoomSpec): void {
  if (!isAgentRoomPresetName(spec.preset)) {
    throw new Error(`unknown preset '${spec.preset}' · use one of ${AGENT_ROOM_PRESET_NAMES.join(', ')}`);
  }
  const arity = presetArityFor(spec.preset);
  if (spec.members.length !== arity) {
    throw new Error(
      `preset '${spec.preset}' expects ${arity} members · got ${spec.members.length}`,
    );
  }
  if (spec.focusIndex !== undefined) {
    if (!Number.isInteger(spec.focusIndex) || spec.focusIndex < 0 || spec.focusIndex >= arity) {
      throw new Error(`focusIndex ${spec.focusIndex} out of range [0, ${arity})`);
    }
  }
  if (spec.layoutMode !== undefined && spec.layoutMode !== 'single-vw' && spec.layoutMode !== 'multi-vw') {
    throw new Error(`layoutMode must be 'single-vw' or 'multi-vw' · got ${spec.layoutMode}`);
  }
  if (spec.layoutMode === 'multi-vw') {
    throw new Error(
      `layoutMode 'multi-vw' is Bundle 2 · v1 only supports 'single-vw'`,
    );
  }
  for (let i = 0; i < spec.members.length; i++) {
    const m = spec.members[i]!;
    if (typeof m.brandRef !== 'string' || !m.brandRef.trim()) {
      throw new Error(`member[${i}].brandRef must be a non-empty string`);
    }
    if (m.roleHint !== undefined && !isAgentRoomRoleHint(m.roleHint)) {
      throw new Error(`member[${i}].roleHint invalid · got ${m.roleHint}`);
    }
    if (m.transportPref !== undefined && !isLaneTransportPref(m.transportPref)) {
      throw new Error(
        `member[${i}].transportPref invalid · got '${String(m.transportPref)}' · ` +
        `must be one of ${LANE_TRANSPORT_PREFS.join(', ')}`,
      );
    }
  }
}
