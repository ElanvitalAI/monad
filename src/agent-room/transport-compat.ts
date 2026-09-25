// Showroom v2 Arc 2 · brand × transportPref compatibility table.
//
// `AgentRoomMember.transportPref` lets the user state a transport
// preference (via `/showroom <role>:<provider>:<transport>` or via the
// LLM tool schema). At room-build time we cross-check it against the
// resolved brand. Combinations that are guaranteed to fail (e.g. asking
// `pty` for `monad` when monad-as-child is ACP-only) are silently
// **dropped** — the spawn proceeds with the brand's natural adapter so
// the user's room still comes up — and a warning is surfaced via
// `BuildRoomResult.warnings` so the slash output explains the override.
//
// PLAN: 내부 문서 `PLAN-showroom-v2-arc2-transport-pref-2026-04-28` §D1.
//
// Hot rule (compat-table maintenance): when a new adapter lands for
// an existing brand (e.g. `claude-code-acp` becoming an embodied
// adapter alongside `claude-pty`), update the compat entry below.
// The single-source-of-truth keeps the warning text honest.

import { debug } from '../debug/log.js';
import type { LaneKind, LaneTransportPref } from './types.js';

export interface TransportCompatResult {
  /** Effective transport pref after compat enforcement. `undefined`
   *  means "no hint, system decides" (the brand-driven adapter pick
   *  is unambiguous). */
  readonly effective?: LaneTransportPref;
  /** Human-readable explanation surfaced when the requested pref was
   *  dropped. Caller appends this to `BuildRoomResult.warnings`. */
  readonly warning?: string;
}

/** Brands with no PTY adapter — `transportPref: 'pty'` is impossible.
 *  Brand strings here are post-`resolveBrand` canonical forms (aliases
 *  already collapsed: 'mac' → 'monad'). */
const ACP_ONLY_BRANDS: ReadonlySet<string> = new Set([
  'monad',
]);

/** Brands with no ACP-embodied adapter (yet) — `transportPref: 'acp'`
 *  is dropped. Note: `/acp <brand>` is a different code path (chat
 *  pane round-trip, not an embodied session) — this list is about
 *  embodied / agent-room spawn only. Brand strings are post-resolveBrand
 *  canonical forms ('codex' → 'codex-app-server' · 'clc' → 'claude'
 *  · 'gem' → 'gemini'). We also keep the unresolved short forms so
 *  callers passing the raw user input (without going through
 *  brand-resolver) still hit the table — defensive belt-and-braces. */
const PTY_ONLY_EMBODIED_BRANDS: ReadonlySet<string> = new Set([
  'codex-app-server', // canonical
  'codex', 'cas', 'cx', // aliases (defensive)
  'claude',
  'clc', 'claude-code', // aliases
  'gemini',
  'gem', 'gemini-cli', // aliases
  'local-llm',
]);

/** Returns the effective transportPref + an optional warning string.
 *  Stays pure (no I/O) — caller owns the warning surface. */
export function checkTransportCompat(
  brand: string,
  requested: LaneTransportPref | undefined,
): TransportCompatResult {
  if (!requested || requested === 'auto') {
    return {};
  }
  const lower = brand.toLowerCase();

  // Local-llm is special-cased: brand string can be `local-llm` or
  // `lll:<model>` (lane-parser passes the user form through).
  const isLocalLlm = lower === 'local-llm' || lower.startsWith('lll:');

  if (ACP_ONLY_BRANDS.has(lower)) {
    if (requested === 'pty') {
      return dropWithWarning(brand, requested,
        `'${brand}' has no PTY adapter (monad-as-child is ACP only)`);
    }
    return { effective: requested }; // 'acp' is the natural fit
  }

  if (PTY_ONLY_EMBODIED_BRANDS.has(lower) || isLocalLlm) {
    if (requested === 'acp') {
      return dropWithWarning(brand, requested,
        isLocalLlm
          ? `'${brand}' has no ACP adapter (local LLM is PTY only)`
          : `'${brand}' has no ACP-embodied adapter yet · use /acp ${lower} for chat-pane streaming`);
    }
    return { effective: requested }; // 'pty' is the natural fit
  }

  // Unknown brand — pass through. The brand-resolver will have already
  // emitted a warning if it didn't recognize the alias, so we don't
  // double-up here.
  return { effective: requested };
}

