// ACP Plan/Execute Bridge P1 — session mode meta helpers.
//
// Wire-level signal for "this prompt is plan-only (read-only review)"
// vs "this prompt is execute (write-capable)". Carried on the ACP
// `_meta` blob alongside subagent_session_info.
//
// Independent of subagent_session_info because mode is orthogonal to
// subagent linkage — a top-level (non-spawned) prompt can also be
// plan-only. Peers that don't recognise the key fall through to default
// behavior (execute), preserving forward-compat.
//
// Reference key: `session_mode` (no canonical Zed/ACP key exists today;
// monad introduces it under its own namespace; ACP spec push-back can
// adopt or remap later).
//
// PLAN: 내부 문서 `PLAN-acp-plan-execute-bridge` (P1 phase).

export const SESSION_MODE_META_KEY = 'session_mode';

export type SessionMode = 'plan' | 'execute';

/** Extract the session mode from an ACP `_meta` blob. Returns null when
 *  absent or malformed. Callers treat absence as "execute" (default). */
export function readSessionMode(
  meta: Record<string, unknown> | null | undefined,
): SessionMode | null {
  if (!meta || typeof meta !== 'object') return null;
  const raw = meta[SESSION_MODE_META_KEY];
  if (typeof raw !== 'string') return null;
  if (raw === 'plan' || raw === 'execute') return raw;
  return null;
}

/** Build an ACP `_meta` blob fragment carrying the session mode.
 *  Caller merges into whatever other meta fields the request carries. */
export function writeSessionMode(mode: SessionMode): Record<string, unknown> {
  return { [SESSION_MODE_META_KEY]: mode };
}

/** Map a `SessionMode` to codex-native ThreadOptions defaults that
 *  enforce the mode's intent. Returns a partial that callers spread
 *  into their full options bag — explicit caller values win.
 *
 *  - `plan`  → `sandboxMode='read-only'` + `approvalPolicy='never'`
 *              (no writes, no human prompts; read-only review surface).
 *  - `execute` → empty (let other defaults apply). */
export function sessionModeCodexDefaults(mode: SessionMode): {
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
} {
  if (mode === 'plan') {
    return { sandboxMode: 'read-only', approvalPolicy: 'never' };
  }
  return {};
}

/** P6 — non-codex brands have no native sandbox knob (claude-code-acp,
 *  gemini ACP shim). For `plan` mode, we prepend a read-only review
 *  instruction so the agent self-restrains via prompt semantics.
 *  Sprint 5B (2026-04-28) removed the codex-native short-circuit —
 *  codex-app-server now uses turn-level `collaborationMode` (M1) for
 *  plan/default toggling, so the prompt-prefix wrapper applies to
 *  every brand uniformly.
 *
 *  Returns the original message unchanged for execute mode. Wraps
 *  for plan + every brand. */
const PLAN_MODE_PROMPT_PREFIX =
  '[REVIEW MODE — read-only · plan-only]\n' +
  'Describe your plan in detail but DO NOT invoke any tools that modify ' +
  'state (no write/edit/delete/exec). Read-only inspection tools are fine. ' +
  'If a task requires execution, output the steps as a plan and stop.\n\n';

export function wrapPlanModeMessage(
  message: string,
  _brand: string,
  mode: SessionMode | undefined,
): string {
  if (mode !== 'plan') return message;
  if (message.startsWith(PLAN_MODE_PROMPT_PREFIX)) return message;
  return PLAN_MODE_PROMPT_PREFIX + message;
}

/** Exposed for tests + downstream UI surface that wants to detect
 *  whether a prompt has the plan-mode wrapper applied. */
export function getPlanModePromptPrefix(): string {
  return PLAN_MODE_PROMPT_PREFIX;
}
