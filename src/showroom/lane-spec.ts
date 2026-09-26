// Showroom v2 · Lane spec types.
//
// Lane = role + provider + transport-pref triple. Surface for the
// `/showroom <role:provider[:transport]> ...` composer · serializable
// for LLM tool callers (LaneHandoff). Maps to `AgentRoomMember` at
// compose time — keep the type minimal so it stays JSON-friendly.
//
// PLAN: 내부 문서 `PLAN-showroom-v2-lane-handoff-2026-04-28` §D1, §D2.

import type { AgentRoomRoleHint, LaneTransportPref } from '../agent-room/types.js';

// Re-export so existing lane-parser / lane-handoff callers don't
// need to know that the canonical home for LaneTransportPref is
// `agent-room/types.ts` (Arc 2 · 2026-04-28 — promoted into
// AgentRoomMember).
export type { LaneTransportPref } from '../agent-room/types.js';
export {
  LANE_TRANSPORT_PREFS,
  isLaneTransportPref,
} from '../agent-room/types.js';

/** UX-friendly role names accepted by the lane parser. `build` is an
 *  alias for `exec` — internally we always normalize to the
 *  AgentRoomRoleHint set so the policy router + agent-graph stay on
 *  one vocabulary. */
export type LaneRole = AgentRoomRoleHint | 'build';

export const LANE_ROLES: readonly LaneRole[] = [
  'plan', 'build', 'exec', 'review', 'reflect',
];

/** A parsed lane spec ready for compose-time AgentRoomMember mapping. */
export interface LaneSpec {
  /** UX role name as given by the user; may be undefined if user
   *  passed only `provider`. */
  readonly role?: LaneRole;
  /** Provider brandRef as given (`codex` / `claude` / `gemini` /
   *  `elanous` / `auto` / `lll:<model>` / alias). Validation is
   *  delegated to brand-resolver — we only sanity-check non-empty. */
  readonly brandRef: string;
  /** Transport preference. Undefined = `'auto'`. */
  readonly transportPref?: LaneTransportPref;
}

/** Surface preference for the entire `/showroom` invocation —
 *  applied to every lane in the same compose. v1 supports only
 *  Discord channel routing (M1.1 · webhook persona adapter); other
 *  surface kinds (telegram / tui / acp) slot in as additional
 *  variants once each adapter lands.
 *
 *  PLAN: 내부 문서 `PLAN-discord-rich-light-persona-2026-05-01` §3.1 */
export type SurfacePref =
  | { readonly kind: 'discord'; readonly channelId: string };

export const SURFACE_PREF_KINDS = ['discord'] as const;

/** Map UX role names onto AgentRoomRoleHint. `build` → `exec`. */
export function toRoleHint(role: LaneRole | undefined): AgentRoomRoleHint | undefined {
  if (role === undefined) return undefined;
  return role === 'build' ? 'exec' : role;
}

export function isLaneRole(raw: unknown): raw is LaneRole {
  return typeof raw === 'string'
    && (LANE_ROLES as readonly string[]).includes(raw);
}
