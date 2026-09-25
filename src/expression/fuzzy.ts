// Fuzzy subsequence matcher — scores how well a query maps onto a
// target string by walking the query characters in order and finding
// the next match in the target. Inspired by VSCode's matchesFuzzy +
// fzf's bonus rules, kept tiny so we stay dep-free.
//
// Scoring intuition (higher = better):
//  - +12 per match char baseline (so 5-char match dominates 1-char)
//  - +20 contiguous bonus when two matched chars are adjacent in target
//  - +30 word-boundary bonus when the match lands at a word start
//        (start-of-string, after space/-/_/.)
//  - +50 prefix bonus when the very first match is at index 0
//  - exact substring fast-path returns score = 200 + length
//  - case-insensitive comparison; preserves match indices for
//    callers that want to highlight the matched chars
//
// `null` return = no match. Callers filter by truthiness, then sort
// descending by score.

export interface FuzzyMatch {
  /** Total score; higher is better. */
  score: number;
  /** Indices in `target` that matched query characters, in order. */
  indices: ReadonlyArray<number>;
}

const SCORE_PER_MATCH = 12;
const BONUS_CONTIGUOUS = 20;
const BONUS_WORD_BOUNDARY = 30;
const BONUS_PREFIX = 50;
const SUBSTRING_BASE = 200;

/** Score a `query` against a `target`. Returns null when not all
 *  query characters appear in target order. */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, indices: [] };
  if (target.length === 0) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Fast-path: exact substring match dominates everything else.
  const subIdx = t.indexOf(q);
  if (subIdx >= 0) {
    const indices: number[] = [];
    for (let i = 0; i < q.length; i++) indices.push(subIdx + i);
    let score = SUBSTRING_BASE + q.length;
    if (subIdx === 0) score += BONUS_PREFIX;
    if (isWordBoundary(t, subIdx)) score += BONUS_WORD_BOUNDARY;
    return { score, indices };
  }

  // Subsequence walk.
  const indices: number[] = [];
  let ti = 0;
  let qi = 0;
  let score = 0;
  let lastMatchIdx = -2;

  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      score += SCORE_PER_MATCH;
      if (ti === lastMatchIdx + 1) score += BONUS_CONTIGUOUS;
      if (isWordBoundary(t, ti)) score += BONUS_WORD_BOUNDARY;
      if (qi === 0 && ti === 0) score += BONUS_PREFIX;
      indices.push(ti);
      lastMatchIdx = ti;
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return null;
  return { score, indices };
}

/** Predicate — true when `target` index `i` lands at a word start.
 *  Word starts are: index 0, or the char after one of `[ \t\-_./]`. */
function isWordBoundary(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target.charCodeAt(i - 1);
  // Space, tab, hyphen, underscore, dot, forward slash.
  return prev === 32 || prev === 9 || prev === 45 || prev === 95 || prev === 46 || prev === 47;
}

export interface FuzzyRanked<T> {
  item: T;
  match: FuzzyMatch;
}

/** Filter + rank `items` by `query`. Items that don't match are
 *  dropped. The remaining are sorted by score descending; ties
 *  preserve input order (stable). */
export function fuzzyRank<T>(
  items: ReadonlyArray<T>,
  query: string,
  pick: (item: T) => string,
): FuzzyRanked<T>[] {
  if (query.length === 0) {
    return items.map((item) => ({ item, match: { score: 0, indices: [] } }));
  }
  const matched: Array<FuzzyRanked<T> & { idx: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const m = fuzzyMatch(query, pick(item));
    if (m !== null) matched.push({ item, match: m, idx: i });
  }
  matched.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return a.idx - b.idx;
  });
  return matched.map(({ item, match }) => ({ item, match }));
}
