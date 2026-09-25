// PWA · B4 — craft-rulebook verdict hook.
//
// Wraps GET /v1/design-check. State changes when someone edits the active
// repository's DESIGN.md or when monad's vendored `docs/design/craft/`
// directory gains or loses a rulebook — both are human-paced edits, not
// machine churn, so this polls far more slowly than `useWorktrees` (5s).
// A 30s interval keeps the panel honest after an edit without spending a
// directory scan every few seconds on a value that rarely moves.

'use client';

import { useQuery } from '@tanstack/react-query';
import { useNexusClient } from './use-nexus-context';
import { nexusKeys } from './query-keys';
import type { DesignCheckResponse } from '../client';

export function useDesignCheck(opts: { enabled?: boolean } = {}) {
  const client = useNexusClient();
  return useQuery<DesignCheckResponse>({
    queryKey: nexusKeys.designCheck(),
    queryFn: () => client.getDesignCheck(),
    enabled: opts.enabled ?? true,
    refetchInterval: 30_000,
  });
}

/** One rulebook row as the panel renders it.
 *
 *  ⭐ Three states, not two. "Declared and present" vs "declared but missing"
 *  is the CLI's verdict; `available` (shipped by monad but NOT declared) is
 *  the state only this surface can show, and it is the actionable one — it
 *  answers "what could I turn on?" rather than "what did I break?". */
export type RulebookRowStatus = 'declared' | 'missing' | 'available';

export interface RulebookRow {
  name: string;
  status: RulebookRowStatus;
}

/** Projects the verdict lists into one sorted, de-duplicated row set.
 *
 *  Pure so the projection is unit-testable without react-query or a DOM —
 *  the panel then does nothing but paint what this returns.
 *
 *  ⛔ Sorted by SEVERITY first, name second. Alphabetical order alone would
 *  bury a missing rulebook in the middle of a long available list, and the
 *  missing ones are the whole reason a human opens this panel. */
export function projectRulebookRows(verdict: {
  declaredRulebooks: readonly string[];
  unavailableRulebooks: readonly string[];
  availableRulebooks: readonly string[];
}): RulebookRow[] {
  const missing = new Set(verdict.unavailableRulebooks);
  const rows = new Map<string, RulebookRowStatus>();
  // Declared names win over available ones: a name that is both declared and
  // shipped is "declared", not "available to add".
  for (const name of verdict.availableRulebooks) rows.set(name, 'available');
  for (const name of verdict.declaredRulebooks) {
    rows.set(name, missing.has(name) ? 'missing' : 'declared');
  }
  const rank: Record<RulebookRowStatus, number> = { missing: 0, declared: 1, available: 2 };
  return [...rows.entries()]
    .map(([name, status]) => ({ name, status }))
    .sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name));
}

/** Human sentence for a blocked verdict. Keyed off the discriminant rather
 *  than parsed out of prose, so a new `blockedOn` value is a compile error
 *  here instead of a silently generic message in the UI. */
export function describeBlocked(blockedOn: string, path: string | null): string {
  switch (blockedOn) {
    case 'no-repository':
      return 'The daemon is not running inside a git checkout, so there is no DESIGN.md to check.';
    case 'craft-directory':
      return `monad's craft rulebook directory could not be read: ${path ?? '(unknown path)'}`;
    case 'design-document':
      return `This repository has no readable DESIGN.md: ${path ?? '(unknown path)'}`;
    default:
      return `The design check is blocked (${blockedOn}).`;
  }
}
