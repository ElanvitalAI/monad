// ── Destructive-action Guardian (AU3) ──
//
// Lightweight static classifier: given a Bash argv / an edit path /
// etc., flag it as "destructive" so callers can insist on user
// approval even when the current approval policy would otherwise
// let it through.
//
// Ported from codex's Guardian layer (core/src/guardian/
// approval_request.rs) adapted to monad's shell surface. Codex's
// Guardian lives inside core — it can intercept tool calls before
// they reach the shell. Monad's equivalent lives in the same place
// as the approval policy (src/code-edit/safety.ts and the shell
// approval pipeline) and is pattern-matched on the argv.
//
// Design:
//   • Pattern lists are conservative — prefer false positives
//     ("ask again") over false negatives ("silent rm -rf").
//   • Each match carries a short `reason` the chat log + approval
//     modal can surface.
//   • `severity: 'destructive' | 'escalated'` — future surface for
//     AU6 sandbox-failure escalation.
//   • Disable via env `MONAD_GUARDIAN=off`; documented + tested.
//
// Not a replacement for approval modal — the Guardian is a SIGNAL
// that the caller uses to, e.g., force `severity: 'destructive'`
// on the modal, or refuse auto-approval even under `unsupervised`
// policy.

export type GuardianSeverity = 'destructive' | 'escalated';

export interface GuardianFinding {
  severity: GuardianSeverity;
  reason: string;
  /** The matched fragment for logging (argv token, path, etc.). */
  matched: string;
}

/** Global kill-switch, env-driven. Tests flip via setGuardianDisabled. */
let sessionDisabled = false;

export function setGuardianDisabled(disabled: boolean): void {
  sessionDisabled = disabled;
}

export function isGuardianDisabled(): boolean {
  if (sessionDisabled) return true;
  const v = (process.env.MONAD_GUARDIAN ?? '').toLowerCase();
  return v === 'off' || v === '0' || v === 'false';
}

// ── Pattern library ────────────────────────────────────────────────
//
// Each pattern is a regexp applied against the JOINED argv with a
// single space between tokens. We join because an LLM that tries to
// sneak around the guard will split the destructive flag across
// tokens — `rm` + ` -rf` is still `rm -rf` in the joined form.
//
// Caps on reason length so chat-log rendering stays compact.

interface Rule {
  re: RegExp;
  severity: GuardianSeverity;
  reason: string;
}

const RULES: Rule[] = [
  // Filesystem destruction
  { re: /\brm\b[^|;]*\s-(?:r|R|rf|fr)\b/, severity: 'destructive', reason: 'recursive rm' },
  { re: /\brm\b\s+\/($|\s)/, severity: 'destructive', reason: 'rm /' },
  { re: /\brm\b[^|;]*\s--no-preserve-root\b/, severity: 'destructive', reason: 'rm --no-preserve-root' },
  { re: /\bshred\b/, severity: 'destructive', reason: 'shred (unrecoverable)' },
  { re: /\btruncate\b[^|;]*\s-s\s*0\b/, severity: 'destructive', reason: 'truncate to zero' },
  { re: /:\(\)\s*\{[^}]*\|\s*\Z?:\s*&[^}]*}\s*;?\s*:/, severity: 'destructive', reason: 'fork bomb' },

  // Disk-level
  { re: /\bdd\b[^|;]*\bof=\/dev\/[^\s]+/, severity: 'destructive', reason: 'dd of=/dev/...' },
  { re: /\bmkfs(\.\S+)?\b/, severity: 'destructive', reason: 'filesystem format' },
  { re: /\bfdisk\b/, severity: 'destructive', reason: 'partition table edit' },

  // Git — history rewrites
  { re: /\bgit\s+push\b[^|;]*(?:\s-f|\s--force(?!\s*-with-lease))/, severity: 'destructive', reason: 'git push --force (no --force-with-lease)' },
  { re: /\bgit\s+reset\b[^|;]*\s--hard\b/, severity: 'destructive', reason: 'git reset --hard' },
  { re: /\bgit\s+clean\b[^|;]*\s-[dfx]{1,3}\b/, severity: 'destructive', reason: 'git clean -fd(x)' },
  { re: /\bgit\s+branch\b[^|;]*\s-D\b/, severity: 'destructive', reason: 'git branch -D (force delete)' },
  { re: /\bgit\s+update-ref\b[^|;]*\s-d\b/, severity: 'destructive', reason: 'git update-ref -d' },

  // SQL / datastore
  { re: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX)\b/i, severity: 'destructive', reason: 'SQL DROP' },
  { re: /\bTRUNCATE\s+TABLE\b/i, severity: 'destructive', reason: 'SQL TRUNCATE' },
  { re: /\bDELETE\s+FROM\b(?!\s*\S+\s+WHERE\b)/i, severity: 'destructive', reason: 'SQL DELETE without WHERE' },

  // Permission / owner wide changes
  { re: /\bchmod\b[^|;]*\s-R\b[^|;]*\s(?:777|000)\b/, severity: 'destructive', reason: 'chmod -R permissive/null' },
  { re: /\bchown\b[^|;]*\s-R\b\s+\/\b/, severity: 'destructive', reason: 'chown -R on /' },

  // Package / env wipes
  { re: /\bnpm\s+(?:unpublish)\b/, severity: 'destructive', reason: 'npm unpublish' },
  { re: /\byarn\s+(?:unpublish)\b/, severity: 'destructive', reason: 'yarn unpublish' },

  // Cloud / sudo escalation (severity: escalated — still gated)
  { re: /\bsudo\b/, severity: 'escalated', reason: 'sudo (root privileges)' },
  { re: /\bdoas\b/, severity: 'escalated', reason: 'doas (privilege escalation)' },
];

/** Inspect an argv or a raw command string. Returns the FIRST match
 *  (callers care about the most relevant warning — multiple matches
 *  would flood the chat log). Returns null when clean or when the
 *  Guardian is disabled. */
export function classifyDestructive(argvOrCommand: string[] | string): GuardianFinding | null {
  if (isGuardianDisabled()) return null;
  const cmd = Array.isArray(argvOrCommand) ? argvOrCommand.join(' ') : argvOrCommand;
  if (!cmd.trim()) return null;
  for (const rule of RULES) {
    const m = cmd.match(rule.re);
    if (m) {
      return {
        severity: rule.severity,
        reason: rule.reason,
        matched: m[0].slice(0, 80),
      };
    }
  }
  return null;
}

/** Test hook — flip patterns at runtime. Returns the previous list
 *  for chained restore. Not exported in the barrel; used only by
 *  integration tests that want to inject fixtures. */
export function _overrideRulesForTesting(rules: Rule[] | null): Rule[] {
  const prev = RULES.slice();
  if (rules !== null) {
    RULES.length = 0;
    RULES.push(...rules);
  }
  return prev;
}
