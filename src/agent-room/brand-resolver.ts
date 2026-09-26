// H6 P4 · Brand reference resolver for agent-room members.
//
// Maps user-facing brand strings (`codex`, `claude`, `cxn`, `lll:qwen`,
// `auto`) onto the concrete brand + mode the adapter registry expects.
// `auto` delegates to the PolicyRouter (H6 P3 Bundle 1) when one is
// wired; otherwise it falls back to a first-available brand with a
// debug warning (PLAN §D4).
//
// Design rails (PLAN §D4, §R8):
//   - Three role-hint paths: LLM-tool explicit · slash pane-index
//     auto · slash `auto:plan` explicit. This resolver only receives
//     the already-computed hint; pane-index → default-hint mapping
//     lives in the slash/LLM-tool layer so the resolver stays pure.
//   - Diversity filter (R8): the resolver is stateless per call; the
//     room-builder passes `excludeBrands` when resolving member N so
//     `auto` picks don't collapse to a single brand. The router's
//     native `excludeBrands` input is Bundle 2; for v1 we post-filter
//     here.

import { debug } from '../debug/log.js';
import type { AgentLaunchMode } from '../agent/embodiment.js';
import type { AgentRoomRoleHint, LaneKind, LaneTransportPref } from './types.js';
import { resolveLaneKind } from './transport-compat.js';

/** Result of resolving one brand reference. `extraArgs` is merged
 *  into the launch spec by the caller (e.g. `--model qwen2.5-32b` for
 *  the `lll:` alias once H6 P2 lands). */
export interface ResolvedBrand {
  readonly brand: string;
  readonly mode?: AgentLaunchMode;
  readonly extraArgs?: readonly string[];
  readonly resolution: 'literal' | 'alias' | 'policy-decide' | 'fallback';
  /** Set when `resolution === 'fallback'` so the slash/LLM-tool layer
   *  can surface a warning (no router wired, or router threw, or the
   *  diversity filter excluded every preferred candidate). */
  readonly warning?: string;
  /** PR-CL6 (C.2 · 2026-04-29) — Lane the spawned pane will use. Pulled
   *  from `LANE_MATRIX_BY_BRAND` (transport-compat) when the brand is
   *  recognized, else `undefined` so caller can fall back to the safe
   *  default. The user-facing transport hint (if any) is narrowed via
   *  `resolveLaneKind` before populating this field. */
  readonly laneKind?: LaneKind;
}

/** Minimal view of the policy router so this module can be tested
 *  without pulling the whole policy init chain. The prod bootstrap
 *  passes `getPolicyRouter()` from `src/policy/init.ts`. */
export interface PolicyDecideFn {
  (input: {
    readonly task: string;
    readonly strengths?: readonly string[];
  }): { readonly brand: string; readonly model?: string };
}

export interface ResolveBrandDeps {
  readonly policyDecide?: PolicyDecideFn;
  /** Brands already chosen for earlier members in the same room.
   *  Used by R8 diversity filter so `auto` picks spread across the
   *  fleet instead of collapsing to a single brand. */
  readonly excludeBrands?: readonly string[];
  /** PR-CL6 (C.2 · 2026-04-29) — User-facing transport pref carried
   *  through from `AgentRoomMember.transportPref`. When provided, the
   *  resolver narrows it via `LANE_MATRIX_BY_BRAND` and exposes the
   *  outcome as `ResolvedBrand.laneKind`. Omit (or pass `'auto'`) to
   *  let the brand's `defaultLane` win. */
  readonly transportPref?: LaneTransportPref;
}

/** Alias table mirrors `dashboard-acp-chat::parseAcpBackend` plus
 *  room-specific shortcuts. Lower-cased at lookup time.
 *
 *  Sprint 5B (2026-04-28): removed the deprecated `cxn` (codex-native)
 *  and `codex-acp-zed` / `codex-zed` (Zed shim escape) aliases — both
 *  paths' source + dep + docs are gone. */
const ALIAS_MAP: Record<string, string> = {
  // Canonical aliases for codex.
  cx: 'codex',
  codex: 'codex',
  cas: 'codex',
  // Brand short forms for the other backends.
  clc: 'claude',
  'claude-code': 'claude',
  gem: 'gemini',
  'gemini-cli': 'gemini',
  mac: 'elanous',
  'elanous-child': 'elanous',
};

/** Role hint → synthetic task string fed to `PolicyDecide`. Tuned so
 *  the router's `strengths` filter picks the right candidate without
 *  the caller having to understand the rule set. */
const ROLE_TASK: Record<AgentRoomRoleHint, string> = {
  plan:    'agent-room: plan this task — break it down, propose an approach',
  exec:    'agent-room: execute the plan, edit files, run commands',
  review:  'agent-room: review the diff, critique the approach, catch bugs',
  reflect: 'agent-room: reflect on the conversation, summarise key decisions',
};

const ROLE_STRENGTHS: Record<AgentRoomRoleHint, readonly string[]> = {
  plan:    ['reasoning'],
  exec:    ['code'],
  review:  ['code', 'reasoning'],
  reflect: ['chat', 'reasoning'],
};

