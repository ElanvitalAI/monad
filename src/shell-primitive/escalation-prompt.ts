// ── Sandbox-failure escalation prompt (AU6) ──
//
// codex's `on_failure.md` policy teaches the LLM "when a sandboxed
// shell call fails, escalate to the user with require_escalated +
// justification". Elanous's equivalent: detect the failure, set a
// flag on the ShellResult, and include this prompt so the LLM
// knows what to do with the flag.
//
// The detection heuristic is a SEPARATE function (detectSandbox
// Failure) used by the runtime. This file only owns the prompt
// text and the conditional injection helper.

const SANDBOX_ESCALATION_PROMPT = `# Sandboxed shell calls

When a Bash / shell tool call returns with \`sandboxFailure: true\`
on the result, the kernel-level sandbox blocked the operation (not
the command itself). Your options:

1. **Escalate explicitly via AskUserQuestion** — ALWAYS the right
   first step for writes outside the project root, network access
   from a \`network: 'off'\` run, or commands the user would
   reasonably want to review. Offer 2 options: "Retry without
   sandbox" / "Abort — try another approach".

2. **Retry with sandbox:'off'** — only when the operation is
   clearly required AND one of: (a) the user explicitly approved
   the Retry option above, (b) the command is read-only and the
   sandbox was over-restrictive (e.g., reading /etc/hosts for DNS
   diagnosis), (c) the skill's manifest pre-declares the need.

3. **Fail loudly** — summarise the blocked operation for the user
   and ask them to run it manually. Better than silent retry.

Do NOT loop: if one sandboxFailure retry also fails, stop and
explain. The sandbox is trying to tell you something.
`;

export function getSandboxEscalationPrompt(): string {
  return SANDBOX_ESCALATION_PROMPT;
}

/** Dashboard-facing helper. Unconditionally returns the prompt as
 *  one system message — cheap (~100 tokens), and the LLM ignores
 *  it when no sandboxed failure is in play. Kept conditional-free
 *  so the message set stays stable across turns. */
export function buildSandboxEscalationSystemMessages(): Array<{ role: 'system'; content: string }> {
  return [{ role: 'system', content: SANDBOX_ESCALATION_PROMPT }];
}

// ── Heuristic detection ──────────────────────────────────────────
//
// Called by runtime.ts after the child exits. Returns true when:
//   • sandbox was active (sandboxed=true / tool !== 'none')
//   • AND exit code is non-zero OR SIGKILL-like outcome
//   • AND stderr matches a platform-specific sandbox denial.
//
// Kept pessimistic — false positive ("user sees sandboxFailure on a
// normal permission-denied syscall") is acceptable since the prompt
// tells the LLM to ask first. False negative ("sandbox really did
// block but we miss it") is worse because the LLM has no hint.

const DENIAL_PATTERNS: RegExp[] = [
  // macOS sandbox-exec
  /operation not permitted/i,
  /deny (?:file-read|file-write|network)/i,
  /sandbox-exec.*denied/i,
  /sandbox.*violation/i,
  // bwrap / Linux
  /bwrap: .*(?:permission|denied|forbidden)/i,
  /sethostname\s*\(\s*\)\s*failed/i,
  // generic permission denied on writes that sandbox typically blocks
  /EACCES/,
  /Permission denied.*(?:\/etc|\/usr|\/private|\/Library|\/System)/i,
];

export function detectSandboxFailure(opts: {
  sandboxed: boolean;
  exitCode: number | null;
  stderr: string;
}): boolean {
  if (!opts.sandboxed) return false;
  if (opts.exitCode === 0) return false;
  const stderr = opts.stderr ?? '';
  if (!stderr) return false;
  for (const re of DENIAL_PATTERNS) {
    if (re.test(stderr)) return true;
  }
  return false;
}