// ── PR-CL6 (C.2 · 2026-04-29) · Lane matrix ─────────────────────────
//
// The compat helper above answers "is this user hint compatible with
// this brand", which is the room-builder's primary need. Sprint 20
// adds a forward-looking lane matrix that exposes per-brand defaults
// + supported lanes so downstream consumers (pane-spawner C.1, room-
// builder C.3) can ask "given this brand, what's the natural lane?"
// without re-deriving the answer from the compat table.
//
// Additive only — does NOT change `checkTransportCompat` behavior.
// PR-CL5 (C.1) will import `getLaneMatrixForBrand` to pick a default
// when the user gave no explicit transportPref; PR-CL7 (C.3) will use
// it for the mixed-lane room launch wizard.

export interface LaneMatrixEntry {
  /** Lane the brand defaults to when the user gave no explicit hint.
   *  Picked to match each brand's "natural" embodied path. */
  readonly defaultLane: LaneKind;
  /** Every lane the brand can actually be spawned in today. The
   *  resolver narrows the user hint to this set; an unsupported hint
   *  drops to defaultLane (matching the warning behavior in
   *  `checkTransportCompat`). */
  readonly supported: readonly LaneKind[];
}

/** Brand → lane matrix. Brand keys are post-`resolveBrand` canonical
 *  forms ('codex' / 'claude' / 'gemini' / 'monad' / 'local-llm'). The
 *  table is the single source of truth — when a new adapter lands for
 *  an existing brand, update the entry here and the warning text in
 *  `checkTransportCompat` stays correlated.
 *
 *  Sprint 20 baseline (sprint 21+ ramps codex / claude into hybrid as
 *  Track B's stream substrate matures): */
export const LANE_MATRIX_BY_BRAND: Readonly<Record<string, LaneMatrixEntry>> = {
  codex: {
    defaultLane: 'acp',
    supported: ['pty', 'acp', 'hybrid'],
  },
  claude: {
    defaultLane: 'pty',
    supported: ['pty'],
  },
  gemini: {
    defaultLane: 'pty',
    supported: ['pty'],
  },
  'local-llm': {
    defaultLane: 'pty',
    supported: ['pty'],
  },
  monad: {
    defaultLane: 'acp',
    supported: ['acp'],
  },
};

/** Returns the lane matrix entry for a brand. Brand string is matched
 *  case-insensitively against the canonical keys; `local-llm` also
 *  matches `lll:<model>` aliases (lane-parser passes them through).
 *  Unknown brand → `null` so the caller can fall back to the safe
 *  default (`'pty'`) without faking a matrix entry. */
export function getLaneMatrixForBrand(brand: string): LaneMatrixEntry | null {
  const lower = brand.toLowerCase();
  if (lower.startsWith('lll:')) {
    return LANE_MATRIX_BY_BRAND['local-llm']!;
  }
  return LANE_MATRIX_BY_BRAND[lower] ?? null;
}

/** Resolves the effective `LaneKind` for a brand + user transport
 *  preference. Pure read — does NOT emit warnings (the room-builder
 *  uses `checkTransportCompat` for the warning surface). Returns
 *  `null` when the brand is unknown so the caller can decide whether
 *  to surface a warning or default to PTY. */
export function resolveLaneKind(
  brand: string,
  pref: LaneTransportPref | undefined,
): LaneKind | null {
  const matrix = getLaneMatrixForBrand(brand);
  if (!matrix) return null;
  if (!pref || pref === 'auto') return matrix.defaultLane;
  // 'pty' / 'acp' user hint — narrow to supported, otherwise default.
  if (pref === 'pty' || pref === 'acp') {
    return (matrix.supported as readonly string[]).includes(pref)
      ? pref
      : matrix.defaultLane;
  }
  return matrix.defaultLane;
}

function dropWithWarning(
  brand: string,
  requested: LaneTransportPref,
  reason: string,
): TransportCompatResult {
  if (debug.enabled) {
    debug.log('agent-room.transport-pref.drop', brand, {
      brand, requested, reason,
    });
  }
  return {
    warning: `transportPref '${requested}' dropped · ${reason}`,
  };
}
