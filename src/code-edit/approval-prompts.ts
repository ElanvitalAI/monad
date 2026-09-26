// ── Approval-policy system prompt variants (AU2) ──
//
// codex ships three dynamic prompt files
// (protocol/src/prompts/permissions/approval_policy/*.md) injected
// into the system prompt based on the user's configured approval
// policy. claude-code just describes the permission model once
// ("the user will be prompted"), but that leaves the LLM with no
// behavioural guidance.
//
// Elanous already has a live ApprovalPolicy (src/code-edit/safety.ts)
// — we lean on codex's pattern and ship a prompt variant per mode
// so the LLM actually adapts its planning:
//
//   mode: 'ask-edit'      → "every Edit needs approval; plan multi-
//                            file sequences carefully, ask up-front
//                            instead of re-prompting"
//   mode: 'ask-all'       → "even tool calls may prompt; minimize
//                            round-trips"
//   mode: 'unsupervised'  → "no approval gate; be EXTRA careful,
//                            prefer AskUserQuestion for destructive"
//   mode: 'trusted-dirs'  → "edits under {dirs} auto-apply, anywhere
//                            else will prompt"
//
// Written once + selected + template-substituted per turn.

import type { ApprovalPolicy } from './types.js';

const ASK_EDIT_PROMPT = `# Code-edit policy: ASK-EDIT

Every Edit and Write call will surface an approval modal to the user
before the change hits disk. The user can:
  • Approve — the edit applies.
  • Deny (optional reason) — your tool_result carries
    {ok:false, reason:"..."} back; use the reason to revise your
    plan on the next attempt.
  • Approve-session — all subsequent edits in this session auto-apply.

Consequences for your turn:
- Plan multi-file changes carefully. If you're uncertain between two
  approaches, call AskUserQuestion BEFORE emitting a sequence of
  edits — one approval beats four denials.
- Do not batch unrelated edits: denial of one won't stop the next
  from being attempted, but the user's context for each approval
  shrinks when you chain too many.
- If the user denies, read the reason before retrying; don't re-
  submit the same diff.
`;

const ASK_ALL_PROMPT = `# Code-edit policy: ASK-ALL

Every mutating tool call (Edit, Write, Bash, background PTY spawn,
commit, etc.) will surface an approval modal. The user can approve
or deny per call; they can also approve-session for specific tools.

Consequences for your turn:
- Minimize round-trips. Batch independent read-only lookups before
  the first mutation so you have full context when asking for approval.
- AskUserQuestion is still the right tool to clarify requirements;
  use it proactively if the choice of what to mutate is ambiguous.
- Long scripted pipelines (loops over many files) will prompt the
  user many times. Either ask up-front "ok to run on N files?" OR
  collapse into a single Bash invocation that does the whole batch.
`;

const UNSUPERVISED_PROMPT = `# Code-edit policy: UNSUPERVISED

The user has granted you blanket approval. Edits / Writes / Bash
calls auto-apply without a modal.

BECAUSE there is no per-action gate, the burden is on YOU to:
- Call AskUserQuestion BEFORE any action that is both destructive
  and inferred rather than requested (rm -rf, force push, schema
  drops, overwriting user-authored files).
- Surface your plan in chat BEFORE a multi-file change so the user
  can abort with Esc if your interpretation was wrong.
- Prefer additive changes (new files, new functions) over in-place
  rewrites when both would work; additive is easier to undo.
- Remember UndoTurn exists: every turn's first mutation gets a
  ghost-commit snapshot. If you're uncertain, err on the side of
  doing the smaller thing and letting the user request the larger.
`;

const TRUSTED_DIRS_PROMPT = `# Code-edit policy: TRUSTED-DIRS

Edits under these paths auto-apply without prompting:
{TRUSTED_DIRS}

Edits anywhere else (/etc, /usr/local, $HOME/.config, sibling
project checkouts) will surface an approval modal.

Consequences for your turn:
- When a task spans files both inside and outside the trusted list,
  group the inside-trust edits first (fast, no prompts) then tackle
  the outside ones after one summary ask.
- AskUserQuestion is still the right tool for ambiguity about WHERE
  to edit — don't guess between a trusted + an untrusted path.
`;

/** Return the appropriate prompt text for the current policy, with
 *  any template variables substituted. Returns null when the policy
 *  is a mode we don't have guidance for (future-proofing). */
export function buildApprovalPolicyPrompt(policy: ApprovalPolicy): string | null {
  switch (policy.mode) {
    case 'ask-edit':
      return ASK_EDIT_PROMPT;
    case 'ask-all':
      return ASK_ALL_PROMPT;
    case 'unsupervised':
      return UNSUPERVISED_PROMPT;
    case 'trusted-dirs': {
      const dirs = (policy.trustedDirs && policy.trustedDirs.length > 0)
        ? policy.trustedDirs.map(d => `  • ${d}`).join('\n')
        : '  (no trusted directories configured — all edits will prompt)';
      return TRUSTED_DIRS_PROMPT.replace('{TRUSTED_DIRS}', dirs);
    }
    default:
      return null;
  }
}

/** Dashboard-facing helper. Reads the CURRENT policy via getPolicy()
 *  and returns 0 or 1 system messages. Called every turn so a mid-
 *  session `/code-edit policy ...` flip reflects on the next
 *  message. */
export function buildApprovalPolicySystemMessages(): Array<{ role: 'system'; content: string }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPolicy } = require('./safety.js') as typeof import('./safety.js');
  const policy = getPolicy();
  const prompt = buildApprovalPolicyPrompt(policy);
  if (!prompt) return [];
  return [{ role: 'system', content: prompt }];
}