/** Resolve a single brand reference. Pure function — all side-effects
 *  happen in the caller's adapter registry. */
export function resolveBrand(
  brandRef: string,
  roleHint: AgentRoomRoleHint | undefined,
  deps: ResolveBrandDeps = {},
): ResolvedBrand {
  return attachLaneKind(resolveBrandInner(brandRef, roleHint, deps), deps);
}

/** PR-CL6 (C.2) — Wrap resolved brand with `laneKind` derived from
 *  `LANE_MATRIX_BY_BRAND` + `deps.transportPref`. Done at the wrapper
 *  layer (rather than inside each resolution branch) so the matrix
 *  lookup stays a single hop and can't drift between paths. */
function attachLaneKind(
  resolved: ResolvedBrand,
  deps: ResolveBrandDeps,
): ResolvedBrand {
  const laneKind = resolveLaneKind(resolved.brand, deps.transportPref);
  if (laneKind === null) return resolved; // unknown brand — leave undefined
  return { ...resolved, laneKind };
}

function resolveBrandInner(
  brandRef: string,
  roleHint: AgentRoomRoleHint | undefined,
  deps: ResolveBrandDeps,
): ResolvedBrand {
  const raw = (brandRef ?? '').trim();
  if (!raw) {
    return { brand: 'codex', resolution: 'fallback', warning: 'empty brandRef · defaulted to codex' };
  }
  const lower = raw.toLowerCase();

  // 1. `lll:<model>` → H6 P2 local-llm. Currently unwired; brand string
  //    still resolves so room builder surfaces a clear "not wired"
  //    error at launch time rather than here.
  if (lower.startsWith('lll:')) {
    const model = raw.slice(4).trim();
    return {
      brand: 'local-llm',
      resolution: 'alias',
      ...(model ? { extraArgs: ['--model', model] as const } : {}),
    };
  }

  // 2. `auto` → PolicyDecide (or fallback).
  if (lower === 'auto') {
    return resolveAuto(roleHint, deps);
  }

  // 3. `auto:<role>` — explicit role override for slash path (PLAN §D4).
  //    The slash handler normalises this before calling us (parses
  //    the `:<role>` suffix into roleHint). We also handle it defensively
  //    here in case an LLM passes the combined form.
  if (lower.startsWith('auto:')) {
    const roleRaw = raw.slice(5).trim().toLowerCase();
    if ((Object.keys(ROLE_TASK) as string[]).includes(roleRaw)) {
      return resolveAuto(roleRaw as AgentRoomRoleHint, deps);
    }
    return {
      brand: 'codex',
      resolution: 'fallback',
      warning: `auto:${roleRaw} unknown role · defaulted to codex`,
    };
  }

  // 4. Alias.
  if (ALIAS_MAP[lower]) {
    return { brand: ALIAS_MAP[lower]!, resolution: 'alias' };
  }

  // 5. Literal — adapter registry will validate.
  return { brand: raw, resolution: 'literal' };
}

function resolveAuto(
  roleHint: AgentRoomRoleHint | undefined,
  deps: ResolveBrandDeps,
): ResolvedBrand {
  if (!deps.policyDecide) {
    return {
      brand: 'codex',
      resolution: 'fallback',
      warning: "policy router not wired · 'auto' defaulted to codex",
    };
  }
  const hint = roleHint ?? 'exec';
  try {
    const decision = deps.policyDecide({
      task: ROLE_TASK[hint],
      strengths: ROLE_STRENGTHS[hint],
    });
    // R8 · diversity post-filter. If the decided brand is already in
    // excludeBrands, ignore the decision and fall through to the
    // next literal candidate. Bundle 2 upstreams this to the router.
    const excluded = (deps.excludeBrands ?? []).map((b) => b.toLowerCase());
    if (excluded.includes(decision.brand.toLowerCase())) {
      const alt = pickNextLiteralBrand(excluded);
      if (debug.enabled) {
        debug.log('agent-room.brand-resolver.diversity-fallback', hint, {
          excluded,
          decided: decision.brand,
          chose: alt,
        });
      }
      return {
        brand: alt,
        resolution: 'fallback',
        warning: `policy decided ${decision.brand} but already in room · picked ${alt}`,
      };
    }
    return {
      brand: decision.brand,
      resolution: 'policy-decide',
      ...(decision.model ? { extraArgs: ['--model', decision.model] as const } : {}),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      brand: 'codex',
      resolution: 'fallback',
      warning: `policy router threw: ${msg} · defaulted to codex`,
    };
  }
}

/** Diversity fallback — cycles through the default brand pool and
 *  returns the first one not already excluded. When all four are
 *  excluded (N > fleet size) we re-use the first to keep the room
 *  building; room-builder surfaces a warning to the user.
 *
 *  Sprint 5B follow-up (2026-04-28) · codex namespace is unified
 *  again. Backend transport details (pty-direct vs app-server) are
 *  downstream policy concerns, not the room/showroom brand namespace. */
function pickNextLiteralBrand(excluded: readonly string[]): string {
  const pool = ['codex', 'claude', 'gemini', 'elanous'];
  for (const b of pool) {
    if (!excluded.includes(b)) return b;
  }
  return pool[0]!;
}
