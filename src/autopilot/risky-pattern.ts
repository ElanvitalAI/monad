// src/autopilot/risky-pattern.ts
//
// ROADMAP-ipad-companion-autopilot-priority §D1.1 — safety substrate.
//
// Detects risky patterns inside autopilot tool-call arguments (shell
// commands, git operations, network pipes). The detector is a pure
// function — D1.1 follow-up wires it into AutopilotLoopDriver's
// `onUpdate` for `tool_call` SessionUpdate events.
//
// Severity:
//   - `high`  — destructive, privileged, or remote-execution patterns.
//               Default policy: deny + turn cancel + termination .error.
//   - `medium` — recoverable but not user-intended by default (git
//                reset --hard, --no-verify, chmod -R 777 /). Default
//                policy: HITL approval prompt.
//
// Non-goals (intentional first cut):
//   - This is a heuristic — not a sandbox. A determined adversary will
//     bypass regex (base64-encoded payloads, eval(), etc.). Defense in
//     depth: pair with the `agent-cli` HITL approver + sandbox cwd
//     enforcement (D1.1c follow-up) + per-tool allowlist.
//   - Glob-aware path matching deferred — current rules treat path
//     literals as substrings.

/** A single match against a known risky shape. */
export interface RiskyPattern {
  /** Stable id for telemetry + tests (e.g. `"rm-rf"`, `"force-push"`). */
  kind: string;
  /** Exact substring that matched the regex — useful for UI surfacing. */
  match: string;
  /** Policy hint — caller may override based on session config. */
  severity: 'high' | 'medium';
  /** Free-form description for HITL UI / log messages. */
  description: string;
}

interface RuleSpec {
  kind: string;
  regex: RegExp;
  severity: 'high' | 'medium';
  description: string;
}

/**
 * Curated list of risky shapes. Ordered by check priority — first match
 * wins so put more specific rules before broader ones (e.g. `rm-root`
 * before generic `rm-rf` if both would match).
 *
 * To add a rule: append here, then add a unit case in the harness when
 * D1.1 lands the test scaffold.
 */
const RULES: RuleSpec[] = [
  {
    kind: 'rm-rf',
    regex: /\brm\s+-[A-Za-z]*r[A-Za-z]*f/,
    severity: 'high',
    description: 'Recursive force delete (rm -rf …).',
  },
  {
    kind: 'rm-rf',
    regex: /\brm\s+-[A-Za-z]*f[A-Za-z]*r/,
    severity: 'high',
    description: 'Recursive force delete (rm -fr …).',
  },
  {
    kind: 'rm-root',
    regex: /\brm\s+(?:-[A-Za-z]+\s+)*\/(?:\s|$)/,
    severity: 'high',
    description: 'Delete operation rooted at filesystem root.',
  },
  {
    kind: 'sudo',
    regex: /\bsudo\b/,
    severity: 'high',
    description: 'Privileged execution requested (sudo).',
  },
  {
    kind: 'force-push',
    regex: /\bgit\s+push\b[^|;&\n]*--force\b/,
    severity: 'high',
    description: 'Force push to remote (git push --force).',
  },
  {
    kind: 'force-push',
    regex: /\bgit\s+push\b[^|;&\n]*\s-f(?:\s|$)/,
    severity: 'high',
    description: 'Force push short form (git push -f).',
  },
  {
    kind: 'fork-bomb',
    regex: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    severity: 'high',
    description: 'Bash fork bomb signature.',
  },
  {
    kind: 'curl-pipe-shell',
    regex: /\bcurl\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/,
    severity: 'high',
    description: 'Remote script piped into a shell (curl | bash).',
  },
  {
    kind: 'wget-pipe-shell',
    regex: /\bwget\b[^|]*\|\s*(?:bash|sh|zsh|fish)\b/,
    severity: 'high',
    description: 'Remote script piped into a shell (wget | bash).',
  },
  {
    kind: 'dd-disk',
    regex: /\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|hd)[a-z0-9]+/,
    severity: 'high',
    description: 'Direct write to a block device (dd of=/dev/…).',
  },
  {
    kind: 'mkfs',
    regex: /\bmkfs(?:\.[a-z0-9]+)?\b\s+\/dev\//,
    severity: 'high',
    description: 'Filesystem creation on a device node (mkfs).',
  },
  {
    kind: 'reset-hard',
    regex: /\bgit\s+reset\s+--hard\b/,
    severity: 'medium',
    description: 'Destructive working-tree reset (git reset --hard).',
  },
  {
    kind: 'no-verify',
    regex: /\bgit\s+commit\b[^|;&\n]*--no-verify\b/,
    severity: 'medium',
    description: 'Commit hooks bypassed (--no-verify).',
  },
  {
    kind: 'chmod-777-root',
    regex: /\bchmod\s+(?:-R\s+)?777\s+\//,
    severity: 'medium',
    description: 'World-writable mode on a root-anchored path.',
  },
  {
    kind: 'eval-input',
    regex: /\beval\s+["'`]?\$\(/,
    severity: 'medium',
    description: 'Shell eval consuming subshell output.',
  },
];

/**
 * Scan a plain text string for the first risky pattern match. Returns
 * `null` when nothing matches.
 *
 * The check is intentionally substring-based — call sites should
 * normalize quoted/escaped command text upstream (e.g. JSON-stringify
 * tool call arguments) before passing here.
 */
export function detectRiskyPattern(text: string): RiskyPattern | null {
  if (!text) return null;
  for (const rule of RULES) {
    const match = text.match(rule.regex);
    if (match) {
      return {
        kind: rule.kind,
        match: match[0],
        severity: rule.severity,
        description: rule.description,
      };
    }
  }
  return null;
}

/**
 * Scan a structured tool-call argument bag for risky patterns. Accepts
 * a string (shell command) or an object whose JSON serialization is
 * scanned. `null` / `undefined` returns `null`.
 */
export function scanRiskyToolCall(args: unknown): RiskyPattern | null {
  if (args == null) return null;
  const serialized = typeof args === 'string' ? args : safeStringify(args);
  return detectRiskyPattern(serialized);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Convenience: return all matches (not just the first). Useful for
 * surfaces that want to display every flagged pattern, not just the
 * earliest one in `RULES`.
 */
export function detectAllRiskyPatterns(text: string): RiskyPattern[] {
  if (!text) return [];
  const out: RiskyPattern[] = [];
  for (const rule of RULES) {
    const match = text.match(rule.regex);
    if (match) {
      out.push({
        kind: rule.kind,
        match: match[0],
        severity: rule.severity,
        description: rule.description,
      });
    }
  }
  return out;
}
