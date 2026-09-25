// ── Terminal Matrix — unified terminal types ──
//
// One PTY = one TerminalInstance. Placement, surface bindings,
// broadcast groups, and read-only flags are all facets of the
// instance — not separate types owning their own PTY.
//
// Why not reuse TerminalSession directly? SessionRegistry assumes a
// single foreground modal; matrix must support N concurrent surfaces
// bound to the same instance (preview + modal spectator, e.g.). The
// matrix wraps the session registry during migration; once all
// callers migrate, SessionRegistry becomes a thin legacy facade.
//
// See 내부 문서 `PLAN-terminal-matrix` for the full rationale.

import type { PreviewTerminal } from '../preview/terminal.js';
import type { SessionUri } from '../mss/uri/brand.js';
import { unsafeBrandSessionUri } from '../mss/uri/brand.js';

/** Single global ID space for every PTY the app owns. Format
 *  `term:<N>` with N a monotonically-increasing counter. Survives
 *  placement changes; external tools can use this to target a
 *  specific terminal regardless of where it's currently displayed. */
export type GlobalTerminalId = string;

/** What the PTY is running. Character is mutable — Phase T7 lets
 *  the LLM / user swap a shell into a coding-agent etc. without
 *  killing the instance. */
export type TerminalCharacter =
  | { kind: 'shell'; shell?: string }
  | { kind: 'claude-code' }
  | { kind: 'codex' }
  | { kind: 'custom'; name: string; spawnArgs?: readonly string[] };

/** Where the PTY runs. Local = node-pty in this process;
 *  tailscale = `tailscale ssh <host> -- <shell>`; ssh = raw ssh
 *  binary. Transport is immutable — you don't migrate a running
 *  local PTY to a remote one. */
export type TerminalTransport =
  | { kind: 'local' }
  | { kind: 'tailscale'; host: string; user?: string }
  | { kind: 'ssh'; host: string; user?: string; port?: number };

/** Where the terminal is currently surfaced. `background` = no
 *  visible surface, PTY still alive. Moving between placements
 *  does NOT respawn the PTY. */
export type TerminalPlacement =
  | { kind: 'background' }
  | { kind: 'preview' }
  | { kind: 'modal'; modalId: string }
  | { kind: 'vw'; windowId: string; slotId: string };

/** PV1 — Who can see this PTY's output:
 *  - `user`      = rendered in the UI, user interacts (legacy default).
 *  - `llm-only`  = invisible to the user; only snapshot() / PtyShellPoll
 *                  can read. Used by LLM-driven TUI verification and
 *                  non-interactive shells that should not steal focus.
 *  - `both`      = rendered AND snapshot-able (explicit equivalent of
 *                  `user`; the name makes intent obvious in prompts).
 *  `user` and `both` are functionally equivalent today — the distinction
 *  lets tool schemas advertise a clear 3-way toggle. */
export type TerminalVisibility = 'user' | 'llm-only' | 'both';

/** Arguments to TerminalRegistry.spawn. Subset of the existing
 *  SessionSpawnSpec + matrix-specific fields (character, transport,
 *  initial placement). */
export interface TerminalSpawnSpec {
  /** Display title (used by surfaces — modal border, pane badge). */
  title: string;
  /** Working directory for the PTY. Remote transports may ignore
   *  (user's home on the remote host) or honor via `cd $cwd &&` pre. */
  cwd: string;
  /** Optional initial command typed into the shell (followed by CR). */
  command?: string;
  character?: TerminalCharacter;
  transport?: TerminalTransport;
  /** Starting placement — defaults to `background` so callers
   *  explicitly opt in to a visible surface. */
  placement?: TerminalPlacement;
  /** ENV additions for the spawned PTY (merged over process.env). */
  env?: Record<string, string>;
  /** Start read-only. Phase T7 wires actual read-only enforcement. */
  readOnly?: boolean;
  /** PV1 — visibility mode. Default 'both' (user + LLM). 'llm-only'
   *  keeps the PTY alive but removes it from the placement rotation;
   *  the LLM still snapshot()s / PtyShellPoll()s for output. */
  visibility?: TerminalVisibility;
  /** Initial broadcast groups to join. Joining is idempotent. */
  broadcastGroups?: readonly string[];
  /** Free-form metadata the caller can attach — surfaces + tool
   *  catalogs query it for UI badges, filtering, etc. */
  metadata?: Record<string, unknown>;
}

/** The live terminal instance. Mutable fields flip as surfaces are
 *  bound / broadcast groups join / read-only toggles. `pty` is the
 *  authoritative PreviewTerminal; surfaces render it, never own it. */
