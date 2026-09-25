// Closest-match tool-name suggestion — BACKLOG #2 (2026-05-05).
//
// When the LLM hallucinates a tool name (e.g. `Bash` on a non-shell
// runtime, `EditFile` instead of `Edit`, `read` instead of `Read`),
// the dispatch fallback at `src/llm.ts:tool-loop.tool-name.invalid`
// returns an `INVALID TOOL` stub. Without a closest-match hint the
// model has to re-scan the catalog before its next attempt — one
// wasted turn. Injecting top-3 Levenshtein candidates lets the model
// self-recover in the same turn budget.
//
// Case-insensitive distance: case-only mismatches (`read` → `Read`)
// already get caught by the upstream `repaired` path; this helper
// runs only after that path missed, so true near-misses are typos
// or shape variants. Keeping the comparison case-insensitive makes
// the rank stable across providers that lowercase tool names in
// some surfaces.

/** Levenshtein edit distance between two strings (case-insensitive).
 *  Iterative two-row implementation; O(|a| × |b|) time, O(min) space. */
export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 0;
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;

  let prev = new Array<number>(y.length + 1);
  let curr = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;

  for (let i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[y.length];
}

/** Return up to `k` closest matches to `attempted` from `available`,
 *  ranked by Levenshtein distance ascending then alphabetic. Filters
 *  out candidates whose distance exceeds `maxDistance` (default 4)
 *  to avoid surfacing nonsense suggestions when the attempted name
 *  is wildly off (e.g. `xyz123` against a 20-tool catalog). */
export function closestMatches(
  attempted: string,
  available: readonly string[],
  k = 3,
  maxDistance = 4,
): string[] {
  if (available.length === 0 || attempted.length === 0) return [];
  const scored = available
    .map(name => ({ name, dist: editDistance(attempted, name) }))
    .filter(s => s.dist <= maxDistance);
  scored.sort((a, b) => a.dist - b.dist || a.name.localeCompare(b.name));
  return scored.slice(0, k).map(s => s.name);
}
