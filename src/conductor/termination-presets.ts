// ── §5-① goalKind-scoped Termination DSL presets ──
//
// Maps each Conductor GoalKind to a sensible default "done" rule, so a
// goal can be dispatched with an objective completion gate without the
// operator hand-writing a TerminationRule every time.
//
// See 내부 문서 `RESEARCH-loop-engineering-vs-pfc-dual-loop-2026-07-01` §5-①
// and 내부 문서 `CONCEPT-self-hosting-loop-2026-07-01`. Additive — does not
// modify termination-dsl.ts behavior.

import type { GoalKind } from './types.js';
import type { TerminationRule } from '../auto-research/termination-dsl.js';

/**
 * Returns a goalKind-scoped Termination DSL preset — a well-formed
 * {@link TerminationRule} with sensible defaults per kind. Unknown kinds
 * fall back to a conservative rule that requires an explicit `DONE.md`
 * marker (never trivially satisfied).
 */
export function terminationPresetFor(kind: GoalKind): TerminationRule {
  switch (kind) {
    case 'coding':
      // green build: tests + typecheck pass, and a PR note is written.
      return {
        kind: 'and',
        rules: [
          { kind: 'custom', command: 'bun test', timeoutMs: 600_000 },
          { kind: 'custom', command: 'bun run typecheck', timeoutMs: 300_000 },
          { kind: 'summary_written', path: 'PR.md', minChars: 1 },
        ],
      };

    case 'refactor':
      // behavior preserved (tests green) + a scoped, non-empty diff exists.
      return {
        kind: 'and',
        rules: [
          { kind: 'custom', command: 'bun test', timeoutMs: 600_000 },
          { kind: 'custom', command: 'test -n "$(git diff --stat)"', timeoutMs: 15_000 },
        ],
      };

    case 'research':
      // enough evidence gathered + a written summary.
      return {
        kind: 'and',
        rules: [
          { kind: 'min_sources', n: 3, sourcesPath: 'sources.md' },
          { kind: 'summary_written', path: 'SUMMARY.md', minChars: 500 },
        ],
      };

    case 'analysis':
      // an analysis artifact of non-trivial length.
      return { kind: 'summary_written', path: 'ANALYSIS.md', minChars: 300 };

    case 'monitoring':
      // the monitor is established and its check passes at least once.
      return {
        kind: 'and',
        rules: [
          { kind: 'summary_written', path: 'MONITOR.md', minChars: 1 },
          { kind: 'custom', command: 'test -f MONITOR.md', timeoutMs: 15_000 },
        ],
      };

    default:
      // Closed union makes this unreachable; keep a conservative fallback
      // (an explicit DONE marker) rather than a vacuously-true empty `and`.
      return { kind: 'summary_written', path: 'DONE.md', minChars: 1 };
  }
}