export interface TerminalInstance {
  readonly id: GlobalTerminalId;
  /** Display title. Mutable so `/term rename` + character mutations
   *  can update it. */
  title: string;
  character: TerminalCharacter;
  readonly transport: TerminalTransport;
  readonly pty: PreviewTerminal;
  placement: TerminalPlacement;
  readOnly: boolean;
  /** PV1 — PTY visibility mode. See TerminalVisibility for meaning.
   *  Registry skips `llm-only` instances when enumerating placement
   *  candidates; snapshot / poll surfaces stay open so the LLM can
   *  observe output without a UI panel. */
  visibility: TerminalVisibility;
  broadcastGroups: Set<string>;
  readonly createdAt: number;
  lastActivityAt: number;
  exitCode: number | null;
  attentionLevel: 0 | 1 | 2 | 3;
  metadata: Record<string, unknown>;
  /** Legacy ID in the pre-matrix session registry (if any). Used
   *  during the T1/T2 migration to keep existing slash commands +
   *  tool-runtime payloads working. Removed once migration finishes. */
  legacySessionId?: string;
}

/** Matrix-level events. Surface/routing code subscribes to this
 *  bus rather than poking at TerminalSessionRegistry directly,
 *  keeping the abstraction uniform across pre- and post-migration. */
export type TerminalEvent =
  | { type: 'spawned'; instance: TerminalInstance }
  | { type: 'placement'; instance: TerminalInstance; prev: TerminalPlacement }
  | { type: 'character'; instance: TerminalInstance; prev: TerminalCharacter }
  | { type: 'readonly'; instance: TerminalInstance; prev: boolean }
  | { type: 'group:join'; instance: TerminalInstance; group: string }
  | { type: 'group:leave'; instance: TerminalInstance; group: string }
  | { type: 'exited'; instance: TerminalInstance; code: number }
  | { type: 'killed'; instance: TerminalInstance }
  | { type: 'attention'; instance: TerminalInstance; level: 1 | 2 | 3 };

export interface TerminalListFilter {
  transport?: TerminalTransport['kind'];
  characterKind?: TerminalCharacter['kind'];
  placementKind?: TerminalPlacement['kind'];
  group?: string;
  /** Include exited instances. Default false. */
  includeExited?: boolean;
}

/** Thin summary used by pickers / LLM list tools. Drops the live
 *  PTY handle + mutable sets to keep payloads serialisable. */
export interface TerminalSummary {
  id: GlobalTerminalId;
  title: string;
  character: TerminalCharacter;
  transport: TerminalTransport;
  placement: TerminalPlacement;
  readOnly: boolean;
  visibility: TerminalVisibility;
  broadcastGroups: readonly string[];
  createdAt: number;
  lastActivityAt: number;
  exitCode: number | null;
  attentionLevel: 0 | 1 | 2 | 3;
  isAlive: boolean;
}

/** Helper — strips live handle from an instance so we can ship it
 *  through tool-runtime payloads, test snapshots, etc. */
export function summarize(i: TerminalInstance): TerminalSummary {
  return {
    id: i.id,
    title: i.title,
    character: i.character,
    transport: i.transport,
    placement: i.placement,
    readOnly: i.readOnly,
    visibility: i.visibility,
    broadcastGroups: [...i.broadcastGroups],
    createdAt: i.createdAt,
    lastActivityAt: i.lastActivityAt,
    exitCode: i.exitCode,
    attentionLevel: i.attentionLevel,
    isAlive: i.exitCode === null,
  };
}

/** Default character for spec entries that omit one — keeps the
 *  common case ("just open a shell") zero-config. */
export const DEFAULT_CHARACTER: TerminalCharacter = { kind: 'shell' };

/** Default transport — local PTY. Remote transport opt-in only. */
export const DEFAULT_TRANSPORT: TerminalTransport = { kind: 'local' };

/** Default placement — background. Caller attaches a surface
 *  explicitly (`registry.move(id, {kind:'modal', modalId})`). */
export const DEFAULT_PLACEMENT: TerminalPlacement = { kind: 'background' };

/** MSS M1.1 Phase C1 — typed view of the instance's `legacySessionId`
 *  as a `SessionUri`. Same string, different phantom brand — returns
 *  `undefined` for instances that were spawned without a legacy
 *  session binding (pure matrix-era entries). Callers holding a
 *  typed `SessionUri` can compare against this without an unsafe
 *  round-trip cast back to `string`. */
export function terminalSessionUri(instance: TerminalInstance): SessionUri | undefined {
  return instance.legacySessionId !== undefined
    ? unsafeBrandSessionUri(instance.legacySessionId)
    : undefined;
}
